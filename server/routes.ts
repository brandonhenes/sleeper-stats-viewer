import type { Express } from "express";
import { createServer, type Server } from "http";
import { api } from "@shared/routes";
import { z } from "zod";
import { cache, type SyncJob } from "./cache";
import type { LeagueGroup } from "@shared/schema";
import { randomUUID } from "crypto";

const BASE = "https://api.sleeper.app/v1";

// In-memory mutex for running sync jobs (one per username)
const syncLocks = new Map<string, boolean>();

// Rate limit: track last sync time per username
const lastSyncStart = new Map<string, number>();
const MIN_SYNC_INTERVAL = 10 * 60 * 1000; // 10 minutes

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

async function getMatchups(leagueId: string, week: number) {
  return jget(`${BASE}/league/${leagueId}/matchups/${week}`);
}

async function getLeagueTransactions(leagueId: string, week: number) {
  return jget(`${BASE}/league/${leagueId}/transactions/${week}`);
}

async function getAllPlayers() {
  return jget(`${BASE}/players/nfl`);
}

async function getTradedPicks(leagueId: string) {
  return jget(`${BASE}/league/${leagueId}/traded_picks`);
}

// Concurrency limiter
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

// Compute league groups by following previous_league_id chains
async function computeLeagueGroups(userId: string): Promise<void> {
  const leagues = await cache.getLeaguesForUser(userId);
  const leagueMap = new Map(leagues.map((l) => [l.league_id, l]));

  // Build a map from league_id to its root (following previous_league_id)
  const findRoot = async (leagueId: string): Promise<string> => {
    let current = leagueId;
    const visited = new Set<string>();

    while (true) {
      // Check for manual override first
      const override = await cache.getGroupOverride(current);
      if (override) return override;

      const league = leagueMap.get(current);
      if (!league || !league.previous_league_id) break;
      if (visited.has(league.previous_league_id)) break; // Cycle detection
      visited.add(current);
      
      // If previous league exists in our map, continue chain
      if (leagueMap.has(league.previous_league_id)) {
        current = league.previous_league_id;
      } else {
        break;
      }
    }
    return current;
  };

  // Assign group_id to each league
  for (const league of leagues) {
    const groupId = await findRoot(league.league_id);
    if (league.group_id !== groupId) {
      await cache.updateLeagueGroupId(league.league_id, groupId);
    }
  }
}

