import { AuthProvider } from "@kayle-id/auth/client/provider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { useEffect } from "react";
import appCss from "@/routes/styles.css?url";

// Sets the `dark` class on `<html>` before React mounts so dark-mode users
// don't see a light-mode flash on first paint. Surfaces can still opt out by
// wrapping their content in `.light`; see web-theme.css.
const colorSchemeScript = `(function(){try{if(window.matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}catch(e){}})();`;

export const Route = createRootRoute({
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
	component: RootDocument,
});

function RootDocument() {
	const queryClient = new QueryClient();

	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
			document.documentElement.classList.toggle("dark", event.matches);
		};
		handleChange(media);
		media.addEventListener("change", handleChange);
		return () => media.removeEventListener("change", handleChange);
	}, []);

	return (
		<html className="overscroll-x-none" lang="en" suppressHydrationWarning>
			<head>
				<script
					// biome-ignore lint/security/noDangerouslySetInnerHtml: inline script must run before paint to avoid a light-mode flash for dark-mode users
					dangerouslySetInnerHTML={{ __html: colorSchemeScript }}
				/>
				<HeadContent />
			</head>
			<body className="overscroll-x-none font-sans antialiased">
				<AuthProvider>
					<QueryClientProvider client={queryClient}>
						<Outlet />
					</QueryClientProvider>
				</AuthProvider>
				<Scripts />
			</body>
		</html>
	);
}
