/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@kayleai/ui/dialog", async () => {
	const React = await import("react");
	const DialogContext = React.createContext<{
		open: boolean;
		setOpen: (open: boolean) => void;
	}>({
		open: false,
		setOpen: () => {
			// no-op default; replaced by Dialog provider
		},
	});

	function Dialog({ children }: { children: React.ReactNode }) {
		const [open, setOpen] = React.useState(false);
		return (
			<DialogContext.Provider value={{ open, setOpen }}>
				{children}
			</DialogContext.Provider>
		);
	}

	function DialogTrigger({
		children,
		className,
	}: {
		children: React.ReactNode;
		className?: string;
		render?: React.ReactElement;
	}) {
		const { setOpen } = React.useContext(DialogContext);
		return (
			<button className={className} onClick={() => setOpen(true)} type="button">
				{children}
			</button>
		);
	}

	function DialogContent({ children }: { children: React.ReactNode }) {
		const { open } = React.useContext(DialogContext);
		return open ? <div role="dialog">{children}</div> : null;
	}

	function PassThrough({ children }: { children?: React.ReactNode }) {
		return <>{children}</>;
	}

	return {
		Dialog,
		DialogTrigger,
		DialogContent,
		DialogHeader: PassThrough,
		DialogTitle: ({ children }: { children?: React.ReactNode }) => (
			<h2>{children}</h2>
		),
		DialogDescription: PassThrough,
		DialogFooter: () => null,
	};
});

import { type Organization, OrganizationName } from "./organization-name";

function createOrganization(
	overrides: Partial<Organization> = {},
): Organization {
	return {
		name: "Acme Corp",
		ownerIdCheckCompleted: true,
		verifiedApexDomains: ["acme.example"],
		logo: null,
		businessName: null,
		businessJurisdiction: null,
		businessRegistrationNumber: null,
		privacyPolicyUrl: null,
		termsOfServiceUrl: null,
		website: null,
		description: null,
		...overrides,
	};
}

afterEach(() => {
	cleanup();
});

