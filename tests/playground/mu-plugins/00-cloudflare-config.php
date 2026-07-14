<?php

/**
 * Test-only. Defines the wp-config.php constants the plugin reads, so it is "configured"
 * (Config::isConfigured() === true) inside wp-playground and intercepts wp_mail(). Loaded as
 * an mu-plugin — before plugins_loaded, where CloudflareEmail\Plugin::init() reads them.
 * The `00-` prefix loads it ahead of mock-cloudflare.php.
 */

declare(strict_types=1);

defined('CLOUDFLARE_EMAIL_ACCOUNT_ID') || define('CLOUDFLARE_EMAIL_ACCOUNT_ID', 'test-account-id');
defined('CLOUDFLARE_EMAIL_API_TOKEN')  || define('CLOUDFLARE_EMAIL_API_TOKEN', 'test-api-token');
defined('CLOUDFLARE_EMAIL_FROM')       || define('CLOUDFLARE_EMAIL_FROM', 'no-reply@example.com');
defined('CLOUDFLARE_EMAIL_FROM_NAME')  || define('CLOUDFLARE_EMAIL_FROM_NAME', 'CF Email Test');
