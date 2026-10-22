import { HttpClient, type YesposClientOptions } from './http.js';
import { Orders, Outlets, PaymentMethods, Products } from './resources/index.js';

/**
 * The YesPOS Client API (`/api/client/*`).
 *
 * Every request is signed with the client secret, so this must run on a server:
 * never ship the secret to a browser.
 *
 * ```ts
 * const yespos = new YesposClient({ baseUrl, key, secret });
 * const outlets = await yespos.outlets.list();
 * const products = await yespos.products.list(outlets[0].uuid);
 * ```
 */
export class YesposClient {
	readonly http: HttpClient;
	readonly outlets: Outlets;
	readonly products: Products;
	readonly paymentMethods: PaymentMethods;
	readonly orders: Orders;

	constructor(options: YesposClientOptions) {
		this.http = new HttpClient(options);
		this.outlets = new Outlets(this.http);
		this.products = new Products(this.http);
		this.paymentMethods = new PaymentMethods(this.http);
		this.orders = new Orders(this.http);
	}

	/** Public URL of an uploaded image; GET /media/:token needs no login. */
	mediaUrl(token: string): string {
		return this.http.mediaUrl(token);
	}
}

/**
 * Builds a client from the usual environment variables:
 * `YESPOS_API_BASE_URL`, `YESPOS_CLIENT_KEY`, `YESPOS_CLIENT_SECRET`.
 */
export function clientFromEnv(env: Record<string, string | undefined> = process.env): YesposClient {
	return new YesposClient({
		baseUrl: env.YESPOS_API_BASE_URL ?? '',
		key: env.YESPOS_CLIENT_KEY ?? '',
		secret: env.YESPOS_CLIENT_SECRET ?? ''
	});
}
