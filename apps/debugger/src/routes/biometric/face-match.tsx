import { createFileRoute } from "@tanstack/react-router";
import { FaceMatchTester } from "@/biometric/FaceMatchTester";

function FaceMatchPage() {
	return (
		<>
			<header className="space-y-1">
				<h2 className="text-xl font-semibold">Face match only</h2>
				<p className="text-sm text-zinc-400">
					DG2 + N selfie stills → AuraFace embedding match per still.
				</p>
			</header>
			<FaceMatchTester />
		</>
	);
}

export const Route = createFileRoute("/biometric/face-match")({
	component: FaceMatchPage,
});
