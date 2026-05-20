import { useAuth } from "@kayle-id/auth/client/provider";
import { isOrganizationSlug } from "@kayle-id/auth/organization-slug";
import type { OrganizationRole } from "@kayle-id/auth/types";
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
import { Button } from "@kayle-id/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kayle-id/ui/components/card";
import { Input } from "@kayle-id/ui/components/input";
import { Label } from "@kayle-id/ui/components/label";
import { Skeleton } from "@kayle-id/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@kayle-id/ui/components/tooltip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { RelativeTime } from "@/components/relative-time";
import {
	cancelOrganizationDeletion,
	confirmOrganizationDeletion,
	type FullOrganization,
	fetchFullOrganization,
	leaveOrganization,
	ORGANIZATION_QUERY_KEY,
	requestOrganizationDeletion,
	updateOrganization,
} from "./api";
import { OrganizationPageLayout } from "./layout";

function SettingsSkeleton() {
	return (
		<div className="space-y-6">
			<Skeleton className="h-44 w-full" />
			<Skeleton className="h-32 w-full" />
		</div>
	);
}

function SlugCard({ organization }: { organization: FullOrganization }) {
	const queryClient = useQueryClient();
	const { refresh } = useAuth();
	const [slug, setSlug] = useState(organization.slug);
	const [errorMessage, setErrorMessage] = useState("");

	const slugMutation = useMutation({
		mutationFn: () =>
			updateOrganization(organization.id, { slug: slug.trim() }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ORGANIZATION_QUERY_KEY });
			await refresh();
			toast.success("Slug updated");
			setErrorMessage("");
		},
		onError: (err) => {
			setErrorMessage(
				err instanceof Error ? err.message : "Failed to update slug",
			);
		},
	});

	const handleSave = () => {
		const trimmed = slug.trim();
		if (!trimmed) {
			setErrorMessage("Slug is required");
			return;
		}
		if (!isOrganizationSlug(trimmed)) {
			setErrorMessage(
				"Slug must contain only lowercase letters, numbers, and hyphens",
			);
			return;
		}
		setErrorMessage("");
		slugMutation.mutate();
	};

	const isDirty = slug.trim() !== organization.slug;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Slug</CardTitle>
				<CardDescription>The unique identifier used in URLs.</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{errorMessage ? (
					<Alert variant="destructive">
						<AlertTitle>Error</AlertTitle>
						<AlertDescription>{errorMessage}</AlertDescription>
					</Alert>
				) : null}
				<div className="space-y-2">
					<Label htmlFor="slug">Slug</Label>
					<Input
						disabled={slugMutation.isPending}
						id="slug"
						name="slug"
						onChange={(event) => {
							setSlug(event.target.value);
							setErrorMessage("");
						}}
						placeholder="acme-inc"
						value={slug}
					/>
					<p className="text-muted-foreground text-xs">
						Lowercase letters, numbers, and hyphens only.
					</p>
				</div>
				<div className="flex justify-end">
					<Button
						disabled={!isDirty || slugMutation.isPending}
						onClick={handleSave}
						type="button"
					>
						{slugMutation.isPending ? "Saving..." : "Save changes"}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

