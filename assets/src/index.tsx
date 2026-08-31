/**
 * Cloudflare Email — log viewer entry point.
 *
 * Mounts the app on the Tools → Cloudflare Email screen. All data comes from the
 * cloudflare-email/v1 REST routes. `@wordpress/dataviews` (and its non-core dependencies) are
 * bundled; everything else resolves to a core `wp.*` / React global at runtime (see
 * rolldown.config.ts).
 *
 * Styling is StyleX, compiled to atomic classes at build time and emitted into build/index.css.
 * Each component owns its own `stylex.create` block; shared values live in ./tokens.stylex, which
 * maps onto the WordPress Design System.
 */
import domReady from "@wordpress/dom-ready";
import { createRoot } from "@wordpress/element";
import { App } from "./App";

domReady(() => {
	const el = document.querySelector("#cloudflare-email-log-root");
	if (!el) {
		return;
	}
	createRoot(el).render(<App />);
});
