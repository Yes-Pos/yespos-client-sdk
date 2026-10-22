import type { Order, OrderState, Product } from './types/index.js';

/**
 * Reads an order's state. YesPOS statuses are "pending" or
 * "<status>_<settlement>", e.g. "berhasil_settled".
 */
export function orderState(status: string): OrderState {
	const value = status.toLowerCase();
	if (value === 'pending' || value.startsWith('pending')) return 'pending';
	if (value.startsWith('berhasil') || value.startsWith('success')) return 'paid';
	return 'failed';
}

/** True while the order still waits to be paid. */
export const isPending = (order: Order): boolean => orderState(order.status) === 'pending';

/** True once the payment settled. */
export const isPaid = (order: Order): boolean => orderState(order.status) === 'paid';

/**
 * A product tracking stock is sold out when it, or every variant, has none left.
 * Products that do not track stock are never sold out.
 */
export function isSoldOut(product: Product): boolean {
	if (!product.track_stock) return false;
	const variants = product.variants ?? [];
	return variants.length ? variants.every((variant) => variant.current_stock <= 0) : product.current_stock <= 0;
}

/** Lowest and highest price of a product, over its variants when it has any. */
export function priceRange(product: Product): { min: number; max: number } {
	const prices = (product.variants ?? []).map((variant) => variant.price);
	if (!prices.length) return { min: product.price, max: product.price };
	return { min: Math.min(...prices), max: Math.max(...prices) };
}
