<?php

declare(strict_types=1);

namespace CloudflareEmail;

/**
 * The email log: a single custom table plus the query/mutation helpers behind
 * the REST API. Values are stored as JSON (not PHP serialize()), so there is no
 * object-injection surface on read.
 */
final class Log
{
    public const CRON_HOOK = 'cloudflare_email_prune';

    /**
     * Set to a log id while a resend is in flight, so record() updates that row
     * instead of inserting a duplicate.
     */
    private static ?int $resendingId = null;

    public static function table(): string
    {
        global $wpdb;
        return $wpdb->prefix . 'cloudflare_email_log';
    }

    /**
     * Create/upgrade the log table. Safe to call repeatedly (dbDelta).
     */
    public static function install(): void
    {
        global $wpdb;

        $table   = self::table();
        $charset = $wpdb->get_charset_collate();

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        $sql = "CREATE TABLE $table (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            created_at DATETIME NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'sent',
            from_email VARCHAR(255) NOT NULL DEFAULT '',
            to_json TEXT NULL,
            subject VARCHAR(998) NOT NULL DEFAULT '',
            body_html LONGTEXT NULL,
            body_text LONGTEXT NULL,
            headers_json TEXT NULL,
            attachments_json TEXT NULL,
            cf_result_json TEXT NULL,
            error TEXT NULL,
            resent_count INT UNSIGNED NOT NULL DEFAULT 0,
            PRIMARY KEY  (id),
            KEY status (status),
            KEY created_at (created_at)
        ) $charset;";

