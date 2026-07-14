<?php

/**
 * Test-only mock. Intercepts outbound HTTP to the Cloudflare Email Sending API so
 * CloudflareEmail\Client::send() and verifyToken() succeed offline inside
 * wp-playground. Only api.cloudflare.com is touched; every other request is left
 * to WordPress. Loaded automatically as an mu-plugin by the test harness.
 */

declare(strict_types=1);

add_filter('pre_http_request', static function ($pre, array $args, string $url) {
    if (strpos($url, 'api.cloudflare.com') === false) {
        return $pre; // Not a Cloudflare call — let WordPress handle it.
    }

    if (strpos($url, '/user/tokens/verify') !== false) {
        $body = ['success' => true, 'errors' => [], 'messages' => [], 'result' => ['status' => 'active']];
    } else {
        // The Email Sending "send" endpoint.
        $body = ['success' => true, 'errors' => [], 'messages' => [], 'result' => ['delivered' => true]];
    }

    return [
        'headers'  => [],
        'body'     => (string) wp_json_encode($body),
        'response' => ['code' => 200, 'message' => 'OK'],
        'cookies'  => [],
        'filename' => null,
    ];
}, 10, 3);
