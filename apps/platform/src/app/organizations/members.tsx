import { useAuth } from "@kayle-id/auth/client/provider";
import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@kayleai/ui/avatar";
import { Badge } from "@kayleai/ui/badge";
import { Button } from "@kayleai/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@kayleai/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@kayleai/ui/dropdown-menu";
import { Input } from "@kayleai/ui/input";
import { Label } from "@kayleai/ui/label";
import { Skeleton } from "@kayleai/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@kayleai/ui/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	EllipsisVerticalIcon,
	RotateCcwIcon,
	ShieldIcon,
	UserMinusIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { formatDate } from "@/utils/format-date";
import {
	cancelOrganizationInvitation,
	type FullOrganization,
	fetchFullOrganization,
	inviteOrganizationMember,
	ORGANIZATION_QUERY_KEY,
	type OrganizationInvitation,
	type OrganizationMember,
	type OrganizationRole,
	reinstateOrganizationMember,
	suspendOrganizationMember,
	updateOrganizationMemberRole,
} from "./api";
import { OrganizationPageLayout } from "./layout";

const ROLE_OPTIONS: readonly OrganizationRole[] = [
	"owner",
	"admin",
	"member",
] as const;

function MembersSkeleton() {
	return (
		<div className="space-y-3">
			{["a", "b", "c"].map((key) => (
				<Skeleton className="h-12 w-full" key={key} />
			))}
		</div>
	);
}

function MemberRow({
	currentUserId,
	currentUserRole,
	member,
}: {
	currentUserId: string | null;
	currentUserRole: OrganizationRole | null;
	member: OrganizationMember;
}) {
	const queryClient = useQueryClient();

	const isSelf = member.userId === currentUserId;
	const canManage =
		!isSelf &&
		(currentUserRole === "owner" ||
			(currentUserRole === "admin" && member.role !== "owner"));

	const suspendMutation = useMutation({
		mutationFn: () => suspendOrganizationMember({ memberId: member.id }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ORGANIZATION_QUERY_KEY });
		},
	});

	const roleMutation = useMutation({
		mutationFn: (role: OrganizationRole) =>
			updateOrganizationMemberRole({ memberId: member.id, role }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ORGANIZATION_QUERY_KEY });
		},
	});

	const handleChangeRole = (role: OrganizationRole) => {
		if (role === member.role) {
			return;
		}
		toast.promise(roleMutation.mutateAsync(role), {
			loading: "Updating member role...",
			success: "Member role updated",
			error: (err) =>
				err instanceof Error ? err.message : "Failed to update member role",
		});
	};

	const handleSuspend = () => {
		toast.promise(suspendMutation.mutateAsync(), {
			loading: "Suspending member...",
			success: "Member suspended",
			error: (err) =>
				err instanceof Error ? err.message : "Failed to suspend member",
		});
	};

	return (
		<TableRow>
			<TableCell className="font-medium">
				<div className="flex items-center gap-3">
					<Avatar className="size-8">
						<AvatarImage
							alt={member.user.name}
							src={member.user.image ?? undefined}
						/>
						<AvatarFallback className="text-xs">
							{(member.user.name || member.user.email).charAt(0).toUpperCase()}
						</AvatarFallback>
					</Avatar>
					<div className="min-w-0">
						<p className="truncate text-foreground">
							{member.user.name || member.user.email}
							{isSelf ? (
								<span className="ml-2 text-muted-foreground text-xs">
									(you)
								</span>
							) : null}
						</p>
						<p className="truncate text-muted-foreground text-xs">
							{member.user.email}
						</p>
					</div>
				</div>
			</TableCell>
			<TableCell>
				<Badge className="capitalize" variant="outline">
					{member.role}
				</Badge>
			</TableCell>
			<TableCell className="text-muted-foreground">
				{formatDate(member.createdAt)}
			</TableCell>
			<TableCell className="text-right">
				{canManage ? (
					<DropdownMenu>
						<DropdownMenuTrigger
							render={<Button size="icon" variant="ghost" />}
						>
							<EllipsisVerticalIcon className="size-4" />
							<span className="sr-only">Actions</span>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{ROLE_OPTIONS.map((role) => (
								<DropdownMenuItem
									key={role}
									onClick={() => handleChangeRole(role)}
								>
									<ShieldIcon className="size-4" />
									Make {role}
									{role === member.role ? (
										<span className="ml-auto text-muted-foreground text-xs">
											current
										</span>
									) : null}
								</DropdownMenuItem>
							))}
							<DropdownMenuSeparator />
							<DropdownMenuItem
								nativeButton
								render={
									<Button
										className="flex w-full items-center justify-start"
										onClick={handleSuspend}
										variant="destructive"
									/>
								}
							>
								<UserMinusIcon className="size-4" />
								Suspend from organization
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				) : null}
			</TableCell>
		</TableRow>
	);
}

