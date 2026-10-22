import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const KEY = 'test-key';
export const SECRET = 'test-secret';

/** What the mock recorded, so a test can assert on what the SDK sent. */
export interface Recorded {
	method: string;
	path: string;
	body: unknown;
	headers: Record<string, string | undefined>;
}

const categories = [
	{
		category_uuid: 'c1',
		category_name: 'Makanan',
		products: [
			{
				uuid: 'p1',
				name: 'Nasi Goreng',
				price: 25000,
				unit: 'porsi',
				type: 'fnb_main_product',
				current_stock: 0,
				track_stock: false,
				main_image_token: 'img1',
				main_image_url: 'https://cdn.example.com/media/img1',
				variants: []
			},
			{
				uuid: 'p2',
				name: 'Kopi Susu',
				price: 18000,
				unit: 'cup',
				type: 'fnb_main_product',
				current_stock: 0,
				track_stock: true,
				variants: [
					{ uuid: 'v1', name: 'Kecil', price: 18000, current_stock: 5 },
					{ uuid: 'v2', name: 'Besar', price: 24000, current_stock: 0 }
				]
			}
		]
	},
	// A product may sit in several categories; the SDK must list it once.
	{ category_uuid: 'c2', category_name: 'Favorit', products: [] as unknown[] }
];
(categories[1]!.products as unknown[]).push(categories[0]!.products[0]!);

const methods = [
	{ name: 'QRIS', type: 'qris', issuer: 'iPaymu', payment_method: 'qris', payment_channel: 'qris', required_fields: [] },
	{ name: 'BCA', type: 'bank_transfer', issuer: 'iPaymu', payment_method: 'va', payment_channel: 'bca', required_fields: [] },
	{
		name: 'Credit Card',
		type: 'credit_card',
		issuer: 'TSM',
		payment_method: 'edc',
		payment_channel: 'linkpayment',
		required_fields: ['app_code', 'terminal_code', 'merchant_code']
	}
];

export interface MockServer {
	url: string;
	recorded: Recorded[];
	/** Replies to the next request with this status and body, then clears. */
	failNext(status: number, body: unknown): void;
	close(): Promise<void>;
}

/**
 * A YesPOS client API good enough to test the SDK against: it verifies the
 * signature exactly like ClientAuthMiddleware does.
 */
export async function startMockServer(): Promise<MockServer> {
	const recorded: Recorded[] = [];
	const orders = new Map<string, Record<string, unknown>>();
	let failure: { status: number; body: unknown } | undefined;

	const server: Server = createServer((req, res) => {
		let raw = '';
		req.on('data', (chunk) => (raw += chunk));
		req.on('end', () => {
			const json = (status: number, body: unknown) => {
				res.writeHead(status, { 'content-type': 'application/json' });
				res.end(JSON.stringify(body));
			};
			const url = new URL(req.url ?? '/', 'http://mock');
			const path = url.pathname.replace('/api/client', '');

			if (url.pathname.startsWith('/media/')) {
				res.writeHead(200, { 'content-type': 'image/png' });
				return res.end(Buffer.from('iVBORw0KGgo=', 'base64'));
			}

			// Same check as the backend: HMAC over METHOD:key:sha256(body):secret.
			const bodyHash = createHash('sha256').update(raw.trim() || '{}').digest('hex');
			const expected = createHmac('sha256', SECRET)
				.update(`${req.method}:${KEY}:${bodyHash}:${SECRET}`)
				.digest('hex');
			if (req.headers.va !== KEY || req.headers.signature !== expected) {
				return json(401, { message: 'Signature Tidak Sesuai (Invalid signature)' });
			}

			recorded.push({
				method: req.method ?? '',
				path,
				body: raw ? JSON.parse(raw) : undefined,
				headers: { 'accept-language': req.headers['accept-language'] as string | undefined }
			});

			if (failure) {
				const { status, body } = failure;
				failure = undefined;
				return json(status, body);
			}

			if (req.method === 'GET' && path === '/outlets') {
				return json(200, { data: [{ uuid: 'o1', name: 'Cabang Sudirman' }, { uuid: 'o2', name: 'Cabang Thamrin' }] });
			}
			if (req.method === 'GET' && /^\/outlets\/[^/]+\/products$/.test(path)) return json(200, { data: categories });
			let match: RegExpMatchArray | null;
			if (req.method === 'GET' && (match = path.match(/^\/outlets\/[^/]+\/products\/(.+)$/))) {
				const product = categories.flatMap((c) => c.products as { uuid: string }[]).find((p) => p.uuid === match![1]);
				return product ? json(200, { data: { ...product, categories: ['Makanan'] } }) : json(404, { message: 'Produk tidak ditemukan.' });
			}
			if (req.method === 'GET' && path === '/payment-method') return json(200, { data: methods });
			if (req.method === 'GET' && path === '/orders') {
				return json(200, { data: { data: [...orders.values()], total: orders.size, page: 1, limit: 10 } });
			}
			if (req.method === 'POST' && path === '/orders') {
				const input = JSON.parse(raw);
				const order: Record<string, unknown> = {
					uuid: randomUUID(),
					total_payment: input.total_payment,
					payment_method: input.payment_method,
					payment_channel: input.payment_channel,
					status: 'pending',
					items: input.items,
					customer: { name: input.name, email: input.email, phone: input.phone },
					created_at: new Date().toISOString(),
					...(input.payment_method === 'qris' ? { qr_string: '00020101021226' } : {}),
					...(input.payment_method === 'va' ? { payment_no: '8002300000123456', payment_name: 'IPAYMU' } : {}),
					...(input.payment_method === 'edc' ? { app_link: 'https://erpay.id/payment?data=ABC' } : {})
				};
				orders.set(order.uuid as string, order);
				return json(201, { data: order });
			}
			if (req.method === 'POST' && (match = path.match(/^\/orders\/([^/]+)\/payment-method$/))) {
				const order = orders.get(match[1]!);
				if (!order) return json(404, { message: 'Order tidak ditemukan.' });
				if (order.status !== 'pending') return json(409, { message: 'Order sudah tidak pending.' });
				const input = JSON.parse(raw);
				for (const key of ['qr_string', 'payment_no', 'payment_name', 'app_link']) delete order[key];
				order.payment_method = input.payment_method;
				order.payment_channel = input.payment_channel;
				if (input.payment_method === 'qris') order.qr_string = 'NEWQR';
				if (input.payment_method === 'va') order.payment_no = '8002300000999999';
				if (input.payment_method === 'edc') order.app_link = 'https://erpay.id/payment?data=NEW';
				return json(200, { data: order });
			}
			if (req.method === 'GET' && (match = path.match(/^\/orders\/(.+)$/))) {
				const order = orders.get(match[1]!);
				return order ? json(200, { data: order }) : json(400, { message: 'record not found' });
			}
			json(404, { message: 'not found' });
		});
	});

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		recorded,
		failNext: (status, body) => {
			failure = { status, body };
		},
		close: () => new Promise((resolve) => server.close(() => resolve()))
	};
}
