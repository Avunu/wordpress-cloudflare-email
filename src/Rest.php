<?php

declare(strict_types=1);

namespace CloudflareEmail;

use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * REST API backing the DataViews log UI. Namespace: cloudflare-email/v1.
 * Every route requires `manage_options`.
 */
final class Rest
{
    public const NS = 'cloudflare-email/v1';

    public static function register(): void
    {
        register_rest_route(self::NS, '/logs', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'list'],
            'permission_callback' => [self::class, 'permission'],
            'args'                => [
                'page'     => ['type' => 'integer', 'default' => 1],
                'per_page' => ['type' => 'integer', 'default' => 20],
                'search'   => ['type' => 'string'],
                'status'   => ['type' => 'string', 'enum' => ['sent', 'failed']],
                'orderby'  => ['type' => 'string'],
                'order'    => ['type' => 'string', 'enum' => ['asc', 'desc', 'ASC', 'DESC']],
            ],
        ]);

        register_rest_route(self::NS, '/logs/(?P<id>\d+)', [
            [
                'methods'             => 'GET',
                'callback'            => [self::class, 'get'],
                'permission_callback' => [self::class, 'permission'],
            ],
            [
                'methods'             => 'DELETE',
                'callback'            => [self::class, 'delete'],
                'permission_callback' => [self::class, 'permission'],
            ],
        ]);

        register_rest_route(self::NS, '/logs/bulk-delete', [
            'methods'             => 'POST',
            'callback'            => [self::class, 'bulkDelete'],
            'permission_callback' => [self::class, 'permission'],
        ]);

        register_rest_route(self::NS, '/logs/(?P<id>\d+)/resend', [
            'methods'             => 'POST',
            'callback'            => [self::class, 'resend'],
            'permission_callback' => [self::class, 'permission'],
        ]);
    }

    public static function permission(): bool
    {
        return current_user_can('manage_options');
    }

    public static function list(WP_REST_Request $request): WP_REST_Response
    {
        $perPage = min(100, max(1, (int) $request->get_param('per_page')));
        $result  = Log::query([
            'page'     => (int) $request->get_param('page'),
            'per_page' => $perPage,
            'search'   => (string) $request->get_param('search'),
            'status'   => (string) $request->get_param('status'),
            'orderby'  => (string) $request->get_param('orderby'),
            'order'    => (string) $request->get_param('order'),
        ]);

        return new WP_REST_Response([
            'logs'       => $result['items'],
            'total'      => $result['total'],
            'totalPages' => (int) ceil($result['total'] / $perPage),
        ]);
    }

    /**
     * @return WP_REST_Response|WP_Error
     */
    public static function get(WP_REST_Request $request)
    {
        $log = Log::find((int) $request->get_param('id'));
        if ($log === null) {
            return new WP_Error('not_found', 'Log entry not found.', ['status' => 404]);
        }
        return new WP_REST_Response($log);
    }

    public static function delete(WP_REST_Request $request): WP_REST_Response
    {
        $deleted = Log::delete((int) $request->get_param('id'));
        return new WP_REST_Response(['deleted' => $deleted]);
    }

    public static function bulkDelete(WP_REST_Request $request): WP_REST_Response
    {
        $ids     = (array) $request->get_param('ids');
        $deleted = Log::bulkDelete($ids);
        return new WP_REST_Response(['deleted' => $deleted]);
    }

    /**
     * @return WP_REST_Response|WP_Error
     */
    public static function resend(WP_REST_Request $request)
    {
        $id   = (int) $request->get_param('id');
        $sent = Log::resend($id);
        if (!$sent) {
            return new WP_Error('resend_failed', 'Resend failed — see the log entry for the error.', ['status' => 502]);
        }
        return new WP_REST_Response(['sent' => true, 'log' => Log::find($id)]);
    }
}
