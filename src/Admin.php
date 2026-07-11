<?php

declare(strict_types=1);

namespace CloudflareEmail;

/**
 * The one and only admin surface: a Tools submenu that mounts the DataViews
 * log app. All configuration is via constants, so there is no settings screen.
 */
final class Admin
{
    public const SLUG = 'cloudflare-email-log';

    public static function menu(): void
    {
        add_management_page(
            __('Cloudflare Email', 'cloudflare-email'),
            __('Cloudflare Email', 'cloudflare-email'),
            'manage_options',
            self::SLUG,
            [self::class, 'render']
        );
    }

    public static function render(): void
    {
        echo '<div class="wrap"><div id="cloudflare-email-log-root"></div></div>';
    }

    public static function enqueue(string $hook): void
    {
        if ($hook !== 'tools_page_' . self::SLUG) {
            return;
        }

        $dir = plugin_dir_path(CLOUDFLARE_EMAIL_FILE);
        $url = plugin_dir_url(CLOUDFLARE_EMAIL_FILE);

        $assetFile = $dir . 'build/index.asset.php';
        if (!is_file($assetFile)) {
            return;
        }

        /** @var array{dependencies: array<int, string>, version: string} $asset */
        $asset = require $assetFile;

        wp_enqueue_script(
            'cloudflare-email-log',
            $url . 'build/index.js',
            $asset['dependencies'],
            $asset['version'],
            true
        );

        wp_enqueue_style('wp-components');
        if (is_file($dir . 'build/index.css')) {
            wp_enqueue_style(
                'cloudflare-email-log',
                $url . 'build/index.css',
                ['wp-components'],
                $asset['version']
            );
        }

        wp_add_inline_script(
            'cloudflare-email-log',
            'window.cloudflareEmailLog = ' . wp_json_encode([
                'root'  => esc_url_raw(rest_url(Rest::NS)),
                'nonce' => wp_create_nonce('wp_rest'),
            ]) . ';',
            'before'
        );

        // Load translations for the app's strings if a language pack is present.
        wp_set_script_translations('cloudflare-email-log', 'cloudflare-email');
    }
}