describe("OrganizationName", () => {
	test("renders the organization name as a button trigger", () => {
		render(<OrganizationName organization={createOrganization()} />);

		expect(screen.getByRole("button", { name: "Acme Corp" })).not.toBeNull();
	});

	test("opens a dialog with organization details when clicked", () => {
		render(
			<OrganizationName
				organization={createOrganization({
					businessName: "Acme Corporation Ltd",
					businessJurisdiction: "United Kingdom",
					businessRegistrationNumber: "12345678",
				})}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Acme Corp" }));

		expect(screen.getByText("Acme Corporation Ltd")).not.toBeNull();
		expect(screen.getByText("United Kingdom")).not.toBeNull();
		expect(screen.getByText("12345678")).not.toBeNull();
	});

	test("shows the verified callout when the organization is verified", () => {
		render(
			<OrganizationName
				organization={createOrganization({ ownerIdCheckCompleted: true })}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Acme Corp" }));

		expect(screen.getByText("Owner ID check completed")).not.toBeNull();
		expect(screen.queryByText("Owner ID check not completed")).toBeNull();
	});

	test("shows the unverified callout when the organization is not verified", () => {
		render(
			<OrganizationName
				organization={createOrganization({ ownerIdCheckCompleted: false })}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Acme Corp" }));

		expect(screen.getByText("Owner ID check not completed")).not.toBeNull();
		expect(screen.queryByText("Owner ID check completed")).toBeNull();
	});

	test("softens unverified callout to amber for age-only sessions", () => {
		const { container: redContainer } = render(
			<OrganizationName
				organization={createOrganization({ ownerIdCheckCompleted: false })}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Acme Corp" }));
		expect(redContainer.querySelector(".bg-red-50\\/60")).not.toBeNull();
		expect(redContainer.querySelector(".bg-amber-50\\/60")).toBeNull();

		cleanup();

		const { container: amberContainer } = render(
			<OrganizationName
				isAgeOnly
				organization={createOrganization({ ownerIdCheckCompleted: false })}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Acme Corp" }));
		expect(amberContainer.querySelector(".bg-amber-50\\/60")).not.toBeNull();
		expect(amberContainer.querySelector(".bg-red-50\\/60")).toBeNull();
	});

	test("renders privacy policy and terms of service links when provided", () => {
		render(
			<OrganizationName
				organization={createOrganization({
					privacyPolicyUrl: "https://acme.example/privacy",
					termsOfServiceUrl: "https://acme.example/terms",
				})}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Acme Corp" }));

		const privacyLink = screen.getByRole("link", { name: "Privacy policy" });
		const termsLink = screen.getByRole("link", { name: "Terms of service" });
		expect(privacyLink.getAttribute("href")).toBe(
			"https://acme.example/privacy",
		);
		expect(privacyLink.getAttribute("target")).toBe("_blank");
		expect(privacyLink.getAttribute("rel")).toBe("noopener noreferrer");
		expect(termsLink.getAttribute("href")).toBe("https://acme.example/terms");
	});

	test("renders website link and description when provided", () => {
		render(
			<OrganizationName
				organization={createOrganization({
					website: "https://acme.example",
					description: "Identity checks for Acme retailers.",
				})}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Acme Corp" }));

		const websiteLink = screen.getByRole("link", { name: "Website" });
		expect(websiteLink.getAttribute("href")).toBe("https://acme.example");
		expect(
			screen.getByText("Identity checks for Acme retailers."),
		).not.toBeNull();
	});

	test("omits a missing legal link without rendering a placeholder", () => {
		render(
			<OrganizationName
				organization={createOrganization({
					privacyPolicyUrl: "https://acme.example/privacy",
				})}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Acme Corp" }));

		expect(screen.getByRole("link", { name: "Privacy policy" })).not.toBeNull();
		expect(screen.queryByRole("link", { name: "Terms of service" })).toBeNull();
	});

	test("omits the legal links section when neither URL is provided", () => {
		render(<OrganizationName organization={createOrganization()} />);

		fireEvent.click(screen.getByRole("button", { name: "Acme Corp" }));

		expect(screen.queryByRole("link", { name: "Privacy policy" })).toBeNull();
		expect(screen.queryByRole("link", { name: "Terms of service" })).toBeNull();
	});

	test("falls back to a generic placeholder when the name is missing", () => {
		render(
			<OrganizationName organization={createOrganization({ name: null })} />,
		);

		expect(
			screen.getByRole("button", { name: "Platform Name" }),
		).not.toBeNull();
	});

	test("omits the details list when no business fields are populated", () => {
		render(<OrganizationName organization={createOrganization()} />);

		fireEvent.click(screen.getByRole("button", { name: "Acme Corp" }));

		expect(screen.queryByText("Legal name")).toBeNull();
		expect(screen.queryByText("Registered in")).toBeNull();
		expect(screen.queryByText("Registration number")).toBeNull();
	});

	test("hides business fields when no verified domain is present", () => {
		render(
			<OrganizationName
				organization={createOrganization({
					verifiedApexDomains: [],
					businessName: "Acme Corporation Ltd",
					businessJurisdiction: "United Kingdom",
					businessRegistrationNumber: "12345678",
				})}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Acme Corp" }));

		expect(screen.queryByText("Legal name")).toBeNull();
		expect(screen.queryByText("Acme Corporation Ltd")).toBeNull();
		expect(screen.queryByText("United Kingdom")).toBeNull();
		expect(screen.queryByText("12345678")).toBeNull();
	});

	test("renders the verified-domain badge only when every link points to a verified apex", () => {
		render(
			<OrganizationName
				organization={createOrganization({
					verifiedApexDomains: ["acme.co"],
					website: "https://acme.co",
					privacyPolicyUrl: "https://privacy.acme.co/policy",
					termsOfServiceUrl: "https://acme.co/terms",
				})}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Acme Corp" }));

		expect(screen.getByText("Verified domain")).not.toBeNull();
		expect(screen.getByText("acme.co")).not.toBeNull();
	});

	test("hides the badge when one of the policy links is on an unverified host", () => {
		render(
			<OrganizationName
				organization={createOrganization({
					verifiedApexDomains: ["acme.co"],
					website: "https://acme.co",
					privacyPolicyUrl: "https://acme-evil.example/policy",
					termsOfServiceUrl: "https://acme.co/terms",
				})}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Acme Corp" }));

		expect(screen.queryByText("Verified domain")).toBeNull();
	});

	test("hides the badge when no policy or website links are present", () => {
		render(
			<OrganizationName
				organization={createOrganization({
					verifiedApexDomains: ["acme.co"],
				})}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Acme Corp" }));

		expect(screen.queryByText("Verified domain")).toBeNull();
	});

	test("hides the badge when the org has no verified domains", () => {
		render(
			<OrganizationName
				organization={createOrganization({
					verifiedApexDomains: [],
					website: "https://acme.co",
				})}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Acme Corp" }));

		expect(screen.queryByText("Verified domain")).toBeNull();
	});

	test("lists every matched apex when policy links span multiple verified domains", () => {
		render(
			<OrganizationName
				organization={createOrganization({
					verifiedApexDomains: ["acme.co", "acme-corp.com"],
					website: "https://acme.co",
					privacyPolicyUrl: "https://acme-corp.com/privacy",
					termsOfServiceUrl: null,
				})}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Acme Corp" }));

		expect(screen.getByText("Verified domains")).not.toBeNull();
		expect(screen.getByText("acme-corp.com, acme.co")).not.toBeNull();
	});

	test("hides the user-supplied logo when no verified domain", () => {
		const { container } = render(
			<OrganizationName
				organization={createOrganization({
					verifiedApexDomains: [],
					logo: "https://cdn.example/spoofed.png",
				})}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Acme Corp" }));

		expect(container.querySelector('img[src*="spoofed.png"]')).toBeNull();
	});

	test("renders the user-supplied logo when a verified domain is present", () => {
		const { container } = render(
			<OrganizationName
				organization={createOrganization({
					verifiedApexDomains: ["acme.co"],
					logo: "https://cdn.example/acme.png",
				})}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Acme Corp" }));

		expect(container.querySelector('img[src*="acme.png"]')).not.toBeNull();
	});
});
