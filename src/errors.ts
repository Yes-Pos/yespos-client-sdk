/**
 * An error answered by the YesPOS API, or a failure to reach it.
 *
 * `status` is the HTTP status, or 0 when the request never got a response.
 * `details` carries the API's `details` field, e.g. the products a product
 * verification submission was refused for.
 */
export class YesposError extends Error {
	readonly name = 'YesposError';

	constructor(
		readonly status: number,
		message: string,
		readonly details?: unknown
	) {
		super(message);
	}

	/** True when the shop is misconfigured or the credential is rejected. */
	get isAuthError(): boolean {
		return this.status === 401 || this.status === 403;
	}

	/** True when YesPOS could not be reached at all. */
	get isNetworkError(): boolean {
		return this.status === 0 || this.status === 502;
	}
}

/** Narrows an unknown error thrown by the SDK. */
export const isYesposError = (error: unknown): error is YesposError => error instanceof YesposError;
