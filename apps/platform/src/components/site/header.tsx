"use client";

import { useAuth } from "@kayle-id/auth/client/provider";
import { Button } from "@kayleai/ui/button";
import { Logo } from "@kayleai/ui/logo";
import {
	NavigationMenu,
	NavigationMenuContent,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	NavigationMenuTrigger,
} from "@kayleai/ui/navigation-menu";
import {
	Sheet,
	SheetContent,
	SheetTitle,
	SheetTrigger,
} from "@kayleai/ui/sheet";
import { cn } from "@kayleai/ui/utils/cn";
import { Link, useLocation } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FileRoutesByTo } from "@/routeTree.gen";

type NavTo = keyof FileRoutesByTo | string;

const API_REFERENCE_URL = "https://docs.kayle.id/api-reference";
const DOCUMENTATION_URL = "https://docs.kayle.id/";
const ORGANIZATIONS_URL = "/organizations" satisfies keyof FileRoutesByTo;

const topLevelNavigationItems: { label: string; to: NavTo }[] = [
	{ label: "Organizations", to: ORGANIZATIONS_URL },
];

const navigationItems: {
	section: string;
	items: { to: NavTo; label: string; description: string }[];
}[] = [
	{
		section: "Product",
		items: [
			{
				description: "Try Kayle ID verification flows end to end.",
				label: "Demo",
				to: "/demo",
			},
			{
				description: "Implementation guides, concepts, and integration notes.",
				label: "Docs",
				to: DOCUMENTATION_URL,
			},
			{
				description: "Endpoint reference for the Kayle ID API.",
				label: "API Reference",
				to: API_REFERENCE_URL,
			},
		],
	},
];

const DESKTOP_NAV_ITEM_CLASS =
	"font-medium text-muted-foreground text-sm transition-colors duration-200 hover:text-foreground";

const DESKTOP_NAV_TRIGGER_CLASS = cn(
	DESKTOP_NAV_ITEM_CLASS,
	"bg-transparent px-0 hover:bg-transparent focus:bg-transparent focus:text-foreground data-open:bg-transparent data-open:text-foreground data-open:hover:bg-transparent data-popup-open:bg-transparent data-popup-open:text-foreground data-popup-open:hover:bg-transparent",
);

function getExternalLinkProps(to: NavTo) {
	return to.startsWith("https://")
		? ({ rel: "noopener noreferrer", target: "_blank" } as const)
		: {};
}

interface NavItemProps {
	children: React.ReactNode;
	className?: string;
	to: NavTo;
	variant?: "default" | "button";
}

function NavItem({
	to,
	children,
	variant = "default",
	className,
}: NavItemProps) {
	if (variant === "button") {
		return (
			<Button
				className={cn(className)}
				nativeButton={false}
				render={
					<Link to={to} {...getExternalLinkProps(to)}>
						{children}
					</Link>
				}
				variant="default"
			/>
		);
	}

	return (
		<Link
			className={DESKTOP_NAV_ITEM_CLASS}
			to={to}
			{...getExternalLinkProps(to)}
		>
			{children}
		</Link>
	);
}

const ListItem = ({
	ref,
	className,
	title,
	children,
	to,
	...props
}: {
	ref?: React.RefObject<HTMLAnchorElement>;
	className?: string;
	title: string;
	children: React.ReactNode;
	to: NavTo;
	props?: React.ComponentPropsWithoutRef<"a">;
}) => {
	if (!to) {
		return null;
	}

	return (
		<li>
			<NavigationMenuLink
				render={() => (
					<Link
						className={cn(
							"block select-none space-y-1 rounded-md p-3 font-medium leading-none no-underline outline-none transition-colors hover:bg-muted hover:text-foreground",
							className,
						)}
						ref={ref}
						to={to}
						{...getExternalLinkProps(to)}
						{...props}
					>
						<div className="font-medium text-sm leading-none">{title}</div>
						<p className="line-clamp-2 text-muted-foreground text-sm leading-snug">
							{children}
						</p>
					</Link>
				)}
			/>
		</li>
	);
};

