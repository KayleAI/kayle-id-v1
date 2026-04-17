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
  AuthenticityValidationResult as AuthenticityValidationResultValue,
  DecodedImage,
  Dg2FaceImage as Dg2FaceImageValue,
} from "./validation-types";
import { configureVerifyAssetFetcher as configureVerifyAssetFetcherInternal } from "./verify-assets";

export type AuthenticityValidationResult = AuthenticityValidationResultValue;
export type Dg2FaceImage = Dg2FaceImageValue;
export type PassiveAuthTrustBundle = PkdTrustBundle;

export function configureVerifyAssetFetcher(
  fetcher: ((pathname: string) => Promise<Uint8Array>) | null
): void {
  configureVerifyAssetFetcherInternal(fetcher);
}

export function configurePkdTrustBundleLoader(
  loader: (() => Promise<PkdTrustBundle | null>) | null
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
  sod,
  trustBundle,
}: {
  checkDate?: Date;
  dg1: Uint8Array;
  dg2: Uint8Array;
  sod: Uint8Array;
  trustBundle?: PkdTrustBundle;
}): Promise<AuthenticityValidationResultValue> {
  return validateAuthenticityInternal({
    checkDate,
    dg1,
    dg2,
    sod,
    trustBundle,
  });
}
