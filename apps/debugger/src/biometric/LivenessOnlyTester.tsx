import type { BiometricVerifierResponsePayload } from "@kayle-id/config/biometric-verifier";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { type VerifyOutcome, verifyLiveness } from "./api";
import {
	bytesToKb,
	GateBadge,
	type GateState,
	TimelineTable,
} from "./debug-ui";
import { createPlaceholderDg2 } from "./placeholderDg2";
import { VideoOverlay } from "./VideoOverlay";
import { type RecordedClip, WebcamRecorder } from "./WebcamRecorder";

type VideoSource = "file" | "webcam";

type RunState =
	| { status: "idle" }
	| { status: "running" }
	| { status: "done"; outcome: VerifyOutcome; durationMs: number };

function LivenessOnlyResponseView({
	response,
	durationMs,
	videoUrl,
}: {
	response: BiometricVerifierResponsePayload;
	durationMs: number;
	videoUrl: string | null;
}) {
	const livenessState: GateState = response.livenessPassed ? "pass" : "fail";
	const padState: GateState = response.padPassed ? "pass" : "fail";
	const verdictPass = livenessState === "pass" && padState === "pass";
	const debug = response.debug ?? null;

	return (
		<section className="space-y-4">
			<header className="flex items-center justify-between">
				<div>
					<div className="text-xs uppercase tracking-wide text-zinc-500">
						verdict
					</div>
					<div
						className={`text-2xl font-semibold ${
							verdictPass ? "text-emerald-400" : "text-rose-400"
						}`}
					>
						{verdictPass ? "PASS" : "FAIL"}
						<span className="ml-2 text-xs uppercase tracking-wide text-zinc-400">
							(liveness + PAD only)
						</span>
					</div>
				</div>
				<div className="text-right text-xs text-zinc-500">
					<div>round-trip {durationMs}ms</div>
					{response.reason ? (
						<div className="font-mono text-zinc-300">{response.reason}</div>
					) : null}
				</div>
			</header>

			<div className="grid grid-cols-2 gap-3">
				<GateBadge
					label="Liveness"
					state={livenessState}
					score={response.livenessScore}
				/>
				<GateBadge label="PAD" state={padState} score={response.padScore} />
			</div>

			{debug ? (
				<div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
					{videoUrl && debug.timeline.length > 0 ? (
						<VideoOverlay videoUrl={videoUrl} debug={debug} />
					) : null}
					<div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
						<div className="text-zinc-400">frames extracted</div>
						<div className="font-mono">{debug.frameCount}</div>
						<div className="text-zinc-400">duration (s)</div>
						<div className="font-mono">
							{debug.durationSeconds !== null
								? debug.durationSeconds.toFixed(3)
								: "—"}
						</div>
						<div className="text-zinc-400">frame size (px)</div>
						<div className="font-mono">
							{debug.frameWidth} × {debug.frameHeight}
						</div>
						<div className="text-zinc-400">center frame</div>
						<div className="font-mono">
							{debug.centerFrameIndex !== null ? debug.centerFrameIndex : "—"}
						</div>
						<div className="text-zinc-400">PAD enabled / loaded</div>
						<div className="font-mono">
							{debug.padDisabled ? "no" : "yes"} /{" "}
							{debug.padLoaded ? "yes" : "no"}
						</div>
						<div className="text-zinc-400">PAD scored / passing</div>
						<div className="font-mono">
							{debug.padScoredFrames} / {debug.padPassingFrames}
						</div>
					</div>
					{debug.timeline.length > 0 ? (
						<TimelineTable
							timeline={debug.timeline}
							centerFrameIndex={debug.centerFrameIndex}
						/>
					) : (
						<div className="text-sm text-zinc-500">
							No timeline (pipeline exited before frames were classified).
						</div>
					)}
				</div>
			) : null}

			<details className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
				<summary className="cursor-pointer text-xs uppercase tracking-wide text-zinc-400">
					raw response
				</summary>
				<pre className="mt-3 overflow-x-auto text-xs leading-relaxed text-zinc-300">
					{JSON.stringify(response, null, 2)}
				</pre>
			</details>
		</section>
	);
}

