import {
	deriveActiveAuthChallenge as deriveActiveAuthChallengeInternal,
	validateActiveAuthentication as validateActiveAuthenticationInternal,
} from "./active-auth";
import { validateChipAuthentication as validateChipAuthenticationInternal } from "./chip-auth";
import {
	decodeFaceImageBytes as decodeFaceImageBytesInternal,
	extractDg2FaceImage as extractDg2FaceImageInternal,
} from "./dg2-face-image";
import {
	configurePkdTrustBundleLoaderFromEnv as configurePkdTrustBundleLoaderFromEnvInternal,
	configurePkdTrustBundleLoader as configurePkdTrustBundleLoaderInternal,
	type PkdTrustBundle,
} from "./pkd-trust";
import { validateAuthenticity as validateAuthenticityInternal } from "./sod-authenticity";
import type {
	ActiveAuthValidationResult as ActiveAuthValidationResultValue,
	AuthenticityValidationResult as AuthenticityValidationResultValue,
	ChipAuthValidationResult as ChipAuthValidationResultValue,
	DecodedImage,
	Dg2FaceImage as Dg2FaceImageValue,
	SupportedHashAlgorithm,
} from "./validation-types";
import { configureVerifyAssetFetcher as configureVerifyAssetFetcherInternal } from "./verify-assets";

export type AuthenticityValidationResult = AuthenticityValidationResultValue;
export type ActiveAuthValidationResult = ActiveAuthValidationResultValue;
export type ChipAuthValidationResult = ChipAuthValidationResultValue;
export type Dg2FaceImage = Dg2FaceImageValue;
export type PassiveAuthTrustBundle = PkdTrustBundle;

export function configureVerifyAssetFetcher(
	fetcher: ((pathname: string) => Promise<Uint8Array>) | null,
): void {
	configureVerifyAssetFetcherInternal(fetcher);
}

export function configurePkdTrustBundleLoader(
	loader: (() => Promise<PkdTrustBundle | null>) | null,
): void {
	configurePkdTrustBundleLoaderInternal(loader);
}

export function configurePkdTrustBundleLoaderFromEnv(env: unknown): void {
	configurePkdTrustBundleLoaderFromEnvInternal(env);
}

export function extractDg2FaceImage(dg2: Uint8Array): Dg2FaceImage {
	return extractDg2FaceImageInternal(dg2);
}

export function decodeFaceImageBytes(bytes: Uint8Array): Promise<DecodedImage> {
	return decodeFaceImageBytesInternal(bytes);
}

export function validateAuthenticity({
	checkDate,
	dg1,
	dg2,
	dg14,
	dg15,
	sod,
	trustBundle,
}: {
	checkDate?: Date;
	dg1: Uint8Array;
	dg2: Uint8Array;
	dg14?: Uint8Array;
	dg15?: Uint8Array;
	sod: Uint8Array;
	trustBundle?: PkdTrustBundle;
}): Promise<AuthenticityValidationResultValue> {
	return validateAuthenticityInternal({
		checkDate,
		dg1,
		dg2,
		dg14,
		dg15,
		sod,
		trustBundle,
	});
}

export function validateActiveAuthentication({
	challenge,
	dg14,
	dg15,
	expectedChallenge,
	signature,
	sodAlgorithm,
	sodDg15Hash,
}: {
	challenge: Uint8Array;
	dg14?: Uint8Array;
	dg15: Uint8Array;
	expectedChallenge?: Uint8Array;
	signature: Uint8Array;
	sodAlgorithm?: SupportedHashAlgorithm;
	sodDg15Hash?: Uint8Array;
}): Promise<ActiveAuthValidationResultValue> {
	return validateActiveAuthenticationInternal({
		challenge,
		dg14,
		dg15,
		expectedChallenge,
		signature,
		sodAlgorithm,
		sodDg15Hash,
	});
}

export function deriveActiveAuthChallenge({
	attemptId,
	authSecret,
}: {
	attemptId: string;
	authSecret: string;
}): Promise<Uint8Array> {
	return deriveActiveAuthChallengeInternal({ attemptId, authSecret });
}

export function validateChipAuthentication({
	chipAuthData,
	dg14,
	sodAlgorithm,
	sodDg14Hash,
}: {
	chipAuthData: Uint8Array;
	dg14: Uint8Array;
	sodAlgorithm?: SupportedHashAlgorithm;
	sodDg14Hash?: Uint8Array;
}): Promise<ChipAuthValidationResultValue> {
	return validateChipAuthenticationInternal({
		chipAuthData,
		dg14,
		sodAlgorithm,
		sodDg14Hash,
	});
}
