import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";

export const Route = createFileRoute("/_legal")({
	component: MarketingLayout,
});

function MarketingLayout() {
	return (
		<div className="bg-background text-foreground">
			<Header />
			<main className="min-h-[calc(100vh)] pt-16">
				<Outlet />
			</main>
			<Footer />
		</div>
	);
}
