import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@kayle-id/ui/components/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@kayle-id/ui/components/alert-dialog";
import { Badge } from "@kayle-id/ui/components/badge";
import { Button } from "@kayle-id/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kayle-id/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kayle-id/ui/components/dialog";
import { Input } from "@kayle-id/ui/components/input";
import { Label } from "@kayle-id/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kayle-id/ui/components/select";
import { Skeleton } from "@kayle-id/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@kayle-id/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FormErrorAlert } from "@/components/form-error-alert";
import { RelativeTime } from "@/components/relative-time";
import { getErrorMessage } from "@/utils/get-error-message";
import {
	type ActiveDomainChallenge,
	addRedirectUri,
	type DnsChallengeStarted,
	listRedirectUris,
	ORGANIZATION_DOMAINS_QUERY_KEY,
	ORGANIZATION_QUERY_KEY,
	ORGANIZATION_REDIRECT_URIS_QUERY_KEY,
	removeRedirectUri,
	removeVerifiedDomain,
	startDnsDomainChallenge,
	type VerifiedDomain,
	verifyDnsDomainChallenge,
} from "./api";
import { OrganizationPageLayout } from "./layout";
import {
	useCurrentMemberRole,
	useOrganizationDomainsQuery,
	useOrganizationQuery,
} from "./use-organization-query";

function DomainsSkeleton() {
	return (
		<div className="space-y-6">
			<Skeleton className="h-44 w-full" />
			<Skeleton className="h-44 w-full" />
		</div>
	);
}

type DomainStatus = "verified" | "pending" | "lost";

interface DomainTableRow {
	key: string;
	apexDomain: string;
	status: DomainStatus;
	verifiedAt: string | null;
	lastCheckedAt: string | null;
	domainId: string | null;
	originalDomain: VerifiedDomain | null;
}

function buildDomainRows(
	domains: VerifiedDomain[],
	challenges: ActiveDomainChallenge[],
): DomainTableRow[] {
	// Verified rows take precedence: an active row hides any pending
	// challenge for the same apex (the challenge is moot once verified). A
	// downgraded row is superseded by a pending challenge — the user is
	// re-verifying, and the in-progress action is the more useful state to
	// surface.
	const byApex = new Map<string, DomainTableRow>();
	for (const d of domains) {
		const status: DomainStatus = d.downgradedAt ? "lost" : "verified";
		byApex.set(d.apexDomain, {
			key: `domain:${d.id}`,
			apexDomain: d.apexDomain,
			status,
			verifiedAt: d.verifiedAt,
			lastCheckedAt: d.lastCheckedAt,
			domainId: d.id,
			originalDomain: d,
		});
	}
	for (const c of challenges) {
		const existing = byApex.get(c.apexDomain);
		if (existing?.status === "verified") {
			continue;
		}
		byApex.set(c.apexDomain, {
			key: `challenge:${c.id}`,
			apexDomain: c.apexDomain,
			status: "pending",
			verifiedAt: null,
			lastCheckedAt: null,
			domainId: existing?.domainId ?? null,
			originalDomain: existing?.originalDomain ?? null,
		});
	}
	return Array.from(byApex.values());
}

function StatusBadge({ status }: { status: DomainStatus }) {
	// Semi-transparent fills follow the same pattern as the webhook status
	// badges (see BADGE_PALETTE in apps/platform/src/app/webhooks/utils.ts):
	// `<color>-500/10` over a light surface in light mode, `<color>-500/20`
	// over a dark surface in dark mode, with `text-<color>-700` flipping to
	// `text-<color>-400` so the foreground stays readable in both themes.
	if (status === "verified") {
		return (
			<Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
				Verified
			</Badge>
		);
	}
	if (status === "pending") {
		return (
			<Badge className="border-amber-500/20 bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
				Pending verification
			</Badge>
		);
	}
	return <Badge variant="destructive">Lost verification</Badge>;
}

