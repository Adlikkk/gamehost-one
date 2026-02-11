import type { WorldSourceKind } from "../types";

export function getWorldSourceKind(path: string): WorldSourceKind {
  return path.trim().toLowerCase().endsWith(".zip") ? "zip" : "folder";
}
