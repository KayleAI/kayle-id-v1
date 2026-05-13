import type { BiometricVerifierResponsePayload } from "@kayle-id/config/biometric-verifier";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { type VerifyOutcome, verifyLiveness } from "./api";
import {
	bytesToKb,
	GateBadge,
	type GateState,
	TimelineTable,
} from "./debug-ui";
import {
	type Dg2WrapImageFormat,
	detectImageFormat,
	wrapImageAsDg2,
} from "./dg2";
import { VideoOverlay } from "./VideoOverlay";
import { type RecordedClip, WebcamRecorder } from "./WebcamRecorder";

type Dg2Mode = "raw" | "wrap";
type VideoSource = "file" | "webcam";

type RunState =
	| { status: "idle" }
	| { status: "running" }
	| {
			status: "done";
			outcome: VerifyOutcome;
			durationMs: number;
	  };

function strategyTone(passed: boolean | null | undefined): string {
	if (passed === true) {
		return "text-emerald-300";
	}
	if (passed === false) {
		return "text-rose-300";
	}
	return "text-zinc-500";
}

function strategyVerdictLabel(passed: boolean | null | undefined): string {
	if (passed === true) {
		return "PASS";
	}
	if (passed === false) {
		return "FAIL";
	}
	return "—";
}

function formatScoreOrDash(value: number | null | undefined): string {
	return typeof value === "number" ? value.toFixed(3) : "—";
}

function FaceMatchAlignmentRow({
	response,
}: {
	response: BiometricVerifierResponsePayload;
}) {
	// Single-row breakdown: AuraFace ran once on the input crop produced
	// by whichever alignment was available. "mesh" = the preferred path
	// (478-pt mesh on both sides), "yunet" = fallback when either side's
	// mesh failed.
	const alignment = response.faceMatchAlignment;
	const label =
		alignment === "mesh"
			? "AuraFace · mesh align"
			: alignment === "yunet"
				? "AuraFace · YuNet 5-pt fallback"
				: "AuraFace · no match";
	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs">
			<div className="mb-2 text-[10px] uppercase tracking-wide text-zinc-400">
				Face-match
			</div>
			<table className="w-full font-mono">
				<thead>
					<tr className="text-left text-[10px] uppercase tracking-wide text-zinc-500">
						<th className="py-0.5 pr-2">alignment</th>
						<th className="py-0.5 pr-2 text-right">score</th>
						<th className="py-0.5 text-right">verdict</th>
					</tr>
				</thead>
				<tbody>
					<tr className="border-t border-zinc-800/60">
						<td className="py-0.5 pr-2 text-zinc-300">{label}</td>
						<td className="py-0.5 pr-2 text-right text-zinc-200">
							{formatScoreOrDash(response.faceMatchScore)}
						</td>
						<td
							className={`py-0.5 text-right font-semibold ${strategyTone(response.faceMatchPassed)}`}
						>
							{strategyVerdictLabel(response.faceMatchPassed)}
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	);
}

