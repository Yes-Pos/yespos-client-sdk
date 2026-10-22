import type { HttpClient } from '../http.js';
import type { Product, ProductCategory, ProductDetail } from '../types/index.js';

const basePath = (outletUuid: string) => `/outlets/${encodeURIComponent(outletUuid)}/products`;

/** Products sold at an outlet. */
export class Products {
	constructor(private readonly http: HttpClient) {}

	/** Products of an outlet, grouped by category. */
	async list(outletUuid: string): Promise<ProductCategory[]> {
		return (await this.http.get<ProductCategory[] | null>(basePath(outletUuid))) ?? [];
	}

	/** One product of an outlet, with the names of its categories. */
	get(outletUuid: string, productUuid: string): Promise<ProductDetail> {
		return this.http.get<ProductDetail>(`${basePath(outletUuid)}/${encodeURIComponent(productUuid)}`);
	}

	/**
	 * Every product of an outlet keyed by uuid. A product may sit in several
	 * categories; this lists it once.
	 */
	async map(outletUuid: string): Promise<Map<string, Product>> {
		const products = new Map<string, Product>();
		for (const category of await this.list(outletUuid)) {
			for (const product of category.products) products.set(product.uuid, product);
		}
		return products;
	}
}
