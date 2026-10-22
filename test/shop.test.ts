import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Shop, YesposClient, isSoldOut, isYesposError, orderState, paymentValue, priceRange, shopFromEnv } from '../src/index.js';
import { KEY, SECRET, startMockServer, type MockServer } from './mock-server.js';

let mock: MockServer;
const buyer = { name: 'Budi', email: 'budi@example.com', phone: '0812' };
const edc = { app_code: 'YESPOS', terminal_code: 'T1', merchant_code: 'M1' };

const shopWith = (options = {}) =>
	new Shop(new YesposClient({ baseUrl: mock.url, key: KEY, secret: SECRET }), options);

beforeAll(async () => {
	mock = await startMockServer();
});
afterAll(() => mock.close());

describe('outlet', () => {
	it('uses the configured outlet', async () => {
		await expect(shopWith({ outletUuid: 'o2' }).outlet()).resolves.toMatchObject({ uuid: 'o2' });
	});

	it('falls back to the first outlet', async () => {
		await expect(shopWith().outlet()).resolves.toMatchObject({ uuid: 'o1' });
	});

	it('refuses an outlet that is not the client owner\'s', async () => {
		const error = await shopWith({ outletUuid: 'nope' }).outlet().catch((err: unknown) => err);
		expect(isYesposError(error) && error.status).toBe(404);
	});
});

describe('payment methods', () => {
	it('hides EDC when no terminal is configured', async () => {
		const methods = await shopWith().paymentMethods();
		expect(methods.map(paymentValue)).toEqual(['qris:qris', 'va:bca']);
	});

	it('offers EDC once a terminal is configured', async () => {
		const methods = await shopWith({ edc }).paymentMethods();
		expect(methods.map(paymentValue)).toContain('edc:linkpayment');
	});
});

describe('pricing', () => {
	it('prices the cart from the API, ignoring anything the caller sends', async () => {
		const items = await shopWith().priceCart([
			{ productUuid: 'p1', quantity: 2 },
			{ productUuid: 'p2', variantUuid: 'v2', quantity: 1 }
		]);
		expect(items).toEqual([
			{ product_name: 'Nasi Goreng', quantity: 2, price: 25000, total: 50000 },
			{ product_name: 'Kopi Susu - Besar', quantity: 1, price: 24000, total: 24000 }
		]);
	});

	it('rounds a quantity up to a whole number of at least one', async () => {
		const items = await shopWith().priceCart([{ productUuid: 'p1', quantity: 2.7 }, { productUuid: 'p1', quantity: 0 }]);
		expect(items.map((item) => item.quantity)).toEqual([2, 1]);
	});

	it('refuses a product or variant the outlet no longer sells', async () => {
		for (const line of [{ productUuid: 'gone', quantity: 1 }, { productUuid: 'p2', variantUuid: 'gone', quantity: 1 }]) {
			const error = await shopWith().priceCart([line]).catch((err: unknown) => err);
			expect(isYesposError(error) && error.status).toBe(409);
		}
	});
});

