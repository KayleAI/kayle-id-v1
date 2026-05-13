// Extracts N evenly-spaced JPEG frames from an in-memory video Blob, all
// client-side. Used by the face-match tester to turn a webcam clip into a
// set of selfie stills without involving the server's ffmpeg path.

const FRAME_JPEG_QUALITY = 0.92;

async function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const onSeeked = () => {
			cleanup();
			resolve();
		};
		const onError = () => {
			cleanup();
			reject(new Error("video_seek_failed"));
		};
		const cleanup = () => {
			video.removeEventListener("seeked", onSeeked);
			video.removeEventListener("error", onError);
		};
		video.addEventListener("seeked", onSeeked);
		video.addEventListener("error", onError);
		video.currentTime = time;
	});
}

async function awaitMetadata(video: HTMLVideoElement): Promise<void> {
	if (video.readyState >= 1 && Number.isFinite(video.duration)) {
		return;
	}
	return new Promise((resolve, reject) => {
		const onLoaded = () => {
			cleanup();
			resolve();
		};
		const onError = () => {
			cleanup();
			reject(new Error("video_load_failed"));
		};
		const cleanup = () => {
			video.removeEventListener("loadedmetadata", onLoaded);
			video.removeEventListener("error", onError);
		};
		video.addEventListener("loadedmetadata", onLoaded);
		video.addEventListener("error", onError);
	});
}

export async function extractFramesFromVideoBlob({
	blob,
	frameCount,
}: {
	blob: Blob;
	frameCount: number;
}): Promise<Blob[]> {
	if (frameCount <= 0) {
		return [];
	}

	const url = URL.createObjectURL(blob);
	const video = document.createElement("video");
	video.src = url;
	video.muted = true;
	video.playsInline = true;
	video.preload = "auto";
	// Keep the element offscreen — some browsers refuse to advance
	// currentTime on a detached element, so we attach but hide it.
	video.style.position = "absolute";
	video.style.width = "1px";
	video.style.height = "1px";
	video.style.opacity = "0";
	video.style.pointerEvents = "none";
	document.body.appendChild(video);

	try {
		await awaitMetadata(video);
		const duration = video.duration;
		if (!(Number.isFinite(duration) && duration > 0)) {
			throw new Error("video_duration_invalid");
		}
		const width = video.videoWidth;
		const height = video.videoHeight;
		if (width <= 0 || height <= 0) {
			throw new Error("video_dimensions_invalid");
		}

		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			throw new Error("canvas_2d_unavailable");
		}

		const frames: Blob[] = [];
		for (let i = 0; i < frameCount; i += 1) {
			const timestamp = (duration * (i + 0.5)) / frameCount;
			await seekTo(video, timestamp);
			ctx.drawImage(video, 0, 0, width, height);
			const frame = await new Promise<Blob | null>((resolve) => {
				canvas.toBlob(
					(result) => resolve(result),
					"image/jpeg",
					FRAME_JPEG_QUALITY,
				);
			});
			if (frame) {
				frames.push(frame);
			}
		}
		return frames;
	} finally {
		video.remove();
		URL.revokeObjectURL(url);
	}
}
