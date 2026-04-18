DROP INDEX IF EXISTS trust_store_cscas_subject_serial_idx;

CREATE INDEX IF NOT EXISTS trust_store_cscas_subject_serial_idx
  ON trust_store_cscas (subject_key, serial_number_hex);
