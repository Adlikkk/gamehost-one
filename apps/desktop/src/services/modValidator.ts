import { invoke } from "@tauri-apps/api/core";
import type { ModsValidationResult, WorldSourceKind } from "../types";

export async function validateModsSource(
  sourcePath: string,
  sourceKind: WorldSourceKind
): Promise<ModsValidationResult> {
  return invoke<ModsValidationResult>("validate_mods_source", { sourcePath, sourceKind });
}
