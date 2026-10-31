import type { ReactNode } from "react";
import { Notice } from "@wordpress/components";
import { __, sprintf } from "@wordpress/i18n";
import * as stylex from "@stylexjs/stylex";
import { color, radius, size, space, text } from "../tokens.stylex";
import { formatDate } from "../format";
import type { LogDetail } from "../types";
import { DetailRow } from "./DetailRow";
import { StatusBadge } from "./StatusBadge";

const styles = stylex.create({
	// A column that grows into the space DetailView gives it, so the body frame can fill the modal.
	root: { display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 },
	body: {
		display: "flex",
		flexDirection: "column",
		flexGrow: 1,
		marginBlockStart: space.md,
	},
	bodyLabel: { fontWeight: text.weightEmphasis, marginBlockEnd: space.xs },
	bodyFrame: {
		flexGrow: 1,
		width: "100%",
		minHeight: size.bodyFrame,
		borderWidth: "1px",
		borderStyle: "solid",
		borderColor: color.stroke,
		borderRadius: radius.sm,
		backgroundColor: color.surface,
	},
	bodyText: {
		whiteSpace: "pre-wrap",
		overflowWrap: "break-word",
		backgroundColor: color.surfaceMuted,
		padding: space.md,
		borderRadius: radius.sm,
		flexGrow: 1,
		minHeight: size.bodyFrame,
		overflow: "auto",
	},
});

/** The full record for one logged email. The email body is sandboxed: it is untrusted HTML. */
export function Detail({ log }: { log: LogDetail }): ReactNode {
	const headers = log.headers ?? {};
	const suppressed = log.suppressed ?? [];
	return (
		<div {...stylex.props(styles.root)}>
			{log.status === "partial" && (
				<Notice status="warning" isDismissible={false}>
					{sprintf(
						/* translators: %s: comma-separated email addresses */
						__(
							"Not delivered to %s: on the Cloudflare suppression list. Every other recipient received it; Resend retries only the suppressed recipients.",
							"cloudflare-email",
						),
						suppressed.join(", "),
					)}
				</Notice>
			)}
			{log.status === "failed" && log.error && (
				<Notice status="error" isDismissible={false}>
					{log.error}
				</Notice>
			)}
			<DetailRow label={__("Date", "cloudflare-email")}>{formatDate(log.created_at)}</DetailRow>
			<DetailRow label={__("Status", "cloudflare-email")}>
				<StatusBadge status={log.status} />
				{log.resent_count > 0 &&
					` ${sprintf(
						/* translators: %d: number of resends */
						__("(resent %d×)", "cloudflare-email"),
						log.resent_count,
					)}`}
			</DetailRow>
			<DetailRow label={__("From", "cloudflare-email")}>{log.from_email}</DetailRow>
			<DetailRow label={__("To", "cloudflare-email")}>{(log.to ?? []).join(", ")}</DetailRow>
			{(headers.cc ?? []).length > 0 && (
				<DetailRow label={__("Cc", "cloudflare-email")}>{(headers.cc ?? []).join(", ")}</DetailRow>
			)}
			{(headers.bcc ?? []).length > 0 && (
				<DetailRow label={__("Bcc", "cloudflare-email")}>
					{(headers.bcc ?? []).join(", ")}
				</DetailRow>
			)}
			{Boolean(headers.reply_to) && (
				<DetailRow label={__("Reply-To", "cloudflare-email")}>{headers.reply_to}</DetailRow>
			)}
			<DetailRow label={__("Subject", "cloudflare-email")}>{log.subject}</DetailRow>
			{(log.attachments ?? []).length > 0 && (
				<DetailRow label={__("Attachments", "cloudflare-email")}>
					{(log.attachments ?? []).map((a) => a.name).join(", ")}
				</DetailRow>
			)}
			<div {...stylex.props(styles.body)}>
				<div {...stylex.props(styles.bodyLabel)}>{__("Body", "cloudflare-email")}</div>
				{log.body_html ? (
					<iframe
						title={__("Email body", "cloudflare-email")}
						sandbox=""
						srcDoc={log.body_html}
						{...stylex.props(styles.bodyFrame)}
					/>
				) : (
					<pre {...stylex.props(styles.bodyText)}>{log.body_text ?? ""}</pre>
				)}
			</div>
		</div>
	);
}
