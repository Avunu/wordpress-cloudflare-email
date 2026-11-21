<?php

declare(strict_types=1);

namespace CloudflareEmail;

/**
 * Reads plugin configuration from wp-config.php constants or, when a constant
 * is not defined, from the environment variable of the same name. There is no
 * admin settings screen by design — this is the whole configuration surface.
 */
final class Config
{
    public static function isConfigured(): bool
    {
        return self::accountId() !== '' && self::apiToken() !== '';
    }

    public static function accountId(): string
    {
        return trim(self::string('CLOUDFLARE_EMAIL_ACCOUNT_ID'));
    }

    public static function apiToken(): string
    {
        return trim(self::string('CLOUDFLARE_EMAIL_API_TOKEN'));
    }

    public static function fromAddress(): ?string
    {
        $from = self::string('CLOUDFLARE_EMAIL_FROM');
        return $from !== '' ? $from : null;
    }

    public static function fromName(): ?string
    {
        $name = self::string('CLOUDFLARE_EMAIL_FROM_NAME');
        return $name !== '' ? $name : null;
    }

    /**
     * Whether successful sends are logged. Failures are always logged regardless.
     * Defaults to true; set CLOUDFLARE_EMAIL_LOG to a falsey value to disable.
     */
    public static function logSuccesses(): bool
    {
        $value = self::value('CLOUDFLARE_EMAIL_LOG');
        if ($value === null) {
            return true;
        }
        if (is_string($value)) {
            // An environment variable is always a string, and "false" is truthy.
            return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? true;
        }
        return (bool) $value;
    }

    /**
     * Days to retain log rows before the daily prune deletes them. 0 = keep forever.
     */
    public static function retentionDays(): int
    {
        $value = self::value('CLOUDFLARE_EMAIL_LOG_RETENTION_DAYS');
        if ($value !== null && is_numeric($value)) {
            return max(0, (int) $value);
        }
        return 30;
    }

    /**
     * The constant when defined, else a non-empty environment variable of the
     * same name, else null.
     */
    private static function value(string $name): mixed
    {
        if (defined($name)) {
            return constant($name);
        }

        $env = getenv($name);
        return is_string($env) && $env !== '' ? $env : null;
    }

    private static function string(string $name): string
    {
        $value = self::value($name);
        return is_scalar($value) ? (string) $value : '';
    }
}
