import { invoke } from "@tauri-apps/api/core";
import type { ClientDetectionResult, ClientVersionInfo, MinecraftClientStatus } from "../types";

export async function detectClient(): Promise<ClientDetectionResult> {
  const status = await invoke<MinecraftClientStatus>("detect_minecraft_client");
  if (!status.running || !status.mcVersion) {
    return {
      running: false,
      versionId: status.mcVersion ?? null,
      mcVersion: null,
      loader: null,
      pid: status.pid ?? null
    };
  }

  let info: ClientVersionInfo | null = null;
  try {
    info = await invoke<ClientVersionInfo | null>("get_client_version_info", {
      versionId: status.mcVersion
    });
  } catch {
    info = null;
  }

  return {
    running: status.running,
    versionId: status.mcVersion ?? null,
    mcVersion: info?.mcVersion ?? status.mcVersion ?? null,
    loader: info?.loader ?? status.loader ?? null,
    pid: status.pid ?? null
  };
}