describe('orders', () => {
	it('places an order with the total it computed', async () => {
		const order = await shopWith({ notifyUrl: 'https://example.com/cb' }).placeOrder(
			[{ productUuid: 'p1', quantity: 2 }],
			buyer,
			'va:bca'
		);
		expect(order).toMatchObject({ total_payment: 50000, payment_method: 'va', payment_no: '8002300000123456' });
		const sent = mock.recorded.at(-1)?.body as Record<string, unknown>;
		expect(sent).toMatchObject({ total_payment: 50000, payment_channel: 'bca', name: 'Budi', notify_url: 'https://example.com/cb' });
		expect(sent.app_code).toBeUndefined();
	});

	it('sends the EDC terminal only for an EDC order', async () => {
		const shop = shopWith({ edc });
		await shop.placeOrder([{ productUuid: 'p1', quantity: 1 }], buyer, 'edc:linkpayment');
		expect(mock.recorded.at(-1)?.body).toMatchObject(edc);
		await shop.placeOrder([{ productUuid: 'p1', quantity: 1 }], buyer, 'qris:qris');
		expect((mock.recorded.at(-1)?.body as Record<string, unknown>).app_code).toBeUndefined();
	});

	it('refuses a method the client owner did not activate', async () => {
		for (const payment of ['va:mandiri', 'edc:linkpayment', 'cash:cash']) {
			const error = await shopWith().placeOrder([{ productUuid: 'p1', quantity: 1 }], buyer, payment).catch((err: unknown) => err);
			expect(isYesposError(error) && error.status, payment).toBe(400);
		}
	});

	it('changes the payment method of a pending order', async () => {
		const shop = shopWith();
		const order = await shop.placeOrder([{ productUuid: 'p1', quantity: 1 }], buyer, 'qris:qris');
		const changed = await shop.changePayment(order.uuid, 'va:bca');
		expect(changed).toMatchObject({ payment_method: 'va', payment_no: '8002300000999999' });
		expect(changed.qr_string).toBeUndefined();
		// The buyer saved with the order is reused: nothing to fill in again.
		expect((mock.recorded.at(-1)?.body as Record<string, unknown>).name).toBeUndefined();
	});

	it('sends a buyer only when one is given', async () => {
		const shop = shopWith();
		const order = await shop.placeOrder([{ productUuid: 'p1', quantity: 1 }], buyer, 'qris:qris');
		await shop.changePayment(order.uuid, 'va:bca', { name: 'Citra', email: 'citra@example.com', phone: '0814' });
		expect(mock.recorded.at(-1)?.body).toMatchObject({ name: 'Citra', phone: '0814' });
	});
});

describe('shopFromEnv', () => {
	it('reads the usual environment variables', async () => {
		const shop = shopFromEnv({
			YESPOS_API_BASE_URL: mock.url,
			YESPOS_CLIENT_KEY: KEY,
			YESPOS_CLIENT_SECRET: SECRET,
			YESPOS_OUTLET_UUID: 'o2',
			YESPOS_EDC_APP_CODE: edc.app_code,
			YESPOS_EDC_TERMINAL_CODE: edc.terminal_code,
			YESPOS_EDC_MERCHANT_CODE: edc.merchant_code
		});
		await expect(shop.outlet()).resolves.toMatchObject({ uuid: 'o2' });
		expect((await shop.paymentMethods()).map(paymentValue)).toContain('edc:linkpayment');
	});

	it('hides EDC when the terminal is only half configured', async () => {
		const shop = shopFromEnv({
			YESPOS_API_BASE_URL: mock.url,
			YESPOS_CLIENT_KEY: KEY,
			YESPOS_CLIENT_SECRET: SECRET,
			YESPOS_EDC_APP_CODE: edc.app_code
		});
		expect((await shop.paymentMethods()).map(paymentValue)).not.toContain('edc:linkpayment');
	});
});

describe('utils', () => {
	it('reads order states', () => {
		expect(orderState('pending')).toBe('pending');
		expect(orderState('berhasil_settled')).toBe('paid');
		expect(orderState('success')).toBe('paid');
		expect(orderState('expired')).toBe('failed');
	});

	it('knows when a product is sold out', () => {
		const base = { uuid: 'x', name: 'x', price: 1, unit: 'pcs', type: 't', current_stock: 0, variants: null };
		expect(isSoldOut({ ...base, track_stock: false })).toBe(false);
		expect(isSoldOut({ ...base, track_stock: true })).toBe(true);
		expect(isSoldOut({ ...base, track_stock: true, current_stock: 3 })).toBe(false);
		const variants = [
			{ uuid: 'a', name: 'a', price: 1, current_stock: 0 },
			{ uuid: 'b', name: 'b', price: 2, current_stock: 4 }
		];
		expect(isSoldOut({ ...base, track_stock: true, variants })).toBe(false);
		expect(isSoldOut({ ...base, track_stock: true, variants: [variants[0]!] })).toBe(true);
	});

	it('reads a price range over variants', () => {
		const base = { uuid: 'x', name: 'x', price: 10, unit: 'pcs', type: 't', current_stock: 0, track_stock: false };
		expect(priceRange({ ...base, variants: null })).toEqual({ min: 10, max: 10 });
		expect(
			priceRange({
				...base,
				variants: [
					{ uuid: 'a', name: 'a', price: 30, current_stock: 1 },
					{ uuid: 'b', name: 'b', price: 20, current_stock: 1 }
				]
			})
		).toEqual({ min: 20, max: 30 });
	});
});
