import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const trust_store_metadata = sqliteTable("trust_store_metadata", {
  id: integer("id").primaryKey(),
  generatedAt: text("generated_at").notNull(),
  version: integer("version").notNull(),
  objectLdifPath: text("object_ldif_path").notNull(),
  objectLdifVersion: text("object_ldif_version"),
  masterListsLdifPath: text("master_lists_ldif_path").notNull(),
  masterListsLdifVersion: text("master_lists_ldif_version"),
  cscaCount: integer("csca_count").notNull(),
  dscCount: integer("dsc_count").notNull(),
  crlCount: integer("crl_count").notNull(),
  ignoredBcsc: integer("ignored_bcsc").notNull(),
  ignoredBcscNc: integer("ignored_bcsc_nc").notNull(),
});

export const trust_store_cscas = sqliteTable(
  "trust_store_cscas",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    akiHex: text("aki_hex"),
    derBase64: text("der_base64").notNull(),
    issuerKey: text("issuer_key").notNull(),
    issuerName: text("issuer_name").notNull(),
    masterListSourcesJson: text("master_list_sources_json").notNull(),
    notAfter: text("not_after").notNull(),
    notBefore: text("not_before").notNull(),
    serialNumberHex: text("serial_number_hex").notNull(),
    skiHex: text("ski_hex"),
    sourceCountryCode: text("source_country_code"),
    sourceDn: text("source_dn").notNull(),
    subjectKey: text("subject_key").notNull(),
    subjectName: text("subject_name").notNull(),
  },
  (table) => [
    index("trust_store_cscas_subject_serial_idx").on(
      table.subjectKey,
      table.serialNumberHex
    ),
    index("trust_store_cscas_subject_key_idx").on(table.subjectKey),
    index("trust_store_cscas_ski_hex_idx").on(table.skiHex),
  ]
);

export const trust_store_dscs = sqliteTable(
  "trust_store_dscs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    akiHex: text("aki_hex"),
    derBase64: text("der_base64").notNull(),
    issuerKey: text("issuer_key").notNull(),
    issuerName: text("issuer_name").notNull(),
    notAfter: text("not_after").notNull(),
    notBefore: text("not_before").notNull(),
    serialNumberHex: text("serial_number_hex").notNull(),
    skiHex: text("ski_hex"),
    sourceCountryCode: text("source_country_code"),
    sourceDn: text("source_dn").notNull(),
    subjectKey: text("subject_key").notNull(),
    subjectName: text("subject_name").notNull(),
  },
  (table) => [
    uniqueIndex("trust_store_dscs_issuer_serial_idx").on(
      table.issuerKey,
      table.serialNumberHex
    ),
    index("trust_store_dscs_ski_hex_idx").on(table.skiHex),
    index("trust_store_dscs_subject_key_idx").on(table.subjectKey),
  ]
);

export const trust_store_crls = sqliteTable(
  "trust_store_crls",
  {
    id: integer("id").primaryKey(),
    akiHex: text("aki_hex"),
    derBase64: text("der_base64").notNull(),
    issuerKey: text("issuer_key").notNull(),
    issuerName: text("issuer_name").notNull(),
    nextUpdate: text("next_update"),
    sourceCountryCode: text("source_country_code"),
    sourceDn: text("source_dn").notNull(),
    thisUpdate: text("this_update").notNull(),
  },
  (table) => [
    index("trust_store_crls_issuer_key_idx").on(table.issuerKey),
    index("trust_store_crls_aki_hex_idx").on(table.akiHex),
  ]
);

export const trust_store_crl_revocations = sqliteTable(
  "trust_store_crl_revocations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    crlId: integer("crl_id")
      .notNull()
      .references(() => trust_store_crls.id, {
        onDelete: "cascade",
      }),
    issuerKey: text("issuer_key").notNull(),
    revokedSerialNumberHex: text("revoked_serial_number_hex").notNull(),
  },
  (table) => [
    index("trust_store_crl_revocations_crl_id_idx").on(table.crlId),
    index("trust_store_crl_revocations_issuer_serial_idx").on(
      table.issuerKey,
      table.revokedSerialNumberHex
    ),
  ]
);
