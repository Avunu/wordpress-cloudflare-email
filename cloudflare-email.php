<?php

/**
 * Plugin Name:       Cloudflare Email
 * Description:       Send all WordPress email through the Cloudflare Email Sending API and log every message. Configure via wp-config.php — no admin settings.
 * x-release-please-start-version
 * Version:           0.3.0
 * x-release-please-end
 * Requires PHP:      8.4
 * Requires at least: 7.0
 * License:           MIT
 * Update URI:        https://github.com/Avunu/wordpress-cloudflare-email
 *
 * ============================================================================
 * CONFIGURATION (wp-config.php constants or environment variables)
 * ============================================================================
 *
 * Every setting below can also be an environment variable of the same name,
 * which is read when the constant is not defined (an empty value counts as
 * unset). CLOUDFLARE_EMAIL_LOG from the environment accepts true/false, 1/0,
 * yes/no and on/off.
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

// Dependencies. The release zip bundles its own vendor/. Under Composer (a
// Bedrock site, for example) the plugin directory has no vendor/ and the
// project's autoloader, loaded before WordPress, already provides the classes.
$cloudflareEmailAutoload = __DIR__ . '/vendor/autoload.php';
if (is_file($cloudflareEmailAutoload)) {
    require_once $cloudflareEmailAutoload;
}

if (!class_exists(\CloudflareEmail\Plugin::class)) {
    add_action('admin_notices', static function (): void {
        echo '<div class="notice notice-error"><p><strong>Cloudflare Email:</strong> dependencies are missing — install the built release zip, or require <code>avunu/cloudflare-email</code> with Composer.</p></div>';
    });
    return;
}

// Self-update from GitHub releases, for installs of the release zip only. The
// built zip bundles vendor/ and build/, so end users never need Composer or
// Node. A Composer-managed install is updated by Composer, and a site with
// DISALLOW_FILE_MODS cannot install updates at all, so neither loads it.
if (is_file($cloudflareEmailAutoload) && wp_is_file_mod_allowed('cloudflare_email_update_checker')) {
    require_once __DIR__ . '/vendor/yahnis-elsts/plugin-update-checker/plugin-update-checker.php';

    $cloudflareEmailUpdateChecker = \YahnisElsts\PluginUpdateChecker\v6\PucFactory::buildUpdateChecker(
        'https://github.com/Avunu/wordpress-cloudflare-email/',
        __FILE__,
        'cloudflare-email'
    );
    // Download the built release asset, not GitHub's source tarball (which lacks vendor/ and build/).
    $cloudflareEmailUpdateChecker->getVcsApi()->enableReleaseAssets('/cloudflare-email\.zip$/');
}
unset($cloudflareEmailAutoload);

register_activation_hook(__FILE__, [\CloudflareEmail\Plugin::class, 'activate']);
register_deactivation_hook(__FILE__, [\CloudflareEmail\Plugin::class, 'deactivate']);

add_action('plugins_loaded', [\CloudflareEmail\Plugin::class, 'init']);
