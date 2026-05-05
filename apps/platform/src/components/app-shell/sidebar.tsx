import { client } from "@kayle-id/auth/client";
import { useAuth } from "@kayle-id/auth/client/provider";
import type { Organization } from "@kayle-id/auth/types";
import { Avatar, AvatarFallback, AvatarImage } from "@kayleai/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@kayleai/ui/dropdown-menu";
import { Logo } from "@kayleai/ui/logo";
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
	SidebarSeparator,
} from "@kayleai/ui/sidebar";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
	BuildingIcon,
	ChevronsUpDownIcon,
	ChevronUpIcon,
	GlobeIcon,
	Key,
	LayoutDashboard,
	LogOutIcon,
	PlusIcon,
	SettingsIcon,
	UserIcon,
	UsersIcon,
	WebhookIcon,
} from "lucide-react";
import { toast } from "sonner";

const NAV_ITEMS = [
	{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
	{ title: "API Keys", url: "/api-keys", icon: Key },
	{ title: "Webhooks", url: "/webhooks", icon: WebhookIcon },
] as const;

export function AppSidebar() {
	const { user, activeOrganization, organizations } = useAuth();
	const routerState = useRouterState();
	const queryClient = useQueryClient();
	const currentPath = routerState.location.pathname;

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
							className="h-10"
							render={
								<Link to="/">
									<span className="flex h-7 items-center w-full">
										<Logo className="flex" title="Kayle ID" />
									</span>
								</Link>
							}
						/>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<SidebarSeparator className="ml-0!" />

			<SidebarHeader className="pr-0!">
				<SidebarMenu>
					<SidebarMenuItem>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<SidebarMenuButton className="h-12 data-open:bg-secondary-foreground/5">
										<Avatar className="size-7 rounded-md">
											<AvatarImage
												alt={orgName}
												src={activeOrganization?.logo ?? undefined}
											/>
											<AvatarFallback className="rounded-md text-[11px]">
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
									<DropdownMenuItem render={<Link to="/organizations" />}>
										<BuildingIcon />
										Overview
									</DropdownMenuItem>
									<DropdownMenuItem
										render={<Link to="/organizations/members" />}
									>
										<UsersIcon />
										Members
									</DropdownMenuItem>
									<DropdownMenuItem
										render={<Link to="/organizations/public" />}
									>
										<GlobeIcon />
										Public details
									</DropdownMenuItem>
									<DropdownMenuItem
										render={<Link to="/organizations/settings" />}
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
													>
														<Avatar className="size-5 rounded-md">
															<AvatarImage
																alt={org.name}
																src={org.logo ?? undefined}
															/>
															<AvatarFallback className="rounded-md text-[10px]">
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
								<DropdownMenuItem render={<Link to="/organizations/create" />}>
									<PlusIcon />
									Create organization
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<div className="mx-3 w-[calc(100%-18px)] h-px bg-sidebar-border"></div>

			<SidebarContent>
				<SidebarGroup className="pr-0!">
					<SidebarGroupContent>
						<SidebarMenu>
							{NAV_ITEMS.map((item) => (
								<SidebarMenuItem key={item.title}>
									<SidebarMenuButton
										className="text-muted-foreground hover:bg-secondary-foreground/3 hover:text-foreground data-active:bg-secondary-foreground/5 data-active:font-normal data-active:text-foreground"
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
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>

			<SidebarFooter className="border-secondary-foreground/10 border-t">
				<SidebarMenu>
					<SidebarMenuItem>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<SidebarMenuButton
										className="h-12 data-open:bg-secondary-foreground/5"
										tooltip={userName}
									>
										<Avatar className="size-7 rounded-md">
											<AvatarImage
												alt={user?.name}
												src={user?.image ?? undefined}
											/>
											<AvatarFallback className="rounded-md text-[11px]">
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
