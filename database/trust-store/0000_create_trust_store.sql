CREATE TABLE IF NOT EXISTS trust_store_metadata (
  id INTEGER PRIMARY KEY NOT NULL,
  generated_at TEXT NOT NULL,
  version INTEGER NOT NULL,
  object_ldif_path TEXT NOT NULL,
  object_ldif_version TEXT,
  master_lists_ldif_path TEXT NOT NULL,
  master_lists_ldif_version TEXT,
  csca_count INTEGER NOT NULL,
  dsc_count INTEGER NOT NULL,
  crl_count INTEGER NOT NULL,
  ignored_bcsc INTEGER NOT NULL,
  ignored_bcsc_nc INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trust_store_cscas (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  aki_hex TEXT,
  der_base64 TEXT NOT NULL,
  issuer_key TEXT NOT NULL,
  issuer_name TEXT NOT NULL,
  master_list_sources_json TEXT NOT NULL,
  not_after TEXT NOT NULL,
  not_before TEXT NOT NULL,
  serial_number_hex TEXT NOT NULL,
  ski_hex TEXT,
  source_country_code TEXT,
  source_dn TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  subject_name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS trust_store_cscas_subject_serial_idx
  ON trust_store_cscas (subject_key, serial_number_hex);
CREATE INDEX IF NOT EXISTS trust_store_cscas_subject_key_idx
  ON trust_store_cscas (subject_key);
CREATE INDEX IF NOT EXISTS trust_store_cscas_ski_hex_idx
  ON trust_store_cscas (ski_hex);

CREATE TABLE IF NOT EXISTS trust_store_dscs (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  aki_hex TEXT,
  der_base64 TEXT NOT NULL,
  issuer_key TEXT NOT NULL,
  issuer_name TEXT NOT NULL,
  not_after TEXT NOT NULL,
  not_before TEXT NOT NULL,
  serial_number_hex TEXT NOT NULL,
  ski_hex TEXT,
  source_country_code TEXT,
  source_dn TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  subject_name TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS trust_store_dscs_issuer_serial_idx
  ON trust_store_dscs (issuer_key, serial_number_hex);
CREATE INDEX IF NOT EXISTS trust_store_dscs_ski_hex_idx
  ON trust_store_dscs (ski_hex);
CREATE INDEX IF NOT EXISTS trust_store_dscs_subject_key_idx
  ON trust_store_dscs (subject_key);

CREATE TABLE IF NOT EXISTS trust_store_crls (
  id INTEGER PRIMARY KEY NOT NULL,
  aki_hex TEXT,
  der_base64 TEXT NOT NULL,
  issuer_key TEXT NOT NULL,
  issuer_name TEXT NOT NULL,
  next_update TEXT,
  source_country_code TEXT,
  source_dn TEXT NOT NULL,
  this_update TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS trust_store_crls_issuer_key_idx
  ON trust_store_crls (issuer_key);
CREATE INDEX IF NOT EXISTS trust_store_crls_aki_hex_idx
  ON trust_store_crls (aki_hex);

CREATE TABLE IF NOT EXISTS trust_store_crl_revocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  crl_id INTEGER NOT NULL REFERENCES trust_store_crls(id) ON DELETE CASCADE,
  issuer_key TEXT NOT NULL,
  revoked_serial_number_hex TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS trust_store_crl_revocations_crl_id_idx
  ON trust_store_crl_revocations (crl_id);
CREATE INDEX IF NOT EXISTS trust_store_crl_revocations_issuer_serial_idx
  ON trust_store_crl_revocations (issuer_key, revoked_serial_number_hex);
