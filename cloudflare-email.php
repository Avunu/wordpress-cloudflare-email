<?php

/**
 * Plugin Name:       Cloudflare Email
 * Description:       Send all WordPress email through the Cloudflare Email Sending API and log every message. Configure via wp-config.php — no admin settings.
 * x-release-please-start-version
 * Version:           0.1.0
 * x-release-please-end
 * Requires PHP:      8.4
 * Requires at least: 7.0
 * License:           MIT
 * Update URI:        https://github.com/Avunu/wordpress-cloudflare-email
 *
 * ============================================================================
 * CONFIGURATION (wp-config.php)
 * ============================================================================
 *
 * --- Required ---------------------------------------------------------------
 *   define('CLOUDFLARE_EMAIL_ACCOUNT_ID', 'your-cloudflare-account-id');
 *   define('CLOUDFLARE_EMAIL_API_TOKEN',  'token-with-email-sending-permission');
 *
 * --- Recommended ------------------------------------------------------------
 * The From address MUST use a domain onboarded to Cloudflare Email Sending.
 * WordPress otherwise defaults to wordpress@<site-domain>, which is usually not
 * verified. These are applied via the standard wp_mail_from(_name) filters.
 *   define('CLOUDFLARE_EMAIL_FROM',      'no-reply@your-verified-domain.com');
 *   define('CLOUDFLARE_EMAIL_FROM_NAME', 'Your Site');
 *
 * --- Logging (optional) -----------------------------------------------------
 *   define('CLOUDFLARE_EMAIL_LOG', false);              // stop logging *successful* sends
 *                                                       // (failures are always logged); default true
 *   define('CLOUDFLARE_EMAIL_LOG_RETENTION_DAYS', 30);  // auto-prune window; 0 = keep forever
 *
 * When ACCOUNT_ID / API_TOKEN are absent the plugin does nothing and WordPress
 * mail continues to work through its normal transport.
 */

declare(strict_types=1);

defined('WPINC') || exit;

define('CLOUDFLARE_EMAIL_FILE', __FILE__);

$cloudflareEmailAutoload = __DIR__ . '/vendor/autoload.php';
if (!is_file($cloudflareEmailAutoload)) {
    add_action('admin_notices', static function (): void {
        echo '<div class="notice notice-error"><p><strong>Cloudflare Email:</strong> dependencies are missing — run <code>composer install</code> or install the built release zip.</p></div>';
    });
    return;
}
require_once $cloudflareEmailAutoload;

// Self-update from GitHub releases. The built zip attached to each release bundles
// vendor/ and build/, so end users never need Composer or Node.
require_once __DIR__ . '/vendor/yahnis-elsts/plugin-update-checker/plugin-update-checker.php';

$cloudflareEmailUpdateChecker = \YahnisElsts\PluginUpdateChecker\v5\PucFactory::buildUpdateChecker(
    'https://github.com/Avunu/wordpress-cloudflare-email/',
    __FILE__,
    'cloudflare-email'
);
// Download the built release asset, not GitHub's source tarball (which lacks vendor/ and build/).
$cloudflareEmailUpdateChecker->getVcsApi()->enableReleaseAssets('/cloudflare-email\.zip$/');

register_activation_hook(__FILE__, [\CloudflareEmail\Plugin::class, 'activate']);
register_deactivation_hook(__FILE__, [\CloudflareEmail\Plugin::class, 'deactivate']);

add_action('plugins_loaded', [\CloudflareEmail\Plugin::class, 'init']);
