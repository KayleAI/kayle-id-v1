import { createFileRoute } from "@tanstack/react-router";
import { LivenessOnlyTester } from "@/biometric/LivenessOnlyTester";

function LivenessPage() {
	return (
		<>
			<header className="space-y-1">
				<h2 className="text-xl font-semibold">Liveness only</h2>
				<p className="text-sm text-zinc-400">
					Liveness video → movement coverage + PAD (face match skipped).
				</p>
			</header>
			<LivenessOnlyTester />
		</>
	);
}

export const Route = createFileRoute("/biometric/liveness")({
	component: LivenessPage,
});
