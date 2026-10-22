export type PaymentMethodCode = 'qris' | 'va' | 'edc';

/** A payment method the client owner activated (GET /api/client/payment-method). */
export interface PaymentMethod {
	name: string;
	type: string;
	issuer: string;
	payment_method: PaymentMethodCode;
	payment_channel: string;
	/** Extra order fields this method needs, e.g. the EDC terminal codes. */
	required_fields: string[];
}

/** The EDC terminal an order is charged to. */
export interface EdcTerminal {
	app_code: string;
	terminal_code: string;
	merchant_code: string;
}
