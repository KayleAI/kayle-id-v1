import { appendFileSync } from "node:fs";
import {
  type AppStoreConnectConfig,
  type AppStoreConnectEnv,
  fetchAppStoreConnectJson,
  readAppStoreConnectConfig,
} from "./app-store-connect";

const VERSION_REGEX = /^\d+\.\d+\.\d+$/;
const NUMBER_REGEX = /^\d+$/;
const APP_STORE_PLATFORM = "IOS";
const INITIAL_BUILD_NUMBER = 1;

interface AppStoreCollection<T> {
  data: T[];
  links?: {
    next?: string;
  };
}

interface AppResource {
  attributes?: {
    bundleId?: string;
  };
  id: string;
}

interface PreReleaseVersionResource {
  attributes?: {
    platform?: string;
    version?: string;
  };
  id: string;
}

interface BuildResource {
  attributes?: {
    version?: string;
  };
}

interface ResolveIosBuildNumberEnv extends AppStoreConnectEnv {
  APP_BUNDLE_ID?: string;
  APP_VERSION?: string;
}

export interface IosBuildNumberResolution {
  appId: string;
  buildNumber: number;
  bundleVersion: string;
  latestBundleVersion: string | null;
}

function requireInput(
  env: ResolveIosBuildNumberEnv,
  name: keyof ResolveIosBuildNumberEnv
) {
  const value = env[name] ?? process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var ${name}.`);
  }
  return value;
}

function createPath(
  pathname: string,
  params: Record<string, string | number>
): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    searchParams.set(key, String(value));
  }
  return `${pathname}?${searchParams.toString()}`;
}

function nextPathFromLink(next: string): string {
  if (!(next.startsWith("http://") || next.startsWith("https://"))) {
    return next;
  }

  const url = new URL(next);
  return `${url.pathname}${url.search}`;
}

async function fetchCollection<T>(
  config: AppStoreConnectConfig,
  initialPath: string
): Promise<T[]> {
  let path: string | null = initialPath;
  const items: T[] = [];

  while (path) {
    const page = await fetchAppStoreConnectJson<AppStoreCollection<T>>(
      config,
      path
    );
    items.push(...page.data);
    path = page.links?.next ? nextPathFromLink(page.links.next) : null;
  }

  return items;
}

function parseExistingBuildNumber(
  appVersion: string,
  bundleVersion: string
): number | null {
  const prefix = `${appVersion}.`;
  if (!bundleVersion.startsWith(prefix)) {
    return null;
  }

  const suffix = bundleVersion.slice(prefix.length);
  if (!NUMBER_REGEX.test(suffix)) {
    return null;
  }

  const parsed = Number(suffix);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

function maxExistingBuildNumber(
  appVersion: string,
  builds: BuildResource[]
): { latestBundleVersion: string | null; maxBuildNumber: number } {
  let latestBundleVersion: string | null = null;
  let maxBuildNumber = 0;
  const unrecognizedBundleVersions: string[] = [];

  for (const build of builds) {
    const bundleVersion = build.attributes?.version;
    if (!bundleVersion) {
      continue;
    }

    const buildNumber = parseExistingBuildNumber(appVersion, bundleVersion);
    if (buildNumber === null) {
      unrecognizedBundleVersions.push(bundleVersion);
      continue;
    }

    if (buildNumber > maxBuildNumber) {
      maxBuildNumber = buildNumber;
      latestBundleVersion = bundleVersion;
    }
  }

  if (maxBuildNumber === 0 && unrecognizedBundleVersions.length > 0) {
    throw new Error(
      `Unable to derive the next iOS build number. Expected existing CFBundleVersion values like ${appVersion}.N, received: ${unrecognizedBundleVersions.join(
        ", "
      )}.`
    );
  }

  return { latestBundleVersion, maxBuildNumber };
}

async function findAppId(input: {
  bundleId: string;
  config: AppStoreConnectConfig;
}): Promise<string> {
  const apps = await fetchCollection<AppResource>(
    input.config,
    createPath("/v1/apps", {
      "fields[apps]": "bundleId",
      "filter[bundleId]": input.bundleId,
      limit: 2,
    })
  );

  if (apps.length === 0) {
    throw new Error(
      `No App Store Connect app found for bundle id ${input.bundleId}.`
    );
  }

  if (apps.length > 1) {
    throw new Error(
      `Expected one App Store Connect app for bundle id ${input.bundleId}, received ${apps.length}.`
    );
  }

  return apps[0].id;
}

async function findPreReleaseVersionId(input: {
  appId: string;
  appVersion: string;
  config: AppStoreConnectConfig;
}): Promise<string | null> {
  const versions = await fetchCollection<PreReleaseVersionResource>(
    input.config,
    createPath(`/v1/apps/${input.appId}/preReleaseVersions`, {
      "fields[preReleaseVersions]": "platform,version",
      limit: 200,
    })
  );

  const matchingVersions = versions.filter(
    (version) =>
      version.attributes?.version === input.appVersion &&
      version.attributes?.platform === APP_STORE_PLATFORM
  );

  if (matchingVersions.length === 0) {
    return null;
  }

  if (matchingVersions.length > 1) {
    throw new Error(
      `Expected one iOS prerelease version for ${input.appVersion}, received ${matchingVersions.length}.`
    );
  }

  return matchingVersions[0].id;
}

function listPreReleaseBuilds(input: {
  config: AppStoreConnectConfig;
  preReleaseVersionId: string;
}): Promise<BuildResource[]> {
  return fetchCollection<BuildResource>(
    input.config,
    createPath(`/v1/preReleaseVersions/${input.preReleaseVersionId}/builds`, {
      "fields[builds]": "version",
      limit: 200,
    })
  );
}

export async function resolveIosBuildNumber(
  env: ResolveIosBuildNumberEnv
): Promise<IosBuildNumberResolution> {
  const appVersion = requireInput(env, "APP_VERSION");
  if (!VERSION_REGEX.test(appVersion)) {
    throw new Error(
      `APP_VERSION must be a numeric semver like 1.2.3. Received ${appVersion}.`
    );
  }

  const bundleId = requireInput(env, "APP_BUNDLE_ID");
  const config = readAppStoreConnectConfig(env);
  const appId = await findAppId({ bundleId, config });
  const preReleaseVersionId = await findPreReleaseVersionId({
    appId,
    appVersion,
    config,
  });

  if (!preReleaseVersionId) {
    return {
      appId,
      buildNumber: INITIAL_BUILD_NUMBER,
      bundleVersion: `${appVersion}.${INITIAL_BUILD_NUMBER}`,
      latestBundleVersion: null,
    };
  }

  const builds = await listPreReleaseBuilds({ config, preReleaseVersionId });
  const { latestBundleVersion, maxBuildNumber } = maxExistingBuildNumber(
    appVersion,
    builds
  );
  const buildNumber = maxBuildNumber + 1 || INITIAL_BUILD_NUMBER;

  return {
    appId,
    buildNumber,
    bundleVersion: `${appVersion}.${buildNumber}`,
    latestBundleVersion,
  };
}

function writeGithubOutput(name: string, value: string | number): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }

  appendFileSync(outputPath, `${name}=${value}\n`);
}

async function main(): Promise<void> {
  const resolution = await resolveIosBuildNumber({});
  if (resolution.latestBundleVersion) {
    console.log(
      `Latest App Store Connect build for this version is ${resolution.latestBundleVersion}; using ${resolution.bundleVersion}.`
    );
  } else {
    console.log(
      `No App Store Connect builds found for this version; using ${resolution.bundleVersion}.`
    );
  }

  writeGithubOutput("app_id", resolution.appId);
  writeGithubOutput("build_number", resolution.buildNumber);
  writeGithubOutput("bundle_version", resolution.bundleVersion);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