function SuspendedMemberRow({
	canManage,
	member,
}: {
	canManage: boolean;
	member: OrganizationMember;
}) {
	const queryClient = useQueryClient();

	const reinstateMutation = useMutation({
		mutationFn: () => reinstateOrganizationMember({ memberId: member.id }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ORGANIZATION_QUERY_KEY });
		},
	});

	const handleReinstate = () => {
		toast.promise(reinstateMutation.mutateAsync(), {
			loading: "Reinstating member...",
			success: "Member reinstated",
			error: (err) =>
				err instanceof Error ? err.message : "Failed to reinstate member",
		});
	};

	return (
		<TableRow>
			<TableCell className="font-medium">
				<div className="flex items-center gap-3">
					<Avatar className="size-8 opacity-60">
						<AvatarImage
							alt={member.user.name}
							src={member.user.image ?? undefined}
						/>
						<AvatarFallback className="text-xs">
							{(member.user.name || member.user.email).charAt(0).toUpperCase()}
						</AvatarFallback>
					</Avatar>
					<div className="min-w-0">
						<p className="truncate text-foreground">
							{member.user.name || member.user.email}
						</p>
						<p className="truncate text-muted-foreground text-xs">
							{member.user.email}
						</p>
					</div>
				</div>
			</TableCell>
			<TableCell>
				<Badge className="capitalize" variant="outline">
					{member.role}
				</Badge>
			</TableCell>
			<TableCell className="text-muted-foreground">
				{member.suspendedAt ? formatDate(member.suspendedAt) : "—"}
			</TableCell>
			<TableCell className="text-right">
				{canManage ? (
					<Button
						disabled={reinstateMutation.isPending}
						onClick={handleReinstate}
						size="sm"
						variant="outline"
					>
						<RotateCcwIcon className="size-3.5" />
						Reinstate
					</Button>
				) : null}
			</TableCell>
		</TableRow>
	);
}

function InvitationRow({
	canManage,
	invitation,
}: {
	canManage: boolean;
	invitation: OrganizationInvitation;
}) {
	const queryClient = useQueryClient();

	const cancelMutation = useMutation({
		mutationFn: () => cancelOrganizationInvitation(invitation.id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ORGANIZATION_QUERY_KEY });
		},
	});

	const handleCancel = () => {
		toast.promise(cancelMutation.mutateAsync(), {
			loading: "Cancelling invitation...",
			success: "Invitation cancelled",
			error: (err) =>
				err instanceof Error ? err.message : "Failed to cancel invitation",
		});
	};

	return (
		<TableRow>
			<TableCell className="font-medium text-foreground">
				{invitation.email}
			</TableCell>
			<TableCell>
				<Badge className="capitalize" variant="outline">
					{invitation.role ?? "member"}
				</Badge>
			</TableCell>
			<TableCell className="text-muted-foreground">
				{formatDate(invitation.expiresAt)}
			</TableCell>
			<TableCell className="text-right">
				{canManage ? (
					<Button
						disabled={cancelMutation.isPending}
						onClick={handleCancel}
						size="sm"
						variant="outline"
					>
						Cancel
					</Button>
				) : null}
			</TableCell>
		</TableRow>
	);
}

