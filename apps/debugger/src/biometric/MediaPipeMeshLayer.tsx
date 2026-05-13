import {
	FaceLandmarker,
	FilesetResolver,
	type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { type RefObject, useEffect, useRef, useState } from "react";

// MediaPipe's wasm + model assets live off-CDN. Keep them as constants so
// it's obvious what we're loading when reading the diff and easy to swap
// later if we want to self-host the binaries.
const MEDIAPIPE_WASM_BASE =
	"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const FACE_LANDMARKER_MODEL_URL =
	"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

type LandmarkerState =
	| { kind: "idle" }
	| { kind: "loading" }
	| { kind: "ready"; landmarker: FaceLandmarker }
	| { kind: "error"; message: string };

async function loadFaceLandmarker(): Promise<FaceLandmarker> {
	const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE);
	return await FaceLandmarker.createFromOptions(fileset, {
		baseOptions: {
			modelAssetPath: FACE_LANDMARKER_MODEL_URL,
			delegate: "GPU",
		},
		outputFaceBlendshapes: false,
		outputFacialTransformationMatrixes: false,
		runningMode: "VIDEO",
		numFaces: 1,
	});
}

function drawMesh({
	ctx,
	landmarks,
	frameWidth,
	frameHeight,
}: {
	ctx: CanvasRenderingContext2D;
	landmarks: NormalizedLandmark[];
	frameWidth: number;
	frameHeight: number;
}) {
	ctx.clearRect(0, 0, frameWidth, frameHeight);

	ctx.strokeStyle = "rgba(34, 197, 94, 0.4)";
	ctx.lineWidth = Math.max(0.5, frameHeight * 0.001);
	ctx.beginPath();
	for (const connection of FaceLandmarker.FACE_LANDMARKS_TESSELATION) {
		const a = landmarks[connection.start];
		const b = landmarks[connection.end];
		if (!(a && b)) {
			continue;
		}
		ctx.moveTo(a.x * frameWidth, a.y * frameHeight);
		ctx.lineTo(b.x * frameWidth, b.y * frameHeight);
	}
	ctx.stroke();

	ctx.fillStyle = "rgba(34, 197, 94, 0.7)";
	const dotRadius = Math.max(1, frameHeight * 0.002);
	for (const point of landmarks) {
		ctx.beginPath();
		ctx.arc(
			point.x * frameWidth,
			point.y * frameHeight,
			dotRadius,
			0,
			Math.PI * 2,
		);
		ctx.fill();
	}
}

export function MediaPipeMeshLayer({
	videoRef,
	frameWidth,
	frameHeight,
}: {
	videoRef: RefObject<HTMLVideoElement | null>;
	frameWidth: number;
	frameHeight: number;
}) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const stateRef = useRef<LandmarkerState>({ kind: "idle" });
	const rafRef = useRef<number | null>(null);
	const [state, setState] = useState<LandmarkerState>({ kind: "idle" });

	useEffect(() => {
		let cancelled = false;
		setState({ kind: "loading" });
		stateRef.current = { kind: "loading" };
		loadFaceLandmarker()
			.then((landmarker) => {
				if (cancelled) {
					landmarker.close();
					return;
				}
				const next: LandmarkerState = { kind: "ready", landmarker };
				stateRef.current = next;
				setState(next);
			})
			.catch((caught: unknown) => {
				if (cancelled) {
					return;
				}
				const next: LandmarkerState = {
					kind: "error",
					message: caught instanceof Error ? caught.message : String(caught),
				};
				stateRef.current = next;
				setState(next);
			});

		return () => {
			cancelled = true;
			if (stateRef.current.kind === "ready") {
				stateRef.current.landmarker.close();
			}
			stateRef.current = { kind: "idle" };
		};
	}, []);

	useEffect(() => {
		if (state.kind !== "ready") {
			return;
		}
		const canvas = canvasRef.current;
		const video = videoRef.current;
		if (!(canvas && video)) {
			return;
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}
		if (frameWidth <= 0 || frameHeight <= 0) {
			return;
		}
		if (canvas.width !== frameWidth || canvas.height !== frameHeight) {
			canvas.width = frameWidth;
			canvas.height = frameHeight;
		}

		const landmarker = state.landmarker;

		const detectAndDraw = () => {
			if (video.readyState < 2) {
				return;
			}
			const result = landmarker.detectForVideo(video, performance.now());
			if (result.faceLandmarks.length > 0) {
				drawMesh({
					ctx,
					landmarks: result.faceLandmarks[0],
					frameWidth,
					frameHeight,
				});
			} else {
				ctx.clearRect(0, 0, frameWidth, frameHeight);
			}
		};

		const tick = () => {
			detectAndDraw();
			rafRef.current = window.requestAnimationFrame(tick);
		};

		const onPlay = () => {
			if (rafRef.current === null) {
				rafRef.current = window.requestAnimationFrame(tick);
			}
		};
		const onStop = () => {
			if (rafRef.current !== null) {
				window.cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
		};
		// Single-shot draw at the seeked timestamp so the mesh updates even
		// when the video is paused.
		const onSeeked = () => detectAndDraw();

		video.addEventListener("play", onPlay);
		video.addEventListener("pause", onStop);
		video.addEventListener("ended", onStop);
		video.addEventListener("seeked", onSeeked);
		if (video.paused || video.ended) {
			onSeeked();
		} else {
			onPlay();
		}

		return () => {
			onStop();
			video.removeEventListener("play", onPlay);
			video.removeEventListener("pause", onStop);
			video.removeEventListener("ended", onStop);
			video.removeEventListener("seeked", onSeeked);
		};
	}, [state, videoRef, frameWidth, frameHeight]);

	return (
		<>
			<canvas
				ref={canvasRef}
				className="pointer-events-none absolute inset-0 h-full w-full"
			/>
			{state.kind === "loading" ? (
				<div className="absolute right-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-emerald-300">
					loading mesh…
				</div>
			) : null}
			{state.kind === "error" ? (
				<div className="absolute right-2 top-2 max-w-xs rounded bg-rose-950/80 px-2 py-1 text-xs text-rose-200">
					mesh load failed: {state.message}
				</div>
			) : null}
		</>
	);
}
