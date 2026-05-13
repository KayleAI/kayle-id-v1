import type {
	LivenessDebugPayload,
	LivenessDebugTimelineEntry,
} from "@kayle-id/config/biometric-verifier";
import { useEffect, useMemo, useRef, useState } from "react";
import { MediaPipeMeshLayer } from "./MediaPipeMeshLayer";

// Container samples frames at evenly spaced timestamps:
//   t_i = duration * (i + 0.5) / frameCount
// This mirrors extract_frames_with_ffmpeg's `fps=frameCount/duration` filter
// — i.e. one frame per equal interval, centred in that interval.
function frameTimestampSeconds(
	frameIndex: number,
	frameCount: number,
	durationSeconds: number,
): number {
	if (frameCount <= 0) {
		return 0;
	}
	return (durationSeconds * (frameIndex + 0.5)) / frameCount;
}

function pickNearestEntry(
	timeline: LivenessDebugTimelineEntry[],
	frameCount: number,
	durationSeconds: number,
	currentTime: number,
): LivenessDebugTimelineEntry | null {
	if (timeline.length === 0 || durationSeconds <= 0) {
		return null;
	}
	let bestEntry: LivenessDebugTimelineEntry | null = null;
	let bestDelta = Number.POSITIVE_INFINITY;
	for (const entry of timeline) {
		const t = frameTimestampSeconds(
			entry.frameIndex,
			frameCount,
			durationSeconds,
		);
		const delta = Math.abs(t - currentTime);
		if (delta < bestDelta) {
			bestDelta = delta;
			bestEntry = entry;
		}
	}
	return bestEntry;
}

function drawOverlay({
	ctx,
	entry,
	frameWidth,
	frameHeight,
}: {
	ctx: CanvasRenderingContext2D;
	entry: LivenessDebugTimelineEntry | null;
	frameWidth: number;
	frameHeight: number;
}) {
	ctx.clearRect(0, 0, frameWidth, frameHeight);
	if (!entry) {
		return;
	}

	// Frame-level label sits in the top-left regardless of detection.
	ctx.font = `${Math.max(14, Math.round(frameHeight * 0.03))}px ui-monospace, monospace`;
	ctx.textBaseline = "top";
	const formatAngle = (value: number | null | undefined): string =>
		typeof value === "number" ? `${value.toFixed(1)}°` : "—";
	const yawLabel = formatAngle(entry.yawDeg);
	const pitchLabel = formatAngle(entry.pitchDeg);
	const rollLabel = formatAngle(entry.rollDeg);
	const headerText = `#${entry.frameIndex} · ${entry.pose} · yaw ${yawLabel} · pitch ${pitchLabel} · roll ${rollLabel}`;
	ctx.fillStyle = "rgba(0,0,0,0.6)";
	const headerPadding = 6;
	const headerWidth = ctx.measureText(headerText).width + headerPadding * 2;
	const headerHeight = Math.round(frameHeight * 0.045);
	ctx.fillRect(8, 8, headerWidth, headerHeight);
	ctx.fillStyle = "#fde68a";
	ctx.fillText(headerText, 8 + headerPadding, 8 + headerPadding / 2);

	if (!(entry.faceDetected && entry.bbox && entry.landmarks)) {
		return;
	}

	const { bbox, landmarks } = entry;

	const strokeWidth = Math.max(2, Math.round(frameHeight * 0.005));

	// Bbox.
	ctx.lineWidth = strokeWidth;
	ctx.strokeStyle =
		entry.pose === "center"
			? "#fbbf24"
			: entry.pose === "left"
				? "#38bdf8"
				: entry.pose === "right"
					? "#e879f9"
					: "#a3a3a3";
	ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);

	// Eye midline + nose offset — the actual signal `estimate_yaw_deg` uses.
	const [reX, reY] = landmarks.rightEye;
	const [leX, leY] = landmarks.leftEye;
	const [noseX, noseY] = landmarks.nose;
	const midX = (reX + leX) / 2;
	const midY = (reY + leY) / 2;

	ctx.strokeStyle = "rgba(253, 224, 71, 0.7)";
	ctx.lineWidth = Math.max(1, Math.round(strokeWidth * 0.6));
	ctx.beginPath();
	ctx.moveTo(reX, reY);
	ctx.lineTo(leX, leY);
	ctx.stroke();

	// Nose-offset vector from the eye midline.
	ctx.strokeStyle = "#fbbf24";
	ctx.lineWidth = strokeWidth;
	ctx.beginPath();
	ctx.moveTo(midX, midY);
	ctx.lineTo(noseX, noseY);
	ctx.stroke();

	// Five landmark dots.
	const dotRadius = Math.max(3, Math.round(frameHeight * 0.008));
	const points: Array<[number, number, string]> = [
		[reX, reY, "#fbbf24"],
		[leX, leY, "#fbbf24"],
		[noseX, noseY, "#fde68a"],
		[landmarks.rightMouth[0], landmarks.rightMouth[1], "#fda4af"],
		[landmarks.leftMouth[0], landmarks.leftMouth[1], "#fda4af"],
	];
	for (const [px, py, color] of points) {
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
		ctx.fill();
	}

	// Confidence in the bottom-left of the bbox.
	ctx.fillStyle = "rgba(0,0,0,0.6)";
	const confText = `conf ${bbox.confidence.toFixed(2)}`;
	const confPadding = 4;
	const confWidth = ctx.measureText(confText).width + confPadding * 2;
	const confHeight = Math.round(frameHeight * 0.035);
	ctx.fillRect(bbox.x, bbox.y + bbox.h - confHeight, confWidth, confHeight);
	ctx.fillStyle = "#e5e7eb";
	ctx.fillText(
		confText,
		bbox.x + confPadding,
		bbox.y + bbox.h - confHeight + confPadding / 2,
	);
}