function InviteMemberDialog({ canInvite }: { canInvite: boolean }) {
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<OrganizationRole>("member");
	const [errorMessage, setErrorMessage] = useState("");

	const inviteMutation = useMutation({
		mutationFn: () => inviteOrganizationMember({ email: email.trim(), role }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ORGANIZATION_QUERY_KEY });
			setOpen(false);
			setEmail("");
			setRole("member");
			setErrorMessage("");
			toast.success("Invitation sent");
		},
		onError: (err) => {
			setErrorMessage(
				err instanceof Error ? err.message : "Failed to send invitation",
			);
		},
	});

	const handleSubmit = () => {
		if (!email.trim()) {
			setErrorMessage("Please enter an email address");
			return;
		}
		setErrorMessage("");
		inviteMutation.mutate();
	};

	return (
		<Dialog
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					setErrorMessage("");
				}
			}}
			open={open}
		>
			<DialogTrigger
				render={
					<Button disabled={!canInvite} onClick={() => setOpen(true)}>
						Invite member
					</Button>
				}
			/>
			<DialogContent className="flex w-full max-w-lg! flex-col">
				<DialogHeader>
					<DialogTitle>Invite a member</DialogTitle>
				</DialogHeader>
				<div className="space-y-4">
					{errorMessage ? (
						<Alert variant="destructive">
							<AlertTitle>Error</AlertTitle>
							<AlertDescription>{errorMessage}</AlertDescription>
						</Alert>
					) : null}
					<div className="space-y-2">
						<Label htmlFor="invite-email">Email</Label>
						<Input
							autoComplete="email"
							disabled={inviteMutation.isPending}
							id="invite-email"
							onChange={(event) => setEmail(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									handleSubmit();
								}
							}}
							placeholder="teammate@example.com"
							type="email"
							value={email}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="invite-role">Role</Label>
						<select
							className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm capitalize shadow-sm transition-colors file:border-0 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
							disabled={inviteMutation.isPending}
							id="invite-role"
							name="role"
							onChange={(event) =>
								setRole(event.target.value as OrganizationRole)
							}
							value={role}
						>
							{ROLE_OPTIONS.map((value) => (
								<option key={value} value={value}>
									{value}
								</option>
							))}
						</select>
					</div>
				</div>
				<DialogFooter>
					<Button
						disabled={inviteMutation.isPending || !email.trim()}
						onClick={handleSubmit}
					>
						{inviteMutation.isPending ? "Sending..." : "Send invitation"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function MembersBody({
	currentUserId,
	currentUserRole,
	organization,
}: {
	currentUserId: string | null;
	currentUserRole: OrganizationRole | null;
	organization: FullOrganization;
}) {
	const canInvite = currentUserRole === "owner" || currentUserRole === "admin";
	const canManageSuspended = canInvite;
	const pendingInvitations = organization.invitations.filter(
		(invitation) => invitation.status === "pending",
	);

	const { activeMembers, suspendedMembers } = useMemo(() => {
		const active: OrganizationMember[] = [];
		const suspended: OrganizationMember[] = [];
		for (const member of organization.members) {
			if (member.suspendedAt) {
				suspended.push(member);
			} else {
				active.push(member);
			}
		}
		return { activeMembers: active, suspendedMembers: suspended };
	}, [organization.members]);

	return (
		<div className="space-y-10">
			<section className="space-y-4">
				<header className="flex items-end justify-between gap-4">
					<div>
						<h2 className="font-medium text-foreground text-lg">Members</h2>
						<p className="text-muted-foreground text-sm">
							People with access to this organization.
						</p>
					</div>
					<InviteMemberDialog canInvite={canInvite} />
				</header>
				<div className="overflow-hidden rounded-md border">
					<Table>
						<TableHeader className="sticky top-0 z-10 bg-muted">
							<TableRow>
								<TableHead>Member</TableHead>
								<TableHead>Role</TableHead>
								<TableHead>Joined</TableHead>
								<TableHead>
									<span className="sr-only">Actions</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{activeMembers.map((member) => (
								<MemberRow
									currentUserId={currentUserId}
									currentUserRole={currentUserRole}
									key={member.id}
									member={member}
								/>
							))}
						</TableBody>
					</Table>
				</div>
			</section>

			{suspendedMembers.length > 0 ? (
				<section className="space-y-4">
					<header>
						<h2 className="font-medium text-foreground text-lg">
							Suspended members
						</h2>
						<p className="text-muted-foreground text-sm">
							These members no longer have access. Their membership rows are
							preserved so audit-log entries can keep attributing past actions
							to them. Reinstate to restore access.
						</p>
					</header>
					<div className="overflow-hidden rounded-md border">
						<Table>
							<TableHeader className="sticky top-0 z-10 bg-muted">
								<TableRow>
									<TableHead>Member</TableHead>
									<TableHead>Role at suspension</TableHead>
									<TableHead>Suspended</TableHead>
									<TableHead>
										<span className="sr-only">Actions</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{suspendedMembers.map((member) => (
									<SuspendedMemberRow
										canManage={canManageSuspended}
										key={member.id}
										member={member}
									/>
								))}
							</TableBody>
						</Table>
					</div>
				</section>
			) : null}

			<section className="space-y-4">
				<header>
					<h2 className="font-medium text-foreground text-lg">
						Pending invitations
					</h2>
					<p className="text-muted-foreground text-sm">
						Invitations that have been sent but not yet accepted.
					</p>
				</header>
				{pendingInvitations.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						No pending invitations.
					</p>
				) : (
					<div className="overflow-hidden rounded-md border">
						<Table>
							<TableHeader className="sticky top-0 z-10 bg-muted">
								<TableRow>
									<TableHead>Email</TableHead>
									<TableHead>Role</TableHead>
									<TableHead>Expires</TableHead>
									<TableHead>
										<span className="sr-only">Actions</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{pendingInvitations.map((invitation) => (
									<InvitationRow
										canManage={canInvite}
										invitation={invitation}
										key={invitation.id}
									/>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</section>
		</div>
	);
}

export function OrganizationMembersPage() {
	const { user } = useAuth();
	const { data, isLoading, isError, error } = useQuery({
		queryFn: fetchFullOrganization,
		queryKey: ORGANIZATION_QUERY_KEY,
		staleTime: 30_000,
	});

	const currentMember =
		data?.members.find((member) => member.userId === user?.id) ?? null;

	return (
		<OrganizationPageLayout
			description="Manage who has access to your organization."
			title="Members"
		>
			{isError ? (
				<Alert variant="destructive">
					<AlertTitle>Failed to load members</AlertTitle>
					<AlertDescription>
						{error instanceof Error
							? error.message
							: "Something went wrong while loading members."}
					</AlertDescription>
				</Alert>
			) : null}
			{isLoading ? <MembersSkeleton /> : null}
			{data && !isError ? (
				<MembersBody
					currentUserId={user?.id ?? null}
					currentUserRole={
						(currentMember?.role as OrganizationRole | undefined) ?? null
					}
					organization={data}
				/>
			) : null}
		</OrganizationPageLayout>
	);
}
