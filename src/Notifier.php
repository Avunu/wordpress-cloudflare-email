<?php

declare(strict_types=1);

namespace CloudflareEmail;

/**
 * Tells the site administrator when Cloudflare refused to deliver to a suppressed
 * recipient. Without this the only trace is a log row nobody may look at, and the
 * suppressed person (often the business owner on a contact form) silently stops
 * receiving mail.
 *
 * The notice goes out through wp_mail(), so it is itself routed through Cloudflare and
 * logged like any other message.
 */
final class Notifier
{
    /** Set while a notice is being sent, so a notice that itself fails cannot trigger another. */
    private static bool $sending = false;

    /**
     * Some recipients were dropped because they are suppressed.
     *
     * @param array<string, mixed> $record     From Mailer::buildRecord().
     * @param array<int, string>   $suppressed Bare addresses that were dropped.
     * @param bool                 $delivered  Whether the remaining recipients were sent the message.
     */
    public static function suppressed(array $record, array $suppressed, bool $delivered): void
    {
        $lines = [
            sprintf(
                /* translators: %s: site name */
                __('Cloudflare refused to deliver an email from %s to the following recipient(s), because they are on your Cloudflare Email Sending suppression list (after an earlier hard bounce or spam complaint):', 'cloudflare-email'),
                self::siteName()
            ),
            '',
            ...array_map(static fn(string $address): string => '  ' . $address, $suppressed),
            '',
            $delivered
                ? __('The email was delivered to its other recipients.', 'cloudflare-email')
                : __('The email was NOT delivered to anyone.', 'cloudflare-email'),
            '',
            ...self::summary($record),
            '',
            __('If an address should receive mail again, remove it from the suppression list in the Cloudflare dashboard (Email Service → Suppressions), then resend the email from the log.', 'cloudflare-email'),
        ];

        self::send(
            /* translators: %s: site name */
            sprintf(__('[%s] Email not delivered to a suppressed recipient', 'cloudflare-email'), self::siteName()),
            $lines,
            $suppressed
        );
    }

    /**
     * Cloudflare reported a suppressed recipient but the plugin could not tell which,
     * so the message was not sent at all.
     *
     * @param array<string, mixed> $record From Mailer::buildRecord().
     */
    public static function unidentifiedSuppression(array $record, string $reason): void
    {
        $lines = [
            sprintf(
                /* translators: %s: site name */
                __('Cloudflare rejected an email from %s because one of its recipients is on your Cloudflare Email Sending suppression list.', 'cloudflare-email'),
                self::siteName()
            ),
            '',
            sprintf(
                /* translators: %s: why the recipient could not be identified */
                __('The plugin could not work out which recipient that is (%s), so the email was NOT delivered to anyone.', 'cloudflare-email'),
                $reason
            ),
            '',
            ...self::summary($record),
            '',
            __('Allow the API token to read Email Sending suppressions so suppressed recipients can be dropped automatically, or review the suppression list in the Cloudflare dashboard (Email Service → Suppressions), then resend the email from the log.', 'cloudflare-email'),
        ];

        self::send(
            /* translators: %s: site name */
            sprintf(__('[%s] Email rejected: suppressed recipient', 'cloudflare-email'), self::siteName()),
            $lines,
            []
        );
    }

    /**
     * @param array<int, string> $lines
     * @param array<int, string> $suppressed Bare addresses to never notify (they would be refused too).
     */
    private static function send(string $subject, array $lines, array $suppressed): void
    {
        // An admin resending from the log sees the outcome there; and a notice about a
        // failed notice would loop.
        if (self::$sending || Log::isResending()) {
            return;
        }

        /**
         * Who is told about suppressed recipients. Defaults to the site's admin email;
         * return an empty string to turn these notices off.
         *
         * @param string $to
         */
        $to = trim((string) apply_filters('cloudflare_email_suppression_notice_to', (string) get_option('admin_email')));
        if ($to === '' || in_array(strtolower($to), $suppressed, true)) {
            return;
        }

        self::$sending = true;
        try {
            wp_mail($to, $subject, implode("\n", $lines));
        } finally {
            self::$sending = false;
        }
    }

    /**
     * @param array<string, mixed> $record
     * @return array<int, string>
     */
    private static function summary(array $record): array
    {
        $headers = (array) ($record['headers'] ?? []);
        $lines   = [
            __('Subject:', 'cloudflare-email') . ' ' . (string) ($record['subject'] ?? ''),
            __('From:', 'cloudflare-email') . ' ' . (string) ($record['from_email'] ?? ''),
            __('To:', 'cloudflare-email') . ' ' . implode(', ', (array) ($record['to'] ?? [])),
        ];
        if (!empty($headers['cc'])) {
            $lines[] = __('Cc:', 'cloudflare-email') . ' ' . implode(', ', (array) $headers['cc']);
        }
        if (!empty($headers['bcc'])) {
            $lines[] = __('Bcc:', 'cloudflare-email') . ' ' . implode(', ', (array) $headers['bcc']);
        }
        $lines[] = '';
        $lines[] = __('Email log:', 'cloudflare-email') . ' ' . admin_url('tools.php?page=' . Admin::SLUG);

        return $lines;
    }

    private static function siteName(): string
    {
        return wp_specialchars_decode((string) get_option('blogname'), ENT_QUOTES);
    }
}
