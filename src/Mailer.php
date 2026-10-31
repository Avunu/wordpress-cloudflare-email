<?php

declare(strict_types=1);

namespace CloudflareEmail;

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception as PHPMailerException;

/**
 * Intercepts WordPress mail by subclassing core's bundled PHPMailer.
 *
 * We do NOT redefine wp_mail() and we do NOT re-implement header parsing.
 * Instead, on `pre_wp_mail` (see Plugin::interceptMail) the global $phpmailer is
 * swapped for an instance of this class and core runs untouched: it parses the
 * From/To/Cc/Bcc/Reply-To, headers, subject, body and attachments onto our object
 * exactly as it always does, then calls $phpmailer->send(). Our send() override
 * reads that parsed state, ships it to Cloudflare, logs the outcome, and reports
 * success/failure through the same exception contract core expects (so
 * wp_mail_succeeded / wp_mail_failed still fire correctly).
 *
 * The instantiation lives in Plugin (which does NOT extend PHPMailer) rather than
 * here, because `pre_wp_mail` fires before core has loaded PHPMailer — autoloading
 * a subclass of a not-yet-declared parent would fatal.
 */
final class Mailer extends PHPMailer
{
    /**
     * Called by core wp_mail() once this object has been fully populated.
     * Never touches SMTP/mail() — dispatches to the Cloudflare API instead.
     *
     * The message goes out once, with To/Cc/Bcc exactly as WordPress built them.
     * Cloudflare rejects the whole message when any recipient is on the account's
     * suppression list, so on that error the suppressed recipients are identified,
     * dropped, and the message is sent again to everyone else — logged as `partial`,
     * with the site administrator told who missed out (see Notifier).
     *
     * @throws PHPMailerException so core catches it and fires wp_mail_failed.
     */
    public function send(): bool
    {
        $payload = $this->buildPayload();
        $record  = $this->buildRecord($payload);

        /**
         * Final chance to adjust the outgoing Cloudflare payload (e.g. strip a
         * custom header Cloudflare rejects). No settings screen by design, so this
         * filter is the escape hatch.
         *
         * @param array<string, mixed> $payload
         * @param Mailer               $mailer
         */
        $payload = apply_filters('cloudflare_email_payload', $payload, $this);

        try {
            $result = Client::send($payload);
        } catch (ApiError $e) {
            if (!$e->has(ApiError::RECIPIENT_SUPPRESSED)) {
                self::fail($record, $e->getMessage());
            }
            return $this->sendWithoutSuppressed($payload, $record, $e);
        } catch (\Throwable $e) {
            self::fail($record, $e->getMessage());
        }

        Log::record($record, 'sent', $result, null);

        return true;
    }

    /**
     * Recover from a `recipient_suppressed` rejection: look up which recipients are
     * suppressed (the error does not say), and re-send to the rest.
     *
     * @param array<string, mixed> $payload
     * @param array<string, mixed> $record
     * @throws PHPMailerException when nobody could be sent the message.
     */
    private function sendWithoutSuppressed(array $payload, array $record, ApiError $rejection): bool
    {
        try {
            $suppressed = self::suppressedAmong(self::addresses($payload), self::domain($this->From));
        } catch (\Throwable $lookup) {
            $reason = sprintf('could not read the suppression list (%s)', $lookup->getMessage());
            Notifier::unidentifiedSuppression($record, $reason);
            self::fail($record, sprintf('%s — %s, so the message was not sent.', $rejection->getMessage(), $reason));
        }

        if ($suppressed === []) {
            $reason = 'none of the recipients is on the suppression list';
            Notifier::unidentifiedSuppression($record, $reason);
            self::fail($record, sprintf('%s — %s, so the message was not sent.', $rejection->getMessage(), $reason));
        }

        $error     = 'Not delivered to suppressed recipient(s): ' . implode(', ', $suppressed);
        $remaining = self::withoutRecipients($payload, $suppressed);

        if ($remaining === null) {
            Notifier::suppressed($record, $suppressed, false);
            self::fail($record, $error . '. No other recipients remained.', ['suppressed' => $suppressed]);
        }

        try {
            $result = Client::send($remaining);
        } catch (\Throwable $e) {
            Notifier::suppressed($record, $suppressed, false);
            self::fail($record, sprintf('%s. Sending to the remaining recipients then failed: %s', $error, $e->getMessage()), ['suppressed' => $suppressed]);
        }

        $result['suppressed'] = $suppressed;
        Log::record($record, 'partial', $result, $error);
        Notifier::suppressed($record, $suppressed, true);

        return true;
    }

