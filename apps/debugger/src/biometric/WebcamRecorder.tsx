import { useCallback, useEffect, useRef, useState } from "react";

const RECORDER_MIME_CANDIDATES = [
	"video/webm;codecs=vp9",
	"video/webm;codecs=vp8",
	"video/webm",
	"video/mp4",
];

function pickRecorderMime(): string {
	if (typeof MediaRecorder === "undefined") {
		return "";
	}
	const supported = RECORDER_MIME_CANDIDATES.find((candidate) =>
		MediaRecorder.isTypeSupported(candidate),
	);
	return supported ?? "";
}

type RecorderState =
	| { kind: "idle" }
	| { kind: "previewing" }
	| { kind: "recording"; startedAt: number }
	| { kind: "recorded"; blob: Blob; durationMs: number };

export type RecordedClip = {
	blob: Blob;
	durationMs: number;
	mimeType: string;
};

type Props = {
	clip: RecordedClip | null;
	onClipReady: (clip: RecordedClip) => void;
	onClipCleared: () => void;
	// Default 720x1280 (9:16). The canvas captures the cropped region at
	// these dimensions and that's also what MediaRecorder records, so the
	// downstream frame extractor will produce stills at this size.
	outputWidth?: number;
	outputHeight?: number;
};

// Webcam → hidden <video> → canvas (centre-cropped 9:16 per frame) →
// canvas.captureStream() → MediaRecorder. The canvas is the preview,
// so what the user sees is what the verifier receives.
export function WebcamRecorder({
	clip,
	onClipReady,
	onClipCleared,
	outputWidth = 720,
	outputHeight = 1280,
}: Props) {
	const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
	const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const recordedVideoRef = useRef<HTMLVideoElement | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const canvasStreamRef = useRef<MediaStream | null>(null);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const rafRef = useRef<number | null>(null);
	const recordingStartedAtRef = useRef<number>(0);

	const [state, setState] = useState<RecorderState>(
		clip
			? { kind: "recorded", blob: clip.blob, durationMs: clip.durationMs }
			: { kind: "idle" },
	);
	const [error, setError] = useState<string | null>(null);
	const [elapsedMs, setElapsedMs] = useState<number>(0);
	const [recordedUrl, setRecordedUrl] = useState<string | null>(null);

	const stopRafLoop = useCallback(() => {
		if (rafRef.current !== null) {
			window.cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
	}, []);

	const stopStream = useCallback(() => {
		stopRafLoop();
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) {
				track.stop();
			}
			streamRef.current = null;
		}
		if (canvasStreamRef.current) {
			for (const track of canvasStreamRef.current.getTracks()) {
				track.stop();
			}
			canvasStreamRef.current = null;
		}
		if (hiddenVideoRef.current) {
			hiddenVideoRef.current.srcObject = null;
		}
	}, [stopRafLoop]);

	useEffect(() => {
		return () => {
			stopStream();
			if (recorderRef.current && recorderRef.current.state !== "inactive") {
				try {
					recorderRef.current.stop();
				} catch {
					// best-effort cleanup
				}
			}
		};
	}, [stopStream]);

	useEffect(() => {
		if (state.kind !== "recording") {
			return;
		}
		const interval = window.setInterval(() => {
			setElapsedMs(Date.now() - state.startedAt);
		}, 100);
		return () => window.clearInterval(interval);
	}, [state]);

	useEffect(() => {
		if (state.kind === "recorded") {
			const url = URL.createObjectURL(state.blob);
			setRecordedUrl(url);
			return () => URL.revokeObjectURL(url);
		}
		setRecordedUrl(null);
		return;
	}, [state]);

	const drawCroppedFrame = useCallback(() => {
		const video = hiddenVideoRef.current;
		const canvas = previewCanvasRef.current;
		if (!(video && canvas)) {
			return;
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}
		if (
			video.readyState >= 2 &&
			video.videoWidth > 0 &&
			video.videoHeight > 0
		) {
			const srcW = video.videoWidth;
			const srcH = video.videoHeight;
			const dstAspect = canvas.width / canvas.height;
			let cropW: number;
			let cropH: number;
			let cropX: number;
			let cropY: number;
			if (srcW / srcH > dstAspect) {
				// Source wider than 9:16 → trim left/right.
				cropH = srcH;
				cropW = srcH * dstAspect;
				cropY = 0;
				cropX = (srcW - cropW) / 2;
			} else {
				// Source taller than 9:16 → trim top/bottom.
				cropW = srcW;
				cropH = srcW / dstAspect;
				cropX = 0;
				cropY = (srcH - cropH) / 2;
			}
			ctx.drawImage(
				video,
				cropX,
				cropY,
				cropW,
				cropH,
				0,
				0,
				canvas.width,
				canvas.height,
			);
		}
		rafRef.current = window.requestAnimationFrame(drawCroppedFrame);
	}, []);

	async function startPreview() {
		setError(null);
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				// Ask for landscape so we have headroom to center-crop a portrait
				// 9:16 strip. Browsers ignore exact dimensions if the camera can't
				// match, but the underlying ImageBitmap retains its native size.
				video: { facingMode: "user", width: 1280, height: 720 },
				audio: false,
			});
			streamRef.current = stream;
			const video = hiddenVideoRef.current;
			if (video) {
				video.srcObject = stream;
				// Wait for the video to report dimensions before kicking off the
				// draw loop. Without this, the very first raf tick can find
				// readyState=HAVE_NOTHING and the loop spins forever on browsers
				// that lazily start decode when the element is offscreen.
				await new Promise<void>((resolve) => {
					if (video.readyState >= 1 && video.videoWidth > 0) {
						resolve();
						return;
					}
					const onReady = () => {
						video.removeEventListener("loadedmetadata", onReady);
						video.removeEventListener("loadeddata", onReady);
						resolve();
					};
					video.addEventListener("loadedmetadata", onReady);
					video.addEventListener("loadeddata", onReady);
				});
				await video.play().catch(() => undefined);
			}
			// State transition mounts the <canvas>; the draw loop is kicked
			// off by the useEffect below once the ref is attached. Calling
			// drawCroppedFrame() here would early-return (the canvas isn't
			// in the DOM yet) and never reschedule itself — that path used
			// to leave us with a blank canvas, `captureStream` producing no
			// frames, and the recorded blob being an empty WebM header.
			setState({ kind: "previewing" });
		} catch (caught) {
			setError(
				`camera_unavailable:${caught instanceof Error ? caught.message : String(caught)}`,
			);
		}
	}

	// Start the draw loop once the canvas is actually mounted (right after
	// `setState({ kind: "previewing" })` triggers a re-render that
	// includes the <canvas> in the tree). Re-runs harmlessly on state
	// transitions because of the rafRef guard.
	useEffect(() => {
		if (state.kind !== "previewing" && state.kind !== "recording") {
			return;
		}
		const canvas = previewCanvasRef.current;
		const video = hiddenVideoRef.current;
		if (!(canvas && video)) {
			return;
		}
		if (canvas.width !== outputWidth || canvas.height !== outputHeight) {
			canvas.width = outputWidth;
			canvas.height = outputHeight;
		}
		if (rafRef.current === null) {
			drawCroppedFrame();
		}
	}, [state, outputWidth, outputHeight, drawCroppedFrame]);

	function startRecording() {
		const canvas = previewCanvasRef.current;
		if (!canvas) {
			setError("camera_unavailable:no_canvas");
			return;
		}
		// captureStream pulls frames as they're drawn — keep the raf loop
		// running so we don't end up with a frozen recording.
		const canvasStream = canvas.captureStream(24);
		canvasStreamRef.current = canvasStream;
		const mimeType = pickRecorderMime();
		try {
			const recorder =
				mimeType.length > 0
					? new MediaRecorder(canvasStream, { mimeType })
					: new MediaRecorder(canvasStream);
			chunksRef.current = [];
			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					chunksRef.current.push(event.data);
				}
			};
			recorder.onstop = () => {
				const usedMime = recorder.mimeType || mimeType || "video/webm";
				const blob = new Blob(chunksRef.current, { type: usedMime });
				const durationMs = Date.now() - recordingStartedAtRef.current;
				setState({ kind: "recorded", blob, durationMs });
				onClipReady({ blob, durationMs, mimeType: usedMime });
				stopStream();
			};
			recorder.onerror = (event) => {
				const recorderError = (
					event as unknown as { error?: { message?: string } }
				).error;
				setError(`recorder_error:${recorderError?.message ?? "unknown"}`);
			};
			recordingStartedAtRef.current = Date.now();
			recorder.start();
			recorderRef.current = recorder;
			setState({
				kind: "recording",
				startedAt: recordingStartedAtRef.current,
			});
			setElapsedMs(0);
		} catch (caught) {
			setError(
				`recorder_start_failed:${caught instanceof Error ? caught.message : String(caught)}`,
			);
		}
	}

	function stopRecording() {
		if (recorderRef.current && recorderRef.current.state === "recording") {
			recorderRef.current.stop();
		}
	}

	function discardRecording() {
		setState({ kind: "idle" });
		setRecordedUrl(null);
		onClipCleared();
	}

	const isLive = state.kind === "previewing" || state.kind === "recording";
	const aspectRatio = `${outputWidth} / ${outputHeight}`;

	return (
		<div className="space-y-3">
			{error ? (
				<div className="rounded border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
					{error}
				</div>
			) : null}

			{/* Hidden video element drinks the raw camera stream. It's
			    positioned far offscreen but kept at real dimensions because
			    some browsers (notably Safari and Chrome under power-saving)
			    won't decode frames into a 1×1 or display:none video element,
			    which would leave the canvas blank and MediaRecorder writing
			    an unreadable blob. */}
			<video
				ref={hiddenVideoRef}
				muted
				playsInline
				autoPlay
				style={{
					position: "fixed",
					top: "-10000px",
					left: "-10000px",
					width: "320px",
					height: "240px",
					pointerEvents: "none",
				}}
			>
				<track kind="captions" />
			</video>

			{state.kind === "idle" ? (
				<button
					type="button"
					onClick={startPreview}
					className="rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
				>
					Start camera
				</button>
			) : null}

			{isLive ? (
				<div className="space-y-2">
					<canvas
						ref={previewCanvasRef}
						className="block w-full max-w-[240px] rounded border border-zinc-800 bg-black"
						style={{ aspectRatio }}
					/>
					<div className="flex items-center gap-3">
						{state.kind === "previewing" ? (
							<button
								type="button"
								onClick={startRecording}
								className="rounded bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-500"
							>
								● Record
							</button>
						) : (
							<>
								<button
									type="button"
									onClick={stopRecording}
									className="rounded bg-zinc-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-zinc-600"
								>
									■ Stop
								</button>
								<span className="font-mono text-sm text-rose-400">
									● {(elapsedMs / 1000).toFixed(1)}s
								</span>
							</>
						)}
						<button
							type="button"
							onClick={() => {
								stopStream();
								setState({ kind: "idle" });
							}}
							className="text-xs text-zinc-500 hover:text-zinc-300"
						>
							cancel
						</button>
					</div>
					<p className="text-xs text-zinc-500">
						Centre-cropped to {outputWidth}×{outputHeight} (9:16). The clip you
						record is the clip the verifier samples frames from.
					</p>
				</div>
			) : null}

			{state.kind === "recorded" && recordedUrl ? (
				<div className="space-y-2">
					<video
						ref={recordedVideoRef}
						className="block w-full max-w-[240px] rounded border border-zinc-800 bg-black"
						src={recordedUrl}
						controls
						playsInline
						style={{ aspectRatio }}
					>
						<track kind="captions" />
					</video>
					<div className="flex items-center gap-3 text-xs text-zinc-500">
						<span>
							{(state.durationMs / 1000).toFixed(1)}s ·{" "}
							{(state.blob.size / 1024).toFixed(1)} KB
						</span>
						<button
							type="button"
							onClick={discardRecording}
							className="text-zinc-400 underline hover:text-zinc-200"
						>
							re-record
						</button>
					</div>
				</div>
			) : null}
		</div>
	);
}
