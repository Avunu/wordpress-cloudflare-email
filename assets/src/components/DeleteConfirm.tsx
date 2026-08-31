import type { ReactNode } from "react";
import { useCallback, useState } from "@wordpress/element";
import { Button } from "@wordpress/components";
import { __, sprintf } from "@wordpress/i18n";
import * as stylex from "@stylexjs/stylex";
import { space } from "../tokens.stylex";
import { api } from "../api";
import type { LogItem } from "../types";
import { Row } from "./Row";

const styles = stylex.create({
	// Passed to <Row> as an override: last style wins, so this flips the justification and swaps
	// the row's trailing margin for a leading one.
	actions: {
		justifyContent: "flex-end",
		gap: space.md,
		marginBlockStart: space.lg,
		marginBlockEnd: 0,
	},
});

/**
 * Confirms deletion of one or more entries. Rendered inside the Modal that DataViews provides for a
 * RenderModal action.
 */
export function DeleteConfirm({
	items,
	closeModal,
	onDone,
}: {
	items: LogItem[];
	closeModal?: () => void;
	onDone: () => void;
}): ReactNode {
	const [busy, setBusy] = useState(false);
	const many = items.length > 1;

	const doDelete = useCallback(async () => {
		setBusy(true);
		try {
			await (many
				? api("/logs/bulk-delete", {
						method: "POST",
						data: { ids: items.map((i) => i.id) },
					})
				: api(`/logs/${items[0]?.id}`, { method: "DELETE" }));
			onDone();
			closeModal?.();
		} catch (error: unknown) {
			// The reset is duplicated across both exits rather than shared in a `finally`, which
			// React Compiler cannot lower. Rethrown so a failed delete is not swallowed silently.
			setBusy(false);
			throw error;
		}
		setBusy(false);
	}, [items, many, closeModal, onDone]);

	return (
		<>
			<p>
				{many
					? sprintf(
							/* translators: %d: number of entries */
							__("Delete %d log entries? This cannot be undone.", "cloudflare-email"),
							items.length,
						)
					: __("Delete this log entry? This cannot be undone.", "cloudflare-email")}
			</p>
			<Row style={styles.actions}>
				<Button variant="tertiary" onClick={closeModal} disabled={busy}>
					{__("Cancel", "cloudflare-email")}
				</Button>
				<Button variant="primary" isDestructive onClick={doDelete} isBusy={busy}>
					{__("Delete", "cloudflare-email")}
				</Button>
			</Row>
		</>
	);
}
