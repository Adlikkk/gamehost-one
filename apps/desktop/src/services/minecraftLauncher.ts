import { invoke } from "@tauri-apps/api/core";
import type { LauncherChoice } from "../types";

export async function launchMinecraft(
  choice: LauncherChoice,
  version: string | null,
  serverName: string | null
) {
  return invoke("launch_minecraft", { choice, version, serverName });
}
