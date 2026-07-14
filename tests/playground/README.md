# wp-playground tests

Runtime tests for the Cloudflare Email plugin, run against a real WordPress booted in
[wp-playground](https://wordpress.github.io/wordpress-playground/) (WASM PHP, no Docker). They
exist because the plugin's failure modes are **silent** — a broken asset manifest or a missing
table produces a blank/empty page with no error — so static checks (PHPStan, oxlint, tsc) can't
catch them.

This is a **separate npm package** from the repo root on purpose: its dependencies
(`@wp-playground/cli`, `playwright-core`) are heavy and must never enter the root
`package-lock.json` that the Nix build consumes.

## Prerequisites

- The plugin must be **built first**: run `npm run build` in the repo root (the tests mount and
  run the real `build/` output).
- Node 22+.
- `npm install` in this directory.
- For the browser test only: a Chrome/Chromium binary. Defaults to
  `/run/current-system/sw/bin/google-chrome-stable`; override with `CHROME_PATH=/path/to/chrome`.
- PHP 8.4 is used automatically (WordPress enforces the plugin's `Requires PHP: 8.4` header on
  activation). Target a specific WordPress version with `WP_VERSION=6.6` (default: `latest`).

## Tests

| Script                | What it covers | Browser? |
| --------------------- | -------------- | -------- |
| `npm run test:assets` | **A** — `build/index.asset.php` declares the real WP handles, never lists an unregistered one (`wp-icons`), and the bundle has no un-shimmed `require("react")`. | no |
| `npm run test:e2e`    | **B** — `wp_mail()` → Cloudflare (mocked) → a `sent` row visible via the DB and the REST API; dropping the table self-heals via `Log::maybeUpgrade()`. | no |
| `npm run test:browser`| **C** — the log page actually **mounts** the DataViews app (guards the blank-page regression) and shows a sent email as a row. | yes |
| `npm test`            | A + B (the browser-free gate). | no |

`api.cloudflare.com` is stubbed by `mu-plugins/mock-cloudflare.php`; the plugin constants are
defined by `mu-plugins/00-cloudflare-config.php`.
