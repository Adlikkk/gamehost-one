import type { ModsValidationResult, WorldValidationResult } from "../types";

export type ModComparison = {
  mismatch: boolean;
  reason: string | null;
};

export function compareWorldMods(
  worldValidation: WorldValidationResult | null,
  modsValidation: ModsValidationResult | null
): ModComparison {
  if (!worldValidation?.valid) {
    return { mismatch: false, reason: null };
  }

  const modded = worldValidation.detected_type === "forge";
  if (!modded) {
    return { mismatch: false, reason: null };
  }

  if (!modsValidation?.valid) {
    return {
      mismatch: true,
      reason: "This world looks modded but no mods were added yet."
    };
  }

  return { mismatch: false, reason: null };
}
