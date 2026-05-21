export class SessionTransitionSkippedError extends Error {
	constructor() {
		super("verification_session_not_active");
		this.name = "SessionTransitionSkippedError";
	}
}