function LeaveCard({
	isLastOwner,
	organization,
}: {
	isLastOwner: boolean;
	organization: FullOrganization;
}) {
	const navigate = useNavigate();
	const { refresh } = useAuth();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);

	const leaveMutation = useMutation({
		mutationFn: () => leaveOrganization(organization.id),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ORGANIZATION_QUERY_KEY });
			await refresh();
			toast.success("You have left the organization");
			navigate({ to: "/select-organization" });
		},
		onError: (err) => {
			toast.error(
				err instanceof Error ? err.message : "Failed to leave organization",
			);
			setOpen(false);
		},
	});

	const leaveButton = (
		<Button
			disabled={isLastOwner || leaveMutation.isPending}
			onClick={() => setOpen(true)}
			type="button"
			variant="outline"
		>
			Leave organization
		</Button>
	);

	return (
		<>
			<Card>
				<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="space-y-1.5">
						<CardTitle>Leave organization</CardTitle>
						<CardDescription>
							You will lose access to this organization.
						</CardDescription>
					</div>
					{isLastOwner ? (
						<Tooltip>
							{/* `<span>` wrapper is required because disabled buttons swallow
							 * pointer events, so the trigger never fires the hover state.
							 * tabIndex=0 keeps the tooltip reachable by keyboard. */}
							<TooltipTrigger
								render={
									<span
										className="inline-flex"
										// biome-ignore lint/a11y/noNoninteractiveTabindex: we want to keep the tooltip reachable by keyboard
										tabIndex={0}
									>
										{leaveButton}
									</span>
								}
							/>
							<TooltipContent
								className="max-w-xs border border-border bg-popover text-left text-popover-foreground shadow-md ring-1 ring-foreground/5 [&>.rotate-45]:border [&>.rotate-45]:border-border [&>.rotate-45]:bg-popover [&>.rotate-45]:fill-popover"
								side="left"
							>
								<p className="font-medium text-foreground text-sm">
									You're the only owner
								</p>
								<p className="mt-1 text-muted-foreground text-xs">
									Promote another member to owner on the Members page before
									leaving, or delete the organization instead.
								</p>
							</TooltipContent>
						</Tooltip>
					) : (
						leaveButton
					)}
				</CardHeader>
			</Card>

			<AlertDialog onOpenChange={setOpen} open={open}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Leave this organization?</AlertDialogTitle>
						<AlertDialogDescription>
							You will lose access to{" "}
							<span className="font-semibold text-foreground">
								{organization.name}
							</span>{" "}
							immediately.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel
							disabled={leaveMutation.isPending}
							variant="secondary"
						>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={leaveMutation.isPending}
							onClick={() => leaveMutation.mutate()}
						>
							{leaveMutation.isPending ? "Leaving..." : "Leave"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function VerificationCard({
	canStartVerification,
	organization,
}: {
	canStartVerification: boolean;
	organization: FullOrganization;
}) {
	const isVerified = organization.verifiedAt !== null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Verification</CardTitle>
				{!isVerified ? (
					<CardDescription>
						The owner identity check is part of organization onboarding.
					</CardDescription>
				) : null}
			</CardHeader>
			<CardContent>
				{isVerified ? (
					<div className="flex items-start gap-3 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
						<ShieldCheckIcon aria-hidden className="mt-0.5 size-5 shrink-0" />
						<div className="text-sm">
							<p className="font-medium">Verified organization</p>
							<p className="text-emerald-700/80 dark:text-emerald-400/80">
								An owner completed an identity check{" "}
								<RelativeTime iso={organization.verifiedAt as string} />.
							</p>
						</div>
					</div>
				) : (
					<div className="flex items-center justify-between gap-4">
						<p className="text-muted-foreground text-sm">
							{canStartVerification
								? "Finish onboarding to complete the owner identity check."
								: "Only an owner can complete the owner identity check."}
						</p>
						{canStartVerification ? (
							<Link to="/onboarding">
								<Button type="button">Continue onboarding</Button>
							</Link>
						) : null}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function PendingDeletionCard({
	organization,
}: {
	organization: FullOrganization;
}) {
	const { refresh } = useAuth();
	const queryClient = useQueryClient();

	const cancelMutation = useMutation({
		mutationFn: () => cancelOrganizationDeletion(organization.id),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ORGANIZATION_QUERY_KEY });
			await refresh();
			toast.success("Deletion canceled");
		},
		onError: (err) => {
			toast.error(
				err instanceof Error ? err.message : "Failed to cancel deletion",
			);
		},
	});

	const deadline = organization.pendingDeletionAt;

	return (
		<Card className="border-destructive/30">
			<CardHeader>
				<CardTitle className="text-destructive">
					Scheduled for deletion
				</CardTitle>
				<CardDescription>
					{deadline ? (
						<>
							This organization will be permanently deleted{" "}
							<RelativeTime iso={deadline} />. API keys, webhooks, and
							verification flows are disabled until the deletion is canceled.
						</>
					) : (
						"This organization is scheduled for deletion."
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="flex items-center justify-between gap-4">
					<p className="text-muted-foreground text-sm">
						Cancel before the deadline to keep the organization.
					</p>
					<Button
						disabled={cancelMutation.isPending}
						onClick={() => cancelMutation.mutate()}
						type="button"
						variant="destructive"
					>
						{cancelMutation.isPending ? "Canceling..." : "Cancel deletion"}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

function DeleteCard({ organization }: { organization: FullOrganization }) {
	const queryClient = useQueryClient();
	const { refresh } = useAuth();
	const [open, setOpen] = useState(false);
	const [code, setCode] = useState("");

	const requestMutation = useMutation({
		mutationFn: () => requestOrganizationDeletion(organization.id),
		onSuccess: () => {
			toast.success("Confirmation code sent. Check your email.");
		},
		onError: (err) => {
			toast.error(
				err instanceof Error ? err.message : "Failed to send confirmation code",
			);
			setOpen(false);
		},
	});

	const confirmMutation = useMutation({
		mutationFn: () =>
			confirmOrganizationDeletion(organization.id, code.trim().toUpperCase()),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ORGANIZATION_QUERY_KEY });
			await refresh();
			toast.success("Deletion scheduled. You have 48 hours to cancel.");
			setOpen(false);
			setCode("");
		},
		onError: (err) => {
			toast.error(
				err instanceof Error ? err.message : "Failed to confirm deletion",
			);
		},
	});

	const isCodeValid = code.trim().length === 8;
	const isPending = requestMutation.isPending || confirmMutation.isPending;

	const handleOpenChange = (next: boolean) => {
		if (isPending) {
			return;
		}
		setOpen(next);
		if (!next) {
			setCode("");
		}
	};

	const handleStartFlow = () => {
		setCode("");
		setOpen(true);
		requestMutation.mutate();
	};

	return (
		<>
			<Card>
				<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="space-y-1.5">
						<CardTitle className="text-destructive">
							Delete organization
						</CardTitle>
						<CardDescription>
							Once deleted, this organization and everything inside it —
							members, invitations, API keys, and webhooks — cannot be
							recovered.
						</CardDescription>
					</div>
					<Button
						disabled={isPending}
						onClick={handleStartFlow}
						type="button"
						variant="destructive"
					>
						Delete organization
					</Button>
				</CardHeader>
			</Card>

			<AlertDialog onOpenChange={handleOpenChange} open={open}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Confirm deletion of{" "}
							<span className="font-semibold text-foreground">
								{organization.name}
							</span>
						</AlertDialogTitle>
						<AlertDialogDescription>
							We sent an 8-character confirmation code to your email. Enter it
							below to schedule deletion.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="space-y-2 pb-2">
						<Label htmlFor="confirm-code">Confirmation code</Label>
						<Input
							autoComplete="off"
							autoFocus
							className="font-mono uppercase tracking-widest"
							id="confirm-code"
							maxLength={8}
							name="confirm-code"
							onChange={(event) => setCode(event.target.value.toUpperCase())}
							value={code}
						/>
						<button
							className="text-muted-foreground text-xs underline-offset-2 hover:underline disabled:opacity-50"
							disabled={isPending}
							onClick={() => requestMutation.mutate()}
							type="button"
						>
							{requestMutation.isPending ? "Sending..." : "Resend code"}
						</button>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel
							disabled={confirmMutation.isPending}
							variant="secondary"
						>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={!isCodeValid || isPending}
							onClick={() => confirmMutation.mutate()}
							variant="destructive"
						>
							{confirmMutation.isPending
								? "Confirming..."
								: "Schedule deletion"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function SettingsBody({
	canCancelDeletion,
	canEditSlug,
	canScheduleDeletion,
	canStartVerification,
	isLastOwner,
	organization,
}: {
	canCancelDeletion: boolean;
	canEditSlug: boolean;
	canScheduleDeletion: boolean;
	canStartVerification: boolean;
	isLastOwner: boolean;
	organization: FullOrganization;
}) {
	const isPendingDeletion = organization.pendingDeletionAt !== null;
	return (
		<div className="space-y-6">
			{canEditSlug && !isPendingDeletion ? (
				<SlugCard organization={organization} />
			) : null}
			{isPendingDeletion ? null : (
				<VerificationCard
					canStartVerification={canStartVerification}
					organization={organization}
				/>
			)}
			{isPendingDeletion ? null : (
				<LeaveCard isLastOwner={isLastOwner} organization={organization} />
			)}
			{isPendingDeletion && canCancelDeletion ? (
				<PendingDeletionCard organization={organization} />
			) : null}
			{!isPendingDeletion && canScheduleDeletion ? (
				<DeleteCard organization={organization} />
			) : null}
		</div>
	);
}

function hasOwnerRole(role: string | undefined): boolean {
	return role?.split(",").includes("owner") ?? false;
}

export function OrganizationSettingsPage() {
	const { user } = useAuth();
	const { data, isLoading, isError, error } = useQuery({
		queryFn: fetchFullOrganization,
		queryKey: ORGANIZATION_QUERY_KEY,
		staleTime: 30_000,
	});

	const currentRole = data?.members.find((member) => member.userId === user?.id)
		?.role as OrganizationRole | undefined;
	const canEditSlug = currentRole === "owner" || currentRole === "admin";
	const canScheduleDeletion = currentRole === "owner";
	const canCancelDeletion = currentRole === "owner" || currentRole === "admin";
	const canStartVerification = hasOwnerRole(currentRole);
	const isCurrentUserOwner = hasOwnerRole(currentRole);
	const ownerCount =
		data?.members.filter((member) => hasOwnerRole(member.role)).length ?? 0;
	const isLastOwner = isCurrentUserOwner && ownerCount <= 1;

	return (
		<OrganizationPageLayout
			description="Internal organization settings."
			title="Settings"
		>
			{isError ? (
				<Alert variant="destructive">
					<AlertTitle>Failed to load settings</AlertTitle>
					<AlertDescription>
						{error instanceof Error
							? error.message
							: "Something went wrong while loading settings."}
					</AlertDescription>
				</Alert>
			) : null}
			{isLoading ? <SettingsSkeleton /> : null}
			{data && !isError ? (
				<SettingsBody
					canCancelDeletion={canCancelDeletion}
					canEditSlug={canEditSlug}
					canScheduleDeletion={canScheduleDeletion}
					canStartVerification={canStartVerification}
					isLastOwner={isLastOwner}
					organization={data}
				/>
			) : null}
		</OrganizationPageLayout>
	);
}
