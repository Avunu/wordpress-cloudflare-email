/**
 * Design tokens for the log viewer.
 *
 * Every value points at the WordPress Design System (`--wpds-*`), which core loads as the
 * `wp-theme` stylesheet (see Admin::enqueue, which declares it as a dependency). There are
 * deliberately no `var(…, fallback)` defaults: the plugin requires WordPress 7.0, which ships
 * design-tokens.css, and a silent fallback would hide the case where that stylesheet is missing.
 * The browser test asserts a resolved badge colour so that case fails loudly instead.
 *
 * StyleX requires this file to be named `*.stylex.ts` and to export nothing but `defineVars` groups
 * — the compiler resolves the file path to generate stable custom-property names.
 */
import * as stylex from "@stylexjs/stylex";

export const color = stylex.defineVars({
	/** Detail-pane iframe backdrop. */
	surface: "var(--wpds-color-background-surface-neutral-strong)",
	/** Plain-text body block. */
	surfaceMuted: "var(--wpds-color-background-surface-neutral-weak)",
	/** Detail-pane iframe border. */
	stroke: "var(--wpds-color-stroke-surface-neutral)",
	sentBg: "var(--wpds-color-background-surface-success)",
	sentFg: "var(--wpds-color-foreground-content-success)",
	failedBg: "var(--wpds-color-background-surface-error)",
	failedFg: "var(--wpds-color-foreground-content-error)",
});

export const space = stylex.defineVars({
	xs: "var(--wpds-dimension-padding-xs)", // 4px
	sm: "var(--wpds-dimension-gap-sm)", // 8px
	md: "var(--wpds-dimension-padding-md)", // 12px
	lg: "var(--wpds-dimension-gap-lg)", // 16px
});

export const radius = stylex.defineVars({
	sm: "var(--wpds-border-radius-sm)", // 2px
});

export const text = stylex.defineVars({
	sizeSm: "var(--wpds-typography-font-size-sm)", // 12px
	weightEmphasis: "var(--wpds-typography-font-weight-emphasis)", // 600
});

export const size = stylex.defineVars({
	/** Label column of a detail row. */
	detailLabel: "90px",
	/** Height of the rendered email body (iframe) and its plain-text fallback. */
	bodyFrame: "420px",
});
