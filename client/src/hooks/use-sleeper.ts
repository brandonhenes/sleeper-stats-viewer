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
// mode: "current" = latest season only, "history" = all seasons
export function useTrades(groupId: string | undefined, mode: "current" | "history" = "current") {
  return useQuery({
    queryKey: [api.sleeper.trades.path, groupId, mode],
    queryFn: async () => {
      if (!groupId) return null;
      const url = `${buildUrl(api.sleeper.trades.path, { groupId })}?mode=${mode}`;
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

// GET /api/league/:leagueId/draft-capital?username=... - Get draft capital for a league
export function useDraftCapital(leagueId: string | undefined, username: string | undefined) {
  return useQuery({
    queryKey: ["/api/league", leagueId, "draft-capital", username],
    queryFn: async () => {
      if (!leagueId || !username) return null;
      const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}/draft-capital?username=${encodeURIComponent(username)}`);
      
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch draft capital");
      }

      return res.json();
    },
    enabled: !!leagueId && !!username,
  });
}

// GET /api/league/:leagueId/churn?username=...&timeframe=... - Get churn stats for a league
// timeframe: "season" (default), "last30", "lifetime"
export function useChurnStats(leagueId: string | undefined, username: string | undefined, timeframe: string = "season", groupId?: string) {
  return useQuery({
    queryKey: ["/api/league", leagueId, "churn", username, timeframe, groupId],
    queryFn: async () => {
      if (!leagueId || !username) return null;
      let url = `/api/league/${encodeURIComponent(leagueId)}/churn?username=${encodeURIComponent(username)}&timeframe=${encodeURIComponent(timeframe)}`;
      if (groupId && timeframe === "lifetime") {
        url += `&groupId=${encodeURIComponent(groupId)}`;
      }
      const res = await fetch(url);
      
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch churn stats");
      }

      return res.json();
    },
    enabled: !!leagueId && !!username,
  });
}

// GET /api/league/:leagueId/trade-timing?username=... - Get trade timing analysis
export function useTradeTiming(leagueId: string | undefined, username: string | undefined) {
  return useQuery({
    queryKey: ["/api/league", leagueId, "trade-timing", username],
    queryFn: async () => {
      if (!leagueId || !username) return null;
      const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}/trade-timing?username=${encodeURIComponent(username)}`);
      
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch trade timing");
      }

      return res.json();
    },
    enabled: !!leagueId && !!username,
  });
}

// GET /api/league/:leagueId/all-play?username=... - Get all-play record and luck index
export function useAllPlay(leagueId: string | undefined, username: string | undefined) {
  return useQuery({
    queryKey: ["/api/league", leagueId, "all-play", username],
    queryFn: async () => {
      if (!leagueId || !username) return null;
      const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}/all-play?username=${encodeURIComponent(username)}`);
      
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch all-play stats");
      }

      return res.json();
    },
    enabled: !!leagueId && !!username,
    staleTime: 1000 * 60 * 10, // Cache for 10 min (expensive API calls)
  });
}

// ============================================================================
// PHASE 1 SCOUTING HOOKS - All-rosters leaderboard data
// ============================================================================

// GET /api/league/:leagueId/scouting/draft-capital - Draft capital for all rosters
export function useScoutingDraftCapital(leagueId: string | undefined) {
  return useQuery({
    queryKey: ["/api/league", leagueId, "scouting/draft-capital"],
    queryFn: async () => {
      if (!leagueId) return null;
      const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}/scouting/draft-capital`);
      
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch draft capital");
      }

      return res.json();
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}

// GET /api/league/:leagueId/scouting/strength - All-Play + Luck Index for all rosters
export function useScoutingStrength(leagueId: string | undefined) {
  return useQuery({
    queryKey: ["/api/league", leagueId, "scouting/strength"],
    queryFn: async () => {
      if (!leagueId) return null;
      const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}/scouting/strength`);
      
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch strength data");
      }

      return res.json();
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}

// GET /api/league/:leagueId/scouting/consistency - Consistency + Boom/Bust for all rosters
export function useScoutingConsistency(leagueId: string | undefined) {
  return useQuery({
    queryKey: ["/api/league", leagueId, "scouting/consistency"],
    queryFn: async () => {
      if (!leagueId) return null;
      const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}/scouting/consistency`);
      
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch consistency data");
      }

      return res.json();
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}

// GET /api/league/:leagueId/scouting/churn?timeframe=... - Churn rate for all rosters
export function useScoutingChurn(leagueId: string | undefined, timeframe: string = "season") {
  return useQuery({
    queryKey: ["/api/league", leagueId, "scouting/churn", timeframe],
    queryFn: async () => {
      if (!leagueId) return null;
      const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}/scouting/churn?timeframe=${encodeURIComponent(timeframe)}`);
      
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch churn data");
      }

      return res.json();
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 5,
  });
}

// GET /api/league/:leagueId/scouting/trading - Trade propensity for all rosters
export function useScoutingTrading(leagueId: string | undefined) {
  return useQuery({
    queryKey: ["/api/league", leagueId, "scouting/trading"],
    queryFn: async () => {
      if (!leagueId) return null;
      const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}/scouting/trading`);
      
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch trading data");
      }

      return res.json();
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}

// ============================================================================
// PHASE 2 HOOKS - Teams, Draft Capital (all), Trade Assets
// ============================================================================

// GET /api/league/:leagueId/teams - All teams with current rosters
export function useLeagueTeams(leagueId: string | undefined) {
  return useQuery({
    queryKey: ["/api/league", leagueId, "teams"],
    queryFn: async () => {
      if (!leagueId) return null;
      const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}/teams`);
      
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch teams");
      }

      return res.json();
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}

// GET /api/league/:leagueId/draft-capital/all - Draft capital for ALL teams
export function useAllDraftCapital(leagueId: string | undefined) {
  return useQuery({
    queryKey: ["/api/league", leagueId, "draft-capital/all"],
    queryFn: async () => {
      if (!leagueId) return null;
      const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}/draft-capital/all`);
      
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch draft capital");
      }

      return res.json();
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}

// GET /api/league/:leagueId/trade-assets - Normalized trade assets for a league
export function useTradeAssets(leagueId: string | undefined, rosterId?: number) {
  return useQuery({
    queryKey: ["/api/league", leagueId, "trade-assets", rosterId],
    queryFn: async () => {
      if (!leagueId) return null;
      let url = `/api/league/${encodeURIComponent(leagueId)}/trade-assets`;
      if (rosterId !== undefined) {
        url += `?roster_id=${rosterId}`;
      }
      const res = await fetch(url);
      
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch trade assets");
      }

      return res.json() as Promise<{
        league_id: string;
        total_assets: number;
        trades_count: number;
        trades: Array<{
          trade_id: string;
          created_at_ms: number;
          season: number;
          participants: number[];
          assets: Array<{
            roster_id: number;
            direction: string;
            asset_type: string;
            asset_key: string;
            asset_name: string | null;
          }>;
        }>;
      }>;
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 5,
  });
}

// POST /api/league/:leagueId/normalize-trades - Normalize trades for a league
export function useNormalizeTrades() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (leagueId: string) => {
      const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}/normalize-trades`, {
        method: "POST",
      });
      
      if (!res.ok) {
        throw new Error("Failed to normalize trades");
      }
      
      return res.json() as Promise<{ success: boolean; assets_created: number }>;
    },
    onSuccess: (_, leagueId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/league", leagueId, "trade-assets"] });
    },
  });
}

// GET /api/group/:groupId/trade-assets - Trade assets for a league group with season filter
export function useGroupTradeAssets(groupId: string | undefined, season?: number | 'all') {
  return useQuery({
    queryKey: ["/api/group", groupId, "trade-assets", season],
    enabled: !!groupId,
    queryFn: async () => {
      if (!groupId) return null;
      let url = `/api/group/${encodeURIComponent(groupId)}/trade-assets`;
      if (season && season !== 'all') {
        url += `?season=${season}`;
      }
      const res = await fetch(url);
      
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch group trade assets");
      }

      return res.json() as Promise<{
        group_id: string;
        seasons: number[];
        latest_season: number;
        total_assets: number;
        trades_count: number;
        trades: Array<{
          trade_id: string;
          created_at_ms: number;
          season: number;
          league_id: string;
          participants: number[];
          assets: Array<{
            roster_id: number;
            direction: string;
            asset_type: string;
            asset_key: string;
            asset_name: string | null;
          }>;
        }>;
        debug?: {
          leagues_count: number;
          season_filter: number | null;
          default_season: number;
        };
      }>;
    },
    staleTime: 1000 * 60 * 5,
  });
}

// Shared league player type
interface SharedLeaguePlayer {
  player_id: string;
  name: string;
  position: string | null;
}

// Shared league data type
interface SharedLeague {
  league_id: string;
  name: string;
  season: number;
  userA_roster_id: number | null;
  userB_roster_id: number | null;
  userA_players: SharedLeaguePlayer[];
  userB_players: SharedLeaguePlayer[];
}

// Shared leagues response type
interface SharedLeaguesResponse {
  userA: { user_id: string; username: string; display_name: string };
  userB: { user_id: string; username: string; display_name: string };
  shared_leagues: SharedLeague[];
}

// GET /api/compare/shared-leagues - Get shared leagues between two users
export function useSharedLeagues(userA: string | undefined, userB: string | undefined) {
  return useQuery<SharedLeaguesResponse>({
    queryKey: ["/api/compare/shared-leagues", userA, userB],
    queryFn: async () => {
      if (!userA || !userB) throw new Error("Both users required");
      const url = `/api/compare/shared-leagues?userA=${encodeURIComponent(userA)}&userB=${encodeURIComponent(userB)}`;
      const res = await fetch(url);
      
      if (!res.ok) {
        if (res.status === 404) throw new Error("One or both users not found");
        throw new Error("Failed to fetch shared leagues");
      }
      
      return res.json();
    },
    enabled: !!userA && !!userB,
    staleTime: 1000 * 60 * 5,
  });
}

// Trade Targets types
interface MatchedAsset {
  player_id: string;
  name: string;
  pos: string | null;
  team: string | null;
  exposure_pct: number;
}

interface TargetMeta {
  active_league_count: number;
  last_synced_at: number | null;
  is_partial: boolean;
}

interface TradeTarget {
  opponent_username: string;
  opponent_display_name: string | null;
  target_score: number;
  matched_assets: MatchedAsset[];
  meta: TargetMeta;
}

interface TargetsResponse {
  league_id: string;
  league_name: string;
  season: number;
  my_roster_id: number;
  targets: TradeTarget[];
}

// GET /api/targets - Get trade targets for a league
export function useTradeTargets(username: string | undefined, leagueId: string | undefined) {
  return useQuery<TargetsResponse>({
    queryKey: ["/api/targets", username, leagueId],
    queryFn: async () => {
      if (!username || !leagueId) throw new Error("Username and league_id required");
      const url = `/api/targets?username=${encodeURIComponent(username)}&league_id=${encodeURIComponent(leagueId)}`;
      const res = await fetch(url);
      
      if (!res.ok) {
        if (res.status === 404) throw new Error("Not found");
        throw new Error("Failed to fetch trade targets");
      }
      
      return res.json();
    },
    enabled: !!username && !!leagueId,
    staleTime: 1000 * 60 * 5,
  });
}

// POST /api/exposure/sync - Sync exposure profile for a user
export function useExposureSync() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (username: string) => {
      const url = `/api/exposure/sync?username=${encodeURIComponent(username)}`;
      const res = await fetch(url, { method: "POST" });
      
      if (!res.ok) {
        if (res.status === 404) throw new Error("User not found");
        throw new Error("Failed to sync exposure");
      }
      
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/targets"] });
    },
  });
}
