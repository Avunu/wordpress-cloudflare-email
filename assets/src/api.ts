/**
 * Typed client for the cloudflare-email/v1 REST routes.
 *
 * The REST root and nonce are injected by Admin::enqueue() as an inline script, so they are on
 * `window` before this module is evaluated. Registering the nonce middleware at module scope means
 * it is in place for every request without each caller having to remember it.
 */
import apiFetch from "@wordpress/api-fetch";
import { __ } from "@wordpress/i18n";

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

/**
 * Re-sends a logged email. Never rejects: a failed resend is an expected outcome (the row records
 * why), so it is reported as `ok: false` with the server's message for the caller to show.
 */
export async function resendLog(id: number): Promise<{ ok: boolean; message: string }> {
	try {
		await api(`/logs/${id}/resend`, { method: "POST" });
		return { ok: true, message: __("Email resent.", "cloudflare-email") };
	} catch (error: unknown) {
		return { ok: false, message: errorMessage(error, __("Resend failed.", "cloudflare-email")) };
	}
}

/**
 * The message from an api() rejection. apiFetch rejects with the REST error body (`{ code, message
 * }`) rather than an Error, so both shapes are read.
 */
export function errorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "object" && error !== null && "message" in error) {
		const { message } = error;
		if (typeof message === "string" && message !== "") {
			return message;
		}
	}
	return fallback;
}
