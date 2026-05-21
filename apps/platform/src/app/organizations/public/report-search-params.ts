const SESSION_ID_MAX_LENGTH = 128;

export interface ReportRouteSearch {
	session_id?: string;
}

export function parseReportRouteSearch(
	search: Record<string, unknown>,
): ReportRouteSearch {
	const sessionId = search.session_id;

	return typeof sessionId === "string" &&
		sessionId.length > 0 &&
		sessionId.length <= SESSION_ID_MAX_LENGTH
		? { session_id: sessionId }
		: {};
}
