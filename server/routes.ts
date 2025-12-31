import type { Express } from "express";
import { createServer, type Server } from "http";
import { api } from "@shared/routes";
import { z } from "zod";
import cache, { type SyncJob } from "./cache";
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
function computeLeagueGroups(userId: string): void {
  const leagues = cache.getLeaguesForUser(userId);
  const leagueMap = new Map(leagues.map((l) => [l.league_id, l]));

  // Build a map from league_id to its root (following previous_league_id)
  const findRoot = (leagueId: string): string => {
    let current = leagueId;
    const visited = new Set<string>();

    while (true) {
      // Check for manual override first
      const override = cache.getGroupOverride(current);
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
    const groupId = findRoot(league.league_id);
    if (league.group_id !== groupId) {
      cache.updateLeagueGroupId(league.league_id, groupId);
    }
  }
}

// Build league groups from cached data
function buildLeagueGroups(userId: string): LeagueGroup[] {
  const leagues = cache.getLeaguesForUser(userId);
  const rosters = cache.getRostersForUser(userId);
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
  const updateJob = (updates: Partial<SyncJob>) => {
    const existing = cache.getSyncJob(jobId);
    if (existing) {
      cache.upsertSyncJob({ ...existing, ...updates, updated_at: Date.now() });
    }
  };

  try {
    updateJob({ step: "user", detail: "Fetching user info..." });

    // Fetch user from Sleeper
    const user = await getUserByUsername(username);
    if (!user) {
      updateJob({ status: "error", error: "User not found on Sleeper" });
      syncLocks.delete(username.toLowerCase());
      return;
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

    updateJob({ step: "leagues", detail: "Fetching leagues..." });

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
        raw_json: JSON.stringify(league),
      });
    }

    updateJob({
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
            cache.upsertRoster({
              league_id: league.league_id,
              owner_id: r.owner_id,
              roster_id: r.roster_id,
              wins: r.settings?.wins || 0,
              losses: r.settings?.losses || 0,
              ties: r.settings?.ties || 0,
              fpts: r.settings?.fpts || 0,
              fpts_against: r.settings?.fpts_against || 0,
            });
          }
        }

        rostersCount++;
        updateJob({ leagues_done: rostersCount });
      } catch (err) {
        console.error(`Error fetching rosters for league ${league.league_id}:`, err);
      }
    });

    updateJob({ step: "users", detail: "Fetching league members..." });

    // Fetch league users with concurrency limit
    await withConcurrencyLimit(allLeagues, 6, async (league) => {
      try {
        const users = await getLeagueUsers(league.league_id);
        if (!users) return;

        for (const u of users) {
          cache.upsertLeagueUser({
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

    updateJob({ step: "grouping", detail: "Computing league groups..." });

    // Compute league groups
    computeLeagueGroups(userId);

    updateJob({
      status: "done",
      step: "done",
      detail: `Synced ${allLeagues.length} leagues`,
      leagues_done: allLeagues.length,
    });
  } catch (err) {
    console.error("Sync job error:", err);
    updateJob({
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

  // GET /api/overview - Returns league groups with aggregated W-L records
  // Always returns cached data immediately with sync status flags
  app.get(api.sleeper.overview.path, async (req, res) => {
    try {
      const { username } = api.sleeper.overview.input.parse(req.query);

      // Check cache first
      let cachedUser = cache.getUserByUsername(username);
      const runningJob = cache.getRunningJobForUser(username);
      const latestJob = cache.getLatestSyncJobForUser(username);

      // Determine sync status
      let syncStatus: "not_started" | "running" | "done" | "error" = "not_started";
      if (runningJob) {
        syncStatus = "running";
      } else if (latestJob) {
        syncStatus = latestJob.status as any;
      }

      if (cachedUser) {
        const leagueGroups = buildLeagueGroups(cachedUser.user_id);
        const lastSync = cache.getLastSyncTime(cachedUser.user_id);
        const isStale = cache.isDataStale(cachedUser.user_id);

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
      const runningJob = cache.getRunningJobForUser(username);
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
        const existingJob = cache.getLatestSyncJobForUser(username);
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

      cache.upsertSyncJob(job);
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

      const job = cache.getSyncJob(job_id);
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

      const cachedUser = cache.getUserByUsername(username);
      if (!cachedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const userId = cachedUser.user_id;
      const leagues = cache.getLeaguesByGroupId(groupId, userId);

      if (leagues.length === 0) {
        return res.status(404).json({ message: "League group not found" });
      }

      // Aggregate H2H data across all leagues in group
      const h2hByOpponent = new Map<string, {
        wins: number; losses: number; ties: number; pf: number; pa: number; games: number;
      }>();

      // For each league, compute H2H if not cached
      for (const league of leagues) {
        let h2hRecords = cache.getH2hForLeague(league.league_id, userId);

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
            cache.upsertH2hSeason({
              league_id: league.league_id,
              my_owner_id: userId,
              opp_owner_id: oppId,
              ...record,
            });
          }

          h2hRecords = cache.getH2hForLeague(league.league_id, userId);
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
      const leagueUsers = cache.getLeagueUsers(mostRecentLeague.league_id);
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

  return httpServer;
}
