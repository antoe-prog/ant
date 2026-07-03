import { readFile } from "node:fs/promises";

export const DEFAULT_IOS_RELEASE_CONFIG_PATH = "mobile/ios/release-config.json";

export function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export async function readIosReleaseConfig(configPath = DEFAULT_IOS_RELEASE_CONFIG_PATH) {
  try {
    return JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    return {};
  }
}

export function resolveIosTeamId({ cliTeamId, config = {}, env = process.env }) {
  return text(cliTeamId) ?? text(env.APPLE_TEAM_ID) ?? text(env.IOS_TEAM_ID) ?? text(config.appleTeamId) ?? null;
}

export function resolveIosBundleId({ cliBundleId, config = {}, env = process.env, fallbackBundleId = null }) {
  return text(cliBundleId) ?? text(env.IOS_BUNDLE_ID) ?? text(config.bundleId) ?? text(fallbackBundleId) ?? null;
}
