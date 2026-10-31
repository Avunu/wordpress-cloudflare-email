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
     * @throws ApiError on a Cloudflare error response.
     * @throws \RuntimeException when the request itself fails.
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
            throw self::error(is_array($body) ? $body : null, $raw, (int) $code);
        }

        return is_array($body['result'] ?? null) ? $body['result'] : [];
    }

    /**
     * Every entry on the account's Email Sending suppression list. Cloudflare's
     * `recipient_suppressed` error does not say which recipient is suppressed, so
     * this is how the mailer finds out. Requires the token to be able to read
     * suppressions; throws (like any API failure) when it cannot.
     *
     * @return array<int, array<string, mixed>>
     * @throws \RuntimeException
     * @see https://developers.cloudflare.com/api/resources/email_sending/subresources/suppressions/methods/list/
     */
    public static function suppressions(): array
    {
        $url     = self::BASE . '/accounts/' . rawurlencode(Config::accountId()) . '/email/sending/suppressions';
        $entries = [];

        // Bounded so a pathological response cannot loop forever.
        for ($page = 1; $page <= 50; $page++) {
            $response = wp_remote_get(add_query_arg(['page' => $page, 'per_page' => 1000], $url), [
                'headers' => ['Authorization' => 'Bearer ' . Config::apiToken()],
                'timeout' => 15,
            ]);

            if (is_wp_error($response)) {
                throw new \RuntimeException($response->get_error_message());
            }

            $code = wp_remote_retrieve_response_code($response);
            $raw  = wp_remote_retrieve_body($response);
            $body = json_decode($raw, true);

            if ($code !== 200 || !is_array($body) || empty($body['success'])) {
                throw self::error(is_array($body) ? $body : null, $raw, (int) $code);
            }

            $result = is_array($body['result'] ?? null) ? array_values(array_filter($body['result'], 'is_array')) : [];
            $entries = array_merge($entries, $result);

            $totalPages = (int) ($body['result_info']['total_pages'] ?? 0);
            if ($result === [] || $page >= $totalPages) {
                break;
            }
        }

        return $entries;
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

        return ['valid' => false, 'message' => self::error(is_array($body) ? $body : null, $raw, (int) $code)->getMessage()];
    }

    /**
     * @param array<string, mixed>|null $body
     */
    private static function error(?array $body, string $raw, int $code): ApiError
    {
        if (is_array($body) && !empty($body['errors']) && is_array($body['errors'])) {
            $messages = array_values(array_filter(array_map(
                static fn($error): string => is_array($error) ? (string) ($error['message'] ?? '') : '',
                $body['errors']
            )));
            if ($messages) {
                return new ApiError(sprintf('Cloudflare API error %d: %s', $code, implode('; ', $messages)), $code, $messages);
            }
        }

        return new ApiError(sprintf('Cloudflare API error %d: %s', $code, $raw !== '' ? $raw : 'unknown error'), $code);
    }
}
