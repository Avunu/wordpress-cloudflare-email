/** Shapes returned by the cloudflare-email/v1 REST routes. */

export type Status = "sent" | "partial" | "failed";

export interface LogItem {
	id: number;
	created_at: string;
	status: Status;
	from_email: string;
	to: string[];
	subject: string;
	resent_count: number;
}

export interface LogHeaders {
	cc?: string[];
	bcc?: string[];
	reply_to?: string | null;
	custom?: Record<string, string>;
}

export interface LogAttachment {
	name: string;
	path: string;
	type: string;
	disposition: string;
}

export interface LogDetail extends LogItem {
	body_html: string | null;
	body_text: string | null;
	headers: LogHeaders;
	attachments: LogAttachment[];
	cf_result: unknown;
	/** Suppressed recipients that were dropped so the message could go to everyone else. */
	suppressed: string[];
	error: string | null;
}

export interface LogListResponse {
	logs: LogItem[];
	total: number;
	totalPages: number;
}