function MobileNavItem({
	to,
	children,
}: {
	to: NavTo;
	children: React.ReactNode;
}) {
	return (
		<Link
			className="block text-lg text-muted-foreground transition-colors hover:text-foreground"
			to={to}
			{...getExternalLinkProps(to)}
		>
			{children}
		</Link>
	);
}

function MobileNavigation() {
	const { status } = useAuth();
	const [open, setOpen] = useState(false);
	const pathname = useLocation().pathname;
	const prevPathnameRef = useRef(pathname);

	// Close the menu when the pathname changes
	useEffect(() => {
		if (prevPathnameRef.current !== pathname && open) {
			setOpen(false);
		}
		prevPathnameRef.current = pathname;
	}, [pathname, open]);

	return (
		<Sheet onOpenChange={setOpen} open={open}>
			<SheetTrigger
				render={() => (
					<button
						aria-label="Open menu"
						className="rounded-lg p-2 transition-colors hover:bg-muted lg:hidden"
						type="button"
					>
						<Menu className="size-6" />
					</button>
				)}
			/>
			<SheetContent className="w-full sm:max-w-sm" side="right">
				<SheetTitle>
					<Link to="/">Kayle</Link>
				</SheetTitle>
				<nav className="mt-8 flex flex-col gap-4">
					<div className="border-border border-b pb-4">
						<ul className="flex flex-col gap-y-2">
							{topLevelNavigationItems.map((item) => (
								<MobileNavItem key={item.to} to={item.to}>
									{item.label}
								</MobileNavItem>
							))}
						</ul>
					</div>
					{navigationItems.map((item) => (
						<div className="border-border border-b pb-4" key={item.section}>
							<h3 className="font-medium text-muted-foreground text-sm">
								{item.section}
							</h3>
							<ul className="mt-2 flex flex-col gap-y-2">
								{item.items.map((i) => (
									<MobileNavItem key={i.to} to={i.to}>
										{i.label}
									</MobileNavItem>
								))}
							</ul>
						</div>
					))}
					<div className="pt-4">
						<Link
							className="block w-full rounded-full bg-foreground px-4 py-2 text-background text-center transition-colors duration-200 ease-in-out hover:bg-foreground/90"
							to={status === "authenticated" ? "/dashboard" : "/sign-in"}
						>
							Get Started
						</Link>
					</div>
				</nav>
			</SheetContent>
		</Sheet>
	);
}

export function Header() {
	const { status } = useAuth();

	return (
		<header className="fixed top-0 right-0 left-0 z-50 border-border/70 border-b bg-background/80 backdrop-blur-sm">
			<div className="mx-auto max-w-7xl px-6 lg:px-8">
				<div className="flex h-16 items-center justify-between">
					<div className="flex items-center gap-12">
						<Link to="/">
							<Logo title="Kayle ID" />
						</Link>
						<div className="hidden items-center gap-6 lg:flex">
							{topLevelNavigationItems.map((item) => (
								<NavItem key={item.to} to={item.to}>
									{item.label}
								</NavItem>
							))}
							<NavigationMenu className="z-50">
								<NavigationMenuList>
									{navigationItems.map((item) => (
										<NavigationMenuItem key={item.section}>
											<NavigationMenuTrigger
												className={DESKTOP_NAV_TRIGGER_CLASS}
											>
												{item.section}
											</NavigationMenuTrigger>
											<NavigationMenuContent>
												<ul className="grid w-[400px] gap-1">
													{item.items.map((i) => (
														<ListItem key={i.to} title={i.label} to={i.to}>
															{i.description}
														</ListItem>
													))}
												</ul>
											</NavigationMenuContent>
										</NavigationMenuItem>
									))}
								</NavigationMenuList>
							</NavigationMenu>
						</div>
					</div>

					<div className="flex items-center gap-2">
						<div className="lg:hidden">
							<MobileNavigation />
						</div>
						<NavItem
							className="hidden lg:flex"
							to={status === "authenticated" ? "/dashboard" : "/sign-in"}
							variant="button"
						>
							Get Started
						</NavItem>
					</div>
				</div>
			</div>
		</header>
	);
}