    /**
     * Log a failed send and raise it the way core expects.
     *
     * @param array<string, mixed>      $record
     * @param array<string, mixed>|null $result
     * @throws PHPMailerException always.
     */
    private static function fail(array $record, string $message, ?array $result = null): never
    {
        Log::record($record, 'failed', $result, $message);
        throw new PHPMailerException($message);
    }

    /**
     * Which of $addresses are suppressed for mail from $fromDomain: an unexpired
     * entry scoped to the whole account, or to exactly that sending domain.
     *
     * @param array<int, string> $addresses Bare, lowercased addresses.
     * @return array<int, string>
     * @throws \RuntimeException when the list cannot be read.
     */
    private static function suppressedAmong(array $addresses, string $fromDomain): array
    {
        $suppressed = [];
        foreach (Client::suppressions() as $entry) {
            $email   = strtolower((string) ($entry['email'] ?? ''));
            $expires = (string) ($entry['expires_at'] ?? '');
            $scope   = is_array($entry['scope'] ?? null) ? $entry['scope'] : ['type' => 'account'];

            $active  = $expires === '' || strtotime($expires) > time();
            $applies = ($scope['type'] ?? 'account') === 'account'
                || strtolower((string) ($scope['value'] ?? '')) === $fromDomain;

            if ($active && $applies && in_array($email, $addresses, true)) {
                $suppressed[$email] = $email;
            }
        }
        return array_values($suppressed);
    }

    /**
     * Every recipient's bare address, lowercased, across To/Cc/Bcc.
     *
     * @param array<string, mixed> $payload
     * @return array<int, string>
     */
    private static function addresses(array $payload): array
    {
        $out = [];
        foreach (['to', 'cc', 'bcc'] as $field) {
            foreach ((array) ($payload[$field] ?? []) as $recipient) {
                $out[] = self::bareAddress((string) $recipient);
            }
        }
        return array_values(array_unique($out));
    }

    /**
     * The payload with $remove taken off To/Cc/Bcc, leaving the rest of the addressing
     * as it was. Cloudflare requires a To, so if every To recipient was removed the Cc
     * list moves up to To. Null when nobody visible is left to address it to.
     *
     * @param array<string, mixed> $payload
     * @param array<int, string>   $remove Bare, lowercased addresses.
     * @return array<string, mixed>|null
     */
    private static function withoutRecipients(array $payload, array $remove): ?array
    {
        foreach (['to', 'cc', 'bcc'] as $field) {
            if (!isset($payload[$field])) {
                continue;
            }
            $payload[$field] = array_values(array_filter(
                (array) $payload[$field],
                static fn($recipient): bool => !in_array(self::bareAddress((string) $recipient), $remove, true)
            ));
            if ($payload[$field] === [] && $field !== 'to') {
                unset($payload[$field]);
            }
        }

        if ($payload['to'] === [] && isset($payload['cc'])) {
            $payload['to'] = $payload['cc'];
            unset($payload['cc']);
        }

        return $payload['to'] === [] ? null : $payload;
    }

    /** "Name <a@b.c>" or "a@b.c" → "a@b.c", lowercased. */
    private static function bareAddress(string $recipient): string
    {
        return strtolower(trim(preg_match('/<([^>]+)>\s*$/', $recipient, $m) ? $m[1] : $recipient));
    }

    private static function domain(string $address): string
    {
        $at = strrpos($address, '@');
        return $at === false ? '' : strtolower(substr($address, $at + 1));
    }

    /**
     * Build the Cloudflare Email Sending JSON payload from parsed PHPMailer state.
     *
     * @return array<string, mixed>
     */
    public function buildPayload(): array
    {
        $to  = array_map([self::class, 'formatAddress'], $this->getToAddresses());
        $cc  = array_map([self::class, 'formatAddress'], $this->getCcAddresses());
        $bcc = array_map([self::class, 'formatAddress'], $this->getBccAddresses());

        if ($to === []) {
            throw new PHPMailerException('No recipients specified.');
        }
        if (count($to) + count($cc) + count($bcc) > 50) {
            throw new PHPMailerException('Cloudflare allows at most 50 combined To/Cc/Bcc recipients per message.');
        }

        $from = ['address' => $this->From];
        if ($this->FromName !== '') {
            $from['name'] = $this->FromName;
        }

        $payload = [
            'from'    => $from,
            'to'      => $to,
            'subject' => $this->Subject,
        ];

        if ($cc !== []) {
            $payload['cc'] = $cc;
        }
        if ($bcc !== []) {
            $payload['bcc'] = $bcc;
        }

        // getReplyToAddresses() => [ address => [address, name], ... ]
        $replyTo = $this->getReplyToAddresses();
        if ($replyTo !== []) {
            $first = reset($replyTo);
            $payload['reply_to'] = self::formatAddress($first);
        }

        if (strtolower($this->ContentType) === 'text/html') {
            $payload['html'] = $this->Body;
            if ($this->AltBody !== '') {
                $payload['text'] = $this->AltBody;
            }
        } else {
            $payload['text'] = $this->Body;
        }

        $headers = self::customHeaders($this->getCustomHeaders());
        if ($headers !== []) {
            $payload['headers'] = $headers;
        }

        $attachments = self::buildAttachments($this->getAttachments());
        if ($attachments !== []) {
            $payload['attachments'] = $attachments;
        }

        return $payload;
    }

