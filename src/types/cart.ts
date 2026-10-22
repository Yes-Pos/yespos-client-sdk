/** What a storefront sends for checkout: no prices, the SDK looks them up. */
export interface CartLine {
	productUuid: string;
	variantUuid?: string;
	quantity: number;
}
