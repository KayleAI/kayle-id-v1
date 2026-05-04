import { useAuth } from "@kayle-id/auth/client/provider";
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
	deleteOrganization,
	type FullOrganization,
	fetchFullOrganization,
	leaveOrganization,
	ORGANIZATION_QUERY_KEY,
	type OrganizationRole,
	updateOrganization,
} from "./api";
import { OrganizationPageLayout } from "./layout";

const SLUG_REGEX = /^[a-z0-9-]+$/;

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
		if (!SLUG_REGEX.test(trimmed)) {
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
				<CardDescription>
					The unique identifier used in URLs. Changing this can break links.
				</CardDescription>
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

function DeleteCard({ organization }: { organization: FullOrganization }) {
	const navigate = useNavigate();
	const { refresh } = useAuth();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [confirmation, setConfirmation] = useState("");

	const deleteMutation = useMutation({
		mutationFn: () => deleteOrganization(organization.id),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ORGANIZATION_QUERY_KEY });
			await refresh();
			toast.success("Organization deleted");
			navigate({ to: "/organizations/select" });
		},
		onError: (err) => {
			toast.error(
				err instanceof Error ? err.message : "Failed to delete organization",
			);
			setOpen(false);
		},
	});

	const isConfirmed = confirmation === organization.slug;

	return (
		<Card className="border-destructive/30">
			<CardHeader>
				<CardTitle className="text-destructive">Delete organization</CardTitle>
				<CardDescription>
					Permanently delete this organization and all of its data. This cannot
					be undone.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="flex items-center justify-between gap-4">
					<p className="text-muted-foreground text-sm">
						All members, invitations, and API keys will be removed.
					</p>
					<Button
						disabled={deleteMutation.isPending}
						onClick={() => {
							setConfirmation("");
							setOpen(true);
						}}
						type="button"
						variant="destructive"
					>
						Delete
					</Button>
				</div>
			</CardContent>
			<AlertDialog
				onOpenChange={(next) => {
					setOpen(next);
					if (!next) {
						setConfirmation("");
					}
				}}
				open={open}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Delete{" "}
							<span className="font-semibold text-foreground">
								{organization.name}
							</span>
							?
						</AlertDialogTitle>
						<AlertDialogDescription>
							Type the slug{" "}
							<span className="font-mono text-foreground">
								{organization.slug}
							</span>{" "}
							to confirm. This permanently deletes the organization and cannot
							be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="space-y-2 pb-2">
						<Label htmlFor="confirm-slug">Confirmation</Label>
						<Input
							autoComplete="off"
							id="confirm-slug"
							name="confirm-slug"
							onChange={(event) => setConfirmation(event.target.value)}
							placeholder={organization.slug}
							value={confirmation}
						/>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel
							disabled={deleteMutation.isPending}
							variant="secondary"
						>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={!isConfirmed || deleteMutation.isPending}
							onClick={() => deleteMutation.mutate()}
							variant="destructive"
						>
							{deleteMutation.isPending ? "Deleting..." : "Delete forever"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Card>
	);
}

function SettingsBody({
	canDelete,
	canEditSlug,
	isLastOwner,
	organization,
}: {
	canDelete: boolean;
	canEditSlug: boolean;
	isLastOwner: boolean;
	organization: FullOrganization;
}) {
	return (
		<div className="space-y-6">
			{canEditSlug ? <SlugCard organization={organization} /> : null}
			<LeaveCard isLastOwner={isLastOwner} organization={organization} />
			{canDelete ? <DeleteCard organization={organization} /> : null}
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
	const canDelete = currentRole === "owner";
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
					canDelete={canDelete}
					canEditSlug={canEditSlug}
					isLastOwner={isLastOwner}
					organization={data}
				/>
			) : null}
		</OrganizationPageLayout>
	);
}
