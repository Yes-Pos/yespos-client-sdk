import type { HttpClient } from '../http.js';
import type { ChangeOrderPaymentInput, CreateOrderInput, Order, OrderList, OrderListParams } from '../types/index.js';

/** Orders of the client. */
export class Orders {
	constructor(private readonly http: HttpClient) {}

	/**
	 * Places an order and asks iPaymu or TSM to collect it. The response carries
	 * what the buyer needs: `qr_string` (QRIS), `payment_no` and `expired_at`
	 * (virtual account), or `app_link` (EDC).
	 */
	create(input: CreateOrderInput): Promise<Order> {
		return this.http.post<Order>('/orders', input);
	}

	/** One order with its current status and payment details. */
	get(uuid: string): Promise<Order> {
		return this.http.get<Order>(`/orders/${encodeURIComponent(uuid)}`);
	}

	/** Orders of the client, newest first. */
	list(params: OrderListParams = {}): Promise<OrderList> {
		return this.http.get<OrderList>('/orders', { page: params.page, limit: params.limit });
	}

	/**
	 * Switches a pending order to another activated payment method, keeping its
	 * total, items, split and buyer. Sending the method it already uses renews
	 * the payment, e.g. an expired virtual account.
	 */
	changePaymentMethod(uuid: string, input: ChangeOrderPaymentInput): Promise<Order> {
		return this.http.post<Order>(`/orders/${encodeURIComponent(uuid)}/payment-method`, input);
	}
}
