// Ambient global augmentation (no imports/exports keeps this a script file, so
// The Window merge applies globally without `declare global`).

interface Window {
  /** Injected by Admin::enqueue() via wp_add_inline_script. */
  cloudflareEmailLog?: {
    root: string;
    nonce: string;
  };
}
