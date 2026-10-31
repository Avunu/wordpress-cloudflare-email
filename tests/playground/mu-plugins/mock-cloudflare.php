<?php

/**
 * Test-only mock. Intercepts outbound HTTP to the Cloudflare Email Sending API so
 * CloudflareEmail\Client::send() and verifyToken() succeed offline inside
 * wp-playground ("suppressed" recipients excepted — see below). Only api.cloudflare.com is touched; every other request is left
 * to WordPress. Loaded automatically as an mu-plugin by the test harness.
 */

declare(strict_types=1);

add_filter('pre_http_request', static function ($pre, array $args, string $url) {
    if (strpos($url, 'api.cloudflare.com') === false) {
        return $pre; // Not a Cloudflare call — let WordPress handle it.
    }

    $code = 200;
    if (strpos($url, '/user/tokens/verify') !== false) {
        $body = ['success' => true, 'errors' => [], 'messages' => [], 'result' => ['status' => 'active']];
    } elseif (strpos($url, '/email/sending/suppressions') !== false) {
        // The suppression list. A test sets the global to simulate a token that cannot read it.
        if (!empty($GLOBALS['cloudflare_email_mock_forbid_suppressions'])) {
            $code = 403;
            $body = ['success' => false, 'errors' => [['code' => 10102, 'message' => 'email.sending.error.authentication.forbidden']], 'messages' => [], 'result' => null];
        } else {
            $body = ['success' => true, 'errors' => [], 'messages' => [], 'result_info' => ['page' => 1, 'total_pages' => 1], 'result' => [
                ['id' => '1', 'email' => 'suppressed@example.com', 'expires_at' => null, 'reason' => 'hard_bounce', 'scope' => ['type' => 'account']],
                ['id' => '2', 'email' => 'lapsed@example.com', 'expires_at' => '2020-01-01T00:00:00Z', 'reason' => 'manual', 'scope' => ['type' => 'account']],
            ]];
        }
    } else {
        // The Email Sending "send" endpoint. Each call's addressing is recorded so a test can
        // assert what was sent, and — like Cloudflare with the domain's default settings — the
        // whole message is rejected when any recipient contains "suppressed".
        $payload    = json_decode((string) ($args['body'] ?? ''), true);
        $recipients = array_merge((array) ($payload['to'] ?? []), (array) ($payload['cc'] ?? []), (array) ($payload['bcc'] ?? []));
        $GLOBALS['cloudflare_email_mock_sends'][] = [
            'to'      => (array) ($payload['to'] ?? []),
            'cc'      => (array) ($payload['cc'] ?? []),
            'bcc'     => (array) ($payload['bcc'] ?? []),
            'subject' => (string) ($payload['subject'] ?? ''),
        ];

        if (preg_grep('/suppressed/i', $recipients)) {
            $code = 400;
            $body = ['success' => false, 'errors' => [['code' => 10001, 'message' => 'email.sending.error.email.recipient_suppressed']], 'messages' => [], 'result' => null];
        } else {
            $body = ['success' => true, 'errors' => [], 'messages' => [], 'result' => ['delivered' => $recipients, 'permanent_bounces' => [], 'queued' => []]];
        }
    }

    return [
        'headers'  => [],
        'body'     => (string) wp_json_encode($body),
        'response' => ['code' => $code, 'message' => $code === 200 ? 'OK' : 'Error'],
        'cookies'  => [],
        'filename' => null,
    ];
}, 10, 3);
