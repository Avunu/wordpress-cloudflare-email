export {};

declare global {
	interface Window {
		/** Injected by Admin::enqueue() via wp_add_inline_script. */
		cloudflareEmailLog?: {
			root: string;
			nonce: string;
		};
	}
}