        dbDelta($sql);
    }

    /**
     * Persist the outcome of a send. During a resend the original row is updated
     * (status + resent_count) rather than a new row inserted.
     *
     * @param array<string, mixed> $record  From Mailer::buildRecord().
     * @param 'sent'|'failed'       $status
     * @param array<string, mixed>|null $result Cloudflare result object.
     */
    public static function record(array $record, string $status, ?array $result, ?string $error): void
    {
        global $wpdb;

        if (self::$resendingId !== null) {
            $wpdb->query($wpdb->prepare(
                "UPDATE " . self::table() . " SET status = %s, cf_result_json = %s, error = %s, resent_count = resent_count + 1 WHERE id = %d",
                $status,
                $result !== null ? (string) wp_json_encode($result) : null,
                $error,
                self::$resendingId
            ));
            return;
        }

        // Failures are always logged; successes only when logging is enabled.
        if ($status === 'sent' && !Config::logSuccesses()) {
            return;
        }

        $wpdb->insert(self::table(), [
            'created_at'       => current_time('mysql'),
            'status'           => $status,
            'from_email'       => (string) ($record['from_email'] ?? ''),
            'to_json'          => (string) wp_json_encode($record['to'] ?? []),
            'subject'          => (string) ($record['subject'] ?? ''),
            'body_html'        => $record['body_html'] ?? null,
            'body_text'        => $record['body_text'] ?? null,
            'headers_json'     => (string) wp_json_encode($record['headers'] ?? []),
            'attachments_json' => (string) wp_json_encode($record['attachments'] ?? []),
            'cf_result_json'   => $result !== null ? (string) wp_json_encode($result) : null,
            'error'            => $error,
        ]);
    }

    /**
     * Paginated, filtered list for the DataViews table.
     *
     * @param array<string, mixed> $args
     * @return array{items: array<int, array<string, mixed>>, total: int}
     */
    public static function query(array $args): array
    {
        global $wpdb;

        $table    = self::table();
        $perPage  = min(100, max(1, (int) ($args['per_page'] ?? 20)));
        $page     = max(1, (int) ($args['page'] ?? 1));
        $offset   = ($page - 1) * $perPage;

        $where  = ['1=1'];
        $params = [];

        if (!empty($args['status']) && in_array($args['status'], ['sent', 'failed'], true)) {
            $where[]  = 'status = %s';
            $params[] = $args['status'];
        }

        if (!empty($args['search'])) {
            $like     = '%' . $wpdb->esc_like((string) $args['search']) . '%';
            $where[]  = '(from_email LIKE %s OR subject LIKE %s OR to_json LIKE %s)';
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
        }

        $whereSql = implode(' AND ', $where);

        // Both validated against an allowlist, so safe to interpolate.
        $orderby = in_array($args['orderby'] ?? '', ['created_at', 'status', 'from_email', 'subject'], true)
            ? (string) $args['orderby']
            : 'created_at';
        $order = strtoupper((string) ($args['order'] ?? 'DESC')) === 'ASC' ? 'ASC' : 'DESC';

        $countSql = "SELECT COUNT(*) FROM $table WHERE $whereSql";
        $total    = (int) $wpdb->get_var($params ? $wpdb->prepare($countSql, $params) : $countSql);

        $listSql = "SELECT id, created_at, status, from_email, to_json, subject, resent_count
            FROM $table WHERE $whereSql ORDER BY $orderby $order LIMIT %d OFFSET %d";
        $rows = $wpdb->get_results(
            $wpdb->prepare($listSql, array_merge($params, [$perPage, $offset])),
            ARRAY_A
        );

        return [
            'items' => array_map([self::class, 'formatListItem'], $rows ?: []),
            'total' => $total,
        ];
    }

    /**
     * Full record for the detail modal.
     *
     * @return array<string, mixed>|null
     */
    public static function find(int $id): ?array
    {
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM " . self::table() . " WHERE id = %d", $id),
            ARRAY_A
        );
        return $row ? self::formatDetail($row) : null;
    }

    public static function delete(int $id): bool
    {
        global $wpdb;
        return (bool) $wpdb->delete(self::table(), ['id' => $id], ['%d']);
    }

    /**
     * @param array<int, int> $ids
     */
    public static function bulkDelete(array $ids): int
    {
        global $wpdb;

        $ids = array_values(array_unique(array_filter(array_map('intval', $ids))));
        if ($ids === []) {
            return 0;
        }

        $placeholders = implode(',', array_fill(0, count($ids), '%d'));
        return (int) $wpdb->query(
            $wpdb->prepare("DELETE FROM " . self::table() . " WHERE id IN ($placeholders)", $ids)
        );
    }

    /**
     * Re-send a logged email. Rehydrates the stored fields, re-attaches any
     * attachment files still present on disk, and runs the normal wp_mail() path
     * (which routes back through Mailer) — updating this row rather than creating
     * a new one.
     */
    public static function resend(int $id): bool
    {
        global $wpdb;

        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM " . self::table() . " WHERE id = %d", $id),
            ARRAY_A
        );
        if (!$row) {
            return false;
        }

        $to          = json_decode((string) $row['to_json'], true) ?: [];
        $headersMeta = json_decode((string) $row['headers_json'], true) ?: [];
        $attachMeta  = json_decode((string) $row['attachments_json'], true) ?: [];

        $isHtml  = !empty($row['body_html']);
        $message = $isHtml ? (string) $row['body_html'] : (string) $row['body_text'];

        $headers = [];
        if ((string) $row['from_email'] !== '') {
            $headers[] = 'From: ' . $row['from_email'];
        }
        $headers[] = 'Content-Type: ' . ($isHtml ? 'text/html' : 'text/plain') . '; charset=UTF-8';
        foreach ((array) ($headersMeta['cc'] ?? []) as $cc) {
            $headers[] = 'Cc: ' . $cc;
        }
        foreach ((array) ($headersMeta['bcc'] ?? []) as $bcc) {
            $headers[] = 'Bcc: ' . $bcc;
        }
        if (!empty($headersMeta['reply_to'])) {
            $headers[] = 'Reply-To: ' . $headersMeta['reply_to'];
        }
        foreach ((array) ($headersMeta['custom'] ?? []) as $name => $value) {
            $headers[] = $name . ': ' . $value;
        }

        $attachments = [];
        foreach ($attachMeta as $attachment) {
            $path = (string) ($attachment['path'] ?? '');
            if ($path !== '' && is_readable($path)) {
                $attachments[] = $path;
            }
        }

        self::$resendingId = $id;
        try {
            $sent = wp_mail($to, (string) $row['subject'], $message, $headers, $attachments);
        } finally {
            self::$resendingId = null;
        }

        return (bool) $sent;
    }

    /**
     * Delete rows older than the retention window. Runs daily via WP-Cron.
     */
    public static function prune(): void
    {
        global $wpdb;

        $days = Config::retentionDays();
        if ($days <= 0) {
            return;
        }

        $wpdb->query($wpdb->prepare(
            "DELETE FROM " . self::table() . " WHERE created_at < %s",
            gmdate('Y-m-d H:i:s', time() - $days * DAY_IN_SECONDS)
        ));
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private static function formatListItem(array $row): array
    {
        return [
            'id'           => (int) $row['id'],
            'created_at'   => (string) $row['created_at'],
            'status'       => (string) $row['status'],
            'from_email'   => (string) $row['from_email'],
            'to'           => json_decode((string) $row['to_json'], true) ?: [],
            'subject'      => (string) $row['subject'],
            'resent_count' => (int) $row['resent_count'],
        ];
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private static function formatDetail(array $row): array
    {
        return [
            'id'           => (int) $row['id'],
            'created_at'   => (string) $row['created_at'],
            'status'       => (string) $row['status'],
            'from_email'   => (string) $row['from_email'],
            'to'           => json_decode((string) $row['to_json'], true) ?: [],
            'subject'      => (string) $row['subject'],
            'body_html'    => $row['body_html'] !== null ? (string) $row['body_html'] : null,
            'body_text'    => $row['body_text'] !== null ? (string) $row['body_text'] : null,
            'headers'      => json_decode((string) $row['headers_json'], true) ?: [],
            'attachments'  => json_decode((string) $row['attachments_json'], true) ?: [],
            'cf_result'    => $row['cf_result_json'] !== null ? json_decode((string) $row['cf_result_json'], true) : null,
            'error'        => $row['error'] !== null ? (string) $row['error'] : null,
            'resent_count' => (int) $row['resent_count'],
        ];
    }
}
