import {
	CommandEmpty,
	CommandGroup,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
} from "@kayleai/ui/command";
import { Kbd, KbdGroup } from "@kayleai/ui/kbd";
import { useNavigate } from "@tanstack/react-router";
import { Command as CommandPrimitive } from "cmdk";
import {
	ArrowUpRightIcon,
	BookOpenIcon,
	BuildingIcon,
	Key,
	LayoutDashboard,
	LifeBuoyIcon,
	LogOutIcon,
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
	{
		title: "Organization",
		url: "/settings/organizations",
		icon: BuildingIcon,
	},
] as const;

export function AppCommandBar() {
	const { open, setOpen, inputRef } = useAppCommand();
	const navigate = useNavigate();
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
						<CommandList className="max-h-[min(60vh,440px)] **:[[cmdk-group-items]]:space-y-0.5 **:[[data-slot=command-item][data-selected=false]]:bg-transparent">
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
							<CommandSeparator />
							<CommandGroup heading="Help">
								<CommandItem
									keywords={["docs", "documentation", "guide"]}
									onSelect={() =>
										runCommand(() => {
											window.open(
												"https://kayle.id/docs",
												"_blank",
												"noopener,noreferrer",
											);
										})
									}
									value="docs"
								>
									<BookOpenIcon />
									Docs
									<CommandShortcut>
										<ArrowUpRightIcon className="size-3.5" />
									</CommandShortcut>
								</CommandItem>
								<CommandItem
									keywords={["support", "contact", "email", "help"]}
									onSelect={() =>
										runCommand(() => {
											window.location.href = "mailto:help@kayle.id";
										})
									}
									value="support"
								>
									<LifeBuoyIcon />
									Contact support
									<CommandShortcut>help@kayle.id</CommandShortcut>
								</CommandItem>
							</CommandGroup>
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
