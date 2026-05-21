export type VerifyChunkEntry = {
	chunkTotal: number;
	parts: Map<number, Uint8Array>;
};

export type RequiredNfcArtifact = "dg1" | "dg2" | "sod";

export type MissingTransferChunk = {
	kind: number;
	index: number;
	chunkTotal: number;
	missingChunkIndices: number[];
};

export type MissingNfcChunk = MissingTransferChunk;

export type NfcTransferStatus = {
	complete: boolean;
	missingArtifacts: RequiredNfcArtifact[];
	missingChunks: MissingNfcChunk[];
};

export type LivenessTransferStatus = {
	complete: boolean;
	receivedBytes: number;
	missingChunks: MissingTransferChunk[];
};

export type VerifyTransferState = {
	dg1?: Uint8Array;
	dg2?: Uint8Array;
	sod?: Uint8Array;
	dg14?: Uint8Array;
	dg15?: Uint8Array;
	activeAuthChallenge?: Uint8Array;
	activeAuthSignature?: Uint8Array;
	chipAuthTranscript?: Uint8Array;
	nfcAttestAssertion?: Uint8Array;
	livenessVideo?: Uint8Array;
	chunks: Map<string, VerifyChunkEntry>;
	bytesReceived: number;
};

export type VerifyDataPayload = {
	kind?: number;
	raw?: Uint8Array;
	index?: number;
	total?: number;
	chunkIndex?: number;
	chunkTotal?: number;
};

export type DataResult = {
	acks: string[];
	error?: {
		code: string;
		message: string;
	};
	authenticityReady: boolean;
	nfcStatus: NfcTransferStatus;
	livenessStatus: LivenessTransferStatus;
};