// Build league groups from cached data
async function buildLeagueGroups(userId: string): Promise<LeagueGroup[]> {
  const leagues = await cache.getLeaguesForUser(userId);
  const rosters = await cache.getRostersForUser(userId);
  const rosterMap = new Map(rosters.map((r) => [r.league_id, r]));

  // Group leagues by group_id
  const groupsMap = new Map<string, typeof leagues>();
  for (const league of leagues) {
    const gid = league.group_id || league.league_id;
    if (!groupsMap.has(gid)) {
      groupsMap.set(gid, []);
    }
    groupsMap.get(gid)!.push(league);
  }

  // Build LeagueGroup objects
  const result: LeagueGroup[] = [];
  for (const entry of Array.from(groupsMap.entries())) {
    const [groupId, groupLeagues] = entry;
    // Sort by season DESC to get most recent first
    groupLeagues.sort((a: typeof leagues[0], b: typeof leagues[0]) => b.season - a.season);

    const seasons = groupLeagues.map((l: typeof leagues[0]) => l.season);
    const minSeason = Math.min(...seasons);
    const maxSeason = Math.max(...seasons);

    // Aggregate W-L-T across all seasons
    let totalWins = 0, totalLosses = 0, totalTies = 0;
    const leagueIds: string[] = [];

    let leagueType: "dynasty" | "redraft" | "unknown" = "unknown";
    
    for (const league of groupLeagues) {
      leagueIds.push(league.league_id);
      const roster = rosterMap.get(league.league_id);
      if (roster) {
        totalWins += roster.wins;
        totalLosses += roster.losses;
        totalTies += roster.ties;
      }
      
      // Derive league type from raw_json settings
      if (leagueType === "unknown" && league.raw_json) {
        try {
          const rawData = typeof league.raw_json === "string" 
            ? JSON.parse(league.raw_json) 
            : league.raw_json;
          
          // Sleeper API: settings.type - 0 = redraft, 2 = dynasty/keeper
          if (rawData?.settings?.type === 2) {
            leagueType = "dynasty";
          } else if (rawData?.settings?.type === 0 || rawData?.settings?.type === 1) {
            leagueType = "redraft";
          }
          // Also check if keeper_deadline is set (indicates keeper/dynasty)
          if (rawData?.settings?.keeper_deadline && leagueType === "unknown") {
            leagueType = "dynasty";
          }
        } catch {
          // ignore parse errors
        }
      }
    }

    result.push({
      group_id: groupId,
      name: groupLeagues[0].name, // most recent season name
      min_season: minSeason,
      max_season: maxSeason,
      seasons_count: groupLeagues.length,
      overall_record: { wins: totalWins, losses: totalLosses, ties: totalTies },
      league_ids: leagueIds,
      league_type: leagueType,
    });
  }

  // Sort by name A-Z
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

// Background sync job runner
async function runSyncJob(jobId: string, username: string): Promise<void> {
  const updateJob = async (updates: Partial<SyncJob>) => {
    const existing = await cache.getSyncJob(jobId);
    if (existing) {
      await cache.upsertSyncJob({ ...existing, ...updates, updated_at: Date.now() });
    }
  };

  try {
    await updateJob({ step: "user", detail: "Fetching user info..." });

    // Fetch user from Sleeper
    const user = await getUserByUsername(username);
    if (!user) {
      await updateJob({ status: "error", error: "User not found on Sleeper" });
      syncLocks.delete(username.toLowerCase());
      return;
    }

    // Upsert user into cache
    await cache.upsertUser({
      user_id: user.user_id,
      username: user.username,
      display_name: user.display_name,
      avatar: user.avatar,
    });

    const userId = user.user_id;
    const sport = "nfl";
    const startSeason = 2017;
    const endSeason = new Date().getFullYear() + 1;

    await updateJob({ step: "leagues", detail: "Fetching leagues..." });

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
      await cache.upsertLeague(userId, {
        league_id: league.league_id,
        name: league.name,
        season: league.season,
        sport: league.sport,
        status: league.status,
        total_rosters: league.total_rosters,
        previous_league_id: league.previous_league_id,
        raw_json: JSON.stringify(league),
      });
    }

    await updateJob({
      step: "rosters",
      detail: "Fetching rosters...",
      leagues_total: allLeagues.length,
      leagues_done: 0,
    });

    // Fetch rosters with concurrency limit (max 6)
    let rostersCount = 0;
    await withConcurrencyLimit(allLeagues, 6, async (league) => {
      try {
        const rosters = await getLeagueRosters(league.league_id);
        if (!rosters) return;

        // Store all rosters for opponent lookup later
        for (const r of rosters) {
          if (r.owner_id) {
            await cache.upsertRoster({
              league_id: league.league_id,
              owner_id: r.owner_id,
              roster_id: r.roster_id,
              wins: r.settings?.wins || 0,
              losses: r.settings?.losses || 0,
              ties: r.settings?.ties || 0,
              fpts: r.settings?.fpts || 0,
              fpts_against: r.settings?.fpts_against || 0,
            });
            
            // Store the player IDs for this roster (for exposure tracking)
            // Always call this to clear stale players if roster is now empty
            const rosterPlayers = (r.players && Array.isArray(r.players)) ? r.players : [];
            await cache.updateRosterPlayers(league.league_id, r.owner_id, rosterPlayers);
          }
        }

        rostersCount++;
        await updateJob({ leagues_done: rostersCount });
      } catch (err) {
        console.error(`Error fetching rosters for league ${league.league_id}:`, err);
      }
    });

    await updateJob({ step: "users", detail: "Fetching league members..." });

    // Fetch league users with concurrency limit
    await withConcurrencyLimit(allLeagues, 6, async (league) => {
      try {
        const users = await getLeagueUsers(league.league_id);
        if (!users) return;

        for (const u of users) {
          await cache.upsertLeagueUser({
            league_id: league.league_id,
            user_id: u.user_id,
            display_name: u.display_name || u.username,
            team_name: u.metadata?.team_name || null,
          });
        }
      } catch (err) {
        console.error(`Error fetching users for league ${league.league_id}:`, err);
      }
    });

    await updateJob({ step: "trades", detail: "Fetching trade history..." });

    // Fetch trades for each league (rounds 0-22 to cover offseason + regular season + playoffs)
    await withConcurrencyLimit(allLeagues, 6, async (league) => {
      try {
        // Fetch transactions for rounds 0-22 (0 = offseason, 1-18 = regular season, 19+ = playoffs)
        // DO NOT early-stop on empty rounds - some leagues have gaps
        for (let round = 0; round <= 22; round++) {
          const transactions = await getLeagueTransactions(league.league_id, round);
          if (!transactions || !Array.isArray(transactions)) continue;

          // Filter for trades only (type === "trade")
          const trades = transactions.filter((t: any) => t.type === "trade");
          for (const trade of trades) {
            await cache.upsertTrade({
              transaction_id: trade.transaction_id,
              league_id: league.league_id,
              status: trade.status || "complete",
              created_at: trade.created || trade.status_updated || Date.now(),
              roster_ids: trade.roster_ids ? JSON.stringify(trade.roster_ids) : null,
              adds: trade.adds ? JSON.stringify(trade.adds) : null,
              drops: trade.drops ? JSON.stringify(trade.drops) : null,
              draft_picks: trade.draft_picks ? JSON.stringify(trade.draft_picks) : null,
              waiver_budget: trade.waiver_budget ? JSON.stringify(trade.waiver_budget) : null,
            });
          }
        }
      } catch (err) {
        console.error(`Error fetching trades for league ${league.league_id}:`, err);
      }
    });

    await updateJob({ step: "players", detail: "Syncing player database..." });

    // Check if players database needs updating (once per day)
    const playersLastUpdated = await cache.getPlayersLastUpdated();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    
    if (!playersLastUpdated || Date.now() - playersLastUpdated > ONE_DAY) {
      try {
        const playersData = await getAllPlayers();
        if (playersData) {
          const playersList = Object.entries(playersData)
            .filter(([, p]) => p && typeof p === "object")
            .map(([playerId, p]: [string, any]) => ({
              player_id: playerId,
              full_name: p.full_name || null,
              first_name: p.first_name || null,
              last_name: p.last_name || null,
              position: p.position || null,
              team: p.team || null,
              status: p.status || null,
              age: p.age || null,
              years_exp: p.years_exp || null,
            }));
          await cache.bulkUpsertPlayers(playersList);
        }
      } catch (err) {
        console.error("Error syncing players:", err);
      }
    }

    await updateJob({ step: "grouping", detail: "Computing league groups..." });

    // Compute league groups
    await computeLeagueGroups(userId);

    await updateJob({
      status: "done",
      step: "done",
      detail: `Synced ${allLeagues.length} leagues`,
      leagues_done: allLeagues.length,
    });
  } catch (err) {
    console.error("Sync job error:", err);
    await updateJob({
      status: "error",
      error: err instanceof Error ? err.message : "Unknown error",
    });
  } finally {
    syncLocks.delete(username.toLowerCase());
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // GET /api/debug/db - Debug endpoint to check DB counts for a user
  app.get("/api/debug/db", async (req, res) => {
    try {
      const username = req.query.username as string;
      if (!username) {
        return res.status(400).json({ error: "username required" });
      }

      const user = await cache.getUserByUsername(username);
      if (!user) {
        return res.json({
          user_exists: false,
          leagues_count: 0,
          rosters_count: 0,
          rosters_with_players_count: 0,
          roster_players_count: 0,
          trades_count: 0,
          players_master_count: 0,
        });
      }

      // Get counts
      const leagues = await cache.getLeaguesForUser(user.user_id);
      const rosters = await cache.getRostersForUser(user.user_id);
      
      // Count rosters with players
      let rostersWithPlayersCount = 0;
      let totalRosterPlayersCount = 0;
      for (const roster of rosters) {
        const players = await cache.getRosterPlayersForUserInLeague(roster.league_id, roster.owner_id);
        if (players.length > 0) {
          rostersWithPlayersCount++;
          totalRosterPlayersCount += players.length;
        }
      }

      // Count trades for user's leagues
      let tradesCount = 0;
      for (const league of leagues) {
        const trades = await cache.getTradesForLeague(league.league_id);
        tradesCount += trades.length;
      }

      // Count players_master
      const allPlayers = await cache.getAllPlayers();

      return res.json({
        user_exists: true,
        user_id: user.user_id,
        username: user.username,
        leagues_count: leagues.length,
        rosters_count: rosters.length,
        rosters_with_players_count: rostersWithPlayersCount,
        roster_players_count: totalRosterPlayersCount,
        trades_count: tradesCount,
        players_master_count: allPlayers.length,
      });
    } catch (e) {
      console.error("Debug endpoint error:", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "Unknown error" });
    }
  });

  // GET /api/overview - Returns league groups with aggregated W-L records
  // Always returns cached data immediately with sync status flags
  app.get(api.sleeper.overview.path, async (req, res) => {
    try {
      const { username } = api.sleeper.overview.input.parse(req.query);

      // Check cache first
      let cachedUser = await cache.getUserByUsername(username);
      const runningJob = await cache.getRunningJobForUser(username);
      const latestJob = await cache.getLatestSyncJobForUser(username);

      // Determine sync status
      let syncStatus: "not_started" | "running" | "done" | "error" = "not_started";
      if (runningJob) {
        syncStatus = "running";
      } else if (latestJob) {
        syncStatus = latestJob.status as any;
      }

      if (cachedUser) {
        const leagueGroups = await buildLeagueGroups(cachedUser.user_id);
        const lastSync = await cache.getLastSyncTime(cachedUser.user_id);
        const isStale = await cache.isDataStale(cachedUser.user_id);

        return res.json({
          user: {
            user_id: cachedUser.user_id,
            username: cachedUser.username,
            display_name: cachedUser.display_name,
            avatar: cachedUser.avatar,
          },
          league_groups: leagueGroups,
          cached: true,
          needs_sync: isStale,
          sync_status: syncStatus,
          lastSyncedAt: lastSync || undefined,
        });
      }

      // No cache - try to verify user exists on Sleeper
      const user = await getUserByUsername(username);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Return empty with needs_sync flag
      return res.json({
        user: {
          user_id: user.user_id,
          username: user.username,
          display_name: user.display_name,
          avatar: user.avatar,
        },
        league_groups: [],
        cached: false,
        needs_sync: true,
        sync_status: syncStatus,
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

  // POST /api/sync - Starts a background sync job (non-blocking)
  app.post(api.sleeper.sync.path, async (req, res) => {
    try {
      const { username } = api.sleeper.sync.input.parse(req.query);
      const usernameLower = username.toLowerCase();

      // Check if already running
      const runningJob = await cache.getRunningJobForUser(username);
      if (runningJob) {
        return res.json({
          job_id: runningJob.job_id,
          status: "running",
          message: "Sync already in progress",
        });
      }

      // Rate limit check
      const lastStart = lastSyncStart.get(usernameLower);
      if (lastStart && Date.now() - lastStart < MIN_SYNC_INTERVAL) {
        const waitSecs = Math.ceil((MIN_SYNC_INTERVAL - (Date.now() - lastStart)) / 1000);
        return res.status(429).json({
          message: `Please wait ${waitSecs} seconds before syncing again`,
        });
      }

      // Check in-memory lock
      if (syncLocks.get(usernameLower)) {
        const existingJob = await cache.getLatestSyncJobForUser(username);
        if (existingJob && existingJob.status === "running") {
          return res.json({
            job_id: existingJob.job_id,
            status: "running",
            message: "Sync already in progress",
          });
        }
      }

      // Create new job
      const jobId = randomUUID();
      const now = Date.now();

      const job: SyncJob = {
        job_id: jobId,
        username,
        status: "running",
        step: "starting",
        detail: "Initializing sync...",
        leagues_total: 0,
        leagues_done: 0,
        started_at: now,
        updated_at: now,
        error: null,
      };

      await cache.upsertSyncJob(job);
      syncLocks.set(usernameLower, true);
      lastSyncStart.set(usernameLower, now);

      // Start background job (don't await)
      runSyncJob(jobId, username).catch((err) => {
        console.error("Sync job failed:", err);
        syncLocks.delete(usernameLower);
      });

      res.json({
        job_id: jobId,
        status: "running",
        message: "Sync started",
      });
    } catch (e) {
      console.error("Sync error:", e);
      if (e instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input" });
      }
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/sync/status - Returns sync job progress
  app.get(api.sleeper.syncStatus.path, async (req, res) => {
    try {
      const { job_id } = api.sleeper.syncStatus.input.parse(req.query);

      const job = await cache.getSyncJob(job_id);
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }

      res.json({
        job_id: job.job_id,
        status: job.status,
        step: job.step,
        detail: job.detail,
        leagues_total: job.leagues_total,
        leagues_done: job.leagues_done,
        error: job.error,
      });
    } catch (e) {
      console.error("Sync status error:", e);
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

  // GET /api/group/:groupId/h2h - Get head-to-head records for a league group
  app.get(api.sleeper.h2h.path, async (req, res) => {
    try {
      const { groupId } = req.params;
      const { username } = api.sleeper.h2h.input.parse(req.query);

      const cachedUser = await cache.getUserByUsername(username);
      if (!cachedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const userId = cachedUser.user_id;
      const leagues = await cache.getLeaguesByGroupId(groupId, userId);

      if (leagues.length === 0) {
        return res.status(404).json({ message: "League group not found" });
      }

      // Aggregate H2H data across all leagues in group
      const h2hByOpponent = new Map<string, {
        wins: number; losses: number; ties: number; pf: number; pa: number; games: number;
      }>();

      // For each league, compute H2H if not cached
      for (const league of leagues) {
        let h2hRecords = await cache.getH2hForLeague(league.league_id, userId);

        // If no cached H2H data, compute it
        if (h2hRecords.length === 0) {
          const rosters = await getLeagueRosters(league.league_id);
          if (!rosters) continue;

          // Build roster_id -> owner_id map
          const rosterToOwner = new Map<number, string>();
          let myRosterId: number | null = null;
          for (const r of rosters) {
            if (r.owner_id) {
              rosterToOwner.set(r.roster_id, r.owner_id);
              if (r.owner_id === userId) {
                myRosterId = r.roster_id;
              }
            }
          }

          if (!myRosterId) continue;

          // Fetch matchups for each week (with concurrency limit of 2)
          const weekData: { week: number; matchups: any[] }[] = [];
          let consecutiveEmpty = 0;

          for (let week = 1; week <= 22; week++) {
            const matchups = await getMatchups(league.league_id, week);
            if (!matchups || matchups.length === 0) {
              consecutiveEmpty++;
              if (consecutiveEmpty >= 2) break;
            } else {
              consecutiveEmpty = 0;
              weekData.push({ week, matchups });
            }
          }

          // Process matchups to compute H2H
          const seasonH2h = new Map<string, {
            wins: number; losses: number; ties: number; pf: number; pa: number; games: number;
          }>();

          for (const { matchups } of weekData) {
            // Group by matchup_id
            const byMatchupId = new Map<number, any[]>();
            for (const m of matchups) {
              if (m.matchup_id) {
                if (!byMatchupId.has(m.matchup_id)) {
                  byMatchupId.set(m.matchup_id, []);
                }
                byMatchupId.get(m.matchup_id)!.push(m);
              }
            }

            // Find my matchup
            for (const entry of Array.from(byMatchupId.entries())) {
              const [matchupId, participants] = entry;
              const myEntry = participants.find((p: any) => p.roster_id === myRosterId);
              if (!myEntry) continue;

              const opponent = participants.find((p: any) => p.roster_id !== myRosterId);
              if (!opponent) continue;

              const oppOwnerId = rosterToOwner.get(opponent.roster_id);
              if (!oppOwnerId) continue;

              const myPts = myEntry.points || 0;
              const oppPts = opponent.points || 0;

              if (!seasonH2h.has(oppOwnerId)) {
                seasonH2h.set(oppOwnerId, { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, games: 0 });
              }

              const record = seasonH2h.get(oppOwnerId)!;
              record.games++;
              record.pf += myPts;
              record.pa += oppPts;

              if (myPts > oppPts) {
                record.wins++;
              } else if (myPts < oppPts) {
                record.losses++;
              } else {
                record.ties++;
              }
            }
          }

          // Save to cache
          for (const entry of Array.from(seasonH2h.entries())) {
            const [oppId, record] = entry;
            await cache.upsertH2hSeason({
              league_id: league.league_id,
              my_owner_id: userId,
              opp_owner_id: oppId,
              ...record,
            });
          }

          h2hRecords = await cache.getH2hForLeague(league.league_id, userId);
        }

        // Aggregate into overall H2H
        for (const record of h2hRecords) {
          if (!h2hByOpponent.has(record.opp_owner_id)) {
            h2hByOpponent.set(record.opp_owner_id, { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, games: 0 });
          }
          const agg = h2hByOpponent.get(record.opp_owner_id)!;
          agg.wins += record.wins;
          agg.losses += record.losses;
          agg.ties += record.ties;
          agg.pf += record.pf;
          agg.pa += record.pa;
          agg.games += record.games;
        }
      }

      // Get opponent names from most recent season
      const mostRecentLeague = leagues[0];
      const leagueUsers = await cache.getLeagueUsers(mostRecentLeague.league_id);
      const userMap = new Map(leagueUsers.map((u) => [u.user_id, u]));

      // Build response
      const opponents = Array.from(h2hByOpponent.entries()).map(([oppId, record]) => {
        const oppUser = userMap.get(oppId);
        return {
          opp_owner_id: oppId,
          display_name: oppUser?.display_name || null,
          team_name: oppUser?.team_name || null,
          ...record,
        };
      });

      // Sort by games DESC, then win% DESC
      opponents.sort((a, b) => {
        if (b.games !== a.games) return b.games - a.games;
        const aWinPct = a.games > 0 ? a.wins / a.games : 0;
        const bWinPct = b.games > 0 ? b.wins / b.games : 0;
        return bWinPct - aWinPct;
      });

      // Compute overall H2H record
      let totalWins = 0, totalLosses = 0, totalTies = 0;
      for (const opp of opponents) {
        totalWins += opp.wins;
        totalLosses += opp.losses;
        totalTies += opp.ties;
      }

      res.json({
        group_id: groupId,
        my_owner_id: userId,
        opponents,
        h2h_overall: { wins: totalWins, losses: totalLosses, ties: totalTies },
      });
    } catch (e) {
      console.error("H2H error:", e);
      if (e instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input" });
      }
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/group/:groupId/trades - Get trades for a league group
  app.get(api.sleeper.trades.path, async (req, res) => {
    try {
      const { groupId } = req.params;

      // Get all leagues in this group
      const allLeagues = await cache.getAllLeaguesMap();
      const groupLeagueIds: string[] = [];
      
      for (const l of allLeagues) {
        const league = await cache.getLeagueById(l.league_id);
        if (league?.group_id === groupId) {
          groupLeagueIds.push(l.league_id);
        }
      }

      if (groupLeagueIds.length === 0) {
        return res.status(404).json({ message: "League group not found" });
      }

      // Get trades for all leagues in group
      const trades: any[] = [];
      for (const leagueId of groupLeagueIds) {
        const leagueTrades = await cache.getTradesForLeague(leagueId);
        const league = await cache.getLeagueById(leagueId);
        
        for (const trade of leagueTrades) {
          // Parse adds and drops, resolve player names
          const parsedAdds = trade.adds ? JSON.parse(trade.adds) : null;
          const parsedDrops = trade.drops ? JSON.parse(trade.drops) : null;
          
          // Resolve player names for adds
          const addsWithNames: Record<string, { player_id: string; name: string; roster_id: string }> = {};
          if (parsedAdds && typeof parsedAdds === "object") {
            for (const [playerId, rosterId] of Object.entries(parsedAdds)) {
              const player = await cache.getPlayer(playerId);
              addsWithNames[playerId] = {
                player_id: playerId,
                name: player?.full_name || playerId,
                roster_id: String(rosterId),
              };
            }
          }
          
          // Resolve player names for drops
          const dropsWithNames: Record<string, { player_id: string; name: string; roster_id: string }> = {};
          if (parsedDrops && typeof parsedDrops === "object") {
            for (const [playerId, rosterId] of Object.entries(parsedDrops)) {
              const player = await cache.getPlayer(playerId);
              dropsWithNames[playerId] = {
                player_id: playerId,
                name: player?.full_name || playerId,
                roster_id: String(rosterId),
              };
            }
          }
          
          trades.push({
            transaction_id: trade.transaction_id,
            league_id: trade.league_id,
            league_name: league?.name,
            season: league?.season,
            status: trade.status,
            created_at: trade.created_at,
            roster_ids: trade.roster_ids ? JSON.parse(trade.roster_ids) : [],
            adds: Object.keys(addsWithNames).length > 0 ? addsWithNames : null,
            drops: Object.keys(dropsWithNames).length > 0 ? dropsWithNames : null,
            draft_picks: trade.draft_picks ? JSON.parse(trade.draft_picks) : null,
          });
        }
      }

      // Sort by created_at DESC
      trades.sort((a, b) => b.created_at - a.created_at);

      res.json({
        group_id: groupId,
        trades,
      });
    } catch (e) {
      console.error("Trades error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/players/exposure - Get player exposure for a user
  // Counts only CURRENT leagues (latest season per group_id) with pagination
  app.get(api.sleeper.playerExposure.path, async (req, res) => {
    try {
      const { username, page: pageStr, pageSize: pageSizeStr, pos, search, sort } = req.query;
      
      if (!username || typeof username !== "string") {
        return res.status(400).json({ message: "Username required" });
      }

      const page = Math.max(1, parseInt(pageStr as string) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(pageSizeStr as string) || 100));
      const posFilter = typeof pos === "string" && pos !== "all" ? pos : null;
      const searchFilter = typeof search === "string" ? search.toLowerCase().trim() : null;
      const sortBy = typeof sort === "string" ? sort : "exposure_desc";

      const cachedUser = await cache.getUserByUsername(username);
      if (!cachedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const userId = cachedUser.user_id;
      const allLeagues = await cache.getLeaguesForUser(userId);
      
      // Get only CURRENT leagues: latest season per group_id
      // Group leagues by group_id, keep only max season per group
      const groupMap = new Map<string, typeof allLeagues[0]>();
      for (const league of allLeagues) {
        const groupId = league.group_id || league.league_id;
        const existing = groupMap.get(groupId);
        if (!existing || (league.season && existing.season && league.season > existing.season)) {
          groupMap.set(groupId, league);
        }
      }
      const currentLeagues = Array.from(groupMap.values());
      const totalLeagues = currentLeagues.length;
      
      // Count player occurrences across CURRENT leagues only
      const playerCounts = new Map<string, { count: number; leagueNames: string[] }>();
      
      for (const league of currentLeagues) {
        const roster = await cache.getRosterForUserInLeague(league.league_id, userId);
        if (!roster) continue;

        const players = await cache.getRosterPlayersForUserInLeague(league.league_id, userId);

        for (const { player_id } of players) {
          if (!playerCounts.has(player_id)) {
            playerCounts.set(player_id, { count: 0, leagueNames: [] });
          }
          const entry = playerCounts.get(player_id)!;
          entry.count++;
          entry.leagueNames.push(league.name);
        }
      }

      // Build full exposure list with player details
      const allExposures = await Promise.all(
        Array.from(playerCounts.entries()).map(async ([playerId, { count, leagueNames }]) => {
          const player = await cache.getPlayer(playerId);
          return {
            player: {
              player_id: playerId,
              full_name: player?.full_name || null,
              first_name: player?.first_name || null,
              last_name: player?.last_name || null,
              position: player?.position || null,
              team: player?.team || null,
              status: player?.status || null,
              age: player?.age || null,
              years_exp: player?.years_exp || null,
            },
            leagues_owned: count,
            total_leagues: totalLeagues,
            exposure_pct: totalLeagues > 0 ? Math.round((count / totalLeagues) * 100) : 0,
            league_names: leagueNames,
          };
        })
      );

      // Apply filters
      let filtered = allExposures;
      if (posFilter) {
        filtered = filtered.filter(e => e.player.position === posFilter);
      }
      if (searchFilter) {
        filtered = filtered.filter(e => {
          const name = (e.player.full_name || e.player.player_id).toLowerCase();
          return name.includes(searchFilter);
        });
      }

      // Apply sorting
      switch (sortBy) {
        case "exposure_asc":
          filtered.sort((a, b) => a.exposure_pct - b.exposure_pct);
          break;
        case "name_asc":
          filtered.sort((a, b) => (a.player.full_name || a.player.player_id).localeCompare(b.player.full_name || b.player.player_id));
          break;
        case "name_desc":
          filtered.sort((a, b) => (b.player.full_name || b.player.player_id).localeCompare(a.player.full_name || a.player.player_id));
          break;
        case "leagues_desc":
          filtered.sort((a, b) => b.leagues_owned - a.leagues_owned);
          break;
        case "leagues_asc":
          filtered.sort((a, b) => a.leagues_owned - b.leagues_owned);
          break;
        case "exposure_desc":
        default:
          filtered.sort((a, b) => b.exposure_pct - a.exposure_pct);
          break;
      }

      const totalPlayers = filtered.length;
      const totalPages = Math.ceil(totalPlayers / pageSize);
      const startIdx = (page - 1) * pageSize;
      const items = filtered.slice(startIdx, startIdx + pageSize);

      res.json({
        username,
        total_leagues: totalLeagues,
        total_players: totalPlayers,
        page,
        pageSize,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
        exposures: items,
      });
    } catch (e) {
      console.error("Player exposure error:", e);
      if (e instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input" });
      }
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/scouting/:username - Get scouting stats for a user
  app.get("/api/scouting/:username", async (req, res) => {
    try {
      const { username } = req.params;
      
      const cachedUser = await cache.getUserByUsername(username);
      if (!cachedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const userId = cachedUser.user_id;
      const allLeagues = await cache.getLeaguesForUser(userId);
      
      // Get current leagues only (latest per group)
      const groupMap = new Map<string, typeof allLeagues[0]>();
      for (const league of allLeagues) {
        const groupId = league.group_id || league.league_id;
        const existing = groupMap.get(groupId);
        if (!existing || (league.season && existing.season && league.season > existing.season)) {
          groupMap.set(groupId, league);
        }
      }
      const currentLeagues = Array.from(groupMap.values());

      // Get all trades for current leagues
      const tradeStats = {
        total_trades: 0,
        total_picks_acquired: 0,
        total_picks_traded: 0,
        total_players_acquired: 0,
        total_players_traded: 0,
        leagues_with_trades: 0,
        avg_trades_per_league: 0,
        first_round_picks_acquired: 0,
        first_round_picks_traded: 0,
      };

      for (const league of currentLeagues) {
        const trades = await cache.getTradesForLeague(league.league_id);
        const roster = await cache.getRosterForUserInLeague(league.league_id, userId);
        if (!roster || !roster.roster_id) continue;

        const userRosterId = roster.roster_id;
        let leagueHasTrades = false;

        for (const trade of trades) {
          // Parse roster_ids to see if user was involved
          let rosterIds: number[] = [];
          try {
            rosterIds = JSON.parse(trade.roster_ids || "[]");
          } catch { }

          if (!rosterIds.includes(userRosterId)) continue;

          leagueHasTrades = true;
          tradeStats.total_trades++;

          // Parse adds to count players acquired
          try {
            const adds = JSON.parse(trade.adds || "{}") as Record<string, number>;
            for (const [playerId, addRosterId] of Object.entries(adds)) {
              if (addRosterId === userRosterId) {
                tradeStats.total_players_acquired++;
              }
            }
          } catch { }

          // Parse drops to count players traded away
          try {
            const drops = JSON.parse(trade.drops || "{}") as Record<string, number>;
            for (const [playerId, dropRosterId] of Object.entries(drops)) {
              if (dropRosterId === userRosterId) {
                tradeStats.total_players_traded++;
              }
            }
          } catch { }

          // Parse draft_picks to count picks moved
          try {
            const picks = JSON.parse(trade.draft_picks || "[]") as Array<{
              round: number;
              season: string;
              owner_id: number;
              previous_owner_id: number;
            }>;
            for (const pick of picks) {
              if (pick.owner_id === userRosterId) {
                tradeStats.total_picks_acquired++;
                if (pick.round === 1) tradeStats.first_round_picks_acquired++;
              }
              if (pick.previous_owner_id === userRosterId) {
                tradeStats.total_picks_traded++;
                if (pick.round === 1) tradeStats.first_round_picks_traded++;
              }
            }
          } catch { }
        }

        if (leagueHasTrades) {
          tradeStats.leagues_with_trades++;
        }
      }

      tradeStats.avg_trades_per_league = currentLeagues.length > 0 
        ? Math.round((tradeStats.total_trades / currentLeagues.length) * 10) / 10 
        : 0;

      // Calculate draft capital score (picks acquired minus traded, weighted by round)
      const draftCapitalScore = (tradeStats.first_round_picks_acquired * 3 + tradeStats.total_picks_acquired) - 
        (tradeStats.first_round_picks_traded * 3 + tradeStats.total_picks_traded);

      res.json({
        username,
        total_current_leagues: currentLeagues.length,
        trade_stats: tradeStats,
        draft_capital_score: draftCapitalScore,
        trade_propensity: tradeStats.avg_trades_per_league >= 5 ? "high" : 
          tradeStats.avg_trades_per_league >= 2 ? "medium" : "low",
      });
    } catch (e) {
      console.error("Scouting stats error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/league/:leagueId/draft-capital?username=<username>
  // Returns draft capital (owned picks by year/round) for a user in a specific league
  app.get("/api/league/:leagueId/draft-capital", async (req, res) => {
    const { leagueId } = req.params;
    const username = req.query.username as string;

    if (!username) {
      return res.status(400).json({ message: "Missing username" });
    }

    try {
      // Get user and rosters to find their roster_id
      const cachedUser = await cache.getUserByUsername(username);
      if (!cachedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const rosters = await cache.getRostersForLeague(leagueId);
      const userRoster = rosters.find(r => r.owner_id === cachedUser.user_id);
      
      if (!userRoster) {
        return res.status(404).json({ message: "User not in this league" });
      }

      const userRosterId = userRoster.roster_id;
      const totalRosters = rosters.length;

      // Fetch traded picks from Sleeper API
      const tradedPicks = await getTradedPicks(leagueId) as Array<{
        season: string;
        round: number;
        roster_id: number;
        previous_owner_id: number;
        owner_id: number;
      }> | null;

      // Extract unique years from traded picks data (only show years that have trade data)
      const yearsFromData = new Set<string>();
      if (tradedPicks && Array.isArray(tradedPicks)) {
        for (const pick of tradedPicks) {
          yearsFromData.add(pick.season);
        }
      }
      
      // Sort years and take only active seasons (years with traded pick data)
      const years = Array.from(yearsFromData).sort();
      const rounds = [1, 2, 3, 4];

      // Track user's picks: acquired and traded away
      const userPicks: Array<{ year: string; round: number; originalOwner: number }> = [];
      const tradedAwayPicks: Array<{ year: string; round: number; newOwner: number }> = [];

      if (tradedPicks && Array.isArray(tradedPicks)) {
        for (const pick of tradedPicks) {
          // If user is the new owner (acquired pick from another roster)
          if (pick.owner_id === userRosterId && pick.roster_id !== userRosterId) {
            userPicks.push({
              year: pick.season,
              round: pick.round,
              originalOwner: pick.roster_id,
            });
          }
          // If user was previous owner and no longer owns (traded away)
          if (pick.previous_owner_id === userRosterId && pick.owner_id !== userRosterId) {
            tradedAwayPicks.push({
              year: pick.season,
              round: pick.round,
              newOwner: pick.owner_id,
            });
          }
        }
      }

      // Calculate user's picks by year/round based on trade activity
      // For each year, start with 1 (own pick) then adjust based on trades
      const ownedPicks: Record<string, Record<number, number>> = {};
      for (const year of years) {
        ownedPicks[year] = {};
        for (const round of rounds) {
          // Start with 1 (user's own pick for this round)
          ownedPicks[year][round] = 1;
        }
      }

      // Add acquired picks (picks traded TO user)
      for (const pick of userPicks) {
        if (ownedPicks[pick.year] && ownedPicks[pick.year][pick.round] !== undefined) {
          ownedPicks[pick.year][pick.round]++;
        }
      }

      // Remove traded away picks (user's picks traded away)
      for (const pick of tradedAwayPicks) {
        if (ownedPicks[pick.year] && ownedPicks[pick.year][pick.round] !== undefined) {
          ownedPicks[pick.year][pick.round]--;
        }
      }

      // Calculate totals (only for years with actual data)
      let totalR1 = 0, totalR2 = 0, totalR3 = 0, totalR4 = 0;
      for (const year of years) {
        totalR1 += Math.max(0, ownedPicks[year][1] || 0);
        totalR2 += Math.max(0, ownedPicks[year][2] || 0);
        totalR3 += Math.max(0, ownedPicks[year][3] || 0);
        totalR4 += Math.max(0, ownedPicks[year][4] || 0);
      }
      const totalPicks = totalR1 + totalR2 + totalR3 + totalR4;

      // Pick Hoard Index: weighted sum of round 1-2 picks
      const pickHoardIndex = totalR1 * 2 + totalR2;

      res.json({
        league_id: leagueId,
        username,
        roster_id: userRosterId,
        picks_by_year: ownedPicks,
        totals: {
          r1: totalR1,
          r2: totalR2,
          r3: totalR3,
          r4: totalR4,
          total: totalPicks,
        },
        pick_hoard_index: pickHoardIndex,
        acquired_picks: userPicks,
        traded_away_picks: tradedAwayPicks,
      });
    } catch (e) {
      console.error("Draft capital error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/league/:leagueId/churn?username=<username>
  // Returns roster churn stats (waiver moves, transactions) for a user
  app.get("/api/league/:leagueId/churn", async (req, res) => {
    const { leagueId } = req.params;
    const username = req.query.username as string;

    if (!username) {
      return res.status(400).json({ message: "Missing username" });
    }

    try {
      const cachedUser = await cache.getUserByUsername(username);
      if (!cachedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const rosters = await cache.getRostersForLeague(leagueId);
      const userRoster = rosters.find(r => r.owner_id === cachedUser.user_id);
      
      if (!userRoster) {
        return res.status(404).json({ message: "User not in this league" });
      }

      const userRosterId = userRoster.roster_id;

      // Fetch transactions (non-trade) from cache or compute from trades table
      // For now, use trades table and filter for waiver/free_agent types
      const leagueTxns = await cache.getTradesForLeague(leagueId);
      
      // Count adds/drops for the user (waiver moves stored in roster_ids)
      let addsCount = 0;
      let dropsCount = 0;
      let tradeCount = 0;

      for (const txn of leagueTxns) {
        // Parse roster_ids to check if user is involved
        let rosterIds: number[] = [];
        try {
          rosterIds = txn.roster_ids ? JSON.parse(txn.roster_ids) : [];
        } catch { }

        if (!rosterIds.includes(userRosterId)) continue;

        // Count based on transaction type
        if (txn.status === "complete") {
          // Parse adds/drops
          try {
            const adds = JSON.parse(txn.adds || "{}") as Record<string, number>;
            for (const [playerId, rosterId] of Object.entries(adds)) {
              if (rosterId === userRosterId) addsCount++;
            }
          } catch { }

          try {
            const drops = JSON.parse(txn.drops || "{}") as Record<string, number>;
            for (const [playerId, rosterId] of Object.entries(drops)) {
              if (rosterId === userRosterId) dropsCount++;
            }
          } catch { }

          // Check if this is a trade (has draft_picks or multiple roster_ids)
          if (rosterIds.length > 1) {
            tradeCount++;
          }
        }
      }

      // Calculate churn rate (moves per transaction count or estimated weeks)
      const totalMoves = addsCount + dropsCount;
      const estimatedWeeks = 18; // NFL season weeks
      const churnRate = Math.round((totalMoves / estimatedWeeks) * 10) / 10;

      // Get league-wide stats for comparison
      const allUserMoves: Array<{ roster_id: number; moves: number }> = [];
      for (const roster of rosters) {
        let rosterMoves = 0;
        for (const txn of leagueTxns) {
          let rosterIds: number[] = [];
          try { rosterIds = txn.roster_ids ? JSON.parse(txn.roster_ids) : []; } catch { }
          if (!rosterIds.includes(roster.roster_id)) continue;

          try {
            const adds = JSON.parse(txn.adds || "{}") as Record<string, number>;
            for (const [_, rid] of Object.entries(adds)) {
              if (rid === roster.roster_id) rosterMoves++;
            }
          } catch { }
          try {
            const drops = JSON.parse(txn.drops || "{}") as Record<string, number>;
            for (const [_, rid] of Object.entries(drops)) {
              if (rid === roster.roster_id) rosterMoves++;
            }
          } catch { }
        }
        allUserMoves.push({ roster_id: roster.roster_id, moves: rosterMoves });
      }

      allUserMoves.sort((a, b) => b.moves - a.moves);
      const rank = allUserMoves.findIndex(m => m.roster_id === userRosterId) + 1;
      
      // Compute league average excluding the current user for fair comparison
      const otherMoves = allUserMoves.filter(m => m.roster_id !== userRosterId);
      const leagueAvg = otherMoves.length > 0 
        ? Math.round((otherMoves.reduce((s, m) => s + m.moves, 0) / otherMoves.length) * 10) / 10 
        : 0;

      res.json({
        league_id: leagueId,
        username,
        roster_id: userRosterId,
        adds: addsCount,
        drops: dropsCount,
        trades: tradeCount,
        total_moves: totalMoves,
        churn_rate: churnRate,
        league_rank: rank,
        league_size: rosters.length,
        league_avg_moves: leagueAvg,
        activity_level: totalMoves > leagueAvg * 1.5 ? "very_active" :
          totalMoves > leagueAvg ? "active" :
          totalMoves > leagueAvg * 0.5 ? "moderate" : "inactive",
      });
    } catch (e) {
      console.error("Churn stats error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/league/:leagueId/trade-timing?username=<username>
  // Returns trade timing analysis - when trades happen (draft vs in-season)
  app.get("/api/league/:leagueId/trade-timing", async (req, res) => {
    const { leagueId } = req.params;
    const username = req.query.username as string;

    if (!username) {
      return res.status(400).json({ message: "Missing username" });
    }

    try {
      const cachedUser = await cache.getUserByUsername(username);
      if (!cachedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const rosters = await cache.getRostersForLeague(leagueId);
      const userRoster = rosters.find(r => r.owner_id === cachedUser.user_id);
      
      if (!userRoster) {
        return res.status(404).json({ message: "User not in this league" });
      }

      const userRosterId = userRoster.roster_id;
      const leagueTxns = await cache.getTradesForLeague(leagueId);
      
      // Analyze trade timing
      // NFL season phases:
      // - Draft window: August-September (before regular season)
      // - Regular season: Weeks 1-14 (September-December)
      // - Playoffs: Weeks 15-17 (December-January)
      // - Offseason: February-July
      
      let draftWindowTrades = 0;
      let inSeasonTrades = 0;
      let playoffTrades = 0;
      let offseasonTrades = 0;
      let totalTrades = 0;

      for (const txn of leagueTxns) {
        // Check if user is involved in this trade
        let rosterIds: number[] = [];
        try { rosterIds = txn.roster_ids ? JSON.parse(txn.roster_ids) : []; } catch { }
        if (!rosterIds.includes(userRosterId)) continue;

        totalTrades++;

        // Use transaction timestamp (Sleeper stores in ms)
        const txnDate = txn.created_at ? new Date(txn.created_at) : null;
        
        if (txnDate) {
          const month = txnDate.getMonth(); // 0-11
          
          if (month >= 7 && month <= 8) { // August-September (pre-season/draft window)
            draftWindowTrades++;
          } else if (month >= 1 && month <= 6) { // February-July (offseason)
            offseasonTrades++;
          } else if (month >= 11 || month === 0) { // December-January (playoffs)
            playoffTrades++;
          } else { // September-November (regular season)
            inSeasonTrades++;
          }
        } else {
          offseasonTrades++; // Default to offseason if no timing info
        }
      }

      // Determine trading style
      let tradingStyle = "balanced";
      if (totalTrades > 0) {
        const draftRatio = draftWindowTrades / totalTrades;
        const inSeasonRatio = inSeasonTrades / totalTrades;
        const offseasonRatio = offseasonTrades / totalTrades;
        
        if (draftRatio > 0.5) tradingStyle = "draft_heavy";
        else if (inSeasonRatio > 0.5) tradingStyle = "reactionary";
        else if (offseasonRatio > 0.5) tradingStyle = "offseason_builder";
      }

      res.json({
        league_id: leagueId,
        username,
        roster_id: userRosterId,
        total_trades: totalTrades,
        draft_window: draftWindowTrades,
        in_season: inSeasonTrades,
        playoffs: playoffTrades,
        offseason: offseasonTrades,
        trading_style: tradingStyle,
      });
    } catch (e) {
      console.error("Trade timing error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/league/:leagueId/all-play?username=<username>
  // Returns all-play record and luck index (what record would be if played everyone each week)
  app.get("/api/league/:leagueId/all-play", async (req, res) => {
    const { leagueId } = req.params;
    const username = req.query.username as string;

    if (!username) {
      return res.status(400).json({ message: "Missing username" });
    }

    try {
      const cachedUser = await cache.getUserByUsername(username);
      if (!cachedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const rosters = await cache.getRostersForLeague(leagueId);
      const userRoster = rosters.find(r => r.owner_id === cachedUser.user_id);
      
      if (!userRoster) {
        return res.status(404).json({ message: "User not in this league" });
      }

      const userRosterId = userRoster.roster_id;
      const leagueSize = rosters.length;

      // Fetch matchups for each week (1-14 for regular season)
      let allPlayWins = 0;
      let allPlayLosses = 0;
      let allPlayTies = 0;
      let actualWins = 0;
      let actualLosses = 0;
      let actualTies = 0;
      let weeksPlayed = 0;

      for (let week = 1; week <= 18; week++) {
        const matchups = await getMatchups(leagueId, week) as Array<{
          roster_id: number;
          points: number;
          matchup_id: number;
        }> | null;

        if (!matchups || matchups.length === 0) continue;

        // Find user's score this week
        const userMatchup = matchups.find(m => m.roster_id === userRosterId);
        if (!userMatchup || userMatchup.points === undefined) continue;

        weeksPlayed++;
        const userScore = userMatchup.points;
        const userMatchupId = userMatchup.matchup_id;

        // Find actual opponent
        const actualOpponent = matchups.find(
          m => m.matchup_id === userMatchupId && m.roster_id !== userRosterId
        );
        
        // Track actual result (1 game per week)
        if (actualOpponent && actualOpponent.points !== undefined) {
          if (userScore > actualOpponent.points) actualWins++;
          else if (userScore < actualOpponent.points) actualLosses++;
          else actualTies++;
        }

        // Calculate all-play record (vs everyone except self)
        // This is the theoretical record if you played everyone each week
        for (const opp of matchups) {
          if (opp.roster_id === userRosterId) continue;
          if (opp.points === undefined) continue;

          if (userScore > opp.points) allPlayWins++;
          else if (userScore < opp.points) allPlayLosses++;
          else allPlayTies++;
        }
      }

      // Calculate luck index: difference between actual win rate and expected (all-play) win rate
      const totalAllPlayGames = allPlayWins + allPlayLosses + allPlayTies;
      const totalActualGames = actualWins + actualLosses + actualTies;
      
      const allPlayWinRate = totalAllPlayGames > 0 
        ? (allPlayWins + allPlayTies * 0.5) / totalAllPlayGames 
        : 0;
      const actualWinRate = totalActualGames > 0 
        ? (actualWins + actualTies * 0.5) / totalActualGames 
        : 0;
      
      // Positive luck = actual record better than expected
      const luckIndex = Math.round((actualWinRate - allPlayWinRate) * 100);
      
      let luckLabel = "neutral";
      if (luckIndex > 10) luckLabel = "lucky";
      else if (luckIndex > 5) luckLabel = "slightly_lucky";
      else if (luckIndex < -10) luckLabel = "unlucky";
      else if (luckIndex < -5) luckLabel = "slightly_unlucky";

      res.json({
        league_id: leagueId,
        username,
        roster_id: userRosterId,
        weeks_played: weeksPlayed,
        all_play: {
          wins: allPlayWins,
          losses: allPlayLosses,
          ties: allPlayTies,
          win_rate: Math.round(allPlayWinRate * 100),
        },
        actual: {
          wins: actualWins,
          losses: actualLosses,
          ties: actualTies,
          win_rate: Math.round(actualWinRate * 100),
        },
        luck_index: luckIndex,
        luck_label: luckLabel,
      });
    } catch (e) {
      console.error("All-play error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  return httpServer;
}
