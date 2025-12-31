import { useQuery } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";

// GET /api/overview?username=...
export function useSleeperOverview(username: string | undefined) {
  return useQuery({
    queryKey: [api.sleeper.overview.path, username],
    queryFn: async () => {
      if (!username) return null;
      // We pass username as a query param manually since buildUrl handles path params
      // but the route definition defines 'input' which implies validation.
      // However, for GET requests with query params, we construct the URL string.
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
