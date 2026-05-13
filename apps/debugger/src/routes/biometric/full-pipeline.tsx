import { createFileRoute } from "@tanstack/react-router";
import { FullPipelineTester } from "@/biometric/FullPipelineTester";

function FullPipelinePage() {
	return (
		<>
			<header className="space-y-1">
				<h2 className="text-xl font-semibold">Full pipeline</h2>
				<p className="text-sm text-zinc-400">
					DG2 + liveness video → liveness + face match + PAD.
				</p>
			</header>
			<FullPipelineTester />
		</>
	);
}

export const Route = createFileRoute("/biometric/full-pipeline")({
	component: FullPipelinePage,
});