export function VideoOverlay({
	videoUrl,
	debug,
}: {
	videoUrl: string;
	debug: LivenessDebugPayload;
}) {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const rafRef = useRef<number | null>(null);
	const [currentTime, setCurrentTime] = useState<number>(0);
	const [naturalSize, setNaturalSize] = useState<{
		width: number;
		height: number;
	} | null>(null);
	const [showServerOverlay, setShowServerOverlay] = useState<boolean>(true);
	const [showMeshOverlay, setShowMeshOverlay] = useState<boolean>(false);

	const frameCount = debug.frameCount;
	const durationSeconds = debug.durationSeconds ?? 0;

	const nearestEntry = useMemo(
		() =>
			pickNearestEntry(
				debug.timeline,
				frameCount,
				durationSeconds,
				currentTime,
			),
		[debug.timeline, frameCount, durationSeconds, currentTime],
	);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) {
			return;
		}

		const tick = () => {
			setCurrentTime(video.currentTime);
			rafRef.current = window.requestAnimationFrame(tick);
		};

		const startTicking = () => {
			if (rafRef.current === null) {
				rafRef.current = window.requestAnimationFrame(tick);
			}
		};

		const stopTicking = () => {
			if (rafRef.current !== null) {
				window.cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
		};

		const handleLoaded = () => {
			setNaturalSize({
				width: video.videoWidth,
				height: video.videoHeight,
			});
			setCurrentTime(video.currentTime);
		};

		const handleSeek = () => setCurrentTime(video.currentTime);

		video.addEventListener("loadedmetadata", handleLoaded);
		video.addEventListener("play", startTicking);
		video.addEventListener("pause", stopTicking);
		video.addEventListener("ended", stopTicking);
		video.addEventListener("seeked", handleSeek);

		return () => {
			stopTicking();
			video.removeEventListener("loadedmetadata", handleLoaded);
			video.removeEventListener("play", startTicking);
			video.removeEventListener("pause", stopTicking);
			video.removeEventListener("ended", stopTicking);
			video.removeEventListener("seeked", handleSeek);
		};
	}, []);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) {
			return;
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}
		// Prefer the dimensions the container actually saw — those are the
		// coordinate system the bboxes / landmarks live in. Fall back to the
		// playing video's natural size if the container didn't report any
		// frame size (pipeline failed before frame extraction).
		const targetWidth = debug.frameWidth || naturalSize?.width || 0;
		const targetHeight = debug.frameHeight || naturalSize?.height || 0;
		if (targetWidth === 0 || targetHeight === 0) {
			return;
		}
		if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
			canvas.width = targetWidth;
			canvas.height = targetHeight;
		}
		drawOverlay({
			ctx,
			entry: nearestEntry,
			frameWidth: targetWidth,
			frameHeight: targetHeight,
		});
	}, [nearestEntry, debug.frameWidth, debug.frameHeight, naturalSize]);

	const targetWidth = debug.frameWidth || naturalSize?.width || 0;
	const targetHeight = debug.frameHeight || naturalSize?.height || 0;

	return (
		<div className="space-y-2">
			<div className="relative w-full max-w-md overflow-hidden rounded border border-zinc-800 bg-black">
				<video
					ref={videoRef}
					className="block h-auto w-full"
					src={videoUrl}
					controls
					playsInline
					muted
				>
					<track kind="captions" />
				</video>
				<canvas
					ref={canvasRef}
					className={`pointer-events-none absolute inset-0 h-full w-full ${
						showServerOverlay ? "" : "opacity-0"
					}`}
				/>
				{showMeshOverlay && targetWidth > 0 && targetHeight > 0 ? (
					<MediaPipeMeshLayer
						videoRef={videoRef}
						frameWidth={targetWidth}
						frameHeight={targetHeight}
					/>
				) : null}
			</div>
			<div className="flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
				<span>
					t {currentTime.toFixed(2)}s
					{durationSeconds > 0 ? ` / ${durationSeconds.toFixed(2)}s` : ""}
				</span>
				<div className="flex items-center gap-3">
					<label className="flex items-center gap-1">
						<input
							type="checkbox"
							checked={showServerOverlay}
							onChange={(event) => setShowServerOverlay(event.target.checked)}
						/>
						<span className="text-amber-300">server (YuNet 5-pt + PnP)</span>
					</label>
					<label className="flex items-center gap-1">
						<input
							type="checkbox"
							checked={showMeshOverlay}
							onChange={(event) => setShowMeshOverlay(event.target.checked)}
						/>
						<span className="text-emerald-300">
							client (MediaPipe 478-pt mesh)
						</span>
					</label>
				</div>
				{nearestEntry ? (
					<span className="font-mono">
						frame #{nearestEntry.frameIndex} · {nearestEntry.pose}
					</span>
				) : null}
			</div>
		</div>
	);
}
