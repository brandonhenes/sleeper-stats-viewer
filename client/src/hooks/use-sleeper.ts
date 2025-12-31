import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";

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
        throw new Error("Sync failed");
      }
      
      return api.sleeper.sync.responses[200].parse(await res.json());
    },
    onSuccess: (_, username) => {
      // Invalidate overview query to refresh data
      queryClient.invalidateQueries({ queryKey: [api.sleeper.overview.path, username] });
    },
  });
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
