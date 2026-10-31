import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "@wordpress/element";
import { Button, Notice, Spinner } from "@wordpress/components";
import { __ } from "@wordpress/i18n";
import * as stylex from "@stylexjs/stylex";
import { space } from "../tokens.stylex";
import { api, resendLog } from "../api";
import type { LogDetail } from "../types";
import { DeleteConfirm } from "./DeleteConfirm";
import { Detail } from "./Detail";
import { Row } from "./Row";

const styles = stylex.create({
	// Fills the modal's content area so the email body below can take the remaining height.
	root: { display: "flex", flexDirection: "column", height: "100%" },
	// Passed to <Row> as an override, as DeleteConfirm does: the actions sit right-aligned above the
	// record, so they are on screen without scrolling past the email body.
	actions: { justifyContent: "flex-end", gap: space.sm, marginBlockEnd: space.md },
});

/**
 * Loads one log entry and renders it with its Resend/Delete actions. Rendered inside the Modal that
 * DataViews provides for a RenderModal action, which is a portal outside the app's mount point.
 */
export function DetailView({
	id,
	closeModal,
	onChanged,
}: {
	id: number;
	closeModal?: () => void;
	/** Called after a resend or delete, so the table behind the modal can reload. */
	onChanged: () => void;
}): ReactNode {
	const [log, setLog] = useState<LogDetail | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const [resending, setResending] = useState(false);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [notice, setNotice] = useState<{ status: "success" | "error"; message: string } | null>(
		null,
	);

	useEffect(() => {
		let cancelled = false;
		void api<LogDetail>(`/logs/${id}`).then((res) => {
			if (!cancelled) {
				setLog(res);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [id, reloadKey]);

	const doResend = useCallback(async () => {
		setResending(true);
		setNotice(null);
		const result = await resendLog(id);
		setNotice({ status: result.ok ? "success" : "error", message: result.message });
		setResending(false);
		// Resending rewrites the row's status and outcomes whether or not it succeeded.
		setReloadKey((k) => k + 1);
		onChanged();
	}, [id, onChanged]);

	if (!log) {
		return <Spinner />;
	}

	if (confirmingDelete) {
		return (
			<DeleteConfirm
				items={[log]}
				closeModal={closeModal}
				onCancel={() => setConfirmingDelete(false)}
				onDone={onChanged}
			/>
		);
	}

	return (
		<div {...stylex.props(styles.root)}>
			<Row style={styles.actions}>
				<Button variant="secondary" onClick={doResend} isBusy={resending} disabled={resending}>
					{__("Resend", "cloudflare-email")}
				</Button>
				<Button
					variant="secondary"
					isDestructive
					onClick={() => setConfirmingDelete(true)}
					disabled={resending}
				>
					{__("Delete", "cloudflare-email")}
				</Button>
			</Row>
			{notice && (
				<Notice status={notice.status} onRemove={() => setNotice(null)}>
					{notice.message}
				</Notice>
			)}
			<Detail log={log} />
		</div>
	);
}
