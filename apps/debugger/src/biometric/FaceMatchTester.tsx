import type {
	FaceMatchDg2Response,
	FaceMatchSelfieResponse,
	LivenessDebugBbox,
	LivenessDebugLandmarks,
} from "@kayle-id/config/biometric-verifier";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { type FaceMatchOutcome, verifyFaceMatch } from "./api";
import { bytesToKb, formatScore } from "./debug-ui";
import {
	type Dg2WrapImageFormat,
	detectImageFormat,
	wrapImageAsDg2,
} from "./dg2";
import { extractFramesFromVideoBlob } from "./extractFramesFromVideoBlob";
import { type RecordedClip, WebcamRecorder } from "./WebcamRecorder";

type Dg2Mode = "raw" | "wrap";
type SelfieSource = "clip" | "file";
type SelfieEntry = {
	id: string;
	blob: Blob;
	source: SelfieSource;
	sourceLabel: string;
};

type RunState =
	| { status: "idle" }
	| { status: "running" }
	| { status: "done"; outcome: FaceMatchOutcome; durationMs: number };

function ImageWithOverlay({
	src,
	imageWidth,
	imageHeight,
	bbox,
	landmarks,
	caption,
	badge,
	badgeTone,
}: {
	src: string;
	imageWidth: number;
	imageHeight: number;
	bbox: LivenessDebugBbox | null;
	landmarks: LivenessDebugLandmarks | null;
	caption?: string;
	badge?: string;
	badgeTone?: "pass" | "fail" | "neutral";
}) {
	const aspect = imageWidth > 0 ? imageWidth / Math.max(imageHeight, 1) : 1;
	return (
		<div className="space-y-1">
			<div
				className="relative overflow-hidden rounded border border-zinc-800 bg-black"
				style={{ aspectRatio: aspect, width: "100%", maxWidth: 320 }}
			>
				<img
					src={src}
					alt={caption ?? ""}
					className="block h-full w-full object-contain"
				/>
				{bbox && imageWidth > 0 && imageHeight > 0 ? (
					<svg
						className="pointer-events-none absolute inset-0 h-full w-full"
						viewBox={`0 0 ${imageWidth} ${imageHeight}`}
						preserveAspectRatio="xMidYMid meet"
					>
						<title>face overlay</title>
						<rect
							x={bbox.x}
							y={bbox.y}
							width={bbox.w}
							height={bbox.h}
							fill="none"
							stroke="#fbbf24"
							strokeWidth={Math.max(2, imageHeight * 0.005)}
						/>
						{landmarks
							? [
									landmarks.rightEye,
									landmarks.leftEye,
									landmarks.nose,
									landmarks.rightMouth,
									landmarks.leftMouth,
								].map(([x, y], index) => (
									<circle
										// biome-ignore lint/suspicious/noArrayIndexKey: fixed 5-point order
										key={index}
										cx={x}
										cy={y}
										r={Math.max(3, imageHeight * 0.008)}
										fill="#fde68a"
									/>
								))
							: null}
					</svg>
				) : null}
				{badge ? (
					<div
						className={`absolute right-1 top-1 rounded px-2 py-0.5 text-xs font-semibold ${
							badgeTone === "pass"
								? "bg-emerald-600/80 text-white"
								: badgeTone === "fail"
									? "bg-rose-700/80 text-white"
									: "bg-zinc-700/80 text-zinc-100"
						}`}
					>
						{badge}
					</div>
				) : null}
			</div>
			{caption ? <div className="text-xs text-zinc-500">{caption}</div> : null}
		</div>
	);
}

