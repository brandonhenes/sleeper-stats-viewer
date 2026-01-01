import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useEffect, useRef } from "react";

// GET /api/overview?username=...
export function useSleeperOverview(username: string | undefined) {
  return useQuery({
    queryKey: [api.sleeper.overview.path, username],
    queryFn: async () => {
      if (!username) return null;
      const url = `${api.sleeper.overview.path}?username=${encodeURIComponent(username)}`;
      
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404) throw new Error("User not found");
        throw new Error("Failed to fetch sleeper data");
      }
      
      return api.sleeper.overview.responses[200].parse(await res.json());
    },
    enabled: !!username && username.length > 0,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// POST /api/sync?username=...
export function useSleeperSync() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (username: string) => {
      const url = `${api.sleeper.sync.path}?username=${encodeURIComponent(username)}`;
      const res = await fetch(url, { method: "POST" });
      
      if (!res.ok) {
        if (res.status === 404) throw new Error("User not found");
        if (res.status === 429) {
          const data = await res.json();
          throw new Error(data.message || "Rate limited");
        }
        throw new Error("Sync failed");
      }
      
      return api.sleeper.sync.responses[200].parse(await res.json());
    },
    onSuccess: (_, username) => {
      // Will refetch after polling completes
    },
  });
}

// GET /api/sync/status?job_id=...
export function useSyncStatus(jobId: string | undefined, enabled: boolean = true) {
  return useQuery({
    queryKey: [api.sleeper.syncStatus.path, jobId],
    queryFn: async () => {
      if (!jobId) return null;
      const url = `${api.sleeper.syncStatus.path}?job_id=${encodeURIComponent(jobId)}`;
      const res = await fetch(url);
      
      if (!res.ok) {
        throw new Error("Failed to fetch sync status");
      }
      
      return api.sleeper.syncStatus.responses[200].parse(await res.json());
    },
    enabled: !!jobId && enabled,
    refetchInterval: (query) => {
      // Poll every 1s while running
      const data = query.state.data;
      if (data && data.status === "running") {
        return 1000;
      }
      return false;
    },
  });
}

// Hook to auto-sync when needed and poll status
export function useAutoSync(username: string | undefined, needsSync: boolean, syncStatus: string | undefined) {
  const queryClient = useQueryClient();
  const syncMutation = useSleeperSync();
  const jobIdRef = useRef<string | null>(null);
  
  // Auto-trigger sync when needs_sync is true and no sync is running
  useEffect(() => {
    if (needsSync && username && syncStatus === "not_started" && !syncMutation.isPending) {
      syncMutation.mutate(username, {
        onSuccess: (data) => {
          jobIdRef.current = data.job_id;
        },
      });
    }
  }, [needsSync, username, syncStatus, syncMutation.isPending]);
  
  // Poll sync status
  const { data: statusData } = useSyncStatus(
    jobIdRef.current || undefined,
    !!jobIdRef.current
  );
  
  // Refetch overview when sync completes
  useEffect(() => {
    if (statusData && statusData.status === "done" && username) {
      queryClient.invalidateQueries({ queryKey: [api.sleeper.overview.path, username] });
      jobIdRef.current = null;
    }
  }, [statusData?.status, username, queryClient]);
  
  return {
    syncMutation,
    syncStatus: statusData,
    jobId: jobIdRef.current,
  };
}

// GET /api/league/:leagueId
export function useLeagueDetails(leagueId: string) {
  return useQuery({
    queryKey: [api.sleeper.league.path, leagueId],
    queryFn: async () => {
      const url = buildUrl(api.sleeper.league.path, { leagueId });
      const res = await fetch(url);
      
      if (!res.ok) {
        if (res.status === 404) throw new Error("League not found");
        throw new Error("Failed to fetch league details");
      }

      return api.sleeper.league.responses[200].parse(await res.json());
    },
    enabled: !!leagueId,
  });
}

// GET /api/group/:groupId/h2h?username=...
export function useH2h(groupId: string | undefined, username: string | undefined) {
  return useQuery({
    queryKey: [api.sleeper.h2h.path, groupId, username],
    queryFn: async () => {
      if (!groupId || !username) return null;
      const url = `${buildUrl(api.sleeper.h2h.path, { groupId })}?username=${encodeURIComponent(username)}`;
      const res = await fetch(url);
      
      if (!res.ok) {
        if (res.status === 404) throw new Error("League group not found");
        throw new Error("Failed to fetch H2H data");
      }

      return api.sleeper.h2h.responses[200].parse(await res.json());
    },
    enabled: !!groupId && !!username,
  });
}

// GET /api/group/:groupId/trades
export function useTrades(groupId: string | undefined) {
  return useQuery({
    queryKey: [api.sleeper.trades.path, groupId],
    queryFn: async () => {
      if (!groupId) return null;
      const url = buildUrl(api.sleeper.trades.path, { groupId });
      const res = await fetch(url);
      
      if (!res.ok) {
        if (res.status === 404) throw new Error("League group not found");
        throw new Error("Failed to fetch trades");
      }

      return api.sleeper.trades.responses[200].parse(await res.json());
    },
    enabled: !!groupId,
  });
}

// GET /api/players/exposure?username=... with pagination params
export interface ExposureParams {
  username: string | undefined;
  page?: number;
  pageSize?: number;
  pos?: string;
  search?: string;
  sort?: string;
}

export function usePlayerExposure(params: ExposureParams | string | undefined) {
  // Support both old string format and new object format
  const normalizedParams: ExposureParams = typeof params === "string" 
    ? { username: params } 
    : params || { username: undefined };
  
  const { username, page = 1, pageSize = 100, pos, search, sort } = normalizedParams;

  return useQuery({
    queryKey: ["/api/players/exposure", username, page, pageSize, pos, search, sort],
    queryFn: async () => {
      if (!username) return null;
      const searchParams = new URLSearchParams();
      searchParams.set("username", username);
      searchParams.set("page", String(page));
      searchParams.set("pageSize", String(pageSize));
      if (pos && pos !== "all") searchParams.set("pos", pos);
      if (search) searchParams.set("search", search);
      if (sort) searchParams.set("sort", sort);

      const url = `${api.sleeper.playerExposure.path}?${searchParams.toString()}`;
      const res = await fetch(url);
      
      if (!res.ok) {
        if (res.status === 404) throw new Error("User not found");
        throw new Error("Failed to fetch player exposure");
      }

      return res.json();
    },
    enabled: !!username && username.length > 0,
  });
}

// GET /api/scouting/:username - Get scouting stats
export function useScoutingStats(username: string | undefined) {
  return useQuery({
    queryKey: ["/api/scouting", username],
    queryFn: async () => {
      if (!username) return null;
      const res = await fetch(`/api/scouting/${encodeURIComponent(username)}`);
      
      if (!res.ok) {
        if (res.status === 404) throw new Error("User not found");
        throw new Error("Failed to fetch scouting stats");
      }

      return res.json();
    },
    enabled: !!username && username.length > 0,
  });
}
