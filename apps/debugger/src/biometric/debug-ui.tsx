import type { LivenessDebugTimelineEntry } from "@kayle-id/config/biometric-verifier";

export function bytesToKb(byteLength: number): string {
	return `${(byteLength / 1024).toFixed(1)} KB`;
}

export function formatScore(score: number | null | undefined): string {
	if (score === null || score === undefined) {
		return "—";
	}
	return score.toFixed(3);
}

export function formatYaw(yaw: number | null): string {
	if (yaw === null) {
		return "—";
	}
	const sign = yaw >= 0 ? "+" : "";
	return `${sign}${yaw.toFixed(1)}°`;
}

export type GateState = "pass" | "fail" | "skipped";

export function GateBadge({
	label,
	state,
	score,
	threshold,
}: {
	label: string;
	state: GateState;
	score: number | null | undefined;
	threshold?: number;
}) {
	const tone =
		state === "pass"
			? "border-emerald-700 bg-emerald-950/40"
			: state === "fail"
				? "border-rose-800 bg-rose-950/40"
				: "border-zinc-700 bg-zinc-900/40";
	const labelTone =
		state === "pass"
			? "text-emerald-400"
			: state === "fail"
				? "text-rose-400"
				: "text-zinc-400";
	const labelText =
		state === "pass" ? "PASS" : state === "fail" ? "FAIL" : "SKIPPED";
	return (
		<div className={`rounded-lg border p-3 ${tone}`}>
			<div className="flex items-center justify-between">
				<span className="text-xs uppercase tracking-wide text-zinc-400">
					{label}
				</span>
				<span className={`text-xs font-semibold ${labelTone}`}>
					{labelText}
				</span>
			</div>
			<div className="mt-1 font-mono text-lg">
				{state === "skipped" ? "—" : formatScore(score)}
			</div>
			{threshold !== undefined && state !== "skipped" ? (
				<div className="text-xs text-zinc-500">
					threshold {threshold.toFixed(2)}
				</div>
			) : null}
		</div>
	);
}

export function TimelineTable({
	timeline,
	centerFrameIndex,
}: {
	timeline: LivenessDebugTimelineEntry[];
	centerFrameIndex: number | null;
}) {
	return (
		<table className="w-full font-mono text-sm">
			<thead>
				<tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
					<th className="py-1 pr-3">#</th>
					<th className="py-1 pr-3">face</th>
					<th className="py-1 pr-3">pose</th>
					<th className="py-1 pr-3">yaw</th>
					<th className="py-1 pr-3">PAD</th>
				</tr>
			</thead>
			<tbody>
				{timeline.map((entry) => {
					const isCenter = entry.frameIndex === centerFrameIndex;
					return (
						<tr
							key={entry.frameIndex}
							className={
								isCenter ? "bg-amber-950/40" : "border-t border-zinc-800/60"
							}
						>
							<td className="py-1 pr-3 text-zinc-400">
								{entry.frameIndex}
								{isCenter ? " ←" : ""}
							</td>
							<td className="py-1 pr-3">{entry.faceDetected ? "✓" : "·"}</td>
							<td
								className={`py-1 pr-3 ${
									entry.pose === "center"
										? "text-amber-300"
										: entry.pose === "left"
											? "text-sky-300"
											: entry.pose === "right"
												? "text-fuchsia-300"
												: "text-zinc-500"
								}`}
							>
								{entry.pose}
							</td>
							<td className="py-1 pr-3 text-zinc-300">
								{formatYaw(entry.yawDeg)}
							</td>
							<td className="py-1 pr-3 text-zinc-300">
								{formatScore(entry.padScore)}
							</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}
