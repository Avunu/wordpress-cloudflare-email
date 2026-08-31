import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "@wordpress/element";
import { Notice } from "@wordpress/components";
import { DataViews } from "@wordpress/dataviews";
import type { Action, Field, View } from "@wordpress/dataviews";
import { __ } from "@wordpress/i18n";
import * as stylex from "@stylexjs/stylex";
import { space } from "./tokens.stylex";
import { api } from "./api";
import { formatDate } from "./format";
import type { LogItem, LogListResponse } from "./types";
import { DeleteConfirm } from "./components/DeleteConfirm";
import { DetailView } from "./components/DetailView";
import { StatusBadge } from "./components/StatusBadge";

const styles = stylex.create({
	// The margin lives here rather than on the <h1>, because core's `.wrap h1 { margin: 0 }` is
	// (0,1,1) and would outrank an atomic class on the heading itself.
	header: { marginBlockEnd: space.lg },
});

const STATUS_ELEMENTS = [
	{ value: "sent", label: __("Sent", "cloudflare-email") },
	{ value: "failed", label: __("Failed", "cloudflare-email") },
];

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

/** The log screen: a DataViews table over the REST routes, with view/resend/delete actions. */
export function App(): ReactNode {
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
			<div {...stylex.props(styles.header)}>
				<h1 className="wp-heading-inline">{__("Cloudflare Email log", "cloudflare-email")}</h1>
			</div>
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
