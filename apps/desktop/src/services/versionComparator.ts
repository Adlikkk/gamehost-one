import type { ClientDetectionResult, ServerConfig } from "../types";

export type ClientComparison = {
  versionMatch: boolean;
  loaderMatch: boolean;
};

export function compareClientToServer(
  client: ClientDetectionResult | null,
  server: ServerConfig | null
): ClientComparison {
  if (!client || !client.running || !server) {
    return { versionMatch: false, loaderMatch: false };
  }

  const serverLoader = server.server_type === "forge"
    ? "forge"
    : server.server_type === "fabric"
    ? "fabric"
    : "vanilla";
  const clientLoader = client.loader ?? "vanilla";

  const serverVersion = server.version.split("-")[0] ?? server.version;
  const clientVersion = client.mcVersion ?? client.versionId ?? "";

  return {
    versionMatch: Boolean(clientVersion && clientVersion === serverVersion),
    loaderMatch: serverLoader === "vanilla" ? true : clientLoader === serverLoader
  };
}
