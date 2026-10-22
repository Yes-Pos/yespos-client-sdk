import type { HttpClient } from '../http.js';
import type { Outlet } from '../types/index.js';

/** Outlets of the client owner. */
export class Outlets {
	constructor(private readonly http: HttpClient) {}

	/** Every outlet of the client owner. */
	async list(): Promise<Outlet[]> {
		return (await this.http.get<Outlet[] | null>('/outlets')) ?? [];
	}
}
