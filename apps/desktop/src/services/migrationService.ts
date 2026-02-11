import type { ModsValidationResult, ServerConfig, WorldValidationResult } from "../types";

export type MigrationHost = "aternos" | "minehut" | "other" | "zip";

export type MigrationInstructions = {
  title: string;
  steps: string[];
  helpUrl?: string;
};

export type MigrationDetection = {
  loader: ServerConfig["server_type"];
  version: string | null;
  modded: boolean;
};

const HELP_LINKS: Record<Exclude<MigrationHost, "zip">, string> = {
  aternos: "https://support.aternos.org/hc/en-us/articles/360027235971-Download-your-world",
  minehut: "https://support.minehut.com/hc/en-us/articles/4413595127709-World-Download",
  other: "https://minecraft.wiki/w/Tutorials/World_backup"
};

export function getMigrationInstructions(host: MigrationHost | null): MigrationInstructions | null {
  if (!host) return null;
  if (host === "aternos") {
    return {
      title: "Aternos export",
      steps: [
        "Open your Aternos server page and stop the server.",
        "Download the world ZIP from the Worlds section.",
        "If the server is modded, download the mods too.",
        "Keep the ZIP ready for the next step."
      ],
      helpUrl: HELP_LINKS.aternos
    };
  }
  if (host === "minehut") {
    return {
      title: "Minehut export",
      steps: [
        "Open the Minehut dashboard and stop the server.",
        "Download the world ZIP from the File Manager.",
        "Grab any modpack or mods used by the server.",
        "Keep the ZIP ready for the next step."
      ],
      helpUrl: HELP_LINKS.minehut
    };
  }
  if (host === "other") {
    return {
      title: "Other hosting",
      steps: [
        "Stop the server before exporting the world.",
        "Download the world ZIP or backup file.",
        "Download mods or modpacks if the server is modded.",
        "Keep the ZIP ready for the next step."
      ],
      helpUrl: HELP_LINKS.other
    };
  }

  return {
    title: "World ZIP ready",
    steps: [
      "Make sure the ZIP contains level.dat and the region folder.",
      "If the world is modded, keep your mods or modpack ready.",
      "Continue to upload the ZIP." 
    ]
  };
}

export function detectWorldProfile(validation: WorldValidationResult | null): MigrationDetection | null {
  if (!validation?.valid) return null;
  const detectedType = validation.detected_type ?? "vanilla";
  const loader: ServerConfig["server_type"] = detectedType === "forge" ? "forge" : "vanilla";
  return {
    loader,
    version: validation.detected_version?.trim() ?? null,
    modded: detectedType === "forge"
  };
}

export function normalizeRamEven(value: number): number {
  if (!Number.isFinite(value)) return 2;
  if (value <= 2) return 2;
  return value % 2 === 0 ? value : value + 1;
}

export function suggestRamGb(
  systemRamGb: number | null,
  safeRamMaxGb: number,
  worldValidation: WorldValidationResult | null,
  modsValidation: ModsValidationResult | null
): number | null {
  if (!systemRamGb) return null;
  let suggested = 4;
  if (modsValidation?.mod_count) {
    suggested += Math.ceil(modsValidation.mod_count / 25);
  }
  if ((worldValidation?.size_bytes ?? 0) > 1024 * 1024 * 1024) {
    suggested += 1;
  }
  suggested = Math.max(2, suggested);
  const capped = Math.min(suggested, safeRamMaxGb);
  return normalizeRamEven(capped);
}
