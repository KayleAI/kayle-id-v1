import { useAuth } from "@kayle-id/auth/client/provider";
import { isOrganizationSlug } from "@kayle-id/auth/organization-slug";
import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@kayleai/ui/alert-dialog";
import { Button } from "@kayleai/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kayleai/ui/card";
import { Input } from "@kayleai/ui/input";
import { Label } from "@kayleai/ui/label";
import { Skeleton } from "@kayleai/ui/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
	cancelOrganizationDeletion,
	confirmOrganizationDeletion,
	type FullOrganization,
	fetchFullOrganization,
	leaveOrganization,
	ORGANIZATION_QUERY_KEY,
	type OrganizationRole,
	requestOrganizationDeletion,
	updateOrganization,
} from "./api";
import { OrganizationPageLayout } from "./layout";
import { StartVerificationDialog } from "./start-verification-dialog";

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
			navigate({ to: "/organizations/select" });
		},
		onError: (err) => {
			toast.error(
				err instanceof Error ? err.message : "Failed to leave organization",
			);
			setOpen(false);
		},
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>Leave organization</CardTitle>
				<CardDescription>
					You will lose access to this organization. An owner can re-invite you.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{isLastOwner ? (
					<Alert>
						<AlertTitle>You're the only owner</AlertTitle>
						<AlertDescription>
							Promote another member to owner on the Members page before
							leaving, or delete the organization instead.
						</AlertDescription>
					</Alert>
				) : null}
				<div className="flex items-center justify-between gap-4">
					<p className="text-muted-foreground text-sm">
						You'll be redirected to your other organizations after leaving.
					</p>
					<Button
						disabled={isLastOwner || leaveMutation.isPending}
						onClick={() => setOpen(true)}
						type="button"
						variant="outline"
					>
						Leave
					</Button>
				</div>
			</CardContent>
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
		</Card>
	);
}

function formatDeadline(iso: string): string {
	try {
		return new Date(iso).toLocaleString();
	} catch {
		return iso;
	}
}

function formatVerifiedAt(iso: string): string {
	try {
		return new Date(iso).toLocaleDateString(undefined, {
			year: "numeric",
			month: "long",
			day: "numeric",
		});
	} catch {
		return iso;
	}
}

function VerificationCard({
	canStartVerification,
	organization,
}: {
	canStartVerification: boolean;
	organization: FullOrganization;
}) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const isVerified = organization.verifiedAt !== null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Verification</CardTitle>
				<CardDescription>
					{isVerified
						? "An owner has completed an identity check and this organization is verified."
						: "Verifying lifts the unverified-org rate limit and removes the warning shown to your end-users."}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="flex items-center justify-between gap-4">
					{isVerified ? (
						<p className="text-muted-foreground text-sm">
							Verified on {formatVerifiedAt(organization.verifiedAt as string)}.
						</p>
					) : (
						<p className="text-muted-foreground text-sm">
							{canStartVerification
								? "You'll be redirected to complete a one-time identity check."
								: "Only an owner can start the verification flow."}
						</p>
					)}
					{!isVerified && canStartVerification ? (
						<Button onClick={() => setDialogOpen(true)} type="button">
							Start verification
						</Button>
					) : null}
				</div>
			</CardContent>
			{!isVerified && canStartVerification ? (
				<StartVerificationDialog
					onOpenChange={setDialogOpen}
					open={dialogOpen}
					organization={organization}
				/>
			) : null}
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

	const deadline = organization.pendingDeletionAt
		? formatDeadline(organization.pendingDeletionAt)
		: null;

	return (
		<Card className="border-destructive/30">
			<CardHeader>
				<CardTitle className="text-destructive">
					Scheduled for deletion
				</CardTitle>
				<CardDescription>
					{deadline
						? `This organization will be permanently deleted at ${deadline}. API keys, webhooks, and verification flows are disabled until the deletion is canceled.`
						: "This organization is scheduled for deletion."}
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
		<Card className="border-destructive/30">
			<CardHeader>
				<CardTitle className="text-destructive">Delete organization</CardTitle>
				<CardDescription>
					Schedule permanent deletion. We'll email an 8-character confirmation
					code; entering it freezes the organization for 48 hours before it's
					permanently deleted.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="flex items-center justify-between gap-4">
					<p className="text-muted-foreground text-sm">
						All members, invitations, API keys, and webhooks will be removed.
					</p>
					<Button
						disabled={isPending}
						onClick={handleStartFlow}
						type="button"
						variant="destructive"
					>
						Delete
					</Button>
				</div>
			</CardContent>
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
		</Card>
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
