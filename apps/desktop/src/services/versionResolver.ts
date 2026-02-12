import { invoke } from "@tauri-apps/api/core";
import type { ServerConfig, ServerMetadata } from "../types";

export type LoaderKind = "vanilla" | "forge" | "fabric";

export type RequiredClientVersion = {
  loader: LoaderKind;
  mcVersion: string;
  loaderVersion: string | null;
  versionId: string | null;
};

const FABRIC_META = "https://meta.fabricmc.net/v2/versions";

function normalizeMcVersion(value: string): string {
  return value.split("-")[0]?.trim() || value.trim();
}

export function resolveRequiredClient(
  server: ServerConfig,
  metadata: ServerMetadata | null
): RequiredClientVersion {
  const fallbackMc = normalizeMcVersion(server.version);
  const mcVersion = metadata?.mcVersion && metadata.mcVersion !== "unknown"
    ? metadata.mcVersion
    : fallbackMc;
  const loader = metadata?.loader as LoaderKind | undefined;
  const serverLoader: LoaderKind = loader === "forge" || loader === "fabric"
    ? loader
    : server.server_type === "forge"
    ? "forge"
    : server.server_type === "fabric"
    ? "fabric"
    : "vanilla";

  if (serverLoader === "forge") {
    const parts = server.version.split("-");
    const forgeVersion = parts.length > 1 ? parts.slice(1).join("-") : null;
    return {
      loader: "forge",
      mcVersion,
      loaderVersion: forgeVersion,
      versionId: forgeVersion ? `${mcVersion}-forge-${forgeVersion}` : null
    };
  }

  if (serverLoader === "fabric") {
    return {
      loader: "fabric",
      mcVersion,
      loaderVersion: null,
      versionId: null
    };
  }

  return {
    loader: "vanilla",
    mcVersion,
    loaderVersion: null,
    versionId: mcVersion
  };
}

export async function fetchLatestFabricLoader(mcVersion: string): Promise<string> {
  const response = await fetch(`${FABRIC_META}/loader/${mcVersion}`);
  if (!response.ok) {
    throw new Error("Unable to fetch Fabric loader versions");
  }
  const loaders = (await response.json()) as Array<{ loader: { version: string; stable: boolean } }>;
  const stable = loaders.find((entry) => entry.loader?.stable);
  if (!stable?.loader?.version) {
    throw new Error("No stable Fabric loader found for this Minecraft version");
  }
  return stable.loader.version;
}

export function buildFabricVersionId(mcVersion: string, loaderVersion: string): string {
  return `fabric-loader-${loaderVersion}-${mcVersion}`;
}

export async function resolveForgeVersion(mcVersion: string): Promise<string> {
  const versions = await invoke<string[]>("get_forge_versions");
  const match = versions.find((value) => value.startsWith(`${mcVersion}-`));
  if (!match) {
    throw new Error("No Forge version found for this Minecraft version");
  }
  const parts = match.split("-");
  if (parts.length < 2) {
    throw new Error("Invalid Forge version format");
  }
  return parts.slice(1).join("-");
}
