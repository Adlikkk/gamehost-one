import { invoke } from "@tauri-apps/api/core";
import type { RequiredClientVersion } from "./versionResolver";
import { buildFabricVersionId, fetchLatestFabricLoader, resolveForgeVersion } from "./versionResolver";

export type LoaderInstallResult = {
  versionId: string;
  loader: RequiredClientVersion["loader"];
  loaderVersion: string | null;
};

async function isVersionInstalled(versionId: string): Promise<boolean> {
  return invoke<boolean>("is_client_version_installed", { versionId });
}

export async function ensureClientLoaderInstalled(
  required: RequiredClientVersion
): Promise<LoaderInstallResult> {
  if (required.loader === "vanilla") {
    if (!required.versionId) {
      throw new Error("Missing Minecraft version for vanilla client.");
    }
    const installed = await isVersionInstalled(required.versionId);
    if (!installed) {
      throw new Error("Vanilla client version is not installed.");
    }
    return { versionId: required.versionId, loader: "vanilla", loaderVersion: null };
  }

  if (required.loader === "forge") {
    const loaderVersion = required.loaderVersion ?? (await resolveForgeVersion(required.mcVersion));
    const versionId = `${required.mcVersion}-forge-${loaderVersion}`;
    if (await isVersionInstalled(versionId)) {
      return { versionId, loader: "forge", loaderVersion };
    }
    const installedVersionId = await invoke<string>("install_forge_client_cmd", {
      mcVersion: required.mcVersion,
      forgeVersion: loaderVersion
    });
    return { versionId: installedVersionId, loader: "forge", loaderVersion };
  }

  if (required.loader === "fabric") {
    let loaderVersion = required.loaderVersion;
    if (!loaderVersion) {
      loaderVersion = await fetchLatestFabricLoader(required.mcVersion);
    }
    const versionId = buildFabricVersionId(required.mcVersion, loaderVersion);
    if (await isVersionInstalled(versionId)) {
      return { versionId, loader: "fabric", loaderVersion };
    }
    const installedVersionId = await invoke<string>("install_fabric_client_cmd", {
      mcVersion: required.mcVersion,
      loaderVersion
    });
    return { versionId: installedVersionId, loader: "fabric", loaderVersion };
  }

  throw new Error("Unsupported loader type.");
}
