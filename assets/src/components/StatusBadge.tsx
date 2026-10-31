import type { ReactNode } from "react";
import { __ } from "@wordpress/i18n";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { color, radius, space, text } from "../tokens.stylex";
import type { Status } from "../types";

const styles = stylex.create({
	badge: {
		display: "inline-block",
		paddingBlock: "2px",
		paddingInline: space.sm,
		borderRadius: radius.sm,
		fontSize: text.sizeSm,
		fontWeight: text.weightEmphasis,
	},
	sent: { color: color.sentFg, backgroundColor: color.sentBg },
	partial: { color: color.partialFg, backgroundColor: color.partialBg },
	failed: { color: color.failedFg, backgroundColor: color.failedBg },
});

// Both maps are exhaustive over Status: adding a status becomes a compile error rather than
// silently falling through to the "sent" label and styling.
const LABEL: Readonly<Record<Status, string>> = {
	sent: __("Sent", "cloudflare-email"),
	partial: __("Partial", "cloudflare-email"),
	failed: __("Failed", "cloudflare-email"),
};

const VARIANT: Readonly<Record<Status, StyleXStyles>> = {
	sent: styles.sent,
	partial: styles.partial,
	failed: styles.failed,
};

/** The coloured send-outcome pill, shown in the table and in the detail view. */
export function StatusBadge({ status }: { status: Status }): ReactNode {
	return <span {...stylex.props(styles.badge, VARIANT[status])}>{LABEL[status]}</span>;
}