    /**
     * Build the log record (no base64 content — stores attachment *paths* so a
     * later resend can re-attach files still present on disk).
     *
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    private function buildRecord(array $payload): array
    {
        $attachments = [];
        foreach ($this->getAttachments() as $attachment) {
            $isString = (bool) ($attachment[5] ?? false);
            $attachments[] = [
                'name'        => (string) ($attachment[2] !== '' ? $attachment[2] : basename((string) $attachment[1])),
                'path'        => $isString ? '' : (string) $attachment[0],
                'type'        => (string) ($attachment[4] ?? ''),
                'disposition' => (string) ($attachment[6] ?? 'attachment'),
            ];
        }

        return [
            'from_email'  => $this->From,
            'to'          => array_map([self::class, 'formatAddress'], $this->getToAddresses()),
            'subject'     => $this->Subject,
            'body_html'   => $payload['html'] ?? null,
            'body_text'   => $payload['text'] ?? null,
            'headers'     => [
                'cc'       => $payload['cc'] ?? [],
                'bcc'      => $payload['bcc'] ?? [],
                'reply_to' => $payload['reply_to'] ?? null,
                'custom'   => $payload['headers'] ?? new \stdClass(),
            ],
            'attachments' => $attachments,
        ];
    }

    /**
     * Format a PHPMailer address tuple [address, name] as an RFC 5322 string.
     *
     * @param array{0?: string, 1?: string} $address
     */
    public static function formatAddress(array $address): string
    {
        $email = (string) ($address[0] ?? '');
        $name  = (string) ($address[1] ?? '');

        if ($name === '') {
            return $email;
        }

        // Quote names containing characters that would otherwise break the header.
        if (preg_match('/[,;<>@"]/', $name)) {
            $name = '"' . str_replace('"', '\"', $name) . '"';
        }

        return sprintf('%s <%s>', $name, $email);
    }

    /**
     * @param array<int, array{0: string, 1: string}> $custom PHPMailer getCustomHeaders() tuples.
     * @return array<string, string>
     */
    private static function customHeaders(array $custom): array
    {
        $headers = [];
        foreach ($custom as $header) {
            $name  = trim((string) ($header[0] ?? ''));
            $value = (string) ($header[1] ?? '');
            if ($name !== '') {
                $headers[$name] = $value;
            }
        }
        return $headers;
    }

    /**
     * @param array<int, array<int, mixed>> $attachments PHPMailer getAttachments() tuples.
     * @return array<int, array<string, string>>
     */
    private static function buildAttachments(array $attachments): array
    {
        $out = [];
        foreach ($attachments as $attachment) {
            $isString = (bool) ($attachment[5] ?? false);
            $content  = $isString ? (string) $attachment[0] : @file_get_contents((string) $attachment[0]);
            if ($content === false || $content === '') {
                continue;
            }

            $disposition = (string) ($attachment[6] ?? 'attachment');
            $filename    = (string) ($attachment[2] !== '' ? $attachment[2] : basename((string) $attachment[1]));
            $type        = (string) ($attachment[4] ?? '');

            $entry = [
                'content'     => base64_encode($content),
                'filename'    => $filename !== '' ? $filename : 'attachment',
                'type'        => $type !== '' ? $type : 'application/octet-stream',
                'disposition' => $disposition === 'inline' ? 'inline' : 'attachment',
            ];

            // Preserve inline-image references (cid:) — PHPMailer stores the cid at index 7.
            $cid = (string) ($attachment[7] ?? '');
            if ($entry['disposition'] === 'inline' && $cid !== '') {
                $entry['content_id'] = $cid;
            }

            $out[] = $entry;
        }
        return $out;
    }
}
