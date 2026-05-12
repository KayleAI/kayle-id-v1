/**
 * @vitest-environment jsdom
 */
import { ERROR_MESSAGES } from "@kayle-id/translations/error-messages";
import { DEFAULT_LOCALE } from "@kayle-id/translations/i18n";
import { VERIFY_HANDOFF_COPY } from "@kayle-id/translations/verify-handoff-copy";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import {
	I18nProvider,
	useErrorMessages,
	useLocale,
	useVerifyHandoffCopy,
} from "./provider";

afterEach(() => {
	cleanup();
});

function LocaleProbe() {
	const locale = useLocale();
	return <span data-testid="locale">{locale}</span>;
}

function HandoffCopyProbe() {
	const copy = useVerifyHandoffCopy();
	return <span data-testid="copy-title">{copy.cancelDialog.title}</span>;
}

function ErrorMessagesProbe() {
	const errorMessages = useErrorMessages();
	return <span data-testid="error-title">{errorMessages.UNKNOWN.title}</span>;
}

describe("I18nProvider", () => {
	test("publishes the negotiated locale through useLocale", () => {
		render(
			<I18nProvider initialLocale="en">
				<LocaleProbe />
			</I18nProvider>,
		);

		expect(screen.getByTestId("locale").textContent).toBe("en");
	});

	test("exposes the matching verify-handoff dictionary", () => {
		render(
			<I18nProvider initialLocale="en">
				<HandoffCopyProbe />
			</I18nProvider>,
		);

		expect(screen.getByTestId("copy-title").textContent).toBe(
			VERIFY_HANDOFF_COPY.cancelDialog.title,
		);
	});

	test("exposes the matching error-messages dictionary", () => {
		render(
			<I18nProvider initialLocale="en">
				<ErrorMessagesProbe />
			</I18nProvider>,
		);

		expect(screen.getByTestId("error-title").textContent).toBe(
			ERROR_MESSAGES.UNKNOWN.title,
		);
	});
});

describe("i18n hooks without a provider", () => {
	test("useLocale falls back to DEFAULT_LOCALE", () => {
		render(<LocaleProbe />);

		expect(screen.getByTestId("locale").textContent).toBe(DEFAULT_LOCALE);
	});

	test("useVerifyHandoffCopy falls back to the English dictionary", () => {
		render(<HandoffCopyProbe />);

		expect(screen.getByTestId("copy-title").textContent).toBe(
			VERIFY_HANDOFF_COPY.cancelDialog.title,
		);
	});

	test("useErrorMessages falls back to the English dictionary", () => {
		render(<ErrorMessagesProbe />);

		expect(screen.getByTestId("error-title").textContent).toBe(
			ERROR_MESSAGES.UNKNOWN.title,
		);
	});
});
