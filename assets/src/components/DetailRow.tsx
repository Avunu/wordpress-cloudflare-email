import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { size, text } from "../tokens.stylex";
import { Row } from "./Row";

const styles = stylex.create({
	label: {
		flexGrow: 0,
		flexShrink: 0,
		minWidth: size.detailLabel,
		fontWeight: text.weightEmphasis,
	},
	value: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
});

/** One label/value line of the detail view. Renders nothing when the value is empty. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }): ReactNode {
	if (children === null || children === undefined || children === "") {
		return null;
	}
	return (
		<Row>
			<div {...stylex.props(styles.label)}>{label}</div>
			<div {...stylex.props(styles.value)}>{children}</div>
		</Row>
	);
}
