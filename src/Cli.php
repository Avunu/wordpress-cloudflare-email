<?php

declare(strict_types=1);

namespace CloudflareEmail;

use WP_CLI;

/**
 * WP-CLI helpers. Since there is no settings screen, these provide the
 * verification/smoke-test surface.
 *
 *   wp cloudflare-email verify
 *   wp cloudflare-email send-test you@example.com
 */
final class Cli
{
    public static function register(): void
    {
        WP_CLI::add_command('cloudflare-email verify', [self::class, 'verify']);
        WP_CLI::add_command('cloudflare-email send-test', [self::class, 'sendTest']);
    }

    /**
     * Verify the configured Cloudflare API token.
     */
    public static function verify(): void
    {
        if (!Config::isConfigured()) {
            WP_CLI::error('Not configured — define CLOUDFLARE_EMAIL_ACCOUNT_ID and CLOUDFLARE_EMAIL_API_TOKEN in wp-config.php.');
        }

        WP_CLI::log('Account ID: ' . Config::accountId());
        WP_CLI::log('From:       ' . (Config::fromAddress() ?? '(WordPress default)'));

        $result = Client::verifyToken();
        if ($result['valid']) {
            WP_CLI::success($result['message']);
        } else {
            WP_CLI::error($result['message']);
        }
    }

    /**
     * Send a test email through the normal wp_mail() path (exercises logging too).
     *
     * @param array<int, string> $args
     */
    public static function sendTest(array $args): void
    {
        $to = $args[0] ?? '';
        if ($to === '' || !is_email($to)) {
            WP_CLI::error('Usage: wp cloudflare-email send-test <valid-email-address>');
        }

        $sent = wp_mail(
            $to,
            'Cloudflare Email test',
            "<p>This is a test message sent via the Cloudflare Email Sending API.</p>",
            ['Content-Type: text/html; charset=UTF-8']
        );

        if ($sent) {
            WP_CLI::success("Test email dispatched to {$to}. Check Tools → Cloudflare Email for the log entry.");
        } else {
            WP_CLI::error("Send failed. Check Tools → Cloudflare Email for the logged error.");
        }
    }
}