function VerifiedDomainsCard({
	canManage,
	challenges,
	domains,
	onAdd,
}: {
	canManage: boolean;
	challenges: ActiveDomainChallenge[];
	domains: VerifiedDomain[];
	onAdd: () => void;
}) {
	const queryClient = useQueryClient();
	const [pendingRemoval, setPendingRemoval] = useState<VerifiedDomain | null>(
		null,
	);

	const removeMutation = useMutation({
		mutationFn: (id: string) => removeVerifiedDomain({ id }),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: ORGANIZATION_DOMAINS_QUERY_KEY,
				}),
				queryClient.invalidateQueries({
					queryKey: ORGANIZATION_REDIRECT_URIS_QUERY_KEY,
				}),
			]);
			toast.success(`Removed ${pendingRemoval?.apexDomain ?? "domain"}.`);
			setPendingRemoval(null);
		},
		onError: (err) => {
			toast.error(getErrorMessage(err, "Failed to remove domain."));
		},
	});

	const rows = buildDomainRows(domains, challenges);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Verified domains</CardTitle>
				<CardDescription>
					You can verify the domains controlled by your organization to confirm
					your organization's identity on Kayle ID.{" "}
					<a
						className="underline underline-offset-2 hover:text-foreground"
						href="https://kayle.id/docs/auth/verified-domains"
						rel="noopener noreferrer"
						target="_blank"
					>
						Learn more
					</a>
					.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="overflow-hidden rounded-md border border-border/70">
					<Table>
						<TableHeader className="bg-muted/40">
							<TableRow>
								<TableHead>Domain</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Verified</TableHead>
								<TableHead>Last re-checked</TableHead>
								<TableHead>
									<span className="sr-only">Actions</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.length === 0 ? (
								<TableRow>
									<TableCell
										className="text-center text-muted-foreground text-sm"
										colSpan={5}
									>
										You have not verified any domains yet.
									</TableCell>
								</TableRow>
							) : (
								rows.map((row) => (
									<TableRow key={row.key}>
										<TableCell className="break-all font-mono font-medium text-sm">
											{row.apexDomain}
										</TableCell>
										<TableCell>
											<StatusBadge status={row.status} />
										</TableCell>
										<TableCell className="text-muted-foreground text-sm">
											{row.verifiedAt ? (
												<RelativeTime iso={row.verifiedAt} />
											) : (
												"—"
											)}
										</TableCell>
										<TableCell className="text-muted-foreground text-sm">
											{row.lastCheckedAt ? (
												<RelativeTime iso={row.lastCheckedAt} />
											) : (
												"—"
											)}
										</TableCell>
										<TableCell className="text-right">
											{canManage && row.originalDomain ? (
												<Button
													disabled={removeMutation.isPending}
													onClick={() => setPendingRemoval(row.originalDomain)}
													type="button"
													variant="outline"
												>
													Remove
												</Button>
											) : null}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</div>
				{canManage ? (
					<div className="flex justify-end">
						<Button onClick={onAdd} type="button">
							Add domain
						</Button>
					</div>
				) : null}
			</CardContent>
			<AlertDialog
				onOpenChange={(open) => {
					if (!open && !removeMutation.isPending) {
						setPendingRemoval(null);
					}
				}}
				open={pendingRemoval !== null}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Remove {pendingRemoval?.apexDomain}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							The verify flow will hide your business name and logo, and any
							session redirect URL on this domain (or its subdomains) will be
							rejected. You can re-verify at any time.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel
							disabled={removeMutation.isPending}
							variant="secondary"
						>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={removeMutation.isPending}
							onClick={() => {
								if (pendingRemoval) {
									removeMutation.mutate(pendingRemoval.id);
								}
							}}
							variant="destructive"
						>
							{removeMutation.isPending ? "Removing..." : "Remove"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Card>
	);
}

type WizardStep =
	| { kind: "input" }
	| {
			kind: "confirm-takeover";
			apexDomain: string;
			challenge: DnsChallengeStarted;
			conflictingOrgName: string;
	  }
	| {
			kind: "dns";
			apexDomain: string;
			challenge: DnsChallengeStarted;
			isTakeover: boolean;
	  };

function AddDomainWizard({
	onClose,
	onCompleted,
	open,
}: {
	onClose: () => void;
	onCompleted: () => void;
	open: boolean;
}) {
	const queryClient = useQueryClient();
	const [step, setStep] = useState<WizardStep>({ kind: "input" });
	const [apexInput, setApexInput] = useState("");
	const [errorMessage, setErrorMessage] = useState("");

	// Reset on the opening edge rather than on close. Resetting before
	// `onClose()` caused a one-frame flash back to the input step during the
	// dialog's close animation; deferring to the next open keeps whatever
	// step the user was on visible throughout the close, then clears it
	// cleanly the next time they open the wizard.
	useEffect(() => {
		if (!open) {
			return;
		}
		setStep({ kind: "input" });
		setApexInput("");
		setErrorMessage("");
	}, [open]);

	function close() {
		onClose();
	}

	const startDnsMutation = useMutation({
		mutationFn: (apexDomain: string) => startDnsDomainChallenge({ apexDomain }),
		onSuccess: (challenge, apexDomain) => {
			if (challenge.conflict) {
				setStep({
					kind: "confirm-takeover",
					apexDomain,
					challenge,
					conflictingOrgName: challenge.conflict.organization_name,
				});
			} else {
				setStep({ kind: "dns", apexDomain, challenge, isTakeover: false });
			}
			setErrorMessage("");
		},
		onError: (err) => {
			setErrorMessage(getErrorMessage(err, "Failed to start DNS challenge."));
		},
	});

	const verifyDnsMutation = useMutation({
		mutationFn: (input: { challengeId: string; isTakeover: boolean }) =>
			verifyDnsDomainChallenge({
				challengeId: input.challengeId,
				acknowledgeTakeover: input.isTakeover,
			}),
		onSuccess: async (result) => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: ORGANIZATION_DOMAINS_QUERY_KEY,
				}),
				queryClient.invalidateQueries({ queryKey: ORGANIZATION_QUERY_KEY }),
			]);
			if (result.takeover_from) {
				toast.success(
					`Domain verified — taken over from ${result.takeover_from.organization_name}.`,
				);
			} else {
				toast.success("Domain verified.");
			}
			onCompleted();
			close();
		},
		onError: (err) => {
			setErrorMessage(
				getErrorMessage(
					err,
					"DNS record not found yet. DNS may take a few minutes to propagate.",
				),
			);
		},
	});

	function handleApexSubmit(event: React.FormEvent) {
		event.preventDefault();
		const trimmed = apexInput.trim().toLowerCase();
		if (!trimmed) {
			setErrorMessage("Enter a domain to verify.");
			return;
		}
		setErrorMessage("");
		startDnsMutation.mutate(trimmed);
	}

	return (
		<Dialog
			onOpenChange={(next) => {
				if (!next) {
					close();
				}
			}}
			open={open}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add a verified domain</DialogTitle>
					<DialogDescription>
						Verify domains controlled by your organization to confirm your
						organization's identity on Kayle ID.{" "}
						<a
							className="underline underline-offset-2 hover:text-foreground"
							href="https://kayle.id/docs/auth/verified-domains"
							rel="noopener noreferrer"
							target="_blank"
						>
							Learn more
						</a>
						.
					</DialogDescription>
				</DialogHeader>
				<FormErrorAlert message={errorMessage} title="Action needed" />
				{step.kind === "input" ? (
					<form className="space-y-4" onSubmit={handleApexSubmit}>
						<div className="space-y-2">
							<Label htmlFor="apex">Domain</Label>
							<Input
								autoFocus
								id="apex"
								name="apex"
								onChange={(event) => setApexInput(event.target.value)}
								placeholder="acme.co"
								value={apexInput}
							/>
							<p className="text-muted-foreground text-xs">
								Use the bare domain (e.g. <code>acme.co</code>, not a subdomain
								like <code>app.acme.co</code>). Verifying a domain unlocks every
								subdomain underneath it.
							</p>
						</div>
						<DialogFooter>
							<Button
								disabled={startDnsMutation.isPending}
								onClick={close}
								type="button"
								variant="outline"
							>
								Cancel
							</Button>
							<Button disabled={startDnsMutation.isPending} type="submit">
								{startDnsMutation.isPending ? "Preparing..." : "Continue"}
							</Button>
						</DialogFooter>
					</form>
				) : null}

				{step.kind === "confirm-takeover" ? (
					<div className="space-y-4">
						<Alert variant="destructive">
							<AlertTitle>This domain is already verified elsewhere</AlertTitle>
							<AlertDescription>
								<p>
									<span className="font-mono">{step.apexDomain}</span> is
									currently verified by{" "}
									<strong>{step.conflictingOrgName}</strong>. If you complete
									the DNS challenge, their verification will be removed and your
									organization will become the active owner.
								</p>
								<p className="mt-3">
									Their owners will receive an email letting them know the
									domain was transferred. Only continue if you operate{" "}
									<span className="font-mono">{step.apexDomain}</span>.
								</p>
							</AlertDescription>
						</Alert>
						<DialogFooter>
							<Button
								onClick={() => setStep({ kind: "input" })}
								type="button"
								variant="outline"
							>
								Back
							</Button>
							<Button
								onClick={() =>
									setStep({
										kind: "dns",
										apexDomain: step.apexDomain,
										challenge: step.challenge,
										isTakeover: true,
									})
								}
								type="button"
								variant="destructive"
							>
								I understand — continue
							</Button>
						</DialogFooter>
					</div>
				) : null}

				{step.kind === "dns" ? (
					<div className="space-y-4">
						{step.isTakeover ? (
							<Alert variant="destructive">
								<AlertTitle>Takeover pending</AlertTitle>
								<AlertDescription>
									Once you complete this challenge,{" "}
									<span className="font-mono">{step.apexDomain}</span> will
									transfer to your organization and the previous owner's
									verification will be removed.
								</AlertDescription>
							</Alert>
						) : null}
						<p className="text-sm">
							Add this TXT record to{" "}
							<span className="font-mono">{step.apexDomain}</span>:
						</p>
						<div className="space-y-2 rounded-md border bg-muted/40 p-3 font-mono text-sm">
							<div className="grid grid-cols-[80px_1fr] gap-2">
								<span className="text-muted-foreground">Name</span>
								<span className="break-all">{step.challenge.record_name}</span>
							</div>
							<div className="grid grid-cols-[80px_1fr] gap-2">
								<span className="text-muted-foreground">Type</span>
								<span>TXT</span>
							</div>
							<div className="grid grid-cols-[80px_1fr] gap-2">
								<span className="text-muted-foreground">Value</span>
								<span className="break-all">{step.challenge.record_value}</span>
							</div>
						</div>
						<p className="text-muted-foreground text-xs">
							DNS often takes a few minutes to propagate. Click "Verify now"
							once the record is live.
						</p>
						<DialogFooter>
							<Button onClick={close} type="button" variant="outline">
								I'll come back later
							</Button>
							<Button
								disabled={verifyDnsMutation.isPending}
								onClick={() =>
									verifyDnsMutation.mutate({
										challengeId: step.challenge.challenge_id,
										isTakeover: step.isTakeover,
									})
								}
								type="button"
								variant={step.isTakeover ? "destructive" : "default"}
							>
								{verifyDnsMutation.isPending
									? "Checking..."
									: step.isTakeover
										? "Verify and take over"
										: "Verify now"}
							</Button>
						</DialogFooter>
					</div>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

// Subdomain labels: each `.`-separated label is lowercase alphanumeric with
// optional internal hyphens (matches DNS label rules). Empty string allowed
// when the user wants to register the apex itself.
const SUBDOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

function isValidSubdomainPrefix(value: string): boolean {
	if (value === "") {
		return true;
	}
	return value.split(".").every((label) => SUBDOMAIN_LABEL_PATTERN.test(label));
}

// Path: empty, or starts with `/`, no query string or fragment. We don't
// constrain the path-internal characters strictly — the safe-url validator
// on the API rejects truly malformed URLs at the schema level.
function validatePathInput(value: string): string | null {
	if (value === "") {
		return null;
	}
	if (!value.startsWith("/")) {
		return "Path must start with a forward slash.";
	}
	if (value.includes("?") || value.includes("#")) {
		return "Path cannot contain query strings or fragments — they aren't valid in a redirect URI pattern.";
	}
	return null;
}

function composeRedirectPattern({
	apex,
	subdomain,
	path,
}: {
	apex: string;
	subdomain: string;
	path: string;
}): string {
	const host = subdomain ? `${subdomain}.${apex}` : apex;
	return `https://${host}${path}`;
}

function AddRedirectUriDialog({
	activeApexes,
	onClose,
	open,
}: {
	activeApexes: string[];
	onClose: () => void;
	open: boolean;
}) {
	const queryClient = useQueryClient();
	const [selectedApex, setSelectedApex] = useState<string | null>(
		activeApexes[0] ?? null,
	);
	const [subdomainInput, setSubdomainInput] = useState("");
	const [pathInput, setPathInput] = useState("");
	const [errorMessage, setErrorMessage] = useState("");

	// Reset on the opening edge so close-animation keeps the user's last
	// state visible, then clears it cleanly the next time they reopen.
	useEffect(() => {
		if (!open) {
			return;
		}
		setSelectedApex(activeApexes[0] ?? null);
		setSubdomainInput("");
		setPathInput("");
		setErrorMessage("");
	}, [open, activeApexes]);

	const addMutation = useMutation({
		mutationFn: (pattern: string) => addRedirectUri({ pattern }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ORGANIZATION_REDIRECT_URIS_QUERY_KEY,
			});
			toast.success("Redirect URI added.");
			onClose();
		},
		onError: (err) => {
			setErrorMessage(getErrorMessage(err, "Failed to add redirect URI."));
		},
	});

	function handleSubmit(event: React.FormEvent) {
		event.preventDefault();
		if (!selectedApex) {
			setErrorMessage("Pick a verified domain.");
			return;
		}
		const subdomain = subdomainInput.trim().toLowerCase();
		const path = pathInput.trim();
		if (subdomain && !isValidSubdomainPrefix(subdomain)) {
			setErrorMessage(
				"Subdomain must be lowercase letters, digits, and hyphens (separated by dots).",
			);
			return;
		}
		const pathError = validatePathInput(path);
		if (pathError) {
			setErrorMessage(pathError);
			return;
		}
		setErrorMessage("");
		addMutation.mutate(
			composeRedirectPattern({ apex: selectedApex, subdomain, path }),
		);
	}

	const previewPattern = selectedApex
		? composeRedirectPattern({
				apex: selectedApex,
				subdomain: subdomainInput.trim().toLowerCase(),
				path: pathInput.trim(),
			})
		: null;

	return (
		<Dialog
			onOpenChange={(next) => {
				if (!next) {
					onClose();
				}
			}}
			open={open}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add an allowed redirect URI</DialogTitle>
					<DialogDescription>
						Patterns are matched as a path-prefix against incoming redirect
						URLs. Query strings and fragments aren't allowed.{" "}
						<a
							className="underline underline-offset-2 hover:text-foreground"
							href="https://kayle.id/docs/auth/verified-domains#allowed-redirect-uris"
							rel="noopener noreferrer"
							target="_blank"
						>
							Read the docs
						</a>
						.
					</DialogDescription>
				</DialogHeader>
				<FormErrorAlert message={errorMessage} title="Couldn't add pattern" />
				<form className="space-y-4" onSubmit={handleSubmit}>
					<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-end">
						<div className="space-y-1">
							<Label htmlFor="redirect-uri-subdomain">Subdomain</Label>
							<Input
								autoComplete="off"
								disabled={addMutation.isPending}
								id="redirect-uri-subdomain"
								name="subdomain"
								onChange={(event) => setSubdomainInput(event.target.value)}
								placeholder="app (optional)"
								value={subdomainInput}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor="redirect-uri-domain">Domain</Label>
							<Select
								disabled={addMutation.isPending}
								name="apex"
								onValueChange={(value) => {
									if (typeof value === "string") {
										setSelectedApex(value);
									}
								}}
								value={selectedApex}
							>
								<SelectTrigger className="w-full" id="redirect-uri-domain">
									<SelectValue placeholder="Pick a verified domain" />
								</SelectTrigger>
								<SelectContent>
									{activeApexes.map((apex) => (
										<SelectItem key={apex} value={apex}>
											{apex}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<div className="space-y-1">
						<Label htmlFor="redirect-uri-path">Path</Label>
						<Input
							autoComplete="off"
							disabled={addMutation.isPending}
							id="redirect-uri-path"
							name="path"
							onChange={(event) => setPathInput(event.target.value)}
							placeholder="/oauth/callback (optional)"
							value={pathInput}
						/>
					</div>
					{previewPattern ? (
						<p className="break-all font-mono text-muted-foreground text-xs">
							Pattern: <span className="text-foreground">{previewPattern}</span>
						</p>
					) : null}
					<DialogFooter>
						<Button
							disabled={addMutation.isPending}
							onClick={onClose}
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={addMutation.isPending || !selectedApex}
							type="submit"
						>
							{addMutation.isPending ? "Adding..." : "Add pattern"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function RedirectUrisCard({
	canManage,
	verifiedDomains,
}: {
	canManage: boolean;
	verifiedDomains: VerifiedDomain[];
}) {
	const queryClient = useQueryClient();
	const [addOpen, setAddOpen] = useState(false);
	const redirectQuery = useQuery({
		queryFn: listRedirectUris,
		queryKey: ORGANIZATION_REDIRECT_URIS_QUERY_KEY,
		staleTime: 30_000,
	});

	const activeApexes = verifiedDomains
		.filter((d) => d.downgradedAt === null)
		.map((d) => d.apexDomain);
	const hasActiveVerifiedDomain = activeApexes.length > 0;

	const removeMutation = useMutation({
		mutationFn: (id: string) => removeRedirectUri({ id }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ORGANIZATION_REDIRECT_URIS_QUERY_KEY,
			});
			toast.success("Redirect URI removed.");
		},
		onError: (err) => {
			toast.error(getErrorMessage(err, "Failed to remove redirect URI."));
		},
	});

	const rows = redirectQuery.data ?? [];

	return (
		<Card>
			<CardHeader>
				<CardTitle>Allowed redirect URIs</CardTitle>
				<CardDescription>
					By default, any subdomain of your verified domain is accepted as a
					session redirect URL. Add explicit entries here to narrow that — only
					URLs whose path-prefix matches one of these patterns will be allowed
					on the matching domain.{" "}
					<a
						className="underline underline-offset-2 hover:text-foreground"
						href="https://kayle.id/docs/auth/verified-domains#allowed-redirect-uris"
						rel="noopener noreferrer"
						target="_blank"
					>
						Learn more
					</a>
					.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{redirectQuery.isLoading ? (
					<Skeleton className="h-24 w-full" />
				) : (
					<div className="overflow-hidden rounded-md border border-border/70">
						<Table>
							<TableHeader className="bg-muted/40">
								<TableRow>
									<TableHead>Pattern</TableHead>
									<TableHead>Domain</TableHead>
									<TableHead>Added</TableHead>
									<TableHead>
										<span className="sr-only">Actions</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.length === 0 ? (
									<TableRow>
										<TableCell
											className="text-center text-muted-foreground text-sm"
											colSpan={4}
										>
											No explicit patterns. Any subdomain + path on a verified
											domain is currently accepted.
										</TableCell>
									</TableRow>
								) : (
									rows.map((row) => (
										<TableRow key={row.id}>
											<TableCell className="break-all font-mono text-sm">
												{row.pattern}
											</TableCell>
											<TableCell className="font-mono text-muted-foreground text-sm">
												{row.apexDomain}
											</TableCell>
											<TableCell className="text-muted-foreground text-sm">
												<RelativeTime iso={row.createdAt} />
											</TableCell>
											<TableCell className="text-right">
												{canManage ? (
													<Button
														disabled={removeMutation.isPending}
														onClick={() => removeMutation.mutate(row.id)}
														type="button"
														variant="outline"
													>
														Remove
													</Button>
												) : null}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				)}
				{canManage && hasActiveVerifiedDomain ? (
					<div className="flex justify-end">
						<Button onClick={() => setAddOpen(true)} type="button">
							Add pattern
						</Button>
					</div>
				) : null}
				{canManage && !hasActiveVerifiedDomain ? (
					<Alert>
						<AlertTitle>Verify a domain first</AlertTitle>
						<AlertDescription>
							Allowed redirect URIs can only be added on a domain you've
							verified. Verify a domain above, then come back here to register
							patterns.
						</AlertDescription>
					</Alert>
				) : null}
			</CardContent>
			<AddRedirectUriDialog
				activeApexes={activeApexes}
				onClose={() => setAddOpen(false)}
				open={addOpen}
			/>
		</Card>
	);
}

export function OrganizationDomainsPage() {
	const orgQuery = useOrganizationQuery();
	const domainsQuery = useOrganizationDomainsQuery();
	const [wizardOpen, setWizardOpen] = useState(false);
	const canManage = useCurrentMemberRole() === "owner";

	const isLoading = orgQuery.isLoading || domainsQuery.isLoading;
	const isError = orgQuery.isError || domainsQuery.isError;
	const errorMessage = getErrorMessage(
		orgQuery.error ?? domainsQuery.error,
		"Something went wrong while loading domains.",
	);

	return (
		<OrganizationPageLayout title="Domains">
			<FormErrorAlert
				message={isError ? errorMessage : ""}
				title="Failed to load domains"
			/>
			{isLoading ? <DomainsSkeleton /> : null}
			{!(isLoading || isError) ? (
				<div className="space-y-6">
					<VerifiedDomainsCard
						canManage={canManage}
						challenges={domainsQuery.data?.challenges ?? []}
						domains={domainsQuery.data?.domains ?? []}
						onAdd={() => setWizardOpen(true)}
					/>
					<RedirectUrisCard
						canManage={canManage}
						verifiedDomains={domainsQuery.data?.domains ?? []}
					/>
					<AddDomainWizard
						onClose={() => setWizardOpen(false)}
						onCompleted={() => {
							/* invalidations live inside the wizard */
						}}
						open={wizardOpen}
					/>
				</div>
			) : null}
		</OrganizationPageLayout>
	);
}
