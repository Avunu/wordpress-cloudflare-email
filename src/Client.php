<?php

declare(strict_types=1);

namespace CloudflareEmail;

/**
 * Thin HTTP client for the Cloudflare Email Sending REST API. Uses the WordPress
 * HTTP API (wp_remote_*) rather than cURL directly.
 *
 * @see https://developers.cloudflare.com/api/resources/email_sending/methods/send
 */
final class Client
{
    private const BASE = 'https://api.cloudflare.com/client/v4';

    /**
     * POST an email payload. Returns the Cloudflare `result` object
     * (delivered / permanent_bounces / queued) on success.
     *
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     * @throws \RuntimeException on any non-success response.
     */
    public static function send(array $payload): array
    {
        $url = self::BASE . '/accounts/' . rawurlencode(Config::accountId()) . '/email/sending/send';

        $response = wp_remote_post($url, [
            'headers' => [
                'Authorization' => 'Bearer ' . Config::apiToken(),
                'Content-Type'  => 'application/json',
            ],
            'body'    => (string) wp_json_encode($payload),
            'timeout' => 30,
        ]);

        if (is_wp_error($response)) {
            throw new \RuntimeException($response->get_error_message());
        }

        $code = wp_remote_retrieve_response_code($response);
        $raw  = wp_remote_retrieve_body($response);
        $body = json_decode($raw, true);

        if ($code !== 200 || !is_array($body) || empty($body['success'])) {
            throw new \RuntimeException(self::errorMessage(is_array($body) ? $body : null, $raw, (int) $code));
        }

        return is_array($body['result'] ?? null) ? $body['result'] : [];
    }

    /**
     * Verify the API token. Returns ['valid' => bool, 'message' => string].
     *
     * @return array{valid: bool, message: string}
     */
    public static function verifyToken(): array
    {
        $response = wp_remote_get(self::BASE . '/user/tokens/verify', [
            'headers' => ['Authorization' => 'Bearer ' . Config::apiToken()],
            'timeout' => 15,
        ]);

        if (is_wp_error($response)) {
            return ['valid' => false, 'message' => $response->get_error_message()];
        }

        $code = wp_remote_retrieve_response_code($response);
        $raw  = wp_remote_retrieve_body($response);
        $body = json_decode($raw, true);

        if ($code === 200 && is_array($body) && !empty($body['success'])) {
            $status = (string) ($body['result']['status'] ?? 'active');
            return ['valid' => $status === 'active', 'message' => 'Token status: ' . $status];
        }

        return ['valid' => false, 'message' => self::errorMessage(is_array($body) ? $body : null, $raw, (int) $code)];
    }

    /**
     * @param array<string, mixed>|null $body
     */
    private static function errorMessage(?array $body, string $raw, int $code): string
    {
        if (is_array($body) && !empty($body['errors']) && is_array($body['errors'])) {
            $messages = array_filter(array_map(
                static fn($error): string => is_array($error) ? (string) ($error['message'] ?? '') : '',
                $body['errors']
            ));
            if ($messages) {
                return sprintf('Cloudflare API error %d: %s', $code, implode('; ', $messages));
            }
        }

        return sprintf('Cloudflare API error %d: %s', $code, $raw !== '' ? $raw : 'unknown error');
    }
}
