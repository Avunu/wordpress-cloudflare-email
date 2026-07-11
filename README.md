# Cloudflare Email

Route **all** WordPress email through the [Cloudflare Email Sending API](https://developers.cloudflare.com/email-service/) and keep a searchable log of every message. Configured entirely through `wp-config.php` constants — there is no settings screen.

- **Tiny surface.** No admin settings; the only screen is the log viewer (**Tools → Cloudflare Email**), built with WordPress DataViews.
- **Drop-in.** Hooks `wp_mail()` without redefining it — every plugin/theme that sends mail is routed automatically, with Cc/Bcc/Reply-To/custom headers/inline images preserved.
- **Logged.** Every send (and every failure) is recorded; view, resend, or delete from the log.
- **Self-updating.** Pulls new versions straight from GitHub Releases.

## Requirements

- WordPress 6.6+ and PHP 8.4+.
- A Cloudflare account with **Email Sending** enabled for your sending domain (see [Cloudflare's setup guide](https://developers.cloudflare.com/email-service/); `npx wrangler email sending enable yourdomain.com`).
- A Cloudflare **API token** with the Email Sending permission.

Deliverability records (SPF/DKIM/DMARC) and domain onboarding are managed in Cloudflare — this plugin only sends.

## Configuration

Add to `wp-config.php`:

```php
// Required
define('CLOUDFLARE_EMAIL_ACCOUNT_ID', 'your-cloudflare-account-id');
define('CLOUDFLARE_EMAIL_API_TOKEN',  'token-with-email-sending-permission');

// Recommended — the From domain must be onboarded to Cloudflare Email Sending.
// (WordPress otherwise defaults to wordpress@<site-domain>, which is usually unverified.)
define('CLOUDFLARE_EMAIL_FROM',      'no-reply@your-verified-domain.com');
define('CLOUDFLARE_EMAIL_FROM_NAME', 'Your Site');

// Optional
define('CLOUDFLARE_EMAIL_LOG', false);              // stop logging *successful* sends
                                                    // (failures are always logged); default true
define('CLOUDFLARE_EMAIL_LOG_RETENTION_DAYS', 30);  // auto-prune window; 0 = keep forever
```

When the required constants are absent the plugin does nothing and WordPress mail continues through its normal transport.

If Cloudflare rejects a message (e.g. an unverified sender, or a custom header it disallows) the send is logged as **failed** and `wp_mail()` returns `false` — there is no silent fallback. To adjust the outgoing payload, filter it:

```php
add_filter('cloudflare_email_payload', function (array $payload) {
    unset($payload['headers']['X-Some-Header']);
    return $payload;
});
```

## Verifying

With [WP-CLI](https://wp-cli.org/):

```bash
wp cloudflare-email verify              # check the API token
wp cloudflare-email send-test you@example.com
```

Then open **Tools → Cloudflare Email** to see the log entry.

## Development

The log viewer is a **TypeScript** DataViews app bundled with [rolldown](https://rolldown.rs/); the dev shell and release build are driven by [Nix](https://nixos.org/) (with [direnv](https://direnv.net/)):

```bash
direnv allow          # or: nix develop
composer install      # PHP deps (plugin-update-checker)
npm install           # JS deps (rolldown, typescript, @wordpress/dataviews)
npm run dev           # watch-build the DataViews app (rolldown --watch)
npm run typecheck     # strict type-check (tsc --noEmit)
npm run build         # type-check + production bundle -> build/
```

`npm run build` emits `build/index.js` (IIFE), `build/index.asset.php` (the WordPress
dependency manifest), and `build/index.css` (the DataViews stylesheet).
`@wordpress/dataviews` and its non-core deps are bundled; every other `@wordpress/*`
package resolves to its core `wp.*` global at runtime.

Build the distributable, self-contained zip (bundles `vendor/` and the compiled `build/`):

```bash
nix build .#zip -L    # -> result/cloudflare-email.zip
```

## Releasing

Commits to `main` follow [Conventional Commits](https://www.conventionalcommits.org/). [Release Please](https://github.com/googleapis/release-please) maintains a release PR; merging it bumps the version in `composer.json`, `package.json`, and the plugin header, updates `CHANGELOG.md`, tags `vX.Y.Z`, and the release workflow builds `cloudflare-email.zip` with Nix and attaches it to the GitHub Release. Client sites self-update from that asset via [plugin-update-checker](https://github.com/YahnisElsts/plugin-update-checker).

## License

MIT © Avunu LLC
