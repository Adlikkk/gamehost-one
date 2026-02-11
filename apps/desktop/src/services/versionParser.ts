import type { ServerMetadata } from "../types";

export function formatModpackName(value?: string | null): string | null {
  if (!value) return null;
  if (value === "modrinth") return "Modrinth";
  if (value === "curseforge") return "CurseForge";
  if (value === "quilt") return "Quilt";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function buildServerBadges(metadata: ServerMetadata | null): string[] {
  if (!metadata) return [];
  const badges: string[] = [];
  const version = metadata.mcVersion && metadata.mcVersion !== "unknown" ? ` ${metadata.mcVersion}` : "";
  if (metadata.loader && metadata.loader !== "unknown") {
    badges.push(`${metadata.loader.charAt(0).toUpperCase() + metadata.loader.slice(1)}${version}`);
  } else if (version) {
    badges.push(metadata.mcVersion);
  }
  if (metadata.modCount > 0) {
    badges.push(`${metadata.modCount} Mods Detected`);
  }
  if (metadata.moddedWorld) {
    badges.push("Modded World");
  }
  const modpack = formatModpackName(metadata.modpack);
  if (modpack) {
    badges.push(`${modpack} Modpack`);
  }
  return badges;
}
