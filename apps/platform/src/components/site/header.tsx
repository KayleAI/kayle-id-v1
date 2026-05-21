"use client";

import { useAuth } from "@kayle-id/auth/client/provider";
import { Button } from "@kayle-id/ui/components/button";
import { Logo } from "@kayle-id/ui/components/logo";
import {
	NavigationMenu,
	NavigationMenuContent,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	NavigationMenuTrigger,
} from "@kayle-id/ui/components/navigation-menu";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetTitle,
	SheetTrigger,
} from "@kayle-id/ui/components/sheet";
import { cn } from "@kayle-id/ui/lib/utils";
import { Link, useLocation } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FileRoutesByTo } from "@/routeTree.gen";

type NavTo = keyof FileRoutesByTo | string;
type TopLevelNavigationLink = {
	label: string;
	to: NavTo;
};
type DropdownNavigationLink = {
	description: string;
	label: string;
	to: NavTo;
};

const API_REFERENCE_URL = "https://docs.kayle.id/api-reference";
const DOCUMENTATION_URL = "https://docs.kayle.id/";
const ORGANIZATIONS_URL = "/organizations" satisfies keyof FileRoutesByTo;

const topLevelNavigationItems: TopLevelNavigationLink[] = [
	{
		label: "Organizations",
		to: ORGANIZATIONS_URL,
	},
];

const navigationItems: {
	section: string;
	items: DropdownNavigationLink[];
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
				description: "Guides, concepts, and more about Kayle ID.",
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

function isActiveNavigationPath(to: NavTo, pathname: string) {
	if (to.startsWith("https://")) {
		return false;
	}

	if (to === "/") {
		return pathname === "/";
	}

	return pathname === to || pathname.startsWith(`${to}/`);
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
	isActive,
	label,
	onNavigate,
}: {
	isActive: boolean;
	label: string;
	onNavigate: () => void;
	to: NavTo;
}) {
	return (
		<Link
			aria-current={isActive ? "page" : undefined}
			className={cn(
				"flex min-h-11 items-center rounded-lg border border-transparent px-3 py-1.5 text-left font-medium text-foreground text-lg outline-none transition-colors hover:bg-muted/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30",
				isActive && "border-border/80 bg-muted text-foreground",
			)}
			onClick={onNavigate}
			to={to}
			{...getExternalLinkProps(to)}
		>
			{label}
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

	const handleMenuClose = () => setOpen(false);
	const ctaLabel = status === "authenticated" ? "Dashboard" : "Get Started";
	const ctaTo = status === "authenticated" ? "/dashboard" : "/sign-in";

	return (
		<Sheet modal={false} onOpenChange={setOpen} open={open}>
			{open ? (
				<SheetClose
					render={
						<Button
							aria-expanded={open}
							aria-label="Close menu"
							className="lg:hidden"
							size="icon"
							variant="ghost"
						/>
					}
				>
					<X aria-hidden="true" className="size-5" />
				</SheetClose>
			) : (
				<SheetTrigger
					render={
						<Button
							aria-expanded={open}
							aria-label="Open menu"
							className="lg:hidden"
							size="icon"
							variant="ghost"
						/>
					}
				>
					<Menu aria-hidden="true" className="size-5" />
				</SheetTrigger>
			)}
			<SheetContent
				className="top-16 h-[calc(100dvh-4rem)] w-screen max-w-none origin-top overflow-hidden border-0 bg-background p-0 shadow-none data-ending-style:scale-y-95 data-starting-style:scale-y-95 data-[side=top]:top-16 data-[side=top]:h-[calc(100dvh-4rem)] data-[side=top]:data-ending-style:-translate-y-2 data-[side=top]:data-starting-style:-translate-y-2"
				overlayClassName="z-40 bg-transparent backdrop-blur-none supports-backdrop-filter:backdrop-blur-none"
				showCloseButton={false}
				side="top"
			>
				<SheetTitle className="sr-only">Navigation menu</SheetTitle>
				<nav
					aria-label="Main navigation"
					className="flex min-h-0 flex-1 flex-col"
				>
					<div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
						<ul className="space-y-1">
							{topLevelNavigationItems.map((item) => (
								<li key={item.to}>
									<MobileNavItem
										isActive={isActiveNavigationPath(item.to, pathname)}
										label={item.label}
										onNavigate={handleMenuClose}
										to={item.to}
									/>
								</li>
							))}
						</ul>
						{navigationItems.map((item) => (
							<section className="mt-5" key={item.section}>
								<h3 className="px-3 font-medium text-muted-foreground text-xs uppercase tracking-normal">
									{item.section}
								</h3>
								<ul className="mt-2 space-y-1">
									{item.items.map((navItem) => (
										<li key={navItem.to}>
											<MobileNavItem
												isActive={isActiveNavigationPath(navItem.to, pathname)}
												label={navItem.label}
												onNavigate={handleMenuClose}
												to={navItem.to}
											/>
										</li>
									))}
								</ul>
							</section>
						))}
					</div>
					<div className="border-border/70 border-t p-4">
						<Button
							className="h-11 w-full px-4"
							nativeButton={false}
							render={<Link onClick={handleMenuClose} to={ctaTo} />}
						>
							<span>{ctaLabel}</span>
						</Button>
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
							{status === "authenticated" ? "Dashboard" : "Get Started"}
						</NavItem>
					</div>
				</div>
			</div>
		</header>
	);
}
