/** Display formatting shared across the log views. */

/** Renders a stored timestamp in the viewer's locale, passing through anything unparseable. */
export function formatDate(value: string): string {
	if (!value) {
		return "";
	}
	// Stored as site-local 'YYYY-MM-DD HH:MM:SS'.
	const date = new Date(value.replace(" ", "T"));
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
