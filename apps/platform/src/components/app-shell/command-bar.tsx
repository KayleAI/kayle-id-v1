import { client } from "@kayle-id/auth/client";
import { useAuth } from "@kayle-id/auth/client/provider";
import type { Organization } from "@kayle-id/auth/types";
import { Avatar, AvatarFallback, AvatarImage } from "@kayleai/ui/avatar";
import {
	CommandEmpty,
	CommandGroup,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
} from "@kayleai/ui/command";
import { Kbd, KbdGroup } from "@kayleai/ui/kbd";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Command as CommandPrimitive } from "cmdk";
import {
	BuildingIcon,
	Key,
	LayoutDashboard,
	LogOutIcon,
	PlusIcon,
	SearchIcon,
	SettingsIcon,
	WebhookIcon,
} from "lucide-react";
import {
	createContext,
	type ReactNode,
	type RefObject,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";

type AppCommandContextValue = {
	open: boolean;
	setOpen: (open: boolean) => void;
	inputRef: RefObject<HTMLInputElement | null>;
};

const AppCommandContext = createContext<AppCommandContextValue | null>(null);

export function useAppCommand() {
	const ctx = useContext(AppCommandContext);
	if (!ctx) {
		throw new Error("useAppCommand must be used within AppCommandProvider");
	}
	return ctx;
}

export function AppCommandProvider({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				setOpen((current) => {
					const next = !current;
					if (next) {
						queueMicrotask(() => inputRef.current?.focus());
					} else {
						queueMicrotask(() => inputRef.current?.blur());
					}
					return next;
				});
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	const value = useMemo(() => ({ open, setOpen, inputRef }), [open]);

	return (
		<AppCommandContext.Provider value={value}>
			{children}
		</AppCommandContext.Provider>
	);
}

const PAGES = [
	{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
	{ title: "API Keys", url: "/api-keys", icon: Key },
	{ title: "Webhooks", url: "/webhooks", icon: WebhookIcon },
	{ title: "Organization", url: "/organizations", icon: BuildingIcon },
	{ title: "Account", url: "/account", icon: SettingsIcon },
] as const;

export function AppCommandBar() {
	const { open, setOpen, inputRef } = useAppCommand();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { organizations, activeOrganization } = useAuth();
	const containerRef = useRef<HTMLDivElement>(null);
	const [query, setQuery] = useState("");

	const close = useCallback(() => {
		setOpen(false);
		setQuery("");
		inputRef.current?.blur();
	}, [setOpen, inputRef]);

	useEffect(() => {
		if (!open) {
			return;
		}
		function handlePointerDown(event: PointerEvent) {
			const node = containerRef.current;
			if (node && !node.contains(event.target as Node)) {
				close();
			}
		}
		document.addEventListener("pointerdown", handlePointerDown);
		return () => document.removeEventListener("pointerdown", handlePointerDown);
	}, [open, close]);

	const runCommand = useCallback(
		(action: () => void) => {
			close();
			action();
		},
		[close],
	);

	const switchOrganization = useCallback(
		async (id: string, slug: string) => {
			try {
				await client.organization.setActive({
					organizationId: id,
					organizationSlug: slug,
				});
			} finally {
				queryClient.invalidateQueries({ queryKey: ["api-keys"] });
				queryClient.invalidateQueries({ queryKey: ["webhooks"] });
			}
		},
		[queryClient],
	);

	return (
		<div className="relative w-full max-w-xl" ref={containerRef}>
			<CommandPrimitive
				className="overflow-visible"
				label="Search"
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						close();
					}
				}}
				shouldFilter
			>
				<div className="flex h-9 items-center gap-2 rounded-lg border border-border/70 bg-background px-2.5 text-sm has-[input:focus]:border-ring has-[input:focus]:ring-2 has-[input:focus]:ring-ring/15">
					<SearchIcon className="size-4 shrink-0 text-muted-foreground" />
					<CommandPrimitive.Input
						className="flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
						onClick={() => setOpen(true)}
						onFocus={() => setOpen(true)}
						onValueChange={setQuery}
						placeholder="Search"
						ref={inputRef}
						value={query}
					/>
					<KbdGroup className="hidden sm:inline-flex">
						<Kbd>⌘</Kbd>
						<Kbd>K</Kbd>
					</KbdGroup>
				</div>

				{open ? (
					<div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl ring-1 ring-foreground/5">
						<CommandList className="max-h-[min(60vh,420px)] [&_[cmdk-group-items]]:space-y-0.5">
							<CommandEmpty>No results found.</CommandEmpty>
							<CommandGroup heading="Pages">
								{PAGES.map((page) => (
									<CommandItem
										key={page.url}
										keywords={[page.title]}
										onSelect={() =>
											runCommand(() => {
												navigate({ to: page.url });
											})
										}
										value={`page-${page.title}`}
									>
										<page.icon />
										{page.title}
									</CommandItem>
								))}
							</CommandGroup>
							{organizations.length > 0 ? (
								<>
									<CommandSeparator />
									<CommandGroup heading="Organizations">
										{organizations.map((org: Organization) => {
											const isActive = org.id === activeOrganization?.id;
											return (
												<CommandItem
													key={org.id}
													keywords={[org.name, org.slug]}
													onSelect={() =>
														runCommand(() => {
															if (isActive) {
																navigate({ to: "/organizations" });
																return;
															}
															toast.promise(
																switchOrganization(org.id, org.slug),
																{
																	loading: "Switching organization…",
																	success: "Organization switched",
																	error: "Failed to switch organization",
																},
															);
														})
													}
													value={`org-${org.id}`}
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
													{isActive ? (
														<CommandShortcut>Current</CommandShortcut>
													) : null}
												</CommandItem>
											);
										})}
										<CommandItem
											keywords={["create", "new", "organization"]}
											onSelect={() =>
												runCommand(() => {
													navigate({ to: "/organizations/create" });
												})
											}
											value="org-create"
										>
											<PlusIcon />
											Create organization
										</CommandItem>
									</CommandGroup>
								</>
							) : null}
							<CommandSeparator />
							<CommandGroup heading="Account">
								<CommandItem
									keywords={["account", "profile", "settings"]}
									onSelect={() =>
										runCommand(() => {
											navigate({ to: "/account" });
										})
									}
									value="my-account"
								>
									<SettingsIcon />
									My Account
								</CommandItem>
								<CommandItem
									keywords={["sign out", "logout", "log out"]}
									onSelect={() =>
										runCommand(() => {
											navigate({ to: "/sign-out" });
										})
									}
									value="account-sign-out"
								>
									<LogOutIcon />
									Sign out
								</CommandItem>
							</CommandGroup>
						</CommandList>
					</div>
				) : null}
			</CommandPrimitive>
		</div>
	);
}
