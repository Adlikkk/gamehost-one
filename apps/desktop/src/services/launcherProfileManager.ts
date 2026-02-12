import { invoke } from "@tauri-apps/api/core";

export async function createLauncherProfile(versionId: string, serverName: string | null) {
  return invoke<string>("create_launcher_profile", { versionId, serverName });
}
