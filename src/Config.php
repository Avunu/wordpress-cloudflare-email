<?php

declare(strict_types=1);

namespace CloudflareEmail;

/**
 * Reads plugin configuration from wp-config.php constants. There is no admin
 * settings screen by design — this is the whole configuration surface.
 */
final class Config
{
    public static function isConfigured(): bool
    {
        return self::accountId() !== '' && self::apiToken() !== '';
    }

    public static function accountId(): string
    {
        return defined('CLOUDFLARE_EMAIL_ACCOUNT_ID') ? trim((string) CLOUDFLARE_EMAIL_ACCOUNT_ID) : '';
    }

    public static function apiToken(): string
    {
        return defined('CLOUDFLARE_EMAIL_API_TOKEN') ? trim((string) CLOUDFLARE_EMAIL_API_TOKEN) : '';
    }

    public static function fromAddress(): ?string
    {
        if (defined('CLOUDFLARE_EMAIL_FROM') && CLOUDFLARE_EMAIL_FROM) {
            return (string) CLOUDFLARE_EMAIL_FROM;
        }
        return null;
    }

    public static function fromName(): ?string
    {
        if (defined('CLOUDFLARE_EMAIL_FROM_NAME') && CLOUDFLARE_EMAIL_FROM_NAME) {
            return (string) CLOUDFLARE_EMAIL_FROM_NAME;
        }
        return null;
    }

    /**
     * Whether successful sends are logged. Failures are always logged regardless.
     * Defaults to true; set CLOUDFLARE_EMAIL_LOG to a falsey value to disable.
     */
    public static function logSuccesses(): bool
    {
        return !defined('CLOUDFLARE_EMAIL_LOG') || (bool) CLOUDFLARE_EMAIL_LOG;
    }

    /**
     * Days to retain log rows before the daily prune deletes them. 0 = keep forever.
     */
    public static function retentionDays(): int
    {
        if (defined('CLOUDFLARE_EMAIL_LOG_RETENTION_DAYS')) {
            return max(0, (int) CLOUDFLARE_EMAIL_LOG_RETENTION_DAYS);
        }
        return 30;
    }
}
