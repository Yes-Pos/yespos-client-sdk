import type { PaymentMethodCode } from './payment.js';

export interface OrderItem {
	product_name: string;
	quantity: number;
	price: number;
	total: number;
}

export interface SplitItem {
	va: string;
	amount: number;
	status?: string;
}

export interface Customer {
	name: string;
	email: string;
	phone: string;
}

export interface Order {
	uuid: string;
	total_payment: number;
	payment_method: PaymentMethodCode;
	payment_channel?: string;
	/** "pending" first, then "<status>_<settlement>", e.g. "berhasil_settled". */
	status: string;
	/** QRIS: render as a QR code. */
	qr_string?: string;
	/** EDC: link to open on the terminal. */
	app_link?: string;
	/** Virtual account number, holder name and deadline. */
	payment_no?: string;
	payment_name?: string;
	expired_at?: string;
	items: OrderItem[];
	/** The buyer; missing for orders created before YesPOS saved buyers. */
	customer?: Customer;
	split?: SplitItem[];
	notify_url?: string;
	reference_ipaymu?: string;
	created_at: string;
}

export interface CreateOrderInput extends Customer {
	total_payment: number;
	payment_method: string;
	/** Required when the method has more than one activated channel, e.g. a VA bank. */
	payment_channel?: string;
	items: OrderItem[];
	notify_url?: string;
	split?: SplitItem[];
	app_code?: string;
	terminal_code?: string;
	merchant_code?: string;
}

export interface ChangeOrderPaymentInput {
	payment_method: string;
	payment_channel?: string;
	/** Only for an order with no buyer saved; it is then saved with the order. */
	name?: string;
	email?: string;
	phone?: string;
	app_code?: string;
	terminal_code?: string;
	merchant_code?: string;
}

export interface OrderListParams {
	page?: number;
	limit?: number;
}

export interface OrderList {
	data: Order[];
	total: number;
	page: number;
	limit: number;
}

export type OrderState = 'pending' | 'paid' | 'failed';
