import { YesposError } from './errors.js';

/** A fetch implementation; defaults to the runtime's global `fetch`. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface YesposClientOptions {
	/** Base URL of the YesPOS API, e.g. "https://api.yespos.id" (no trailing slash needed). */
	baseUrl: string;
	/** Client credential key, sent as the `va` header. */
	key: string;
	/** Client credential secret. It signs every request and must stay on the server. */
	secret: string;
	/** Request timeout in ms (default 15000). */
	timeout?: number;
	/** Language of the API's messages (default "id"). */
	language?: string;
	/** Custom fetch, e.g. one with a proxy agent or retries. */
	fetch?: FetchLike;
}

const toHex = (buffer: ArrayBuffer) =>
	[...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const subtle = (): SubtleCrypto => {
	const webcrypto = (globalThis as { crypto?: Crypto }).crypto;
	if (!webcrypto?.subtle) {
		throw new YesposError(500, 'Web Crypto tidak tersedia. Butuh Node 20+, Deno, Bun, atau runtime edge.');
	}
	return webcrypto.subtle;
};

/**
 * Signs a request the way YesPOS's ClientAuthMiddleware checks it:
 * HMAC-SHA256(secret, `${METHOD}:${key}:${sha256(body)}:${secret}`), where an
 * empty body is signed as "{}".
 */
export async function signRequest(method: string, key: string, secret: string, body: string): Promise<string> {
	const encoder = new TextEncoder();
	const bodyHash = toHex(await subtle().digest('SHA-256', encoder.encode(body || '{}')));
	const message = `${method.toUpperCase()}:${key}:${bodyHash}:${secret}`;
	const signingKey = await subtle().importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	return toHex(await subtle().sign('HMAC', signingKey, encoder.encode(message)));
}

/** The API's success envelope: `{ message, data }`. */
interface Envelope<T> {
	message?: string;
	data?: T;
}

interface ErrorBody {
	message?: string | string[];
	details?: unknown;
}

/**
 * Transport for /api/client: signs every request and unwraps the `data` field.
 * Used by the resources; reach for it directly only for an endpoint the SDK
 * does not cover yet.
 */
export class HttpClient {
	private readonly baseUrl: string;
	private readonly timeout: number;
	private readonly language: string;
	private readonly doFetch: FetchLike;

	constructor(private readonly options: YesposClientOptions) {
		const baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
		if (!baseUrl || !options.key || !options.secret) {
			throw new YesposError(500, 'baseUrl, key dan secret wajib diisi saat membuat YesposClient.');
		}
		const runtimeFetch = options.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
		if (!runtimeFetch) {
			throw new YesposError(500, 'fetch tidak tersedia. Pakai Node 18+ atau berikan opsi `fetch`.');
		}
		this.baseUrl = baseUrl;
		this.timeout = options.timeout ?? 15_000;
		this.language = options.language ?? 'id';
		this.doFetch = runtimeFetch;
	}

	/** Public URL of an uploaded file; GET /media/:token needs no login. */
	mediaUrl(token: string): string {
		return `${this.baseUrl}/media/${encodeURIComponent(token)}`;
	}

	get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
		return this.request<T>('GET', path, undefined, query);
	}

	post<T>(path: string, body?: unknown): Promise<T> {
		return this.request<T>('POST', path, body);
	}

	async request<T>(
		method: string,
		path: string,
		body?: unknown,
		query?: Record<string, string | number | undefined>
	): Promise<T> {
		// Serialize here so the signature covers exactly what is sent.
		const payload = body === undefined ? '' : JSON.stringify(body);
		const signature = await signRequest(method, this.options.key, this.options.secret, payload);

		const url = new URL(`${this.baseUrl}/api/client${path}`);
		for (const [name, value] of Object.entries(query ?? {})) {
			if (value !== undefined && value !== '') url.searchParams.set(name, String(value));
		}

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeout);
		let response: Response;
		try {
			response = await this.doFetch(url.toString(), {
				method,
				headers: {
					'Content-Type': 'application/json',
					'Accept-Language': this.language,
					va: this.options.key,
					signature,
					timestamp: String(Math.floor(Date.now() / 1000))
				},
				body: payload || undefined,
				signal: controller.signal
			});
		} catch (error) {
			const aborted = error instanceof Error && error.name === 'AbortError';
			throw new YesposError(0, aborted ? 'Permintaan ke YesPOS melebihi batas waktu.' : 'Tidak dapat terhubung ke server YesPOS.');
		} finally {
			clearTimeout(timer);
		}

		const text = await response.text();
		let parsed: unknown;
		try {
			parsed = text ? JSON.parse(text) : {};
		} catch {
			parsed = {};
		}

		if (!response.ok) {
			const error = parsed as ErrorBody;
			const message = Array.isArray(error.message) ? error.message.join(' ') : error.message;
			throw new YesposError(response.status, message || `Permintaan gagal (${response.status}).`, error.details);
		}
		return (parsed as Envelope<T>).data as T;
	}
}
