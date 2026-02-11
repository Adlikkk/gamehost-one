import { useCallback, useEffect, useState } from "react";
import type { ServerMetadata } from "../types";
import { detectServerMetadata, getServerMetadata } from "../services/modDetection";

export function useServerMetadata(serverId?: string | null) {
  const [metadata, setMetadata] = useState<ServerMetadata | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!serverId) {
      setMetadata(null);
      return;
    }
    setLoading(true);
    try {
      const cached = await getServerMetadata(serverId);
      if (cached) {
        setMetadata(cached);
      }
      const fresh = await detectServerMetadata(serverId);
      setMetadata(fresh);
    } catch {
      // Ignore detection errors.
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { metadata, loading, refresh };
}
