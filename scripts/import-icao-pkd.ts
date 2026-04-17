import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPkdCertificateRecord,
  createPkdCrlRecord,
  extractCscaCertificatesFromMasterList,
  type PkdCscaRecord,
  type PkdTrustBundleJson,
  type PkdTrustBundleSource,
  parseDerCertificate,
  parseDerCertificateRevocationList,
  pkdTrustBundleKey,
  pkdTrustBundleVersion,
  relativeDistinguishedNameKey,
} from "../apps/api/src/v1/verify/pkd-trust";

type CliArgs = {
  masterListsPath: string;
  objectPath: string;
  outputPath: string;
};

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

function usage(): string {
  return [
    "Usage:",
    "  bun ./scripts/import-icao-pkd.ts --objects <path> --master-lists <path> --output <path>",
    "",
    "Example:",
    "  bun ./scripts/import-icao-pkd.ts \\",
    "    --objects ~/Downloads/icaopkd-001-complete-10023.ldif \\",
    "    --master-lists ~/Downloads/icaopkd-002-complete-508.ldif \\",
    "    --output /tmp/icao-pkd-bundle.json",
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

function normalizeLdifText(text: string): string[] {
  const rawLines = text.replaceAll("\r\n", "\n").split("\n");
  const unfolded: string[] = [];

  for (const rawLine of rawLines) {
    if (rawLine.startsWith(" ")) {
      const previous = unfolded.pop();

      if (typeof previous !== "string") {
        throw new Error("ldif_continuation_without_previous_line");
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
      throw new Error(`ldif_line_invalid:${line}`);
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
}): Promise<PkdTrustBundleJson> {
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
    counts: {
      cscas: cscas.length,
      crls: objectEntries.crls.length,
      dscs: objectEntries.dscs.length,
      ignoredBcsc: objectEntries.ignoredBcsc,
      ignoredBcscNc: objectEntries.ignoredBcscNc,
    },
    cscas,
    crls: objectEntries.crls,
    dscs: objectEntries.dscs,
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
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const bundle = await buildTrustBundle({
    masterListsPath: args.masterListsPath,
    objectPath: args.objectPath,
  });
  await mkdir(path.dirname(args.outputPath), {
    recursive: true,
  });
  await writeFile(args.outputPath, `${JSON.stringify(bundle)}\n`, "utf8");

  process.stdout.write(
    [
      "ICAO PKD import complete.",
      `Output: ${args.outputPath}`,
      `Runtime key: ${pkdTrustBundleKey()}`,
      `CSCA count: ${bundle.counts.cscas}`,
      `DSC count: ${bundle.counts.dscs}`,
      `CRL count: ${bundle.counts.crls}`,
      `Ignored BCSC count: ${bundle.counts.ignoredBcsc}`,
      `Ignored BCSC-NC count: ${bundle.counts.ignoredBcscNc}`,
      `Object LDIF version: ${bundle.sources.objectLdif.version ?? "unknown"}`,
      `Master-list LDIF version: ${bundle.sources.masterListsLdif.version ?? "unknown"}`,
    ].join("\n")
  );
}

if (import.meta.main) {
  await main();
}
