import { open } from "@tauri-apps/plugin-dialog";
import type { WorldImportPayload, WorldSourceKind, WorldValidationResult } from "../types";
import { getWorldSourceKind } from "../utils/zipExtractor";
import { validateWorldSource } from "./worldValidator";

export type WorldSelectionResult = {
  sourcePath: string;
  sourceKind: WorldSourceKind;
  validation: WorldValidationResult;
};

export async function pickWorldFolder(): Promise<string | null> {
  const selection = await open({ directory: true, multiple: false });
  if (!selection || Array.isArray(selection)) return null;
  return selection;
}

export async function pickWorldZip(): Promise<string | null> {
  const selection = await open({
    multiple: false,
    filters: [{ name: "World backup", extensions: ["zip"] }]
  });
  if (!selection || Array.isArray(selection)) return null;
  return selection;
}

export async function pickAndValidateWorld(kind: WorldSourceKind): Promise<WorldSelectionResult | null> {
  const selection = kind === "zip" ? await pickWorldZip() : await pickWorldFolder();
  if (!selection) return null;

  const sourceKind = getWorldSourceKind(selection);
  const validation = await validateWorldSource(selection, sourceKind);
  return { sourcePath: selection, sourceKind, validation };
}

export function buildWorldImportPayload(
  sourcePath: string,
  validation: WorldValidationResult
): WorldImportPayload {
  return {
    source_path: sourcePath,
    source_kind: validation.source_kind,
    staged_path: validation.staged_path ?? null
  };
}
