export const SELECT_TRUST_STORE_METADATA_SQL = `
  SELECT
    generated_at AS generatedAt,
    version,
    object_ldif_path AS objectLdifPath,
    object_ldif_version AS objectLdifVersion,
    master_lists_ldif_path AS masterListsLdifPath,
    master_lists_ldif_version AS masterListsLdifVersion,
    csca_count AS cscaCount,
    dsc_count AS dscCount,
    crl_count AS crlCount,
    ignored_bcsc AS ignoredBcsc,
    ignored_bcsc_nc AS ignoredBcscNc
  FROM trust_store_metadata
  WHERE id = ?
`;

export const SELECT_TRUST_STORE_CSCAS_SQL = `
  SELECT
    aki_hex AS akiHex,
    der_base64 AS derBase64,
    issuer_key AS issuerKey,
    issuer_name AS issuerName,
    master_list_sources_json AS masterListSourcesJson,
    not_after AS notAfter,
    not_before AS notBefore,
    serial_number_hex AS serialNumberHex,
    ski_hex AS skiHex,
    source_country_code AS sourceCountryCode,
    source_dn AS sourceDn,
    subject_key AS subjectKey,
    subject_name AS subjectName
  FROM trust_store_cscas
`;

export const SELECT_TRUST_STORE_CRLS_SQL = `
  SELECT
    id,
    aki_hex AS akiHex,
    der_base64 AS derBase64,
    issuer_key AS issuerKey,
    issuer_name AS issuerName,
    next_update AS nextUpdate,
    source_country_code AS sourceCountryCode,
    source_dn AS sourceDn,
    this_update AS thisUpdate
  FROM trust_store_crls
`;

export const SELECT_TRUST_STORE_CRL_REVOCATIONS_SQL = `
  SELECT
    crl_id AS crlId,
    revoked_serial_number_hex AS revokedSerialNumberHex
  FROM trust_store_crl_revocations
`;

export const SELECT_TRUST_STORE_DSC_BY_ISSUER_SERIAL_SQL = `
  SELECT
    aki_hex AS akiHex,
    der_base64 AS derBase64,
    issuer_key AS issuerKey,
    issuer_name AS issuerName,
    not_after AS notAfter,
    not_before AS notBefore,
    serial_number_hex AS serialNumberHex,
    ski_hex AS skiHex,
    source_country_code AS sourceCountryCode,
    source_dn AS sourceDn,
    subject_key AS subjectKey,
    subject_name AS subjectName
  FROM trust_store_dscs
  WHERE issuer_key = ? AND serial_number_hex = ?
  LIMIT 1
`;

export const SELECT_TRUST_STORE_DSCS_BY_SKI_SQL = `
  SELECT
    aki_hex AS akiHex,
    der_base64 AS derBase64,
    issuer_key AS issuerKey,
    issuer_name AS issuerName,
    not_after AS notAfter,
    not_before AS notBefore,
    serial_number_hex AS serialNumberHex,
    ski_hex AS skiHex,
    source_country_code AS sourceCountryCode,
    source_dn AS sourceDn,
    subject_key AS subjectKey,
    subject_name AS subjectName
  FROM trust_store_dscs
  WHERE ski_hex = ?
`;
