import { open } from "@tauri-apps/plugin-dialog";
import type { ModsValidationResult, WorldSourceKind } from "../types";
import { getWorldSourceKind } from "../utils/zipExtractor";
import { validateModsSource } from "./modValidator";

export type ModsSelectionResult = {
  sourcePath: string;
  sourceKind: WorldSourceKind;
  validation: ModsValidationResult;
};

export async function pickModsFolder(): Promise<string | null> {
  const selection = await open({ directory: true, multiple: false });
  if (!selection || Array.isArray(selection)) return null;
  return selection;
}

export async function pickModpackZip(): Promise<string | null> {
  const selection = await open({
    multiple: false,
    filters: [{ name: "Modpack", extensions: ["zip"] }]
  });
  if (!selection || Array.isArray(selection)) return null;
  return selection;
}

export async function pickAndValidateMods(kind: WorldSourceKind): Promise<ModsSelectionResult | null> {
  const selection = kind === "zip" ? await pickModpackZip() : await pickModsFolder();
  if (!selection) return null;

  const sourceKind = getWorldSourceKind(selection);
  const validation = await validateModsSource(selection, sourceKind);
  return { sourcePath: selection, sourceKind, validation };
}
