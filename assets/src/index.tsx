/**
 * Cloudflare Email — log viewer.
 *
 * A DataViews app mounted on the Tools → Cloudflare Email screen. All data comes from the
 * cloudflare-email/v1 REST routes. `@wordpress/dataviews` (and its non-core dependencies) are
 * bundled; everything else resolves to a core `wp.*` / React global at runtime (see
 * rolldown.config.ts).
 */
import { createRoot, useState, useEffect, useMemo, useCallback } from "@wordpress/element";
import type { ReactNode } from "react";
import domReady from "@wordpress/dom-ready";
import apiFetch from "@wordpress/api-fetch";
import { DataViews } from "@wordpress/dataviews";
import type { View, Field, Action } from "@wordpress/dataviews";
import { Button, Spinner, Notice, Flex, FlexItem } from "@wordpress/components";
import { __, sprintf } from "@wordpress/i18n";

type Status = "sent" | "failed";

interface LogItem {
	id: number;
	created_at: string;
	status: Status;
	from_email: string;
	to: string[];
	subject: string;
	resent_count: number;
}

interface LogHeaders {
	cc?: string[];
	bcc?: string[];
	reply_to?: string | null;
	custom?: Record<string, string>;
}

interface LogAttachment {
	name: string;
	path: string;
	type: string;
	disposition: string;
}

interface LogDetail extends LogItem {
	body_html: string | null;
	body_text: string | null;
	headers: LogHeaders;
	attachments: LogAttachment[];
	cf_result: unknown;
	error: string | null;
}

interface LogListResponse {
	logs: LogItem[];
	total: number;
	totalPages: number;
}

const config: { root: string; nonce: string } = window.cloudflareEmailLog ?? {
	root: "",
	nonce: "",
};

apiFetch.use(apiFetch.createNonceMiddleware(config.nonce));

interface ApiOptions {
	method?: string;
	data?: unknown;
}

function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
	return apiFetch<T>({
		url: `${config.root}${path}`,
		method: options.method,
		data: options.data,
	});
}

const STATUS_ELEMENTS = [
	{ value: "sent", label: __("Sent", "cloudflare-email") },
	{ value: "failed", label: __("Failed", "cloudflare-email") },
];

function formatDate(value: string): string {
	if (!value) {
		return "";
	}
	// Stored as site-local 'YYYY-MM-DD HH:MM:SS'.
	const date = new Date(value.replace(" ", "T"));
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function StatusBadge({ status }: { status: Status }): ReactNode {
	const failed = status === "failed";
	return (
		<span
			style={{
				display: "inline-block",
				padding: "2px 8px",
				borderRadius: "2px",
				fontSize: "12px",
				fontWeight: 600,
				color: failed ? "#8a1f11" : "#0a5624",
				background: failed ? "#fbeaea" : "#edf7ed",
			}}
		>
			{failed ? __("Failed", "cloudflare-email") : __("Sent", "cloudflare-email")}
		</span>
	);
}

function DetailRow({ label, children }: { label: string; children: ReactNode }): ReactNode {
	if (children === null || children === undefined || children === "") {
		return null;
	}
	return (
		<Flex align="flex-start" justify="flex-start" gap={4} style={{ marginBottom: 8 }}>
			<FlexItem style={{ minWidth: 90, fontWeight: 600 }}>{label}</FlexItem>
			<FlexItem isBlock>{children}</FlexItem>
		</Flex>
	);
}

function Detail({ log }: { log: LogDetail }): ReactNode {
	const headers = log.headers ?? {};
	return (
		<div>
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
			<div style={{ marginTop: 12 }}>
				<div style={{ fontWeight: 600, marginBottom: 4 }}>{__("Body", "cloudflare-email")}</div>
				{log.body_html ? (
					<iframe
						title={__("Email body", "cloudflare-email")}
						sandbox=""
						srcDoc={log.body_html}
						style={{
							width: "100%",
							height: 420,
							border: "1px solid #ddd",
							borderRadius: 2,
							background: "#fff",
						}}
					/>
				) : (
					<pre
						style={{
							whiteSpace: "pre-wrap",
							wordBreak: "break-word",
							background: "#f6f7f7",
							padding: 12,
							borderRadius: 2,
							maxHeight: 420,
							overflow: "auto",
						}}
					>
						{log.body_text ?? ""}
					</pre>
				)}
			</div>
		</div>
	);
}

// Rendered inside the Modal that DataViews provides for a RenderModal action.
function DetailView({ id }: { id: number }): ReactNode {
	const [log, setLog] = useState<LogDetail | null>(null);
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
	}, [id]);

	return log ? <Detail log={log} /> : <Spinner />;
}

// Rendered inside the Modal that DataViews provides for a RenderModal action.
function DeleteConfirm({
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
		} finally {
			setBusy(false);
		}
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
			<Flex justify="flex-end" gap={3} style={{ marginTop: 16 }}>
				<Button variant="tertiary" onClick={closeModal} disabled={busy}>
					{__("Cancel", "cloudflare-email")}
				</Button>
				<Button variant="primary" isDestructive onClick={doDelete} isBusy={busy}>
					{__("Delete", "cloudflare-email")}
				</Button>
			</Flex>
		</>
	);
}

