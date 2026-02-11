import { invoke } from "@tauri-apps/api/core";
import type { ServerMetadata } from "../types";

export async function getServerMetadata(serverId: string): Promise<ServerMetadata | null> {
  return invoke<ServerMetadata | null>("get_server_metadata", { serverId });
}

export async function detectServerMetadata(serverId: string): Promise<ServerMetadata> {
  return invoke<ServerMetadata>("detect_server_metadata", { serverId });
}
