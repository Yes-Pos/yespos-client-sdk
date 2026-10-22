import { YesposError } from './errors.js';
import { YesposClient } from './client.js';
import type { YesposClientOptions } from './http.js';
import type {
	CartLine,
	ChangeOrderPaymentInput,
	Customer,
	EdcTerminal,
	Order,
	OrderItem,
	Outlet,
	PaymentMethod,
	ProductCategory,
	ProductDetail
} from './types/index.js';

export interface ShopOptions {
	/** The outlet to sell from. Left out, the client owner's first outlet is used. */
	outletUuid?: string;
	/** Where YesPOS sends order status callbacks. */
	notifyUrl?: string;
	/** The EDC terminal to charge card payments to; without it EDC is hidden. */
	edc?: EdcTerminal | null;
	/** Messages shown to the shopper, so a storefront can translate them. */
	messages?: Partial<ShopMessages>;
}

export interface ShopMessages {
	outletNotFound: string;
	productUnavailable: string;
	methodUnavailable: string;
}

const defaultMessages: ShopMessages = {
	outletNotFound: 'Outlet toko tidak ditemukan. Periksa outletUuid.',
	productUnavailable: 'Ada produk di keranjang yang sudah tidak tersedia. Hapus lalu coba lagi.',
	methodUnavailable: 'Metode pembayaran tidak tersedia.'
};

/** "<method>:<channel>", e.g. "va:bca" — how a storefront names a payment choice. */
export type PaymentValue = string;

/** The form value of a payment method: "<method>:<channel>". */
export const paymentValue = (method: Pick<PaymentMethod, 'payment_method' | 'payment_channel'>): PaymentValue =>
	`${method.payment_method}:${method.payment_channel}`;

/**
 * A storefront on top of {@link YesposClient}: it knows which outlet to sell
 * from, hides EDC when no terminal is configured, and — most importantly —
 * **prices every order from the API**, so a tampered cart cannot change what the
 * buyer is charged.
 *
 * ```ts
 * const shop = new Shop({ baseUrl, key, secret }, { outletUuid, edc });
 * const order = await shop.placeOrder(
 *   [{ productUuid: 'abc', quantity: 2 }],
 *   { name: 'Budi', email: 'budi@example.com', phone: '0812' },
 *   'va:bca'
 * );
 * ```
 */
export class Shop {
	readonly client: YesposClient;
	private readonly messages: ShopMessages;

	constructor(
		client: YesposClient | YesposClientOptions,
		private readonly options: ShopOptions = {}
	) {
		this.client = client instanceof YesposClient ? client : new YesposClient(client);
		this.messages = { ...defaultMessages, ...options.messages };
	}

	/** Public URL of an uploaded image. */
	mediaUrl(token: string): string {
		return this.client.mediaUrl(token);
	}

	/** The outlet the shop sells from: `outletUuid`, or the owner's first outlet. */
	async outlet(): Promise<Outlet> {
		const outlets = await this.client.outlets.list();
		const outlet = this.options.outletUuid ? outlets.find((item) => item.uuid === this.options.outletUuid) : outlets[0];
		if (!outlet) throw new YesposError(404, this.messages.outletNotFound);
		return outlet;
	}

	/** Products of the shop outlet, grouped by category. */
	async products(): Promise<ProductCategory[]> {
		return this.client.products.list((await this.outlet()).uuid);
	}

	/** One product of the shop outlet. */
	async product(productUuid: string): Promise<ProductDetail> {
		return this.client.products.get((await this.outlet()).uuid, productUuid);
	}

	/** Activated payment methods; EDC only when a terminal is configured. */
	async paymentMethods(): Promise<PaymentMethod[]> {
		const methods = await this.client.paymentMethods.list();
		return methods.filter((method) => method.payment_method !== 'edc' || !!this.options.edc);
	}

	/** One order of the shop. */
	order(uuid: string): Promise<Order> {
		return this.client.orders.get(uuid);
	}

