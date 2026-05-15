import { wrapImageAsDg2 } from "./dg2";

// Synthesizes a minimal valid DG2 wrapping a 4x4 JPEG produced by the
// canvas API. Used when "skip face match" mode is on so the contributor
// doesn't have to supply a real DG2 — the container env flag short-
// circuits the pipeline before this placeholder image is ever decoded.
export async function createPlaceholderDg2(): Promise<Uint8Array> {
	const canvas = document.createElement("canvas");
	canvas.width = 4;
	canvas.height = 4;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("placeholder_dg2_canvas_unavailable");
	}
	ctx.fillStyle = "#202020";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const blob = await new Promise<Blob | null>((resolve) => {
		canvas.toBlob((result) => resolve(result), "image/jpeg", 0.5);
	});
	if (!blob) {
		throw new Error("placeholder_dg2_blob_unavailable");
	}
	const bytes = new Uint8Array(await blob.arrayBuffer());
	return wrapImageAsDg2({
		imageBytes: bytes,
		imageFormat: "jpeg",
		wrapWithEfTag: true,
	});
}
