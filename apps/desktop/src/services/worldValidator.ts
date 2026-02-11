import { invoke } from "@tauri-apps/api/core";
import type { WorldSourceKind, WorldValidationResult } from "../types";

export async function validateWorldSource(
  sourcePath: string,
  sourceKind: WorldSourceKind
): Promise<WorldValidationResult> {
  return invoke<WorldValidationResult>("validate_world_source", { sourcePath, sourceKind });
}