	/**
	 * Turns cart lines into order items, pricing each one from the API. Throws
	 * when a line points at a product or variant the outlet no longer sells.
	 */
	async priceCart(lines: CartLine[]): Promise<OrderItem[]> {
		const products = await this.client.products.map((await this.outlet()).uuid);
		return lines.map((line) => {
			const product = products.get(line.productUuid);
			const variant = line.variantUuid ? product?.variants?.find((item) => item.uuid === line.variantUuid) : undefined;
			if (!product || (line.variantUuid && !variant)) {
				throw new YesposError(409, this.messages.productUnavailable);
			}
			const quantity = Math.max(1, Math.floor(line.quantity));
			const price = Math.round(variant ? variant.price : product.price);
			return {
				product_name: variant ? `${product.name} - ${variant.name}` : product.name,
				quantity,
				price,
				total: price * quantity
			};
		});
	}

	/**
	 * Places an order for the cart lines. Prices come from the API, never from the
	 * caller, and the payment method must be one the client owner activated.
	 */
	async placeOrder(lines: CartLine[], customer: Customer, payment: PaymentValue): Promise<Order> {
		const items = await this.priceCart(lines);
		const { method, channel } = await this.resolvePayment(payment);
		return this.client.orders.create({
			total_payment: items.reduce((sum, item) => sum + item.total, 0),
			payment_method: method,
			payment_channel: channel,
			...customer,
			items,
			...(this.options.notifyUrl ? { notify_url: this.options.notifyUrl } : {}),
			...(method === 'edc' && this.options.edc ? this.options.edc : {})
		});
	}

	/**
	 * Switches a pending order to another activated payment method. YesPOS keeps
	 * the total, items, split and buyer, and returns the new instructions.
	 */
	async changePayment(uuid: string, payment: PaymentValue, customer?: Partial<Customer>): Promise<Order> {
		const { method, channel } = await this.resolvePayment(payment);
		const input: ChangeOrderPaymentInput = {
			payment_method: method,
			payment_channel: channel,
			...(customer?.name ? { name: customer.name, email: customer.email, phone: customer.phone } : {}),
			...(method === 'edc' && this.options.edc ? this.options.edc : {})
		};
		return this.client.orders.changePaymentMethod(uuid, input);
	}

	/** Checks "<method>:<channel>" against the activated methods. */
	private async resolvePayment(payment: PaymentValue): Promise<{ method: string; channel: string }> {
		const [method = '', channel = ''] = payment.split(':');
		const available = await this.paymentMethods();
		if (!available.some((item) => item.payment_method === method && item.payment_channel === channel)) {
			throw new YesposError(400, this.messages.methodUnavailable);
		}
		return { method, channel };
	}
}

/**
 * Builds a shop from the usual environment variables: `YESPOS_API_BASE_URL`,
 * `YESPOS_CLIENT_KEY`, `YESPOS_CLIENT_SECRET`, `YESPOS_OUTLET_UUID`,
 * `YESPOS_NOTIFY_URL` and `YESPOS_EDC_APP_CODE` / `_TERMINAL_CODE` / `_MERCHANT_CODE`.
 */
export function shopFromEnv(env: Record<string, string | undefined> = process.env, options: ShopOptions = {}): Shop {
	const edc =
		env.YESPOS_EDC_APP_CODE && env.YESPOS_EDC_TERMINAL_CODE && env.YESPOS_EDC_MERCHANT_CODE
			? {
					app_code: env.YESPOS_EDC_APP_CODE,
					terminal_code: env.YESPOS_EDC_TERMINAL_CODE,
					merchant_code: env.YESPOS_EDC_MERCHANT_CODE
				}
			: null;
	return new Shop(
		{
			baseUrl: env.YESPOS_API_BASE_URL ?? '',
			key: env.YESPOS_CLIENT_KEY ?? '',
			secret: env.YESPOS_CLIENT_SECRET ?? ''
		},
		{ outletUuid: env.YESPOS_OUTLET_UUID, notifyUrl: env.YESPOS_NOTIFY_URL, edc, ...options }
	);
}
