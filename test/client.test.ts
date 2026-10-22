import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { YesposClient, YesposError, isYesposError, signRequest } from '../src/index.js';
import { KEY, SECRET, startMockServer, type MockServer } from './mock-server.js';

let mock: MockServer;
let client: YesposClient;

beforeAll(async () => {
	mock = await startMockServer();
	client = new YesposClient({ baseUrl: mock.url, key: KEY, secret: SECRET });
});
afterAll(() => mock.close());

describe('signing', () => {
	it('matches the signature the backend computes', async () => {
		// Fixed vectors: the backend hashes an empty body as "{}".
		await expect(signRequest('GET', 'k', 's', '')).resolves.toBe(await signRequest('GET', 'k', 's', '{}'));
		const signature = await signRequest('POST', 'k', 's', '{"a":1}');
		expect(signature).toMatch(/^[0-9a-f]{64}$/);
		// The method and the body both change the signature.
		await expect(signRequest('GET', 'k', 's', '{"a":1}')).resolves.not.toBe(signature);
		await expect(signRequest('POST', 'k', 's', '{"a":2}')).resolves.not.toBe(signature);
	});

	it('is accepted by a server that checks it like ClientAuthMiddleware', async () => {
		await expect(client.outlets.list()).resolves.toHaveLength(2);
	});

	it('is rejected when the secret is wrong', async () => {
		const wrong = new YesposClient({ baseUrl: mock.url, key: KEY, secret: 'nope' });
		await expect(wrong.outlets.list()).rejects.toMatchObject({ status: 401 });
	});
});

describe('configuration', () => {
	it('refuses to build without credentials', () => {
		expect(() => new YesposClient({ baseUrl: '', key: '', secret: '' })).toThrow(YesposError);
	});

	it('trims a trailing slash and builds media URLs', () => {
		const padded = new YesposClient({ baseUrl: `${mock.url}///`, key: KEY, secret: SECRET });
		expect(padded.mediaUrl('2_abc')).toBe(`${mock.url}/media/2_abc`);
	});

	it('sends the configured language', async () => {
		const english = new YesposClient({ baseUrl: mock.url, key: KEY, secret: SECRET, language: 'en' });
		await english.outlets.list();
		expect(mock.recorded.at(-1)?.headers['accept-language']).toBe('en');
	});
});

describe('resources', () => {
	it('lists products and maps them by uuid once', async () => {
		const categories = await client.products.list('o1');
		expect(categories.map((category) => category.category_name)).toEqual(['Makanan', 'Favorit']);
		const products = await client.products.map('o1');
		// Nasi Goreng sits in two categories but is listed once.
		expect([...products.keys()].sort()).toEqual(['p1', 'p2']);
	});

	it('gets one product with its categories', async () => {
		await expect(client.products.get('o1', 'p2')).resolves.toMatchObject({ name: 'Kopi Susu', categories: ['Makanan'] });
	});

	it('reports an unknown product as 404', async () => {
		const error = await client.products.get('o1', 'nope').catch((err: unknown) => err);
		expect(isYesposError(error) && error.status).toBe(404);
		expect(isYesposError(error) && error.message).toBe('Produk tidak ditemukan.');
	});

	it('creates, reads and lists orders', async () => {
		const order = await client.orders.create({
			total_payment: 50000,
			payment_method: 'qris',
			payment_channel: 'qris',
			name: 'Budi',
			email: 'budi@example.com',
			phone: '0812',
			items: [{ product_name: 'Nasi Goreng', quantity: 2, price: 25000, total: 50000 }]
		});
		expect(order.qr_string).toBeTruthy();
		await expect(client.orders.get(order.uuid)).resolves.toMatchObject({ status: 'pending' });
		await expect(client.orders.list({ page: 1, limit: 10 })).resolves.toMatchObject({ page: 1 });
	});

	it('changes the payment method of a pending order', async () => {
		const order = await client.orders.create({
			total_payment: 25000,
			payment_method: 'qris',
			payment_channel: 'qris',
			name: 'Budi',
			email: 'budi@example.com',
			phone: '0812',
			items: [{ product_name: 'Nasi Goreng', quantity: 1, price: 25000, total: 25000 }]
		});
		const changed = await client.orders.changePaymentMethod(order.uuid, { payment_method: 'va', payment_channel: 'bca' });
		expect(changed).toMatchObject({ payment_method: 'va', payment_no: '8002300000999999' });
		expect(changed.qr_string).toBeUndefined();
	});
});

describe('errors', () => {
	it('joins a list of validation messages', async () => {
		mock.failNext(400, { message: ['payment_method:required', 'email:email'] });
		await expect(client.outlets.list()).rejects.toThrow('payment_method:required email:email');
	});

	it('keeps the details field of a refusal', async () => {
		mock.failNext(422, { message: 'tidak lengkap', details: [{ uuid: 'p1', missing: ['image'] }] });
		const error = await client.outlets.list().catch((err: unknown) => err);
		expect(isYesposError(error) && error.details).toEqual([{ uuid: 'p1', missing: ['image'] }]);
	});

	it('falls back to a message when the body has none', async () => {
		mock.failNext(500, {});
		await expect(client.outlets.list()).rejects.toThrow('Permintaan gagal (500).');
	});

	it('reports an unreachable server as a network error', async () => {
		const offline = new YesposClient({ baseUrl: 'http://127.0.0.1:1', key: KEY, secret: SECRET });
		const error = await offline.outlets.list().catch((err: unknown) => err);
		expect(isYesposError(error) && error.isNetworkError).toBe(true);
	});

	it('times out a slow request', async () => {
		const slow = new YesposClient({
			baseUrl: mock.url,
			key: KEY,
			secret: SECRET,
			timeout: 10,
			fetch: () => new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('x'), { name: 'AbortError' })), 30))
		});
		await expect(slow.outlets.list()).rejects.toThrow(/batas waktu/);
	});
});