export function LivenessOnlyTester() {
	const [videoSource, setVideoSource] = useState<VideoSource>("webcam");
	const [videoFile, setVideoFile] = useState<File | null>(null);
	const [recordedClip, setRecordedClip] = useState<RecordedClip | null>(null);
	const [run, setRun] = useState<RunState>({ status: "idle" });
	const [validationError, setValidationError] = useState<string | null>(null);

	const activeVideoBlob: Blob | null = useMemo(() => {
		if (videoSource === "file") {
			return videoFile;
		}
		return recordedClip?.blob ?? null;
	}, [videoSource, videoFile, recordedClip]);

	const [videoUrl, setVideoUrl] = useState<string | null>(null);

	useEffect(() => {
		if (!activeVideoBlob) {
			setVideoUrl(null);
			return;
		}
		const url = URL.createObjectURL(activeVideoBlob);
		setVideoUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [activeVideoBlob]);

	const haveVideo =
		videoSource === "file" ? videoFile !== null : recordedClip !== null;
	const submitDisabled = useMemo(
		() => !haveVideo || run.status === "running",
		[haveVideo, run.status],
	);

	async function resolveVideoBytes(): Promise<Uint8Array | null> {
		if (videoSource === "file") {
			if (!videoFile) {
				return null;
			}
			return new Uint8Array(await videoFile.arrayBuffer());
		}
		if (!recordedClip) {
			return null;
		}
		return new Uint8Array(await recordedClip.blob.arrayBuffer());
	}

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setValidationError(null);

		const videoBuffer = await resolveVideoBytes();
		if (!videoBuffer) {
			setValidationError(
				videoSource === "file"
					? "Pick a liveness video file."
					: "Record a webcam clip first.",
			);
			return;
		}

		const dg2Bytes = await createPlaceholderDg2();

		setRun({ status: "running" });
		const startedAt = performance.now();
		const outcome = await verifyLiveness({
			dg2Image: dg2Bytes,
			video: videoBuffer,
			includeDebug: true,
			skipFaceMatch: true,
		});
		setRun({
			status: "done",
			outcome,
			durationMs: Math.round(performance.now() - startedAt),
		});
	}

	return (
		<div className="space-y-6">
			<form onSubmit={handleSubmit} className="space-y-6">
				<fieldset className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
					<legend className="px-2 text-xs uppercase tracking-wide text-zinc-400">
						Liveness video
					</legend>
					<div className="flex gap-3 text-sm">
						<label className="flex items-center gap-2">
							<input
								type="radio"
								name="livenessOnlyVideoSource"
								value="webcam"
								checked={videoSource === "webcam"}
								onChange={() => setVideoSource("webcam")}
							/>
							Record from webcam
						</label>
						<label className="flex items-center gap-2">
							<input
								type="radio"
								name="livenessOnlyVideoSource"
								value="file"
								checked={videoSource === "file"}
								onChange={() => setVideoSource("file")}
							/>
							Upload file
						</label>
					</div>
					{videoSource === "webcam" ? (
						<WebcamRecorder
							clip={recordedClip}
							onClipReady={(clip) => setRecordedClip(clip)}
							onClipCleared={() => setRecordedClip(null)}
						/>
					) : (
						<>
							<input
								type="file"
								accept="video/*"
								onChange={(event) =>
									setVideoFile(event.target.files?.[0] ?? null)
								}
								className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-200 hover:file:bg-zinc-700"
							/>
							{videoFile ? (
								<div className="text-xs text-zinc-500">
									{videoFile.name} · {bytesToKb(videoFile.size)}
								</div>
							) : null}
						</>
					)}
				</fieldset>

				{validationError ? (
					<div className="rounded border border-amber-700 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
						{validationError}
					</div>
				) : null}

				<button
					type="submit"
					disabled={submitDisabled}
					className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-700"
				>
					{run.status === "running" ? "Running…" : "Run liveness pipeline"}
				</button>
			</form>

			{run.status === "done" ? (
				run.outcome.kind === "ok" ? (
					<LivenessOnlyResponseView
						response={run.outcome.response}
						durationMs={run.durationMs}
						videoUrl={videoUrl}
					/>
				) : (
					<section className="space-y-3 rounded-lg border border-rose-800 bg-rose-950/40 p-4">
						<div className="text-xs uppercase tracking-wide text-rose-400">
							request failed
						</div>
						<div className="font-mono text-sm text-rose-200">
							{run.outcome.message}
						</div>
						{run.outcome.status !== null ? (
							<div className="text-xs text-rose-300">
								HTTP {run.outcome.status}
							</div>
						) : null}
					</section>
				)
			) : null}
		</div>
	);
}
