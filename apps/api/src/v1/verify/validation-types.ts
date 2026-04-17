export type SupportedHashAlgorithm =
  | "SHA-256"
  | "SHA-384"
  | "SHA-512"
  | "SHA-1";

export type SupportedImageFormat = "jpeg" | "jpeg2000";

export type PassiveAuthCrlStatus =
  | "not_checked"
  | "revoked"
  | "soft_fail_missing"
  | "soft_fail_stale"
  | "verified_not_revoked";

export type PassiveAuthFailureReason =
  | "chain_untrusted"
  | "crl_revoked"
  | "cms_signature_invalid"
  | "dg_hash_mismatch"
  | "missing_required_artifacts"
  | "missing_signer"
  | "missing_signer_certificate"
  | "parse_failure"
  | "required_dg_hash_missing"
  | "signer_certificate_expired"
  | "signer_certificate_invalid"
  | "signer_certificate_not_yet_valid"
  | "trust_bundle_unavailable"
  | "unsupported_digest_algorithm";

export type PassiveAuthSignerSource = "bundle" | "sod";

export type DecodedImage = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
};

export type Dg2FaceImage = {
  imageData: Uint8Array;
  imageFormat: SupportedImageFormat;
  imageWidth: number;
  imageHeight: number;
};

export const DEFAULT_FACE_MATCH_THRESHOLD = 0.8;

export type AuthenticityValidationResult =
  | {
      crlStatus: Exclude<PassiveAuthCrlStatus, "not_checked" | "revoked">;
      ok: true;
      algorithm: SupportedHashAlgorithm;
      signerSource: PassiveAuthSignerSource;
      source: "cms_signed_data";
    }
  | {
      crlStatus: PassiveAuthCrlStatus;
      ok: false;
      reason: PassiveAuthFailureReason;
      detail?: string | null;
      signerSource: PassiveAuthSignerSource | null;
    };

export type FaceScoreResult = {
  faceScore: number | null;
  passed: boolean;
  usedFallback: boolean;
  reason?: string;
};
