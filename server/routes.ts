import type { Express } from "express";
import { createServer, type Server } from "http";
import { api } from "@shared/routes";
import { z } from "zod";
import cache from "./cache";
import type { LeagueWithRecord } from "@shared/schema";

const BASE = "https://api.sleeper.app/v1";

// Helper function for API calls
async function jget(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

async function getUserByUsername(username: string) {
  return jget(`${BASE}/user/${encodeURIComponent(username)}`);
}

async function getLeaguesForSeason(userId: string, sport: string, season: number) {
  return jget(`${BASE}/user/${userId}/leagues/${sport}/${season}`);
}

async function getLeagueUsers(leagueId: string) {
  return jget(`${BASE}/league/${leagueId}/users`);
}

async function getLeagueRosters(leagueId: string) {
  return jget(`${BASE}/league/${leagueId}/rosters`);
}

// Concurrency limiter: max 6 concurrent requests
async function withConcurrencyLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const active: Promise<void>[] = [];

  while (queue.length > 0 || active.length > 0) {
    while (active.length < limit && queue.length > 0) {
      const item = queue.shift()!;
      const promise = fn(item).finally(() => {
        const idx = active.indexOf(promise);
        if (idx !== -1) active.splice(idx, 1);
      });
      active.push(promise);
    }
    if (active.length > 0) {
      await Promise.race(active);
    }
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // GET /api/overview - Returns flattened leagues with W-L records
  // Prefers cached data if available and fresh, otherwise returns stale indicator
  app.get(api.sleeper.overview.path, async (req, res) => {
    try {
      const { username } = api.sleeper.overview.input.parse(req.query);

      // Check cache first
      let cachedUser = cache.getUserByUsername(username);

      if (cachedUser) {
        // We have cached data - return it
        const leagues = cache.getLeaguesForUser(cachedUser.user_id);
        const rosters = cache.getRostersForUser(cachedUser.user_id);
        const lastSync = cache.getLastSyncTime(cachedUser.user_id);
        const isStale = cache.isDataStale(cachedUser.user_id);

        // Build map of rosters by league_id for quick lookup
        const rosterMap = new Map(rosters.map((r) => [r.league_id, r]));

        // Build response with my_record attached
        const leaguesWithRecords: LeagueWithRecord[] = leagues.map((league) => {
          const roster = rosterMap.get(league.league_id);
          return {
            league_id: league.league_id,
            name: league.name,
            season: String(league.season),
            status: league.status,
            sport: league.sport,
            total_rosters: league.total_rosters || undefined,
            my_record: roster
              ? { wins: roster.wins, losses: roster.losses, ties: roster.ties }
              : { wins: 0, losses: 0, ties: 0 },
            my_roster_id: roster?.roster_id,
          };
        });

        // Sort: name A-Z, then season DESC
        leaguesWithRecords.sort((a, b) => {
          const nameCmp = a.name.localeCompare(b.name);
          if (nameCmp !== 0) return nameCmp;
          return Number(b.season) - Number(a.season);
        });

        return res.json({
          user: {
            user_id: cachedUser.user_id,
            username: cachedUser.username,
            display_name: cachedUser.display_name,
            avatar: cachedUser.avatar,
          },
          leagues: leaguesWithRecords,
          cached: true,
          lastSyncedAt: lastSync || undefined,
        });
      }

      // No cache - do a live fetch (but minimal, encourage sync)
      const user = await getUserByUsername(username);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Return empty with instruction to sync
      return res.json({
        user: {
          user_id: user.user_id,
          username: user.username,
          display_name: user.display_name,
          avatar: user.avatar,
        },
        leagues: [],
        cached: false,
        lastSyncedAt: undefined,
      });
    } catch (e) {
      console.error("Overview error:", e);
      if (e instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input" });
      }
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // POST /api/sync - Syncs data from Sleeper API to local SQLite cache
  app.post(api.sleeper.sync.path, async (req, res) => {
    try {
      const { username } = api.sleeper.sync.input.parse(req.query);

      // Fetch user from Sleeper
      const user = await getUserByUsername(username);
      if (!user) {
        return res.status(404).json({ message: "User not found on Sleeper" });
      }

      // Upsert user into cache
      cache.upsertUser({
        user_id: user.user_id,
        username: user.username,
        display_name: user.display_name,
        avatar: user.avatar,
      });

      const userId = user.user_id;
      const sport = "nfl";
      const startSeason = 2017;
      const endSeason = new Date().getFullYear() + 1;

      // Fetch all seasons in parallel
      const seasons = [];
      for (let s = startSeason; s <= endSeason; s++) seasons.push(s);

      const seasonResults = await Promise.all(
        seasons.map(async (season) => {
          const leagues = await getLeaguesForSeason(userId, sport, season);
          return { season, leagues: leagues || [] };
        })
      );

      // Flatten all leagues
      const allLeagues: any[] = [];
      for (const { leagues } of seasonResults) {
        allLeagues.push(...leagues);
      }

      // Upsert all leagues
      for (const league of allLeagues) {
        cache.upsertLeague(userId, {
          league_id: league.league_id,
          name: league.name,
          season: league.season,
          sport: league.sport,
          status: league.status,
          total_rosters: league.total_rosters,
          previous_league_id: league.previous_league_id,
        });
      }

      // Fetch rosters with concurrency limit (max 6)
      let rostersCount = 0;
      await withConcurrencyLimit(allLeagues, 6, async (league) => {
        try {
          const rosters = await getLeagueRosters(league.league_id);
          if (!rosters) return;

          // Find my roster
          const myRoster = rosters.find((r: any) => r.owner_id === userId);
          if (myRoster) {
            const wins = myRoster.settings?.wins || 0;
            const losses = myRoster.settings?.losses || 0;
            const ties = myRoster.settings?.ties || 0;

            cache.upsertRoster({
              league_id: league.league_id,
              owner_id: userId,
              roster_id: myRoster.roster_id,
              wins,
              losses,
              ties,
            });

            // Store player snapshot
            if (myRoster.players && Array.isArray(myRoster.players)) {
              cache.updateRosterPlayers(league.league_id, userId, myRoster.players);
            }

            rostersCount++;
          }
        } catch (err) {
          console.error(`Error fetching rosters for league ${league.league_id}:`, err);
        }
      });

      res.json({
        success: true,
        leaguesSynced: allLeagues.length,
        rostersSynced: rostersCount,
        message: `Synced ${allLeagues.length} leagues and ${rostersCount} rosters`,
      });
    } catch (e) {
      console.error("Sync error:", e);
      if (e instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input" });
      }
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/league/:leagueId - Get league details (users + rosters)
  app.get(api.sleeper.league.path, async (req, res) => {
    try {
      const { leagueId } = req.params;

      const [users, rosters] = await Promise.all([
        getLeagueUsers(leagueId),
        getLeagueRosters(leagueId),
      ]);

      if (!users || !rosters) {
        return res.status(404).json({ message: "League details not found" });
      }

      res.json({ leagueId, users, rosters });
    } catch (e) {
      console.error("League error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  return httpServer;
}
