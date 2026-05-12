import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { negotiateInitialLocale } from "@/i18n/negotiate";
import { I18nProvider } from "@/i18n/provider";
import appCss from "@/routes/styles.css?url";

const colorSchemeScript = `(function(){try{if(window.matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}catch(e){}})();`;

export const Route = createRootRoute({
	beforeLoad: () => ({
		initialLocale: negotiateInitialLocale(),
	}),
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "Kayle ID",
			},
			{
				rel: "apple-touch-icon",
				sizes: "180x180",
				href: "/apple-touch-icon.png",
			},
			{
				rel: "icon",
				type: "image/png",
				sizes: "32x32",
				href: "/favicon-32x32.png",
			},
			{
				rel: "icon",
				type: "image/png",
				sizes: "16x16",
				href: "/favicon-16x16.png",
			},
			{
				rel: "manifest",
				href: "/site.webmanifest",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	component: RootLayout,
});

function RootLayout() {
	const { initialLocale } = Route.useRouteContext();

	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
			document.documentElement.classList.toggle("dark", e.matches);
		};
		handleChange(media);
		media.addEventListener("change", handleChange);
		return () => media.removeEventListener("change", handleChange);
	}, []);

	return (
		<html lang={initialLocale} suppressHydrationWarning>
			<head>
				<script
					// biome-ignore lint/security/noDangerouslySetInnerHtml: inline script must run before paint to avoid a light-mode flash for dark-mode users
					dangerouslySetInnerHTML={{ __html: colorSchemeScript }}
				/>
				<HeadContent />
			</head>
			<body className="isolate font-sans antialiased">
				<I18nProvider initialLocale={initialLocale}>
					<Outlet />
				</I18nProvider>
				<Scripts />
			</body>
		</html>
	);
}
