import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { space } from "../tokens.stylex";

const styles = stylex.create({
	row: {
		display: "flex",
		alignItems: "flex-start",
		justifyContent: "flex-start",
		gap: space.lg,
		marginBlockEnd: space.sm,
	},
});

/**
 * The subset of the row a caller may override. Anything else is a type error, so a <Row> cannot be
 * restyled into something that is no longer a row.
 */
export type RowStyle = StyleXStyles<{
	gap?: string;
	justifyContent?: "flex-start" | "flex-end";
	marginBlockStart?: string;
	marginBlockEnd?: string | 0;
}>;

/** A horizontal flex line. The layout primitive the detail and confirm views are built from. */
export function Row({ style, children }: { style?: RowStyle; children: ReactNode }): ReactNode {
	return <div {...stylex.props(styles.row, style)}>{children}</div>;
}
