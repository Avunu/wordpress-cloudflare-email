<?php

declare(strict_types=1);

namespace CloudflareEmail;

/**
 * A non-success Cloudflare API response. Carries the error identifiers Cloudflare
 * returned (e.g. `email.sending.error.email.recipient_suppressed`) so callers can
 * react to a specific failure instead of matching on the human-readable message.
 */
final class ApiError extends \RuntimeException
{
    public const RECIPIENT_SUPPRESSED = 'email.sending.error.email.recipient_suppressed';

    /**
     * @param array<int, string> $identifiers
     */
    public function __construct(string $message, public readonly int $status, public readonly array $identifiers = [])
    {
        parent::__construct($message, $status);
    }

    public function has(string $identifier): bool
    {
        return in_array($identifier, $this->identifiers, true);
    }
}
