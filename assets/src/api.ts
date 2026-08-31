/**
 * Typed client for the cloudflare-email/v1 REST routes.
 *
 * The REST root and nonce are injected by Admin::enqueue() as an inline script, so they are on
 * `window` before this module is evaluated. Registering the nonce middleware at module scope means
 * it is in place for every request without each caller having to remember it.
 */
import apiFetch from "@wordpress/api-fetch";

const config: { root: string; nonce: string } = window.cloudflareEmailLog ?? {
	root: "",
	nonce: "",
};

apiFetch.use(apiFetch.createNonceMiddleware(config.nonce));

interface ApiOptions {
	method?: string;
	data?: unknown;
}

export function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
	return apiFetch<T>({
		url: `${config.root}${path}`,
		method: options.method,
		data: options.data,
	});
}
