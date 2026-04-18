import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPkdCertificateRecord,
  createPkdCrlRecord,
  extractCscaCertificatesFromMasterList,
  type PkdCscaRecord,
  type PkdCertificateRecord,
  type PkdTrustBundleDscSegmentJson,
  type PkdTrustBundleJson,
  type PkdTrustBundleSource,
  parseDerCertificate,
  parseDerCertificateRevocationList,
  pkdTrustBundleDscSegmentKey,
  pkdTrustBundleKey,
  pkdTrustBundleVersion,
  relativeDistinguishedNameKey,
} from "../apps/api/src/v1/verify/pkd-trust";

type CliArgs = {
  masterListsPath: string;
  objectPath: string;
  outputPath: string;
};

type OutputFormat = "json" | "sql";

type LdifEntry = Map<string, string[]>;

type CscaAccumulator = {
  certBytes: Uint8Array;
  certRecord: PkdCscaRecord;
};

type DistinguishedNameAttribute = {
  name: string;
  value: string;
};

const USER_CERTIFICATE_BINARY = "usercertificate;binary";
const CRL_BINARY = "certificaterevocationlist;binary";
const MASTER_LIST_BINARY = "pkdmasterlistcontent;binary";
const LDIF_VERSION_REGEX = /-(\d+)\.ldif$/i;
const PKD_OBJECT_TYPES = new Set(["bcsc", "bcsc-nc", "cr", "crl", "dsc"]);
const MAX_DSCS_PER_SEGMENT = 1000;
const UNKNOWN_DSC_SEGMENT_KEY = "UNKNOWN";
const MAX_SQL_STATEMENT_LENGTH = 90_000;

function usage(): string {
  return [
    "Usage:",
    "  bun ./scripts/import-icao-pkd.ts --objects <path> --master-lists <path> --output <path>",
    "  Output ending in .sql generates a D1 seed file.",
    "  Output ending in .json generates the legacy R2 trust-bundle format.",
    "",
    "Example:",
    "  bun ./scripts/import-icao-pkd.ts \\",
    "    --objects ~/Downloads/icaopkd-001-complete-10023.ldif \\",
    "    --master-lists ~/Downloads/icaopkd-002-complete-508.ldif \\",
    "    --output /tmp/icao-pkd-trust-store.sql",
  ].join("\n");
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }

  let objectPath: string | null = null;
  let masterListsPath: string | null = null;
  let outputPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--objects") {
      objectPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (value === "--master-lists") {
      masterListsPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (value === "--output") {
      outputPath = argv[index + 1] ?? null;
      index += 1;
    }
  }

  if (!(objectPath && masterListsPath && outputPath)) {
    throw new Error(usage());
  }

  return {
    masterListsPath,
    objectPath,
    outputPath,
  };
}

function ldifVersionFromPath(filePath: string): string | null {
  const match = LDIF_VERSION_REGEX.exec(path.basename(filePath));
  return match?.[1] ?? null;
}

function dscSegmentDirectoryPath(outputPath: string): string {
  const parsed = path.parse(outputPath);
  return path.join(parsed.dir, `${parsed.name}.dsc-country`);
}

function dscCountrySegmentKey(record: PkdCertificateRecord): string {
  return record.sourceCountryCode?.toUpperCase() ?? UNKNOWN_DSC_SEGMENT_KEY;
}

function outputFormatFromPath(outputPath: string): OutputFormat {
  return path.extname(outputPath).toLowerCase() === ".sql" ? "sql" : "json";
}

function chunkItems<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function addIndexSegment(
  index: Record<string, string[]>,
  key: string,
  segmentKey: string
): void {
  const normalizedKey = key.toLowerCase();
  const existing = index[normalizedKey];

  if (existing) {
    if (!existing.includes(segmentKey)) {
      existing.push(segmentKey);
    }
    return;
  }

  index[normalizedKey] = [segmentKey];
}

