export interface InventoryStock {
	inventory_uuid: string;
	inventory_name: string;
	current_stock: number;
}

export interface ProductVariant {
	uuid: string;
	name: string;
	price: number;
	current_stock: number;
	barcode_data?: string;
	main_image_token?: string;
	/** Public image URL built by the API; prefer it over building one from the token. */
	main_image_url?: string;
	inventories?: InventoryStock[];
}

export interface ProductAddOn {
	uuid: string;
	add_on_name: string;
	price: number;
}

export interface Product {
	uuid: string;
	name: string;
	description?: string;
	price: number;
	unit: string;
	type: string;
	current_stock: number;
	barcode_data?: string;
	main_image_token?: string;
	main_image_url?: string;
	track_stock: boolean;
	variants: ProductVariant[] | null;
	add_ons?: ProductAddOn[] | null;
	inventories?: InventoryStock[];
}

/** One product with the names of the categories it sits in. */
export interface ProductDetail extends Product {
	categories: string[];
}

export interface ProductCategory {
	category_uuid: string;
	category_name: string;
	products: Product[];
}
