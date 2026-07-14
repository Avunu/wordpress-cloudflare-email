<?php

declare(strict_types=1);

namespace CloudflareEmail;

/**
 * Bootstrap: wires every hook. Kept deliberately small.
 */
final class Plugin
{
    public static function init(): void
    {
        // Self-heal the log table if the activation hook never ran for this database
        // (in-place self-update, must-use plugin, or an imported database).
        Log::maybeUpgrade();

        // The log UI + REST API are available whenever the plugin is active, so an
        // admin can review past sends even after credentials are removed.
        add_action('rest_api_init', [Rest::class, 'register']);
        add_action(Log::CRON_HOOK, [Log::class, 'prune']);

        if (is_admin()) {
            add_action('admin_menu', [Admin::class, 'menu']);
            add_action('admin_enqueue_scripts', [Admin::class, 'enqueue']);
        }

        if (defined('WP_CLI') && WP_CLI) {
            Cli::register();
        }

        if (!Config::isConfigured()) {
            add_action('admin_notices', [self::class, 'configNotice']);
            return; // Do not intercept mail — WordPress sends natively.
        }

        // Swap the global PHPMailer for our subclass at the very start of wp_mail().
        add_filter('pre_wp_mail', [self::class, 'interceptMail'], 9);

        if (($from = Config::fromAddress()) !== null) {
            add_filter('wp_mail_from', static fn(): string => $from);
        }
        if (($name = Config::fromName()) !== null) {
            add_filter('wp_mail_from_name', static fn(): string => $name);
        }
    }

    /**
     * `pre_wp_mail` callback. Ensures core's PHPMailer is loaded, then replaces
     * the global mailer with our subclass so core parses onto it and calls our
     * send(). Returns the incoming short-circuit value unchanged (null) so core
     * proceeds.
     *
     * This lives here — not on Mailer — deliberately: `pre_wp_mail` fires before
     * core loads PHPMailer, and autoloading Mailer (a PHPMailer subclass) before
     * its parent is declared would be a fatal error. Requiring the parent first,
     * then referencing Mailer, keeps the load order correct.
     *
     * @param mixed $return
     * @return mixed
     */
    public static function interceptMail($return)
    {
        if (!class_exists(\PHPMailer\PHPMailer\PHPMailer::class, false)) {
            require_once ABSPATH . WPINC . '/PHPMailer/PHPMailer.php';
            require_once ABSPATH . WPINC . '/PHPMailer/Exception.php';
            require_once ABSPATH . WPINC . '/PHPMailer/SMTP.php';
        }

        // `true` => throw exceptions, matching core wp_mail()'s own constructor call.
        $GLOBALS['phpmailer'] = new Mailer(true);

        return $return;
    }

    public static function activate(): void
    {
        Log::install();

        if (!wp_next_scheduled(Log::CRON_HOOK)) {
            wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', Log::CRON_HOOK);
        }
    }

    public static function deactivate(): void
    {
        wp_clear_scheduled_hook(Log::CRON_HOOK);
    }

    public static function configNotice(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }
        echo '<div class="notice notice-warning"><p><strong>' .
            esc_html__('Cloudflare Email', 'cloudflare-email') . ':</strong> ' .
            esc_html__('not configured. Define CLOUDFLARE_EMAIL_ACCOUNT_ID and CLOUDFLARE_EMAIL_API_TOKEN in wp-config.php to route mail through Cloudflare.', 'cloudflare-email') .
            '</p></div>';
    }
}
