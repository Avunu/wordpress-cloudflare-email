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
	return runCLI({
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
	const res = await server.playground.run({ code });
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
