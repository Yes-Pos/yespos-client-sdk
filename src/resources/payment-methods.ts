import type { HttpClient } from '../http.js';
import type { PaymentMethod } from '../types/index.js';

/** Payment methods an order may use. */
export class PaymentMethods {
	constructor(private readonly http: HttpClient) {}

	/**
	 * The methods the client owner activated: QRIS, virtual accounts per bank and
	 * EDC. A method missing here cannot be used for an order.
	 */
	async list(): Promise<PaymentMethod[]> {
		return (await this.http.get<PaymentMethod[] | null>('/payment-method')) ?? [];
	}
}
