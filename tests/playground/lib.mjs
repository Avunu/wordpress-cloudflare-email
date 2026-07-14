// Shared helpers for the wp-playground test harness: boot a WordPress instance with the
// built plugin mounted, run PHP against it, and a tiny assertion tally.
import { runCLI } from "@wp-playground/cli";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

export const HARNESS_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HARNESS_DIR, "..", "..");
export const PLUGIN_PATH = "cloudflare-email/cloudflare-email.php";

// System Chrome (no Playwright browser download needed). Override with CHROME_PATH.
export const CHROME_PATH = process.env.CHROME_PATH ?? "/run/current-system/sw/bin/google-chrome-stable";

/**
 * Boot a playground server with the built plugin + test mu-plugins mounted and the plugin
 * activated. The plugin requires PHP 8.4 (WordPress enforces the "Requires PHP" header on
 * activation), so we always boot 8.4. Pass a WordPress version via WP_VERSION / the wp arg.
 * Returns the RunCLIServer (dispose it with `await server[Symbol.asyncDispose]()`).
 */
export async function bootPlayground({ wp = process.env.WP_VERSION ?? "latest", port = 9400 } = {}) {
	if (!existsSync(resolve(REPO_ROOT, "build/index.js"))) {
		throw new Error("build/index.js is missing — run `npm run build` in the repo root first.");
	}
	const server = await runCLI({
		command: "server",
		php: "8.4",
		wp,
		port,
		login: true,
		quiet: true,
		mount: [
			{ hostPath: REPO_ROOT, vfsPath: "/wordpress/wp-content/plugins/cloudflare-email" },
			{ hostPath: resolve(HARNESS_DIR, "mu-plugins"), vfsPath: "/wordpress/wp-content/mu-plugins" },
		],
		blueprint: {
			steps: [{ step: "activatePlugin", pluginPath: PLUGIN_PATH }],
		},
	});

	// The boot-time blueprint step above activates the plugin, but under resource-constrained
	// CI runners we observed it not reliably visible to server.playground.run() calls (every
	// check would silently run against a plugin-INACTIVE site — "Ready!" printed with no error,
	// yet the class autoloader was never registered) despite passing consistently in local dev.
	// Explicitly (re)activate here, against the exact instance this harness talks to, so every
	// caller gets a guaranteed-active plugin. Idempotent: activate_plugin() is a no-op query
	// away if is_plugin_active() already says yes.
	let activation;
	try {
		activation = await phpJson(
			server,
			`if (!function_exists('is_plugin_active')) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}
			$path = ${JSON.stringify(PLUGIN_PATH)};
			if (!is_plugin_active($path)) {
				$result = activate_plugin($path);
				if (is_wp_error($result)) {
					return ['ok' => false, 'error' => $result->get_error_message()];
				}
			}
			return ['ok' => is_plugin_active($path)];`,
		);
	} catch (err) {
		await server[Symbol.asyncDispose]();
		throw new Error(`cloudflare-email plugin activation check crashed: ${err.message}`);
	}
	if (!activation.ok) {
		await server[Symbol.asyncDispose]();
		throw new Error(`cloudflare-email plugin failed to activate: ${activation.error ?? "unknown reason"}`);
	}

	return server;
}

const MARK = "@@CFE@@";

/**
 * Run PHP against the booted WordPress (full bootstrap: wp-load fires plugins_loaded, so
 * Plugin::init / Log::maybeUpgrade run every call). The snippet is a function body with
 * `$wpdb` in scope that must `return` a JSON-encodable value; any stray output it produces
 * (notices, warnings) is discarded, and the returned value is emitted between markers.
 */
export async function phpJson(server, snippet) {
	const code = `<?php
require '/wordpress/wp-load.php';
ob_start();
$__data = (function () {
	global $wpdb;
	${snippet}
})();
ob_end_clean();
echo ${JSON.stringify(MARK)} . wp_json_encode($__data) . ${JSON.stringify(MARK)};`;
	let res;
	try {
		res = await server.playground.run({ code });
	} catch (err) {
		// PHP fatals surface as a thrown PHPExecutionFailureError whose default
		// stringification dumps the entire response body as a byte-indexed object —
		// unreadable in CI logs. Extract just the "Fatal error: ..." line WordPress
		// prints instead.
		const raw = String(err?.message ?? err);
		const fatal = /<b>Fatal error<\/b>:\s*(.*?)(?:<br|\s+in\s+<b>)/is.exec(raw) ?? /Fatal error:\s*(.*)/i.exec(raw);
		throw new Error(fatal ? `PHP fatal error: ${fatal[1].trim()}` : `PHP execution failed: ${raw.slice(0, 300)}`);
	}
	const text = res.text ?? "";
	const start = text.indexOf(MARK);
	const end = text.lastIndexOf(MARK);
	if (start === -1 || end === start) {
		throw new Error(`PHP produced no marked JSON. Raw output:\n${text}`);
	}
	const json = text.slice(start + MARK.length, end).trim();
	try {
		return JSON.parse(json);
	} catch {
		throw new Error(`PHP output was not valid JSON: ${json}`);
	}
}
