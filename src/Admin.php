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

    /**
     * Set once the log-viewer script has actually been enqueued. render() reads it to
     * decide between mounting the app and showing a "build your assets" notice, so a
     * missing/broken build degrades to a clear message instead of a silent blank page.
     */
    private static bool $assetsReady = false;

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
        // enqueue() runs on admin_enqueue_scripts, before this page callback, so the flag
        // is already set. If the assets never enqueued, say so rather than rendering an
        // empty mount point (which historically looked like a broken/blank screen).
        if (!self::$assetsReady) {
            printf(
                '<div class="wrap"><h1>%s</h1><div class="notice notice-error"><p>%s</p></div></div>',
                esc_html__('Cloudflare Email', 'cloudflare-email'),
                esc_html__('The log viewer assets are missing or failed to build. Reinstall the plugin from the release zip, or run "npm run build" in a development checkout.', 'cloudflare-email')
            );
            return;
        }

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
        if (!is_file($assetFile) || !is_file($dir . 'build/index.js')) {
            return;
        }

        /** @var array{dependencies: array<int, string>, version: string} $asset */
        $asset = require $assetFile;

        // Only depend on handles WordPress actually has registered. An unregistered
        // dependency makes WP_Dependencies silently drop the *entire* script (the exact
        // bug that blanked this page when `wp-icons` — which core does not register —
        // leaked into the manifest). Dropping the stray handle keeps the app loading.
        $deps = array_values(array_filter(
            $asset['dependencies'],
            static fn(string $handle): bool => wp_script_is($handle, 'registered')
        ));

        wp_enqueue_script(
            'cloudflare-email-log',
            $url . 'build/index.js',
            $deps,
            $asset['version'],
            true
        );
        self::$assetsReady = true;

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
