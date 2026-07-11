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
        } catch (\Throwable $e) {
            Log::record($record, 'failed', null, $e->getMessage());
            throw new PHPMailerException($e->getMessage(), (int) $e->getCode());
        }

        Log::record($record, 'sent', $result, null);

        return true;
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
