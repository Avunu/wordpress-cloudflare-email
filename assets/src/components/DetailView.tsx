import type { ReactNode } from "react";
import { useEffect, useState } from "@wordpress/element";
import { Spinner } from "@wordpress/components";
import { api } from "../api";
import type { LogDetail } from "../types";
import { Detail } from "./Detail";

/**
 * Loads one log entry and renders it. Rendered inside the Modal that DataViews provides for a
 * RenderModal action, which is a portal outside the app's mount point.
 */
export function DetailView({ id }: { id: number }): ReactNode {
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