function ResponseView({
	response,
	durationMs,
	videoUrl,
}: {
	response: BiometricVerifierResponsePayload;
	durationMs: number;
	videoUrl: string | null;
}) {
	const faceMatchState: GateState = response.faceMatchPassed ? "pass" : "fail";
	const livenessState: GateState = response.livenessPassed ? "pass" : "fail";
	const padState: GateState = response.padPassed ? "pass" : "fail";
	const verdictPass =
		livenessState === "pass" &&
		padState === "pass" &&
		faceMatchState === "pass";
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
					</div>
				</div>
				<div className="text-right text-xs text-zinc-500">
					<div>round-trip {durationMs}ms</div>
					{response.usedFallback ? (
						<div className="text-amber-400">used fallback</div>
					) : null}
					{response.reason ? (
						<div className="font-mono text-zinc-300">{response.reason}</div>
					) : null}
				</div>
			</header>

			<div className="grid grid-cols-3 gap-3">
				<GateBadge
					label="Liveness"
					state={livenessState}
					score={response.livenessScore}
				/>
				<GateBadge
					label="Face match"
					state={faceMatchState}
					score={response.faceMatchScore}
				/>
				<GateBadge label="PAD" state={padState} score={response.padScore} />
			</div>

			<FaceMatchAlignmentRow response={response} />

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

function ErrorView({
	outcome,
}: {
	outcome: Extract<VerifyOutcome, { kind: "error" }>;
}) {
	return (
		<section className="space-y-3 rounded-lg border border-rose-800 bg-rose-950/40 p-4">
			<div className="text-xs uppercase tracking-wide text-rose-400">
				request failed
			</div>
			<div className="font-mono text-sm text-rose-200">{outcome.message}</div>
			{outcome.status !== null ? (
				<div className="text-xs text-rose-300">HTTP {outcome.status}</div>
			) : null}
			{outcome.raw ? (
				<details>
					<summary className="cursor-pointer text-xs uppercase tracking-wide text-rose-400">
						raw body
					</summary>
					<pre className="mt-2 overflow-x-auto text-xs text-rose-200">
						{outcome.raw}
					</pre>
				</details>
			) : null}
		</section>
	);
}

export function FullPipelineTester() {
	const [dg2File, setDg2File] = useState<File | null>(null);
	const [dg2Mode, setDg2Mode] = useState<Dg2Mode>("wrap");
	const [videoSource, setVideoSource] = useState<VideoSource>("webcam");
	const [videoFile, setVideoFile] = useState<File | null>(null);
	const [recordedClip, setRecordedClip] = useState<RecordedClip | null>(null);
	const [threshold, setThreshold] = useState<string>("0.7");
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
	const haveDg2 = dg2File !== null;

	const submitDisabled = useMemo(
		() => !(haveDg2 && haveVideo) || run.status === "running",
		[haveDg2, haveVideo, run.status],
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

	async function resolveDg2Bytes(): Promise<Uint8Array | null> {
		if (!dg2File) {
			return null;
		}
		const buffer = new Uint8Array(await dg2File.arrayBuffer());
		if (dg2Mode === "raw") {
			return buffer;
		}
		const format: Dg2WrapImageFormat | null = detectImageFormat(buffer);
		if (format === null) {
			setValidationError(
				"Selected file isn't a JPEG or JPEG 2000 — switch to 'raw DG2' mode or pick a face image.",
			);
			return null;
		}
		return wrapImageAsDg2({
			imageBytes: buffer,
			imageFormat: format,
			wrapWithEfTag: true,
		});
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

		const dg2Bytes = await resolveDg2Bytes();
		if (!dg2Bytes) {
			if (!validationError) {
				setValidationError("Pick a DG2 / face image.");
			}
			return;
		}

		let parsedThreshold: number | undefined;
		const trimmedThreshold = threshold.trim();
		if (trimmedThreshold.length > 0) {
			const value = Number(trimmedThreshold);
			if (!Number.isFinite(value) || value < 0 || value > 1) {
				setValidationError("Threshold must be a number in [0, 1].");
				return;
			}
			parsedThreshold = value;
		}

		setRun({ status: "running" });
		const startedAt = performance.now();
		const outcome = await verifyLiveness({
			dg2Image: dg2Bytes,
			video: videoBuffer,
			faceMatchThreshold: parsedThreshold,
			includeDebug: true,
			skipFaceMatch: false,
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
						DG2 / face image
					</legend>
					<div className="flex gap-3 text-sm">
						<label className="flex items-center gap-2">
							<input
								type="radio"
								name="dg2Mode"
								value="wrap"
								checked={dg2Mode === "wrap"}
								onChange={() => setDg2Mode("wrap")}
							/>
							Wrap JPEG/JP2 as DG2
						</label>
						<label className="flex items-center gap-2">
							<input
								type="radio"
								name="dg2Mode"
								value="raw"
								checked={dg2Mode === "raw"}
								onChange={() => setDg2Mode("raw")}
							/>
							Raw DG2 binary
						</label>
					</div>
					<input
						type="file"
						accept={
							dg2Mode === "wrap" ? "image/jpeg,image/jp2,.jp2,.j2k" : undefined
						}
						onChange={(event) => setDg2File(event.target.files?.[0] ?? null)}
						className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-200 hover:file:bg-zinc-700"
					/>
					{dg2File ? (
						<div className="text-xs text-zinc-500">
							{dg2File.name} · {bytesToKb(dg2File.size)}
						</div>
					) : null}
				</fieldset>

				<fieldset className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
					<legend className="px-2 text-xs uppercase tracking-wide text-zinc-400">
						Liveness video
					</legend>
					<div className="flex gap-3 text-sm">
						<label className="flex items-center gap-2">
							<input
								type="radio"
								name="videoSource"
								value="webcam"
								checked={videoSource === "webcam"}
								onChange={() => setVideoSource("webcam")}
							/>
							Record from webcam
						</label>
						<label className="flex items-center gap-2">
							<input
								type="radio"
								name="videoSource"
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

				<label className="flex flex-col gap-1 text-sm">
					<span className="text-xs uppercase tracking-wide text-zinc-400">
						Face match threshold
					</span>
					<input
						type="text"
						inputMode="decimal"
						value={threshold}
						onChange={(event) => setThreshold(event.target.value)}
						placeholder="0.7"
						className="rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-zinc-100"
					/>
				</label>

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
					{run.status === "running" ? "Verifying…" : "Verify"}
				</button>
			</form>

			{run.status === "done" ? (
				run.outcome.kind === "ok" ? (
					<ResponseView
						response={run.outcome.response}
						durationMs={run.durationMs}
						videoUrl={videoUrl}
					/>
				) : (
					<ErrorView outcome={run.outcome} />
				)
			) : null}
		</div>
	);
}
