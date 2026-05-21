import { client } from "@kayle-id/auth/client";
import { useAuth } from "@kayle-id/auth/client/provider";
import type { Organization, OrganizationRole } from "@kayle-id/auth/types";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@kayle-id/ui/components/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@kayle-id/ui/components/dropdown-menu";
import { Logomark } from "@kayle-id/ui/components/logo";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@kayle-id/ui/components/sidebar";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
	ArrowUpRightIcon,
	BookOpenIcon,
	BuildingIcon,
	ChevronsUpDownIcon,
	ChevronUpIcon,
	GlobeIcon,
	Key,
	LayoutDashboard,
	LifeBuoyIcon,
	LogOutIcon,
	PlusIcon,
	ScrollTextIcon,
	SettingsIcon,
	ShieldCheckIcon,
	UserIcon,
	UsersIcon,
	WebhookIcon,
} from "lucide-react";
import { toast } from "sonner";
import { SidebarVerificationWarning } from "./sidebar-verification-warning";

const NAV_ITEMS = [
	{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
	{ title: "API Keys", url: "/api-keys", icon: Key },
	{ title: "Webhooks", url: "/webhooks", icon: WebhookIcon },
] as const;

export function AppSidebar() {
	const { user, activeOrganization, organizations, isPlatformAdmin } =
		useAuth();
	const routerState = useRouterState();
	const queryClient = useQueryClient();
	const currentPath = routerState.location.pathname;

	const currentRole = activeOrganization?.role as OrganizationRole | undefined;
	const canViewAuditLogs = currentRole === "owner" || currentRole === "admin";

	const handleSelectOrganization = async (
		organizationId: string,
		organizationSlug: string,
	) => {
		try {
			await client.organization.setActive({
				organizationId,
				organizationSlug,
			});
		} finally {
			queryClient.invalidateQueries({ queryKey: ["api-keys"] });
			queryClient.invalidateQueries({ queryKey: ["webhooks"] });
		}
	};

	const userName = user?.name || user?.email?.split("@")[0] || "User";
	const userInitial = user?.email?.charAt(0).toUpperCase() ?? "U";
	const orgName = activeOrganization?.name ?? "Organization";
	const orgSlug = activeOrganization?.slug ?? "";
	const orgInitial = orgName.charAt(0).toUpperCase();

	return (
		<Sidebar className="border-r-0!" collapsible="icon" variant="sidebar">
			<SidebarHeader className="h-14! flex items-center justify-center">
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							className="h-10 rounded-lg!"
							render={
								<Link to="/">
									<span className="flex h-7 items-center w-full gap-2">
										<Logomark className="flex pl-1 size-6!" />
										<span className="select-none font-medium tracking-tight text-xl">
											Kayle ID
										</span>
									</span>
								</Link>
							}
						/>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<SidebarMenuButton className="h-12 data-open:bg-secondary-foreground/5 rounded-lg!">
										<Avatar className="size-7 rounded-md! after:rounded-md!">
											<AvatarImage
												alt={orgName}
												className="rounded-md!"
												src={activeOrganization?.logo ?? undefined}
											/>
											<AvatarFallback className="rounded-md! text-[11px]">
												{orgInitial}
											</AvatarFallback>
										</Avatar>
										<div className="grid flex-1 text-left leading-tight">
											<span className="truncate font-medium text-sm">
												{orgName}
											</span>
											{orgSlug ? (
												<span className="truncate text-muted-foreground text-xs">
													{orgSlug}
												</span>
											) : null}
										</div>
										<ChevronsUpDownIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
									</SidebarMenuButton>
								}
							/>
							<DropdownMenuContent
								align="start"
								className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-lg"
								side="bottom"
								sideOffset={6}
							>
								<DropdownMenuGroup>
									<DropdownMenuLabel className="text-muted-foreground text-xs">
										{orgName}
									</DropdownMenuLabel>
									<DropdownMenuItem
										render={
											<Link
												to="/settings/organizations"
												className="rounded-lg!"
											/>
										}
									>
										<BuildingIcon />
										Overview
									</DropdownMenuItem>
									<DropdownMenuItem
										render={
											<Link
												to="/settings/organizations/members"
												className="rounded-lg!"
											/>
										}
									>
										<UsersIcon />
										Members
									</DropdownMenuItem>
									<DropdownMenuItem
										render={
											<Link
												to="/settings/organizations/public"
												className="rounded-lg!"
											/>
										}
									>
										<GlobeIcon />
										Public details
									</DropdownMenuItem>
									<DropdownMenuItem
										render={
											<Link
												to="/settings/organizations/settings"
												className="rounded-lg!"
											/>
										}
									>
										<SettingsIcon />
										Settings
									</DropdownMenuItem>
								</DropdownMenuGroup>
								{organizations.length > 1 ? (
									<>
										<DropdownMenuSeparator />
										<DropdownMenuGroup>
											<DropdownMenuLabel className="text-muted-foreground text-xs">
												Switch organization
											</DropdownMenuLabel>
											{organizations
												.filter(
													(org: Organization) =>
														org.id !== activeOrganization?.id,
												)
												.map((org: Organization) => (
													<DropdownMenuItem
														key={org.id}
														onClick={() => {
															toast.promise(
																handleSelectOrganization(org.id, org.slug),
																{
																	loading: "Switching organization…",
																	success: "Organization switched",
																	error: "Failed to switch organization",
																},
															);
														}}
														className="rounded-lg!"
													>
														<Avatar className="size-5 rounded-md! after:rounded-md!">
															<AvatarImage
																alt={org.name}
																className="rounded-md!"
																src={org.logo ?? undefined}
															/>
															<AvatarFallback className="rounded-md! text-[10px]">
																{org.name.charAt(0).toUpperCase()}
															</AvatarFallback>
														</Avatar>
														<span className="truncate">{org.name}</span>
														{org.pendingDeletionAt ? (
															<span className="ml-auto rounded-full border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 font-medium text-[10px] text-destructive uppercase tracking-wide">
																Pending
															</span>
														) : null}
													</DropdownMenuItem>
												))}
										</DropdownMenuGroup>
									</>
								) : null}
								<DropdownMenuSeparator />
								<DropdownMenuItem
									render={
										<Link to="/create-organization" className="rounded-lg!" />
									}
								>
									<PlusIcon />
									Create organization
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupContent>
						<SidebarMenu>
							{NAV_ITEMS.map((item) => (
								<SidebarMenuItem key={item.title}>
									<SidebarMenuButton
										className="text-muted-foreground hover:bg-secondary-foreground/3 hover:text-foreground data-active:bg-secondary-foreground/5 data-active:font-normal data-active:text-foreground rounded-lg!"
										isActive={currentPath.startsWith(item.url)}
										render={
											<Link to={item.url}>
												<item.icon />
												<span>{item.title}</span>
											</Link>
										}
									/>
								</SidebarMenuItem>
							))}
							{canViewAuditLogs ? (
								<SidebarMenuItem>
									<SidebarMenuButton
										className="text-muted-foreground hover:bg-secondary-foreground/3 hover:text-foreground data-active:bg-secondary-foreground/5 data-active:font-normal data-active:text-foregroun rounded-lg!"
										isActive={currentPath.startsWith(
											"/settings/organizations/audit-logs",
										)}
										render={
											<Link to="/settings/organizations/audit-logs">
												<ScrollTextIcon />
												<span>Audit logs</span>
											</Link>
										}
									/>
								</SidebarMenuItem>
							) : null}
							{isPlatformAdmin ? (
								<SidebarMenuItem>
									<SidebarMenuButton
										className="text-muted-foreground hover:bg-secondary-foreground/3 hover:text-foreground data-active:bg-secondary-foreground/5 data-active:font-normal data-active:text-foreground rounded-lg!"
										isActive={currentPath.startsWith("/admin")}
										render={
											<Link to="/admin">
												<ShieldCheckIcon />
												<span>Admin</span>
											</Link>
										}
									/>
								</SidebarMenuItem>
							) : null}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>

			<SidebarFooter>
				<SidebarVerificationWarning />
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							className="text-muted-foreground hover:bg-secondary-foreground/3 hover:text-foreground"
							render={
								<a
									href="https://kayle.id/docs"
									rel="noopener noreferrer"
									target="_blank"
								>
									<BookOpenIcon />
									<span>Docs</span>
									<ArrowUpRightIcon className="ml-auto shrink-0 group-data-[collapsible=icon]:hidden" />
								</a>
							}
						/>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							className="text-muted-foreground hover:bg-secondary-foreground/3 hover:text-foreground"
							render={
								<a href="mailto:help@kayle.id">
									<LifeBuoyIcon />
									<span>Contact support</span>
								</a>
							}
						/>
					</SidebarMenuItem>
				</SidebarMenu>

				<SidebarMenu>
					<SidebarMenuItem>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<SidebarMenuButton
										className="h-12 data-open:bg-secondary-foreground/5"
										tooltip={userName}
									>
										<Avatar className="size-7 rounded-md! after:rounded-md!">
											<AvatarImage
												alt={user?.name}
												className="rounded-md!"
												src={user?.image ?? undefined}
											/>
											<AvatarFallback className="rounded-md! text-[11px]">
												{userInitial}
											</AvatarFallback>
										</Avatar>
										<div className="grid flex-1 text-left leading-tight">
											<span className="truncate font-medium text-sm">
												{userName}
											</span>
											<span className="truncate text-muted-foreground text-xs">
												{user?.email}
											</span>
										</div>
										<ChevronUpIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
									</SidebarMenuButton>
								}
							/>
							<DropdownMenuContent
								align="end"
								className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-lg"
								side="top"
								sideOffset={6}
							>
								<DropdownMenuItem render={<Link to="/account" />}>
									<UserIcon />
									My Account
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									render={<Link to="/sign-out" />}
									variant="destructive"
								>
									<LogOutIcon />
									Sign out
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
		</Sidebar>
	);
}