function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function FaceMatchTester() {
	const [dg2File, setDg2File] = useState<File | null>(null);
	const [dg2Mode, setDg2Mode] = useState<Dg2Mode>("wrap");
	const [recordedClip, setRecordedClip] = useState<RecordedClip | null>(null);
	const [extractFrameCount, setExtractFrameCount] = useState<number>(6);
	const [extractedSelfies, setExtractedSelfies] = useState<SelfieEntry[]>([]);
	const [extractingFrames, setExtractingFrames] = useState<boolean>(false);
	const [extractError, setExtractError] = useState<string | null>(null);
	const [uploadedSelfies, setUploadedSelfies] = useState<SelfieEntry[]>([]);
	const [threshold, setThreshold] = useState<string>("0.7");
	const [run, setRun] = useState<RunState>({ status: "idle" });
	const [validationError, setValidationError] = useState<string | null>(null);
	const [selfiePreviewUrls, setSelfiePreviewUrls] = useState<
		Record<string, string>
	>({});

	const selfies = useMemo(
		() => [...extractedSelfies, ...uploadedSelfies],
		[extractedSelfies, uploadedSelfies],
	);

	useEffect(() => {
		const urls: Record<string, string> = {};
		for (const entry of selfies) {
			urls[entry.id] = URL.createObjectURL(entry.blob);
		}
		setSelfiePreviewUrls(urls);
		return () => {
			for (const url of Object.values(urls)) {
				URL.revokeObjectURL(url);
			}
		};
	}, [selfies]);

	// Re-extract frames whenever the clip or the requested count changes.
	// The extracted list completely replaces any previous extraction —
	// uploaded files are kept untouched in their own list.
	useEffect(() => {
		if (!recordedClip || extractFrameCount <= 0) {
			setExtractedSelfies([]);
			setExtractError(null);
			return;
		}
		let cancelled = false;
		setExtractingFrames(true);
		setExtractError(null);
		extractFramesFromVideoBlob({
			blob: recordedClip.blob,
			frameCount: extractFrameCount,
		})
			.then((frames) => {
				if (cancelled) {
					return;
				}
				const entries: SelfieEntry[] = frames.map((blob, index) => ({
					id: generateId(),
					blob,
					source: "clip",
					sourceLabel: `clip frame ${index + 1}/${frames.length}`,
				}));
				setExtractedSelfies(entries);
			})
			.catch((caught: unknown) => {
				if (cancelled) {
					return;
				}
				setExtractError(
					caught instanceof Error ? caught.message : String(caught),
				);
				setExtractedSelfies([]);
			})
			.finally(() => {
				if (!cancelled) {
					setExtractingFrames(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [recordedClip, extractFrameCount]);

	const submitDisabled = useMemo(
		() =>
			!(dg2File && selfies.length > 0) ||
			run.status === "running" ||
			extractingFrames,
		[dg2File, selfies.length, run.status, extractingFrames],
	);

	function addUploadedFiles(files: File[]) {
		setUploadedSelfies((prev) => [
			...prev,
			...files.map((file, index) => ({
				id: generateId(),
				blob: file,
				source: "file" as const,
				sourceLabel: `upload ${prev.length + index + 1}`,
			})),
		]);
	}

	function removeSelfie(id: string) {
		setUploadedSelfies((prev) => prev.filter((entry) => entry.id !== id));
		// Clip-extracted entries are derived state; the only way to remove them
		// is to re-record or change the frame count. Surface a hint instead.
		setExtractedSelfies((prev) => prev.filter((entry) => entry.id !== id));
	}

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setValidationError(null);

		if (!dg2File) {
			setValidationError("Pick a DG2 / face image.");
			return;
		}
		if (selfies.length === 0) {
			setValidationError("Record a clip or upload at least one selfie still.");
			return;
		}

		const dg2Buffer = new Uint8Array(await dg2File.arrayBuffer());
		let dg2Bytes: Uint8Array;
		if (dg2Mode === "raw") {
			dg2Bytes = dg2Buffer;
		} else {
			const format: Dg2WrapImageFormat | null = detectImageFormat(dg2Buffer);
			if (format === null) {
				setValidationError(
					"DG2 file isn't a JPEG/JP2 — switch to 'raw DG2' mode or pick a face image.",
				);
				return;
			}
			dg2Bytes = wrapImageAsDg2({
				imageBytes: dg2Buffer,
				imageFormat: format,
				wrapWithEfTag: true,
			});
		}

		const selfieBuffers: Uint8Array[] = [];
		for (const entry of selfies) {
			selfieBuffers.push(new Uint8Array(await entry.blob.arrayBuffer()));
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
		const outcome = await verifyFaceMatch({
			dg2Image: dg2Bytes,
			selfies: selfieBuffers,
			faceMatchThreshold: parsedThreshold,
			includeDebug: true,
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
						DG2 / passport face
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
						Selfie clip ({selfies.length} frame
						{selfies.length === 1 ? "" : "s"})
					</legend>
					<WebcamRecorder
						clip={recordedClip}
						onClipReady={(clip) => setRecordedClip(clip)}
						onClipCleared={() => setRecordedClip(null)}
					/>
					<div className="grid grid-cols-2 gap-3">
						<label className="flex flex-col gap-1 text-sm">
							<span className="text-xs uppercase tracking-wide text-zinc-400">
								Frames to extract from clip
							</span>
							<input
								type="number"
								min={1}
								max={16}
								value={extractFrameCount}
								onChange={(event) => {
									const next = Number.parseInt(event.target.value, 10);
									if (Number.isFinite(next)) {
										setExtractFrameCount(Math.max(1, Math.min(16, next)));
									}
								}}
								className="rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-zinc-100"
							/>
						</label>
						<div className="flex flex-col gap-1 text-sm">
							<span className="text-xs uppercase tracking-wide text-zinc-400">
								Or upload stills
							</span>
							<input
								type="file"
								accept="image/*"
								multiple
								onChange={(event) => {
									const files = Array.from(event.target.files ?? []);
									if (files.length > 0) {
										addUploadedFiles(files);
									}
									event.target.value = "";
								}}
								className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-200 hover:file:bg-zinc-700"
							/>
						</div>
					</div>

					{extractingFrames ? (
						<div className="text-xs text-zinc-500">
							Extracting {extractFrameCount} frame
							{extractFrameCount === 1 ? "" : "s"} from clip…
						</div>
					) : null}
					{extractError ? (
						<div className="rounded border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
							frame_extract_failed: {extractError}
						</div>
					) : null}

					{selfies.length > 0 ? (
						<div className="grid grid-cols-3 gap-2">
							{selfies.map((entry) => (
								<div
									key={entry.id}
									className="relative overflow-hidden rounded border border-zinc-800 bg-black"
								>
									{selfiePreviewUrls[entry.id] ? (
										<img
											src={selfiePreviewUrls[entry.id]}
											alt={entry.sourceLabel}
											className="block aspect-[9/16] w-full object-cover"
										/>
									) : null}
									<button
										type="button"
										onClick={() => removeSelfie(entry.id)}
										className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-zinc-200 hover:bg-black"
									>
										×
									</button>
									<div className="px-2 py-1 text-xs text-zinc-400">
										{entry.sourceLabel} · {bytesToKb(entry.blob.size)}
									</div>
								</div>
							))}
						</div>
					) : null}
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
					{run.status === "running" ? "Matching…" : "Match faces"}
				</button>
			</form>

			{run.status === "done" ? (
				run.outcome.kind === "ok" ? (
					<FaceMatchResultView
						response={run.outcome.response}
						durationMs={run.durationMs}
						selfiePreviewUrls={selfiePreviewUrls}
						selfieIds={selfies.map((entry) => entry.id)}
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

function strategyTone(passed: boolean | null): string {
	if (passed === true) {
		return "text-emerald-300";
	}
	if (passed === false) {
		return "text-rose-300";
	}
	return "text-zinc-500";
}

function strategyVerdictLabel(passed: boolean | null): string {
	if (passed === true) {
		return "PASS";
	}
	if (passed === false) {
		return "FAIL";
	}
	return "—";
}

function FaceMatchAlignmentRow({
	selfie,
	threshold,
}: {
	selfie: FaceMatchSelfieResponse;
	threshold: number;
}) {
	// Single AuraFace inference per selfie now: the alignment hint says
	// whether the mesh-aligned (preferred) path was used or whether we
	// fell back to YuNet's 5-pt alignment.
	const alignment = selfie.faceMatchAlignment;
	const label =
		alignment === "mesh"
			? "AuraFace · mesh align"
			: alignment === "yunet"
				? "AuraFace · YuNet 5-pt fallback"
				: "AuraFace · no match";
	return (
		<div className="rounded border border-zinc-800 bg-zinc-900/40 p-2 text-xs">
			<div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
				face-match
			</div>
			<table className="w-full font-mono">
				<thead>
					<tr className="text-left text-[10px] uppercase tracking-wide text-zinc-500">
						<th className="py-0.5 pr-2">alignment</th>
						<th className="py-0.5 pr-2 text-right">score</th>
						<th className="py-0.5 pr-2 text-right">thr</th>
						<th className="py-0.5 text-right">verdict</th>
					</tr>
				</thead>
				<tbody>
					<tr className="border-t border-zinc-800/60">
						<td className="py-0.5 pr-2 text-zinc-300">{label}</td>
						<td className="py-0.5 pr-2 text-right text-zinc-200">
							{formatScore(selfie.faceMatchScore)}
						</td>
						<td className="py-0.5 pr-2 text-right text-zinc-500">
							{threshold.toFixed(2)}
						</td>
						<td
							className={`py-0.5 text-right font-semibold ${strategyTone(selfie.faceMatchPassed)}`}
						>
							{strategyVerdictLabel(selfie.faceMatchPassed)}
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	);
}

function FaceMatchResultView({
	response,
	durationMs,
	selfiePreviewUrls,
	selfieIds,
}: {
	response: {
		threshold: number;
		dg2: FaceMatchDg2Response;
		selfies: FaceMatchSelfieResponse[];
	};
	durationMs: number;
	selfiePreviewUrls: Record<string, string>;
	selfieIds: string[];
}) {
	const dg2DataUri = `data:image/${response.dg2.imageFormat === "jpeg2000" ? "jp2" : "jpeg"};base64,${response.dg2.imageBytesBase64}`;
	const passCount = response.selfies.filter(
		(selfie) => selfie.faceMatchPassed,
	).length;
	return (
		<section className="space-y-4">
			<header className="flex items-center justify-between">
				<div>
					<div className="text-xs uppercase tracking-wide text-zinc-500">
						face match result
					</div>
					<div className="text-2xl font-semibold">
						{passCount} / {response.selfies.length}{" "}
						<span className="text-sm text-zinc-400">
							passed at threshold {response.threshold.toFixed(2)}
						</span>
					</div>
				</div>
				<div className="text-xs text-zinc-500">round-trip {durationMs}ms</div>
			</header>

			<div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
				<div className="mb-3 text-xs uppercase tracking-wide text-zinc-400">
					DG2 reference
				</div>
				<div className="flex flex-wrap gap-4">
					<ImageWithOverlay
						src={dg2DataUri}
						imageWidth={response.dg2.imageWidth}
						imageHeight={response.dg2.imageHeight}
						bbox={response.dg2.bbox}
						landmarks={response.dg2.landmarks}
						caption={`${response.dg2.imageWidth}×${response.dg2.imageHeight} · ${response.dg2.imageFormat} · ${response.dg2.faceDetected ? "face detected" : "no face detected"}`}
					/>
				</div>
			</div>

			<div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
				<div className="mb-3 text-xs uppercase tracking-wide text-zinc-400">
					selfies vs DG2
				</div>
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
					{response.selfies.map((selfie) => {
						const sourceId = selfieIds[selfie.index];
						const previewUrl = sourceId
							? selfiePreviewUrls[sourceId]
							: undefined;
						const scoreText = formatScore(selfie.faceMatchScore);
						const tone: "pass" | "fail" = selfie.faceMatchPassed
							? "pass"
							: "fail";
						return (
							<div key={selfie.index} className="space-y-2">
								{previewUrl ? (
									<ImageWithOverlay
										src={previewUrl}
										imageWidth={selfie.imageWidth}
										imageHeight={selfie.imageHeight}
										bbox={selfie.bbox}
										landmarks={selfie.landmarks}
										caption={`#${selfie.index} · ${selfie.imageWidth}×${selfie.imageHeight}`}
										badge={`${selfie.faceMatchPassed ? "PASS" : "FAIL"} · ${scoreText}`}
										badgeTone={tone}
									/>
								) : null}
								<FaceMatchAlignmentRow
									selfie={selfie}
									threshold={response.threshold}
								/>
								<div className="text-xs text-zinc-500">
									{selfie.reason ? (
										<span className="font-mono">{selfie.reason}</span>
									) : (
										<span className="text-emerald-300">match passed</span>
									)}
									{selfie.usedFallback ? (
										<span className="ml-2 text-amber-400">used fallback</span>
									) : null}
								</div>
							</div>
						);
					})}
				</div>
			</div>

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