function normalizeLdifText(text: string): string[] {
  const rawLines = text.replaceAll("\r\n", "\n").split("\n");
  const unfolded: string[] = [];

  for (const rawLine of rawLines) {
    if (rawLine.startsWith(" ")) {
      const previous = unfolded.pop();

      if (typeof previous !== "string") {
        throw new Error("LDIF continuation line found without a previous line");
      }

      unfolded.push(`${previous}${rawLine.slice(1)}`);
      continue;
    }

    unfolded.push(rawLine);
  }

  return unfolded;
}

function parseLdifEntries(text: string): LdifEntry[] {
  const unfoldedLines = normalizeLdifText(text);
  const entries: LdifEntry[] = [];
  let currentEntry = new Map<string, string[]>();

  for (const line of unfoldedLines) {
    if (line.length === 0) {
      if (currentEntry.size > 0) {
        entries.push(currentEntry);
        currentEntry = new Map<string, string[]>();
      }
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");

    if (separatorIndex <= 0) {
      throw new Error(
        `Invalid LDIF line format (missing colon separator): ${line}`,
      );
    }

    const rawName = line.slice(0, separatorIndex).toLowerCase();
    const isBase64 = line[separatorIndex + 1] === ":";
    const valueStart = separatorIndex + (isBase64 ? 2 : 1);
    const rawValue = line.slice(valueStart).trimStart();
    const values = currentEntry.get(rawName) ?? [];
    values.push(rawValue);
    currentEntry.set(rawName, values);
  }

  if (currentEntry.size > 0) {
    entries.push(currentEntry);
  }

  return entries;
}

function firstEntryValue(entry: LdifEntry, key: string): string | null {
  return entry.get(key.toLowerCase())?.[0] ?? null;
}

function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function splitEscaped(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let escaped = false;

  for (const character of input) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }

    if (character === separator) {
      parts.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  parts.push(current);
  return parts;
}

function unescapeDistinguishedNameValue(value: string): string {
  let output = "";
  let escaped = false;

  for (const character of value) {
    if (escaped) {
      output += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    output += character;
  }

  if (escaped) {
    output += "\\";
  }

  return output;
}

function firstUnescapedIndex(input: string, target: string): number {
  let escaped = false;

  for (const [index, character] of Array.from(input).entries()) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (character === target) {
      return index;
    }
  }

  return -1;
}

export function parseDistinguishedNameAttributes(
  distinguishedName: string
): DistinguishedNameAttribute[] {
  const attributes: DistinguishedNameAttribute[] = [];

  for (const rawComponent of splitEscaped(distinguishedName, ",")) {
    const separatorIndex = firstUnescapedIndex(rawComponent, "=");

    if (separatorIndex <= 0) {
      continue;
    }

    attributes.push({
      name: rawComponent.slice(0, separatorIndex).trim().toLowerCase(),
      value: unescapeDistinguishedNameValue(
        rawComponent.slice(separatorIndex + 1).trim()
      ),
    });
  }

  return attributes;
}

export function sourceCountryCode(dn: string): string | null {
  const attributes = parseDistinguishedNameAttributes(dn);

  for (let index = attributes.length - 1; index >= 0; index -= 1) {
    const attribute = attributes[index];

    if (attribute?.name === "c") {
      return attribute.value.toUpperCase();
    }
  }

  return null;
}

export function objectType(dn: string): string | null {
  const attributes = parseDistinguishedNameAttributes(dn);

  for (let index = attributes.length - 1; index >= 0; index -= 1) {
    const attribute = attributes[index];

    if (attribute?.name !== "o") {
      continue;
    }

    const normalizedValue = attribute.value.toLowerCase();

    if (PKD_OBJECT_TYPES.has(normalizedValue)) {
      return normalizedValue;
    }
  }

  return null;
}

async function importMasterListCscas({
  entries,
}: {
  entries: LdifEntry[];
}): Promise<PkdCscaRecord[]> {
  const cscasByKey = new Map<
    string,
    CscaAccumulator & {
      masterListSourcesByDn: Map<string, PkdTrustBundleSource>;
    }
  >();

  for (const entry of entries) {
    const dn = firstEntryValue(entry, "dn");
    const encodedMasterList = firstEntryValue(entry, MASTER_LIST_BINARY);

    if (!(dn && encodedMasterList)) {
      continue;
    }

    const masterListBytes = decodeBase64(encodedMasterList);
    const countryCode = sourceCountryCode(dn);
    const source = {
      countryCode,
      dn,
    } satisfies PkdTrustBundleSource;

    for (const cert of extractCscaCertificatesFromMasterList(masterListBytes)) {
      const certBytes = new Uint8Array(cert.toSchema().toBER(false));
      const key = `${relativeDistinguishedNameKey(cert.subject)}:${Buffer.from(certBytes).toString("base64")}`;
      const existing = cscasByKey.get(key);

      if (existing) {
        existing.masterListSourcesByDn.set(source.dn, source);
        continue;
      }

      const certRecord = (await createPkdCertificateRecord({
        cert,
        derBytes: certBytes,
        masterListSources: [source],
        sourceCountryCode: countryCode,
        sourceDn: dn,
      })) as PkdCscaRecord;

      cscasByKey.set(key, {
        certBytes,
        certRecord,
        masterListSourcesByDn: new Map([[source.dn, source]]),
      });
    }
  }

  return [...cscasByKey.values()].map((entry) => ({
    ...entry.certRecord,
    masterListSources: [...entry.masterListSourcesByDn.values()],
  }));
}

async function importObjectEntries({
  entries,
}: {
  entries: LdifEntry[];
}): Promise<{
  crls: PkdTrustBundleJson["crls"];
  dscs: PkdTrustBundleJson["dscs"];
  ignoredBcsc: number;
  ignoredBcscNc: number;
}> {
  const dscs: PkdTrustBundleJson["dscs"] = [];
  const crls: PkdTrustBundleJson["crls"] = [];
  let ignoredBcsc = 0;
  let ignoredBcscNc = 0;

  for (const entry of entries) {
    const dn = firstEntryValue(entry, "dn");

    if (!dn) {
      continue;
    }

    const type = objectType(dn);
    const countryCode = sourceCountryCode(dn);

    if (type === "bcsc") {
      ignoredBcsc += 1;
      continue;
    }

    if (type === "bcsc-nc") {
      ignoredBcscNc += 1;
      continue;
    }

    const encodedCertificate = firstEntryValue(entry, USER_CERTIFICATE_BINARY);

    if (encodedCertificate) {
      const certBytes = decodeBase64(encodedCertificate);
      const cert = parseDerCertificate(certBytes);
      dscs.push(
        await createPkdCertificateRecord({
          cert,
          derBytes: certBytes,
          sourceCountryCode: countryCode,
          sourceDn: dn,
        })
      );
      continue;
    }

    const encodedCrl = firstEntryValue(entry, CRL_BINARY);

    if (!encodedCrl) {
      continue;
    }

    const crlBytes = decodeBase64(encodedCrl);
    const crl = parseDerCertificateRevocationList(crlBytes);
    crls.push(
      createPkdCrlRecord({
        crl,
        derBytes: crlBytes,
        sourceCountryCode: countryCode,
        sourceDn: dn,
      })
    );
  }

  return {
    crls,
    dscs,
    ignoredBcsc,
    ignoredBcscNc,
  };
}

async function buildTrustBundle({
  masterListsPath,
  objectPath,
}: {
  masterListsPath: string;
  objectPath: string;
}): Promise<{
  manifest: PkdTrustBundleJson;
  segments: PkdTrustBundleDscSegmentJson[];
}> {
  const { cscas, objectEntries } = await loadImportedTrustStoreEntries({
    masterListsPath,
    objectPath,
  });
  const dscSegmentIndex: NonNullable<PkdTrustBundleJson["dscSegmentIndex"]> = {
    issuerSerial: {},
    skiHex: {},
  };
  const dscsByCountrySegment = new Map<string, PkdCertificateRecord[]>();

  for (const record of objectEntries.dscs) {
    const countrySegment = dscCountrySegmentKey(record);
    const segmentEntries = dscsByCountrySegment.get(countrySegment);

    if (segmentEntries) {
      segmentEntries.push(record);
    } else {
      dscsByCountrySegment.set(countrySegment, [record]);
    }
  }

  const segments = [...dscsByCountrySegment.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([countrySegment, dscs]) =>
      chunkItems(dscs, MAX_DSCS_PER_SEGMENT).map((segmentDscs, index, chunks) => {
        const segmentKey =
          chunks.length === 1
            ? countrySegment
            : `${countrySegment}-${String(index + 1).padStart(2, "0")}`;

        for (const record of segmentDscs) {
          addIndexSegment(
            dscSegmentIndex.issuerSerial,
            `${record.issuerKey}:${record.serialNumberHex.toLowerCase()}`,
            segmentKey
          );

          if (record.skiHex) {
            addIndexSegment(dscSegmentIndex.skiHex, record.skiHex, segmentKey);
          }
        }

        return {
          dscs: segmentDscs,
          segmentKey,
          version: pkdTrustBundleVersion(),
        };
      })
    );

  return {
    manifest: {
      counts: {
        cscas: cscas.length,
        crls: objectEntries.crls.length,
        dscs: objectEntries.dscs.length,
        ignoredBcsc: objectEntries.ignoredBcsc,
        ignoredBcscNc: objectEntries.ignoredBcscNc,
      },
      cscas,
      crls: objectEntries.crls,
      dscSegmentIndex,
      dscs: [],
      generatedAt: new Date().toISOString(),
      sources: {
        masterListsLdif: {
          path: masterListsPath,
          version: ldifVersionFromPath(masterListsPath),
        },
        objectLdif: {
          path: objectPath,
          version: ldifVersionFromPath(objectPath),
        },
      },
      version: pkdTrustBundleVersion(),
    },
    segments,
  };
}

async function loadImportedTrustStoreEntries({
  masterListsPath,
  objectPath,
}: {
  masterListsPath: string;
  objectPath: string;
}): Promise<{
  cscas: PkdCscaRecord[];
  objectEntries: Awaited<ReturnType<typeof importObjectEntries>>;
}> {
  const [masterListsText, objectText] = await Promise.all([
    readFile(masterListsPath, "utf8"),
    readFile(objectPath, "utf8"),
  ]);
  const [cscas, objectEntries] = await Promise.all([
    importMasterListCscas({
      entries: parseLdifEntries(masterListsText),
    }),
    importObjectEntries({
      entries: parseLdifEntries(objectText),
    }),
  ]);

  return {
    cscas,
    objectEntries,
  };
}

function sqlLiteral(value: boolean | number | string | null): string {
  if (value === null) {
    return "NULL";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }

  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }

  return `'${value.replaceAll("'", "''")}'`;
}

