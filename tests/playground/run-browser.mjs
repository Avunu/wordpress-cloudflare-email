// Test C — browser smoke (wp-playground + headless Chrome). The only test that reproduces
// the actual production symptom: the log page must MOUNT the DataViews app (not render a
// blank screen) and must not throw. Then a sent email must appear as a row in the UI.
import { chromium } from "playwright-core";
import { bootPlayground, phpJson, CHROME_PATH } from "./lib.mjs";
import { tally } from "./assert.mjs";

async function login(page, url) {
	await page.goto(`${url}/wp-login.php`, { waitUntil: "networkidle" });
	if (page.url().includes("wp-login.php")) {
		await page.fill("#user_login", "admin");
		await page.fill("#user_pass", "password");
		await page.click("#wp-submit");
		await page.waitForLoadState("networkidle");
	}
}

const LOG_PAGE = "/wp-admin/tools.php?page=cloudflare-email-log";
const t = tally();
console.log(`Test C — browser smoke (WordPress ${process.env.WP_VERSION ?? "latest"})\n`);

let server;
let browser;
try {
	server = await bootPlayground({ port: 9430 });
	const url = server.serverUrl;
	browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

	const page = await browser.newPage();
	const pageErrors = [];
	const consoleErrors = [];
	page.on("pageerror", (e) => pageErrors.push(`${e.name}: ${e.message}`));
	page.on("console", (m) => {
		if (m.type() === "error") consoleErrors.push(m.text());
	});

	await login(page, url);

	// Seed one log entry so the table has a row to show.
	await phpJson(
		server,
		`wp_set_current_user(1);
		wp_mail('browser@example.com', 'Hello from the browser test', '<p>body</p>', ['Content-Type: text/html; charset=UTF-8']);
		return ['ok' => true];`,
	);

	await page.goto(`${url}${LOG_PAGE}`, { waitUntil: "networkidle" });
	// Give React a beat to mount (or to throw, which we'd capture above).
	await page.waitForTimeout(2000);

	const rootHtml = await page
		.locator("#cloudflare-email-log-root")
		.innerHTML()
		.catch(() => "");
	const heading = await page.locator("h1", { hasText: "Cloudflare Email log" }).count();
	const dataviews = await page.locator(".dataviews-wrapper").count();
	const rowVisible = await page.getByText("Hello from the browser test").count();

	t.check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
	t.check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
	t.check("the mount point is not empty (not a blank page)", rootHtml.length > 0, `${rootHtml.length} chars`);
	t.check("the log heading rendered", heading > 0);
	t.check("the DataViews app mounted", dataviews > 0);
	t.check("the sent email appears as a row", rowVisible > 0);
} catch (err) {
	console.error(`\nUnexpected error: ${err.message}`);
	t.check("test completed without an unexpected error", false, err.message);
} finally {
	if (browser) await browser.close();
	if (server) await server[Symbol.asyncDispose]();
}

console.log(t.failures ? `\nTest C FAILED (${t.failures})` : "\nTest C PASSED");
process.exit(t.failures ? 1 : 0);
