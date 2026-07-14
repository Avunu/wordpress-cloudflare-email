// Test B — backend logging e2e (wp-playground, no browser). Exercises the real
// wp_mail() → Mailer::send → Client::send (mocked) → Log::record path, checks the row is
// queryable via the DB and the REST API, then proves the self-healing migration recreates
// the table when it is missing (the "activation never ran on this database" scenario).
import { bootPlayground, phpJson } from "./lib.mjs";
import { tally } from "./assert.mjs";

// Portable table-existence check (works under the SQLite integration and MySQL): COUNT(*)
// returns null when the table is absent because $wpdb suppresses the error.
const EXISTS = `
	$wpdb->suppress_errors(true);
	$t = $wpdb->prefix . 'cloudflare_email_log';
	$count = $wpdb->get_var("SELECT COUNT(*) FROM $t");
	$wpdb->suppress_errors(false);`;

const t = tally();
console.log(`Test B — backend logging e2e (WordPress ${process.env.WP_VERSION ?? "latest"})\n`);

const server = await bootPlayground({ port: 9420 });
try {
	// 1. Activation created the table and stamped the schema version.
	let r = await phpJson(
		server,
		`${EXISTS}
		return ['exists' => $count !== null, 'version' => get_option('cloudflare_email_db_version')];`,
	);
	t.check("activation created the log table", r.exists);
	t.check("db version option stamped to 1", String(r.version) === "1", `version=${r.version}`);

	// 2. Sending an email logs a 'sent' row (Cloudflare HTTP is mocked to succeed).
	r = await phpJson(
		server,
		`wp_set_current_user(1);
		$sent = wp_mail('recipient@example.com', 'E2E subject', '<p>hello world</p>', ['Content-Type: text/html; charset=UTF-8']);
		$t = $wpdb->prefix . 'cloudflare_email_log';
		return [
			'sent'   => (bool) $sent,
			'count'  => (int) $wpdb->get_var("SELECT COUNT(*) FROM $t"),
			'status' => $wpdb->get_var("SELECT status FROM $t ORDER BY id DESC LIMIT 1"),
			'to'     => $wpdb->get_var("SELECT to_json FROM $t ORDER BY id DESC LIMIT 1"),
		];`,
	);
	t.check("wp_mail() returned true via the Cloudflare mock", r.sent);
	t.check("the send inserted a log row", r.count >= 1, `count=${r.count}`);
	t.check("logged row status = 'sent'", r.status === "sent", `status=${r.status}`);
	t.check("logged recipient persisted", String(r.to).includes("recipient@example.com"));

	// 3. The REST route the DataViews UI calls returns the entry.
	r = await phpJson(
		server,
		`wp_set_current_user(1);
		$req = new WP_REST_Request('GET', '/cloudflare-email/v1/logs');
		$res = rest_do_request($req);
		$d = $res->get_data();
		return ['status' => $res->get_status(), 'total' => $d['total'] ?? null, 'n' => isset($d['logs']) ? count($d['logs']) : null];`,
	);
	t.check("REST /logs responds 200", r.status === 200, `status=${r.status}`);
	t.check("REST /logs returns the logged entry", r.total >= 1 && r.n >= 1, `total=${r.total}, n=${r.n}`);

	// 4. Self-heal: simulate a database where the table + version option never existed
	// (in-place self-update / imported DB), then let a fresh request rebuild it.
	await phpJson(
		server,
		`$t = $wpdb->prefix . 'cloudflare_email_log';
		$wpdb->query("DROP TABLE IF EXISTS $t");
		delete_option('cloudflare_email_db_version');
		return ['ok' => true];`,
	);
	// A brand-new request: wp-load → plugins_loaded → Log::maybeUpgrade() recreates the table.
	r = await phpJson(
		server,
		`${EXISTS}
		return ['exists' => $count !== null, 'version' => get_option('cloudflare_email_db_version')];`,
	);
	t.check("maybeUpgrade() self-healed the dropped table", r.exists);
	t.check("db version re-stamped after heal", String(r.version) === "1", `version=${r.version}`);

	// 5. Sending after the heal still logs.
	r = await phpJson(
		server,
		`wp_set_current_user(1);
		$sent = wp_mail('again@example.com', 'After heal', 'plain body');
		$t = $wpdb->prefix . 'cloudflare_email_log';
		return ['sent' => (bool) $sent, 'count' => (int) $wpdb->get_var("SELECT COUNT(*) FROM $t")];`,
	);
	t.check("send after heal logs a row", r.sent && r.count >= 1, `count=${r.count}`);

	// 6. Hardening: with the script not enqueued (Admin::$assetsReady still false, as it
	// would be for a missing/broken build), render() shows an error notice — not a blank page.
	r = await phpJson(
		server,
		`ob_start();
		\\CloudflareEmail\\Admin::render();
		return ['html' => ob_get_clean()];`,
	);
	t.check(
		"render() shows a notice (not a blank page) when assets are absent",
		/notice-error/.test(r.html) && /assets are missing/.test(r.html),
		r.html.replace(/\\s+/g, " ").slice(0, 70),
	);
} finally {
	await server[Symbol.asyncDispose]();
}

console.log(t.failures ? `\nTest B FAILED (${t.failures})` : "\nTest B PASSED");
process.exit(t.failures ? 1 : 0);