function buildInsertStatements(
  columns: string[],
  rows: string[][],
  tableName: string
): string[] {
  if (rows.length === 0) {
    return [];
  }

  const prefix = `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES `;
  const statements: string[] = [];
  let currentValues: string[] = [];
  let currentLength = prefix.length;

  for (const row of rows) {
    const rowSql = `(${row.join(", ")})`;
    const separatorLength = currentValues.length === 0 ? 0 : 2;

    if (
      currentValues.length > 0 &&
      currentLength + separatorLength + rowSql.length + 1 >
        MAX_SQL_STATEMENT_LENGTH
    ) {
      statements.push(`${prefix}${currentValues.join(", ")};`);
      currentValues = [rowSql];
      currentLength = prefix.length + rowSql.length;
      continue;
    }

    currentValues.push(rowSql);
    currentLength += separatorLength + rowSql.length;
  }

  if (currentValues.length > 0) {
    statements.push(`${prefix}${currentValues.join(", ")};`);
  }

  return statements;
}

async function buildTrustStoreSeedSql({
  masterListsPath,
  objectPath,
}: {
  masterListsPath: string;
  objectPath: string;
}): Promise<string> {
  const { cscas, objectEntries } = await loadImportedTrustStoreEntries({
    masterListsPath,
    objectPath,
  });
  const generatedAt = new Date().toISOString();
  const metadataRows = [
    [
      sqlLiteral(1),
      sqlLiteral(generatedAt),
      sqlLiteral(pkdTrustBundleVersion()),
      sqlLiteral(objectPath),
      sqlLiteral(ldifVersionFromPath(objectPath)),
      sqlLiteral(masterListsPath),
      sqlLiteral(ldifVersionFromPath(masterListsPath)),
      sqlLiteral(cscas.length),
      sqlLiteral(objectEntries.dscs.length),
      sqlLiteral(objectEntries.crls.length),
      sqlLiteral(objectEntries.ignoredBcsc),
      sqlLiteral(objectEntries.ignoredBcscNc),
    ],
  ];
  const cscaRows = cscas.map((record) => [
    sqlLiteral(record.akiHex),
    sqlLiteral(record.derBase64),
    sqlLiteral(record.issuerKey),
    sqlLiteral(record.issuerName),
    sqlLiteral(JSON.stringify(record.masterListSources)),
    sqlLiteral(record.notAfter),
    sqlLiteral(record.notBefore),
    sqlLiteral(record.serialNumberHex.toLowerCase()),
    sqlLiteral(record.skiHex),
    sqlLiteral(record.sourceCountryCode),
    sqlLiteral(record.sourceDn),
    sqlLiteral(record.subjectKey),
    sqlLiteral(record.subjectName),
  ]);
  const dscRows = objectEntries.dscs.map((record) => [
    sqlLiteral(record.akiHex),
    sqlLiteral(record.derBase64),
    sqlLiteral(record.issuerKey),
    sqlLiteral(record.issuerName),
    sqlLiteral(record.notAfter),
    sqlLiteral(record.notBefore),
    sqlLiteral(record.serialNumberHex.toLowerCase()),
    sqlLiteral(record.skiHex),
    sqlLiteral(record.sourceCountryCode),
    sqlLiteral(record.sourceDn),
    sqlLiteral(record.subjectKey),
    sqlLiteral(record.subjectName),
  ]);
  const crlRows = objectEntries.crls.map((record, index) => [
    sqlLiteral(index + 1),
    sqlLiteral(record.akiHex),
    sqlLiteral(record.derBase64),
    sqlLiteral(record.issuerKey),
    sqlLiteral(record.issuerName),
    sqlLiteral(record.nextUpdate),
    sqlLiteral(record.sourceCountryCode),
    sqlLiteral(record.sourceDn),
    sqlLiteral(record.thisUpdate),
  ]);
  const crlRevocationRows = objectEntries.crls.flatMap((record, index) =>
    record.revokedSerialNumbersHex.map((revokedSerialNumberHex) => [
      sqlLiteral(index + 1),
      sqlLiteral(record.issuerKey),
      sqlLiteral(revokedSerialNumberHex.toLowerCase()),
    ])
  );

  const statements = [
    "PRAGMA foreign_keys = ON;",
    "DELETE FROM trust_store_crl_revocations;",
    "DELETE FROM trust_store_crls;",
    "DELETE FROM trust_store_dscs;",
    "DELETE FROM trust_store_cscas;",
    "DELETE FROM trust_store_metadata;",
    ...buildInsertStatements(
      [
        "id",
        "generated_at",
        "version",
        "object_ldif_path",
        "object_ldif_version",
        "master_lists_ldif_path",
        "master_lists_ldif_version",
        "csca_count",
        "dsc_count",
        "crl_count",
        "ignored_bcsc",
        "ignored_bcsc_nc",
      ],
      metadataRows,
      "trust_store_metadata"
    ),
    ...buildInsertStatements(
      [
        "aki_hex",
        "der_base64",
        "issuer_key",
        "issuer_name",
        "master_list_sources_json",
        "not_after",
        "not_before",
        "serial_number_hex",
        "ski_hex",
        "source_country_code",
        "source_dn",
        "subject_key",
        "subject_name",
      ],
      cscaRows,
      "trust_store_cscas"
    ),
    ...buildInsertStatements(
      [
        "aki_hex",
        "der_base64",
        "issuer_key",
        "issuer_name",
        "not_after",
        "not_before",
        "serial_number_hex",
        "ski_hex",
        "source_country_code",
        "source_dn",
        "subject_key",
        "subject_name",
      ],
      dscRows,
      "trust_store_dscs"
    ),
    ...buildInsertStatements(
      [
        "id",
        "aki_hex",
        "der_base64",
        "issuer_key",
        "issuer_name",
        "next_update",
        "source_country_code",
        "source_dn",
        "this_update",
      ],
      crlRows,
      "trust_store_crls"
    ),
    ...buildInsertStatements(
      ["crl_id", "issuer_key", "revoked_serial_number_hex"],
      crlRevocationRows,
      "trust_store_crl_revocations"
    ),
    "",
  ];

  return `${statements.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outputFormat = outputFormatFromPath(args.outputPath);
  await mkdir(path.dirname(args.outputPath), {
    recursive: true,
  });

  if (outputFormat === "sql") {
    const sql = await buildTrustStoreSeedSql({
      masterListsPath: args.masterListsPath,
      objectPath: args.objectPath,
    });

    await writeFile(args.outputPath, sql, "utf8");

    process.stdout.write(
      [
        "ICAO PKD import complete.",
        `Output: ${args.outputPath}`,
        "Format: sql",
        "Target: D1 trust-store seed",
        `Object LDIF version: ${ldifVersionFromPath(args.objectPath) ?? "unknown"}`,
        `Master-list LDIF version: ${ldifVersionFromPath(args.masterListsPath) ?? "unknown"}`,
      ].join("\n")
    );
    return;
  }

  const bundle = await buildTrustBundle({
    masterListsPath: args.masterListsPath,
    objectPath: args.objectPath,
  });
  const segmentDir = dscSegmentDirectoryPath(args.outputPath);
  await rm(segmentDir, {
    force: true,
    recursive: true,
  });
  await mkdir(segmentDir, {
    recursive: true,
  });
  await writeFile(
    args.outputPath,
    `${JSON.stringify(bundle.manifest)}\n`,
    "utf8"
  );

  for (const segment of bundle.segments) {
    await writeFile(
      path.join(segmentDir, `${segment.segmentKey}.json`),
      `${JSON.stringify(segment)}\n`,
      "utf8"
    );
  }

  process.stdout.write(
    [
      "ICAO PKD import complete.",
      `Output: ${args.outputPath}`,
      "Format: json",
      `Runtime key: ${pkdTrustBundleKey()}`,
      `DSC segment directory: ${segmentDir}`,
      `DSC segment runtime prefix: ${pkdTrustBundleDscSegmentKey("<segment>").replace("/<segment>.json", "")}`,
      `CSCA count: ${bundle.manifest.counts.cscas}`,
      `DSC count: ${bundle.manifest.counts.dscs}`,
      `CRL count: ${bundle.manifest.counts.crls}`,
      `Ignored BCSC count: ${bundle.manifest.counts.ignoredBcsc}`,
      `Ignored BCSC-NC count: ${bundle.manifest.counts.ignoredBcscNc}`,
      `Object LDIF version: ${bundle.manifest.sources.objectLdif.version ?? "unknown"}`,
      `Master-list LDIF version: ${bundle.manifest.sources.masterListsLdif.version ?? "unknown"}`,
    ].join("\n")
  );
}

if (import.meta.main) {
  await main();
}
