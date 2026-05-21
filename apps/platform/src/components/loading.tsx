import { Layout } from "@kayle-id/ui/components/layout";
import { Logo } from "@kayle-id/ui/components/logo";

function LoadingContent() {
	return (
		<div className="flex h-full w-full flex-1 flex-col items-center justify-center gap-6">
			<Logo className="text-foreground" title="Kayle ID" variant="default" />

			<div className="relative">
				<div className="size-12 rounded-full border-2 border-border" />
				<div className="absolute inset-0 size-12 animate-spin rounded-full border-2 border-t-foreground border-r-foreground" />
				<div className="absolute inset-0 flex items-center justify-center">
					<div className="size-2 rounded-full bg-foreground" />
				</div>
			</div>
		</div>
	);
}

export function Loading({ fullscreen = false }: { fullscreen?: boolean }) {
	if (fullscreen) {
		return (
			<Layout>
				<LoadingContent />
			</Layout>
		);
	}

	return <LoadingContent />;
}
