/** An outlet of the client owner (GET /api/client/outlets). */
export interface Outlet {
	uuid: string;
	name: string;
	address?: string;
	contact?: string;
	type?: string;
}