const DEFAULT_VIEW: View = {
	type: "table",
	page: 1,
	perPage: 20,
	search: "",
	filters: [],
	sort: { field: "created_at", direction: "desc" },
	fields: ["created_at", "status", "from_email", "to"],
	titleField: "subject",
};

function App(): ReactNode {
	const [view, setView] = useState<View>(DEFAULT_VIEW);
	const [data, setData] = useState<LogItem[]>([]);
	const [paginationInfo, setPaginationInfo] = useState({
		totalItems: 0,
		totalPages: 0,
	});
	const [isLoading, setIsLoading] = useState(true);
	const [refreshKey, setRefreshKey] = useState(0);
	const [notice, setNotice] = useState<string | null>(null);

	const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

	useEffect(() => {
		let cancelled = false;
		setIsLoading(true);

		const statusFilter = (view.filters ?? []).find((f) => f.field === "status");
		const rawStatus: unknown = Array.isArray(statusFilter?.value)
			? statusFilter?.value[0]
			: statusFilter?.value;

		const params = new URLSearchParams({
			page: String(view.page ?? 1),
			per_page: String(view.perPage ?? 20),
		});
		if (view.search) {
			params.set("search", view.search);
		}
		if (rawStatus) {
			params.set("status", String(rawStatus));
		}
		if (view.sort?.field) {
			params.set("orderby", view.sort.field);
			params.set("order", view.sort.direction ?? "desc");
		}

		api<LogListResponse>(`/logs?${params.toString()}`)
			.then((res) => {
				if (cancelled) {
					return;
				}
				setData(res.logs ?? []);
				setPaginationInfo({
					totalItems: res.total ?? 0,
					totalPages: res.totalPages ?? 0,
				});
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setNotice(
						error instanceof Error
							? error.message
							: __("Failed to load the email log.", "cloudflare-email"),
					);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [view, refreshKey]);

	const fields = useMemo<Field<LogItem>[]>(
		() => [
			{
				id: "created_at",
				label: __("Date", "cloudflare-email"),
				enableSorting: true,
				enableHiding: false,
				render: ({ item }) => formatDate(item.created_at),
			},
			{
				id: "status",
				label: __("Status", "cloudflare-email"),
				enableSorting: true,
				elements: STATUS_ELEMENTS,
				filterBy: { operators: ["is"] },
				render: ({ item }) => <StatusBadge status={item.status} />,
			},
			{
				id: "from_email",
				label: __("From", "cloudflare-email"),
				enableSorting: true,
			},
			{
				id: "to",
				label: __("To", "cloudflare-email"),
				enableSorting: false,
				render: ({ item }) => (item.to ?? []).join(", "),
			},
			{
				id: "subject",
				label: __("Subject", "cloudflare-email"),
				enableSorting: true,
			},
		],
		[],
	);

	const actions = useMemo<Action<LogItem>[]>(
		() => [
			{
				id: "view",
				label: __("View", "cloudflare-email"),
				isPrimary: true,
				modalHeader: __("Email details", "cloudflare-email"),
				RenderModal: ({ items }) => <DetailView id={items[0].id} />,
			},
			{
				id: "resend",
				label: __("Resend", "cloudflare-email"),
				callback: (items) => {
					void (async () => {
						try {
							await api(`/logs/${items[0].id}/resend`, {
								method: "POST",
							});
							setNotice(__("Email resent.", "cloudflare-email"));
						} catch (error: unknown) {
							setNotice(
								error instanceof Error ? error.message : __("Resend failed.", "cloudflare-email"),
							);
						}
						refresh();
					})();
				},
			},
			{
				id: "delete",
				label: __("Delete", "cloudflare-email"),
				isDestructive: true,
				supportsBulk: true,
				modalHeader: __("Delete log entries", "cloudflare-email"),
				RenderModal: ({ items, closeModal }) => (
					<DeleteConfirm items={items} closeModal={closeModal} onDone={refresh} />
				),
			},
		],
		[refresh],
	);

	return (
		<>
			<h1 className="wp-heading-inline" style={{ marginBottom: 16 }}>
				{__("Cloudflare Email log", "cloudflare-email")}
			</h1>
			{notice && (
				<Notice status="info" onRemove={() => setNotice(null)}>
					{notice}
				</Notice>
			)}
			<DataViews<LogItem>
				data={data}
				fields={fields}
				view={view}
				onChangeView={setView}
				actions={actions}
				paginationInfo={paginationInfo}
				isLoading={isLoading}
				defaultLayouts={{ table: {} }}
				getItemId={(item) => String(item.id)}
			/>
		</>
	);
}

domReady(() => {
	const el = document.querySelector("#cloudflare-email-log-root");
	if (!el) {
		return;
	}
	createRoot(el).render(<App />);
});
