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

// Get current NFL season year (use calendar year, adjusting for NFL season timing)
function getCurrentNFLSeason(): number {
  const now = new Date();
  // NFL season runs Aug-Feb, so if we're in Jan-Feb, use previous year
  const month = now.getMonth(); // 0-indexed
  const year = now.getFullYear();
  return month <= 1 ? year - 1 : year;
}

// Compute trade summary for a user in a set of leagues (uses latest league only for "current" mode)
async function computeTradeSummary(
  userId: string,
  latestLeagueId: string,
  allLeagueIds: string[],
  userRosters: Array<{ league_id: string; roster_id: number; owner_id: string }>
): Promise<{ trade_count: number; trading_style: string | null; top_partner: { user_id: string; display_name: string | null; trade_count: number } | null }> {
  const rosterByLeague = new Map(userRosters.map(r => [r.league_id, r]));
  
  let totalTrades = 0;
  const partnerCounts = new Map<string, { user_id: string; display_name: string | null; count: number }>();
  const tradeTiming = { offseason: 0, draft_window: 0, inseason: 0, playoffs: 0 };
  
  // Only use latest league for tile summary (current mode)
  const leaguesToScan = [latestLeagueId];
  
  for (const leagueId of leaguesToScan) {
    const userRoster = rosterByLeague.get(leagueId);
    if (!userRoster) continue;
    
    // Pre-fetch league data once per league (avoid N+1)
    const leagueRosters = await cache.getRostersForLeague(leagueId);
    const leagueUsers = await cache.getLeagueUsers(leagueId);
    const rosterToOwner = new Map(leagueRosters.map(r => [r.roster_id, r.owner_id]));
    const userById = new Map(leagueUsers.map(u => [u.user_id, u]));
    
    const trades = await cache.getTradesForLeague(leagueId);
    for (const trade of trades) {
      if (trade.status !== "complete") continue;
      
      let rosterIds: number[] = [];
      try {
        rosterIds = trade.roster_ids ? JSON.parse(trade.roster_ids) : [];
      } catch { continue; }
      
      if (!rosterIds.includes(userRoster.roster_id)) continue;
      
      totalTrades++;
      
      // Count counterparties using pre-fetched data
      for (const ridNum of rosterIds) {
        if (ridNum === userRoster.roster_id) continue;
        const ownerId = rosterToOwner.get(ridNum);
        if (!ownerId) continue;
        
        const existing = partnerCounts.get(ownerId);
        if (existing) {
          existing.count++;
        } else {
          const counterUser = userById.get(ownerId);
          partnerCounts.set(ownerId, {
            user_id: ownerId,
            display_name: counterUser?.display_name || null,
            count: 1,
          });
        }
      }
      
      // Trade timing classification (normalize Sleeper's seconds to ms)
      if (trade.created_at) {
        const ts = trade.created_at < 1e11 ? trade.created_at * 1000 : trade.created_at;
        const d = new Date(ts);
        const month = d.getMonth();
        // NFL calendar: offseason (Mar-Jul), draft window (Aug-Sep), in-season (Oct-Dec+Jan), playoffs (Jan-Feb)
        if (month >= 2 && month <= 6) tradeTiming.offseason++;
        else if (month >= 7 && month <= 8) tradeTiming.draft_window++;
        else if (month >= 9 || month === 0) tradeTiming.inseason++;
        else tradeTiming.playoffs++;
      }
    }
  }
  
  // Determine trading style
  let tradingStyle: string | null = null;
  if (totalTrades > 0) {
    const maxPhase = Object.entries(tradeTiming).sort((a, b) => b[1] - a[1])[0];
    if (maxPhase[0] === "offseason" && maxPhase[1] > totalTrades * 0.4) tradingStyle = "Offseason Builder";
    else if (maxPhase[0] === "draft_window" && maxPhase[1] > totalTrades * 0.4) tradingStyle = "Draft Day Dealer";
    else if (maxPhase[0] === "inseason" && maxPhase[1] > totalTrades * 0.4) tradingStyle = "In-Season Trader";
    else if (maxPhase[0] === "playoffs" && maxPhase[1] > totalTrades * 0.4) tradingStyle = "Playoff Push";
    else tradingStyle = "Balanced";
  }
  
  // Find top partner
  let topPartner: { user_id: string; display_name: string | null; trade_count: number } | null = null;
  if (partnerCounts.size > 0) {
    const sorted = Array.from(partnerCounts.values()).sort((a, b) => b.count - a.count);
    if (sorted[0]) {
      topPartner = {
        user_id: sorted[0].user_id,
        display_name: sorted[0].display_name,
        trade_count: sorted[0].count,
      };
    }
  }
  
  return { trade_count: totalTrades, trading_style: tradingStyle, top_partner: topPartner };
}

// Build league groups from cached data
async function buildLeagueGroups(userId: string): Promise<LeagueGroup[]> {
  const leagues = await cache.getLeaguesForUser(userId);
  const rosters = await cache.getRostersForUser(userId);
  const rosterMap = new Map(rosters.map((r) => [r.league_id, r]));
  const currentSeason = getCurrentNFLSeason();

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

    // Determine if this group is "active":
    // User has a roster in the latest league AND 
    // (league status is not "complete" OR season == current NFL season)
    const latestLeague = groupLeagues[0];
    const latestRoster = rosterMap.get(latestLeague.league_id);
    const hasRosterInLatest = !!latestRoster;
    const isCurrentSeason = latestLeague.season === currentSeason;
    const isNotComplete = latestLeague.status !== "complete";
    const isActive = hasRosterInLatest && (isNotComplete || isCurrentSeason);

    // Compute trade summary for this group (uses latest league only)
    const userRostersForGroup = rosters
      .filter(r => leagueIds.includes(r.league_id))
      .map(r => ({ league_id: r.league_id, roster_id: r.roster_id, owner_id: r.owner_id }));
    
    const tradeSummary = await computeTradeSummary(
      userId,
      latestLeague.league_id,
      leagueIds,
      userRostersForGroup
    );

    result.push({
      group_id: groupId,
      name: groupLeagues[0].name, // most recent season name
      min_season: minSeason,
      max_season: maxSeason,
      seasons_count: groupLeagues.length,
      overall_record: { wins: totalWins, losses: totalLosses, ties: totalTies },
      league_ids: leagueIds,
      league_type: leagueType,
      is_active: isActive,
      latest_league_id: latestLeague.league_id,
      trade_summary: tradeSummary,
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
          username,
          leagues_count: 0,
          rosters_count: 0,
          total_groups: 0,
          active_groups: 0,
          history_groups: 0,
          trades_count: 0,
          players_master_count: 0,
          current_nfl_season: getCurrentNFLSeason(),
        });
      }

      // Get counts
      const leagues = await cache.getLeaguesForUser(user.user_id);
      const rosters = await cache.getRostersForUser(user.user_id);
      
      // Build league groups and count active vs history
      const leagueGroups = await buildLeagueGroups(user.user_id);
      const activeGroups = leagueGroups.filter(g => g.is_active);
      const historyGroups = leagueGroups.filter(g => !g.is_active);

      // Count trades for user's leagues
      let tradesCount = 0;
      for (const league of leagues) {
        const trades = await cache.getTradesForLeague(league.league_id);
        tradesCount += trades.length;
      }

      // Count players_master
      const playerCount = await cache.getPlayerCount();
      
      // Count trade assets
      const tradeAssetCounts = await cache.getTradeAssetCounts();

      return res.json({
        user_exists: true,
        user_id: user.user_id,
        username: user.username,
        leagues_count: leagues.length,
        rosters_count: rosters.length,
        rosters_with_players: rosters.filter((r: any) => r.players && r.players.length > 0).length,
        total_groups: leagueGroups.length,
        active_groups: activeGroups.length,
        history_groups: historyGroups.length,
        trades_count: tradesCount,
        trade_assets_count: tradeAssetCounts.total,
        players_master_count: playerCount,
        current_nfl_season: getCurrentNFLSeason(),
      });
    } catch (e) {
      console.error("Debug endpoint error:", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "Unknown error" });
    }
  });

  // GET /api/debug/league?groupId=...&username=... - Debug endpoint for league-level info
  app.get("/api/debug/league", async (req, res) => {
    try {
      const groupId = req.query.groupId as string;
      const username = req.query.username as string;
      
      if (!groupId || !username) {
        return res.status(400).json({ 
          error: "groupId and username required",
          group_found: false,
          group_id: groupId || null,
          username: username || null,
        });
      }

      const user = await cache.getUserByUsername(username);
      if (!user) {
        return res.json({ 
          error: "User not found in cache",
          group_found: false,
          group_id: groupId,
          username: username,
          current_nfl_season: getCurrentNFLSeason(),
        });
      }

      const leagueGroups = await buildLeagueGroups(user.user_id);
      const group = leagueGroups.find(g => g.group_id === groupId);
      
      if (!group) {
        return res.json({ 
          error: "Group not found for this user",
          group_found: false,
          group_id: groupId,
          username: username,
          user_id: user.user_id,
          total_groups_available: leagueGroups.length,
          available_group_ids: leagueGroups.map(g => g.group_id).slice(0, 5),
          current_nfl_season: getCurrentNFLSeason(),
        });
      }

      const latestLeagueId = group.league_ids[group.league_ids.length - 1];
      const rosters = latestLeagueId ? await cache.getRostersForLeague(latestLeagueId) : [];
      const userRoster = rosters.find(r => r.owner_id === user.user_id);
      
      // Count trades for this group
      let groupTradesCount = 0;
      for (const leagueId of group.league_ids) {
        const trades = await cache.getTradesForLeague(leagueId);
        groupTradesCount += trades.length;
      }

      return res.json({
        group_found: true,
        group_id: groupId,
        group_name: group.name || "Unknown",
        min_season: group.min_season,
        max_season: group.max_season,
        seasons_count: group.seasons_count,
        league_ids: group.league_ids || [],
        latest_league_id: latestLeagueId || null,
        is_active: group.is_active ?? false,
        league_type: group.league_type || "unknown",
        user_roster_id: userRoster ? userRoster.roster_id : null,
        user_in_latest_league: !!userRoster,
        roster_count: rosters.length,
        group_trades_count: groupTradesCount,
        total_wins: group.overall_record?.wins ?? 0,
        total_losses: group.overall_record?.losses ?? 0,
        current_nfl_season: getCurrentNFLSeason(),
      });
    } catch (e) {
      console.error("Debug league endpoint error:", e);
      res.status(500).json({ 
        error: e instanceof Error ? e.message : "Unknown error",
        group_found: false,
      });
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
  // Optional query params: 
  //   username - filter to only trades involving this user
  //   mode - "current" (latest season only) or "history" (all seasons)
  app.get(api.sleeper.trades.path, async (req, res) => {
    try {
      const { groupId } = req.params;
      const { username, mode } = req.query;
      const viewMode = mode === "history" ? "history" : "current";

      // Get all leagues in this group
      const allLeagues = await cache.getAllLeaguesMap();
      const groupLeagueIds: string[] = [];
      let maxSeason = 0;
      
      for (const l of allLeagues) {
        const league = await cache.getLeagueById(l.league_id);
        if (league?.group_id === groupId) {
          groupLeagueIds.push(l.league_id);
          if (league.season && league.season > maxSeason) {
            maxSeason = league.season;
          }
        }
      }
      
      // Filter to latest season if mode is "current"
      let filteredLeagueIds = groupLeagueIds;
      if (viewMode === "current" && maxSeason > 0) {
        filteredLeagueIds = [];
        for (const lid of groupLeagueIds) {
          const league = await cache.getLeagueById(lid);
          if (league?.season === maxSeason) {
            filteredLeagueIds.push(lid);
          }
        }
      }

      if (groupLeagueIds.length === 0) {
        return res.status(404).json({ message: "League group not found" });
      }

      // If username provided, get user's roster_id for each league
      let userRosterIds: Map<string, number> | null = null;
      let userId: string | null = null;
      if (username && typeof username === "string") {
        const cachedUser = await cache.getUserByUsername(username);
        if (cachedUser) {
          userId = cachedUser.user_id;
          userRosterIds = new Map();
          for (const leagueId of filteredLeagueIds) {
            const roster = await cache.getRosterForUserInLeague(leagueId, userId);
            if (roster) {
              userRosterIds.set(leagueId, roster.roster_id);
            }
          }
        }
      }

      // Get trades for leagues (filtered by mode)
      const trades: any[] = [];
      let totalTradesChecked = 0;
      
      for (const leagueId of filteredLeagueIds) {
        const leagueTrades = await cache.getTradesForLeague(leagueId);
        const league = await cache.getLeagueById(leagueId);
        totalTradesChecked += leagueTrades.length;
        
        for (const trade of leagueTrades) {
          // Parse roster_ids to check user involvement
          const rosterIds = trade.roster_ids ? JSON.parse(trade.roster_ids) : [];
          
          // If filtering by username, check if user is involved in trade
          if (userRosterIds) {
            const myRosterId = userRosterIds.get(leagueId);
            const isInvolved = myRosterId && rosterIds.includes(myRosterId);
            
            // Also check adds/drops structure as fallback
            let involvedViaAddsDrops = false;
            if (!isInvolved && userId) {
              const parsedAdds = trade.adds ? JSON.parse(trade.adds) : null;
              const parsedDrops = trade.drops ? JSON.parse(trade.drops) : null;
              const draftPicks = trade.draft_picks ? JSON.parse(trade.draft_picks) : [];
              
              // Check if user's roster_id appears in adds/drops values or draft_picks
              if (myRosterId) {
                if (parsedAdds) {
                  involvedViaAddsDrops = Object.values(parsedAdds).includes(myRosterId);
                }
                if (!involvedViaAddsDrops && parsedDrops) {
                  involvedViaAddsDrops = Object.values(parsedDrops).includes(myRosterId);
                }
                if (!involvedViaAddsDrops && draftPicks.length > 0) {
                  involvedViaAddsDrops = draftPicks.some((p: any) => 
                    p.owner_id === myRosterId || p.previous_owner_id === myRosterId
                  );
                }
              }
            }
            
            if (!isInvolved && !involvedViaAddsDrops) continue;
          }
          
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
            roster_ids: rosterIds,
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
        mode: viewMode,
        seasons_checked: filteredLeagueIds.length,
        total_seasons_in_group: groupLeagueIds.length,
        total_trades_in_db: totalTradesChecked,
      });
    } catch (e) {
      console.error("Trades error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/players/exposure - Get player exposure for a user
  // Counts only ACTIVE leagues (latest season per group_id where user has roster and league is active) with pagination
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
      
      // Use buildLeagueGroups to get active vs history classification
      const leagueGroups = await buildLeagueGroups(userId);
      const activeGroups = leagueGroups.filter(g => g.is_active);
      const historyGroups = leagueGroups.filter(g => !g.is_active);
      
      const activeGroupCount = activeGroups.length;
      const historyGroupCount = historyGroups.length;
      
      // Get only ACTIVE leagues: latest league_id from each active group
      const activeLeagueIds = activeGroups.map(g => g.latest_league_id).filter(Boolean) as string[];
      const allLeagues = await cache.getLeaguesForUser(userId);
      const activeLeagues = allLeagues.filter(l => activeLeagueIds.includes(l.league_id));
      
      // Count player occurrences across ACTIVE leagues only
      const playerCounts = new Map<string, { count: number; leagueNames: string[] }>();
      
      for (const league of activeLeagues) {
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
      // Denominator is activeGroupCount (not total leagues, not all groups)
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
            total_leagues: activeGroupCount,
            exposure_pct: activeGroupCount > 0 ? Math.round((count / activeGroupCount) * 100) : 0,
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
        active_leagues: activeGroupCount,
        history_leagues: historyGroupCount,
        total_leagues: activeGroupCount, // Keep for backwards compatibility
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

  // GET /api/targets - Get trade targets for a league based on opponent exposure
  app.get("/api/targets", async (req, res) => {
    try {
      const { username, league_id } = req.query;
      
      if (!username || typeof username !== "string") {
        return res.status(400).json({ message: "Username required" });
      }
      if (!league_id || typeof league_id !== "string") {
        return res.status(400).json({ message: "league_id required" });
      }

      const cachedUser = await cache.getUserByUsername(username);
      if (!cachedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const userId = cachedUser.user_id;
      const league = await cache.getLeagueById(league_id);
      if (!league) {
        return res.status(404).json({ message: "League not found" });
      }

      // Get my roster in this league
      const myRoster = await cache.getRosterForUserInLeague(league_id, userId);
      if (!myRoster) {
        return res.status(404).json({ message: "No roster found for user in this league" });
      }

      // Get my players
      const myPlayers = await cache.getRosterPlayersForUserInLeague(league_id, userId);
      const myPlayerIds = myPlayers.map(p => p.player_id);

      // Get all rosters in the league to find opponents
      const allRosters = await cache.getRostersForLeague(league_id);
      const leagueUsers = await cache.getLeagueUsers(league_id);

      // Build targets for each opponent
      const targets: Array<{
        opponent_username: string;
        opponent_display_name: string | null;
        target_score: number;
        matched_assets: Array<{
          player_id: string;
          name: string;
          pos: string | null;
          team: string | null;
          exposure_pct: number;
        }>;
        meta: {
          active_league_count: number;
          last_synced_at: number | null;
          is_partial: boolean;
        };
      }> = [];

      for (const roster of allRosters) {
        // Skip my own roster
        if (roster.owner_id === userId) continue;

        // Find opponent's username from league_users
        const oppUser = leagueUsers.find(u => u.user_id === roster.owner_id);
        if (!oppUser) continue;

        // Get opponent's cached user info for username
        const oppCachedUser = await cache.getUserById(roster.owner_id);
        const oppUsername = oppCachedUser?.username;
        if (!oppUsername) continue;

        // Get opponent's exposure profile
        const exposureProfile = await cache.getExposureProfile(oppUsername);
        
        const matchedAssets: Array<{
          player_id: string;
          name: string;
          pos: string | null;
          team: string | null;
          exposure_pct: number;
        }> = [];
        let targetScore = 0;

        if (exposureProfile) {
          // Calculate target score based on my players they have exposure to
          for (const playerId of myPlayerIds) {
            const playerExposure = exposureProfile.exposure_json[playerId];
            if (playerExposure && playerExposure.pct >= 10) {
              const player = await cache.getPlayer(playerId);
              matchedAssets.push({
                player_id: playerId,
                name: player?.full_name || playerId,
                pos: player?.position || null,
                team: player?.team || null,
                exposure_pct: playerExposure.pct,
              });
              targetScore += playerExposure.pct;
            }
          }
        }

        // Sort matched assets by exposure percentage
        matchedAssets.sort((a, b) => b.exposure_pct - a.exposure_pct);

        targets.push({
          opponent_username: oppUsername,
          opponent_display_name: oppUser.display_name || oppCachedUser?.display_name || null,
          target_score: Math.round(targetScore * 100) / 100,
          matched_assets: matchedAssets.slice(0, 5),
          meta: {
            active_league_count: exposureProfile?.active_league_count || 0,
            last_synced_at: exposureProfile?.last_synced_at || null,
            is_partial: !exposureProfile || cache.isExposureStale(exposureProfile?.last_synced_at || null),
          },
        });
      }

      // Sort by target score descending
      targets.sort((a, b) => b.target_score - a.target_score);

      res.json({
        league_id,
        league_name: league.name,
        season: league.season,
        my_roster_id: myRoster.roster_id,
        targets,
      });
    } catch (e) {
      console.error("Targets error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // POST /api/exposure/sync - Sync exposure profile for a username
  app.post("/api/exposure/sync", async (req, res) => {
    try {
      const { username } = req.query;
      
      if (!username || typeof username !== "string") {
        return res.status(400).json({ message: "Username required" });
      }

      // Fetch user from Sleeper API
      const userResp = await sleeperQueue.add(() => 
        fetch(`https://api.sleeper.app/v1/user/${username}`)
      );
      if (!userResp.ok) {
        return res.status(404).json({ message: "User not found on Sleeper" });
      }
      const sleeperUser = await userResp.json();
      const userId = sleeperUser.user_id;

      // Get current NFL season (approximate)
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth();
      const season = currentMonth >= 2 ? currentYear : currentYear - 1;

      // Fetch their active leagues for current season
      const leaguesResp = await sleeperQueue.add(() =>
        fetch(`https://api.sleeper.app/v1/user/${userId}/leagues/nfl/${season}`)
      );
      if (!leaguesResp.ok) {
        return res.status(500).json({ message: "Failed to fetch leagues" });
      }
      const leagues = await leaguesResp.json() as any[];

      // Only count active leagues (status === "in_season" or "complete" for current season)
      const activeLeagues = leagues.filter((l: any) => l.status !== "archived");
      
      // Collect player exposure across all active leagues
      const playerCounts = new Map<string, { count: number; pos: string | null }>();

      for (const league of activeLeagues) {
        // Fetch rosters for this league
        const rostersResp = await sleeperQueue.add(() =>
          fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`)
        );
        if (!rostersResp.ok) continue;
        const rosters = await rostersResp.json() as any[];

        // Find this user's roster
        const myRoster = rosters.find((r: any) => r.owner_id === userId);
        if (!myRoster || !myRoster.players) continue;

        for (const playerId of myRoster.players) {
          const existing = playerCounts.get(playerId);
          if (existing) {
            existing.count++;
          } else {
            // Get player position from cache
            const player = await cache.getPlayer(playerId);
            playerCounts.set(playerId, { count: 1, pos: player?.position || null });
          }
        }
      }

      // Calculate exposure percentages
      const activeLeagueCount = activeLeagues.length;
      const exposureJson: Record<string, { count: number; pct: number; pos: string | null }> = {};
      
      for (const [playerId, data] of playerCounts.entries()) {
        exposureJson[playerId] = {
          count: data.count,
          pct: activeLeagueCount > 0 ? Math.round((data.count / activeLeagueCount) * 100) : 0,
          pos: data.pos,
        };
      }

      // Save to cache
      await cache.upsertExposureProfile({
        username: username.toLowerCase(),
        season,
        active_league_count: activeLeagueCount,
        exposure_json: exposureJson,
      });

      res.json({
        username: username.toLowerCase(),
        season,
        active_league_count: activeLeagueCount,
        players_tracked: Object.keys(exposureJson).length,
        synced_at: Date.now(),
      });
    } catch (e) {
      console.error("Exposure sync error:", e);
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

      // Get league season to determine baseline years
      const league = await cache.getLeagueById(leagueId);
      const currentSeason = league?.season ?? new Date().getFullYear();
      
      // Always generate baseline years: current season + 2 future years
      const baselineYears = [
        String(currentSeason),
        String(currentSeason + 1),
        String(currentSeason + 2),
      ];
      
      // Also include any years from traded picks data
      const yearsFromData = new Set<string>(baselineYears);
      if (tradedPicks && Array.isArray(tradedPicks)) {
        for (const pick of tradedPicks) {
          yearsFromData.add(pick.season);
        }
      }
      
      // Sort years (only future years from baseline onwards)
      const years = Array.from(yearsFromData)
        .filter(y => parseInt(y, 10) >= currentSeason)
        .sort();
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

      const debug = req.query.debug === "1" ? {
        baseline_years: baselineYears,
        years_shown: years,
        current_season: currentSeason,
        traded_picks_count: tradedPicks?.length || 0,
      } : undefined;

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
        baseline_years_used: true,
        ...(debug && { debug }),
      });
    } catch (e) {
      console.error("Draft capital error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/league/:leagueId/churn?username=<username>&timeframe=<season|last30|lifetime>&groupId=<groupId>
  // Returns roster churn stats (waiver moves, transactions) for a user
  // timeframe: "season" (default), "last30" (last 30 days), "lifetime" (all time - requires groupId)
  app.get("/api/league/:leagueId/churn", async (req, res) => {
    const { leagueId } = req.params;
    const username = req.query.username as string;
    const timeframe = (req.query.timeframe as string) || "season";
    const groupId = req.query.groupId as string | undefined;

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

      // Fetch transactions based on timeframe
      let leagueTxns: Awaited<ReturnType<typeof cache.getTradesForLeague>> = [];
      let leagueIdsQueried: string[] = [];
      
      if (timeframe === "lifetime" && groupId) {
        const leaguesInGroup = await cache.getLeagueIdsForGroup(groupId);
        for (const lg of leaguesInGroup) {
          if (lg?.league_id) {
            leagueIdsQueried.push(lg.league_id);
            const txns = await cache.getTradesForLeague(lg.league_id);
            leagueTxns.push(...txns);
          }
        }
        if (leagueIdsQueried.length === 0) {
          console.warn(`Churn lifetime: No league IDs found for group ${groupId}`);
          return res.status(400).json({ 
            message: "No league history found for this group",
            group_id: groupId,
          });
        }
      } else {
        leagueTxns = await cache.getTradesForLeague(leagueId);
        leagueIdsQueried = [leagueId];
      }
      
      // Apply timeframe filter
      if (timeframe === "last30") {
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        leagueTxns = leagueTxns.filter(t => t.created_at >= thirtyDaysAgo);
      }
      // "season" uses only current leagueId transactions (done above)
      // "lifetime" uses all league group transactions (done above)
      
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

      // Determine timeframe label for UI display
      const timeframeLabel = timeframe === "last30" ? "Last 30 Days" :
        timeframe === "lifetime" ? "All Time" : "This Season";

      const debug = req.query.debug === "1" ? {
        group_id: groupId || null,
        transactions_count: leagueTxns.length,
        leagues_queried: leagueIdsQueried,
        scope: timeframe === "lifetime" && groupId ? "group" : "single_league",
      } : undefined;

      res.json({
        league_id: leagueId,
        username,
        roster_id: userRosterId,
        timeframe,
        timeframe_label: timeframeLabel,
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
        ...(debug && { debug }),
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

      // Compute expected wins based on all-play win rate
      const expectedWins = allPlayWinRate * totalActualGames;
      const luckDiff = actualWins - expectedWins;
      
      res.json({
        league_id: leagueId,
        username,
        roster_id: userRosterId,
        weeks_played: weeksPlayed,
        teams: leagueSize,
        all_play: {
          wins: allPlayWins,
          losses: allPlayLosses,
          ties: allPlayTies,
          games: totalAllPlayGames,
          win_rate: Math.round(allPlayWinRate * 100),
        },
        actual: {
          wins: actualWins,
          losses: actualLosses,
          ties: actualTies,
          games: totalActualGames,
          win_rate: Math.round(actualWinRate * 100),
        },
        expected_wins: Math.round(expectedWins * 10) / 10,
        luck_diff: Math.round(luckDiff * 10) / 10,
        luck_index: luckIndex,
        luck_label: luckLabel,
      });
    } catch (e) {
      console.error("All-play error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // ============================================================================
  // PHASE 1 SCOUTING ENDPOINTS - All-rosters leaderboards
  // ============================================================================

  // GET /api/league/:leagueId/scouting/draft-capital
  // Returns draft capital for ALL rosters in the league with Pick Hoard Index
  app.get("/api/league/:leagueId/scouting/draft-capital", async (req, res) => {
    const { leagueId } = req.params;

    try {
      const rosters = await cache.getRostersForLeague(leagueId);
      if (!rosters || rosters.length === 0) {
        return res.status(404).json({ message: "League not found or has no rosters" });
      }

      // Get league users for display names
      const leagueUsers = await cache.getLeagueUsers(leagueId);
      const userMap = new Map(leagueUsers.map(u => [u.user_id, u]));

      // Fetch traded picks from Sleeper API
      const tradedPicks = await getTradedPicks(leagueId) as Array<{
        season: string;
        round: number;
        roster_id: number;
        previous_owner_id: number;
        owner_id: number;
      }> | null;

      // Extract unique years from traded picks data
      const yearsFromData = new Set<string>();
      if (tradedPicks && Array.isArray(tradedPicks)) {
        for (const pick of tradedPicks) {
          yearsFromData.add(pick.season);
        }
      }
      const years = Array.from(yearsFromData).sort();
      const rounds = [1, 2, 3, 4];

      // Calculate draft capital for each roster
      const rosterCapital: Array<{
        roster_id: number;
        owner_id: string | null;
        display_name: string;
        picks_by_year: Record<string, Record<number, number>>;
        totals: { r1: number; r2: number; r3: number; r4: number; total: number };
        pick_hoard_index: number;
        acquired_count: number;
        traded_away_count: number;
      }> = [];

      for (const roster of rosters) {
        const rosterId = roster.roster_id;
        const user = userMap.get(roster.owner_id || "");

        // Track picks for this roster
        const acquiredPicks: Array<{ year: string; round: number }> = [];
        const tradedAwayPicks: Array<{ year: string; round: number }> = [];

        if (tradedPicks && Array.isArray(tradedPicks)) {
          for (const pick of tradedPicks) {
            // Acquired: user is owner but not the original roster
            if (pick.owner_id === rosterId && pick.roster_id !== rosterId) {
              acquiredPicks.push({ year: pick.season, round: pick.round });
            }
            // Traded away: user was previous owner but no longer owns
            if (pick.previous_owner_id === rosterId && pick.owner_id !== rosterId) {
              tradedAwayPicks.push({ year: pick.season, round: pick.round });
            }
          }
        }

        // Calculate owned picks by year/round
        const ownedPicks: Record<string, Record<number, number>> = {};
        for (const year of years) {
          ownedPicks[year] = {};
          for (const round of rounds) {
            ownedPicks[year][round] = 1; // Start with own pick
          }
        }

        for (const pick of acquiredPicks) {
          if (ownedPicks[pick.year] && ownedPicks[pick.year][pick.round] !== undefined) {
            ownedPicks[pick.year][pick.round]++;
          }
        }
        for (const pick of tradedAwayPicks) {
          if (ownedPicks[pick.year] && ownedPicks[pick.year][pick.round] !== undefined) {
            ownedPicks[pick.year][pick.round]--;
          }
        }

        // Calculate totals
        let totalR1 = 0, totalR2 = 0, totalR3 = 0, totalR4 = 0;
        for (const year of years) {
          totalR1 += Math.max(0, ownedPicks[year][1] || 0);
          totalR2 += Math.max(0, ownedPicks[year][2] || 0);
          totalR3 += Math.max(0, ownedPicks[year][3] || 0);
          totalR4 += Math.max(0, ownedPicks[year][4] || 0);
        }
        const totalPicks = totalR1 + totalR2 + totalR3 + totalR4;
        const pickHoardIndex = totalR1 * 2 + totalR2;

        rosterCapital.push({
          roster_id: rosterId,
          owner_id: roster.owner_id,
          display_name: user?.display_name || `Team ${rosterId}`,
          picks_by_year: ownedPicks,
          totals: { r1: totalR1, r2: totalR2, r3: totalR3, r4: totalR4, total: totalPicks },
          pick_hoard_index: pickHoardIndex,
          acquired_count: acquiredPicks.length,
          traded_away_count: tradedAwayPicks.length,
        });
      }

      // Sort by pick hoard index descending
      rosterCapital.sort((a, b) => b.pick_hoard_index - a.pick_hoard_index);

      res.json({
        league_id: leagueId,
        years,
        rounds,
        rosters: rosterCapital,
        scope: "snapshot",
        scope_label: "Latest League Only",
      });
    } catch (e) {
      console.error("Scouting draft capital error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/league/:leagueId/scouting/strength
  // Returns All-Play + Luck Index for ALL rosters (Strength leaderboard)
  app.get("/api/league/:leagueId/scouting/strength", async (req, res) => {
    const { leagueId } = req.params;

    try {
      const rosters = await cache.getRostersForLeague(leagueId);
      if (!rosters || rosters.length === 0) {
        return res.status(404).json({ message: "League not found or has no rosters" });
      }

      const leagueUsers = await cache.getLeagueUsers(leagueId);
      const userMap = new Map(leagueUsers.map(u => [u.user_id, u]));
      const leagueSize = rosters.length;

      // Collect matchup data for all weeks
      const weeklyData: Map<number, Array<{ roster_id: number; points: number; matchup_id: number }>> = new Map();
      let weeksPlayed = 0;

      for (let week = 1; week <= 18; week++) {
        const matchups = await getMatchups(leagueId, week) as Array<{
          roster_id: number;
          points: number;
          matchup_id: number;
        }> | null;

        if (!matchups || matchups.length === 0) continue;
        
        // Check if any real scores exist
        const hasScores = matchups.some(m => m.points !== undefined && m.points > 0);
        if (!hasScores) continue;

        weeklyData.set(week, matchups);
        weeksPlayed++;
      }

      // Calculate strength metrics for each roster
      const rosterStrength: Array<{
        roster_id: number;
        owner_id: string | null;
        display_name: string;
        actual: { wins: number; losses: number; ties: number; games: number; win_rate: number };
        all_play: { wins: number; losses: number; ties: number; games: number; win_rate: number };
        points_for: number;
        points_against: number;
        expected_wins: number;
        luck_diff: number;
        luck_index: number;
        luck_label: string;
      }> = [];

      for (const roster of rosters) {
        const rosterId = roster.roster_id;
        const user = userMap.get(roster.owner_id || "");

        let allPlayWins = 0, allPlayLosses = 0, allPlayTies = 0;
        let actualWins = 0, actualLosses = 0, actualTies = 0;
        let pointsFor = 0, pointsAgainst = 0;

        for (const [_, matchups] of Array.from(weeklyData.entries())) {
          const userMatchup = matchups.find(m => m.roster_id === rosterId);
          if (!userMatchup || userMatchup.points === undefined) continue;

          const userScore = userMatchup.points;
          const userMatchupId = userMatchup.matchup_id;
          pointsFor += userScore;

          // Find actual opponent
          const actualOpponent = matchups.find(
            m => m.matchup_id === userMatchupId && m.roster_id !== rosterId
          );
          
          if (actualOpponent && actualOpponent.points !== undefined) {
            pointsAgainst += actualOpponent.points;
            if (userScore > actualOpponent.points) actualWins++;
            else if (userScore < actualOpponent.points) actualLosses++;
            else actualTies++;
          }

          // All-play vs everyone
          for (const opp of matchups) {
            if (opp.roster_id === rosterId) continue;
            if (opp.points === undefined) continue;

            if (userScore > opp.points) allPlayWins++;
            else if (userScore < opp.points) allPlayLosses++;
            else allPlayTies++;
          }
        }

        const totalAllPlayGames = allPlayWins + allPlayLosses + allPlayTies;
        const totalActualGames = actualWins + actualLosses + actualTies;
        
        const allPlayWinRate = totalAllPlayGames > 0 
          ? (allPlayWins + allPlayTies * 0.5) / totalAllPlayGames 
          : 0;
        const actualWinRate = totalActualGames > 0 
          ? (actualWins + actualTies * 0.5) / totalActualGames 
          : 0;
        
        const luckIndex = Math.round((actualWinRate - allPlayWinRate) * 100);
        const expectedWins = allPlayWinRate * totalActualGames;
        const luckDiff = actualWins - expectedWins;

        let luckLabel = "neutral";
        if (luckIndex > 10) luckLabel = "lucky";
        else if (luckIndex > 5) luckLabel = "slightly_lucky";
        else if (luckIndex < -10) luckLabel = "unlucky";
        else if (luckIndex < -5) luckLabel = "slightly_unlucky";

        rosterStrength.push({
          roster_id: rosterId,
          owner_id: roster.owner_id,
          display_name: user?.display_name || `Team ${rosterId}`,
          actual: {
            wins: actualWins,
            losses: actualLosses,
            ties: actualTies,
            games: totalActualGames,
            win_rate: Math.round(actualWinRate * 100),
          },
          all_play: {
            wins: allPlayWins,
            losses: allPlayLosses,
            ties: allPlayTies,
            games: totalAllPlayGames,
            win_rate: Math.round(allPlayWinRate * 100),
          },
          points_for: Math.round(pointsFor * 10) / 10,
          points_against: Math.round(pointsAgainst * 10) / 10,
          expected_wins: Math.round(expectedWins * 10) / 10,
          luck_diff: Math.round(luckDiff * 10) / 10,
          luck_index: luckIndex,
          luck_label: luckLabel,
        });
      }

      // Sort by all-play win rate descending (true strength)
      rosterStrength.sort((a, b) => b.all_play.win_rate - a.all_play.win_rate);

      res.json({
        league_id: leagueId,
        weeks_played: weeksPlayed,
        teams: leagueSize,
        rosters: rosterStrength,
        scope: "snapshot",
        scope_label: "Latest League Only",
      });
    } catch (e) {
      console.error("Scouting strength error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/league/:leagueId/scouting/consistency
  // Returns Consistency + Boom/Bust profile for ALL rosters
  app.get("/api/league/:leagueId/scouting/consistency", async (req, res) => {
    const { leagueId } = req.params;

    try {
      const rosters = await cache.getRostersForLeague(leagueId);
      if (!rosters || rosters.length === 0) {
        return res.status(404).json({ message: "League not found or has no rosters" });
      }

      const leagueUsers = await cache.getLeagueUsers(leagueId);
      const userMap = new Map(leagueUsers.map(u => [u.user_id, u]));

      // Collect weekly scores for all rosters
      const rosterScores: Map<number, number[]> = new Map();
      const weeklyMedians: number[] = [];
      let weeksPlayed = 0;

      for (const roster of rosters) {
        rosterScores.set(roster.roster_id, []);
      }

      for (let week = 1; week <= 18; week++) {
        const matchups = await getMatchups(leagueId, week) as Array<{
          roster_id: number;
          points: number;
        }> | null;

        if (!matchups || matchups.length === 0) continue;
        
        const weekScores: number[] = [];
        let hasScores = false;
        
        for (const m of matchups) {
          if (m.points !== undefined && m.points > 0) {
            hasScores = true;
            weekScores.push(m.points);
            const scores = rosterScores.get(m.roster_id);
            if (scores) scores.push(m.points);
          }
        }

        if (!hasScores) continue;
        weeksPlayed++;

        // Calculate median for this week
        weekScores.sort((a, b) => a - b);
        const mid = Math.floor(weekScores.length / 2);
        const median = weekScores.length % 2 === 0
          ? (weekScores[mid - 1] + weekScores[mid]) / 2
          : weekScores[mid];
        weeklyMedians.push(median);
      }

      // Calculate consistency metrics for each roster
      const rosterConsistency: Array<{
        roster_id: number;
        owner_id: string | null;
        display_name: string;
        weeks_played: number;
        avg_points: number;
        std_dev: number;
        best_week: number;
        worst_week: number;
        weeks_above_median: number;
        median_beat_pct: number;
        consistency_score: number;
      }> = [];

      for (const roster of rosters) {
        const scores = rosterScores.get(roster.roster_id) || [];
        const user = userMap.get(roster.owner_id || "");

        if (scores.length === 0) {
          rosterConsistency.push({
            roster_id: roster.roster_id,
            owner_id: roster.owner_id,
            display_name: user?.display_name || `Team ${roster.roster_id}`,
            weeks_played: 0,
            avg_points: 0,
            std_dev: 0,
            best_week: 0,
            worst_week: 0,
            weeks_above_median: 0,
            median_beat_pct: 0,
            consistency_score: 0,
          });
          continue;
        }

        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        const variance = scores.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / scores.length;
        const stdDev = Math.sqrt(variance);
        const bestWeek = Math.max(...scores);
        const worstWeek = Math.min(...scores);

        // Count weeks above median
        let weeksAboveMedian = 0;
        for (let i = 0; i < scores.length && i < weeklyMedians.length; i++) {
          if (scores[i] > weeklyMedians[i]) weeksAboveMedian++;
        }
        const medianBeatPct = scores.length > 0 ? Math.round((weeksAboveMedian / scores.length) * 100) : 0;

        // Consistency score: lower std dev relative to avg = more consistent
        // Score = 100 - (stdDev/avg * 100), capped at 0-100
        const consistencyScore = avg > 0 
          ? Math.max(0, Math.min(100, Math.round(100 - (stdDev / avg * 100))))
          : 0;

        rosterConsistency.push({
          roster_id: roster.roster_id,
          owner_id: roster.owner_id,
          display_name: user?.display_name || `Team ${roster.roster_id}`,
          weeks_played: scores.length,
          avg_points: Math.round(avg * 10) / 10,
          std_dev: Math.round(stdDev * 10) / 10,
          best_week: Math.round(bestWeek * 10) / 10,
          worst_week: Math.round(worstWeek * 10) / 10,
          weeks_above_median: weeksAboveMedian,
          median_beat_pct: medianBeatPct,
          consistency_score: consistencyScore,
        });
      }

      // Sort by consistency score descending
      rosterConsistency.sort((a, b) => b.consistency_score - a.consistency_score);

      res.json({
        league_id: leagueId,
        weeks_analyzed: weeksPlayed,
        teams: rosters.length,
        rosters: rosterConsistency,
        scope: "snapshot",
        scope_label: "Latest League Only",
      });
    } catch (e) {
      console.error("Scouting consistency error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/league/:leagueId/scouting/churn?timeframe=<season|last30|lifetime>
  // Returns Churn Rate for ALL rosters with explicit timeframe
  app.get("/api/league/:leagueId/scouting/churn", async (req, res) => {
    const { leagueId } = req.params;
    const timeframe = (req.query.timeframe as string) || "season";

    try {
      const rosters = await cache.getRostersForLeague(leagueId);
      if (!rosters || rosters.length === 0) {
        return res.status(404).json({ message: "League not found or has no rosters" });
      }

      const leagueUsers = await cache.getLeagueUsers(leagueId);
      const userMap = new Map(leagueUsers.map(u => [u.user_id, u]));

      // Get all transactions for this league
      let leagueTxns = await cache.getTradesForLeague(leagueId);

      // Apply timeframe filter
      if (timeframe === "last30") {
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        leagueTxns = leagueTxns.filter(t => t.created_at >= thirtyDaysAgo);
      }

      // Calculate churn for each roster
      const rosterChurn: Array<{
        roster_id: number;
        owner_id: string | null;
        display_name: string;
        adds: number;
        drops: number;
        total_moves: number;
        moves_per_week: number;
        activity_level: string;
      }> = [];

      const estimatedWeeks = timeframe === "last30" ? 4 : 18;

      for (const roster of rosters) {
        const rosterId = roster.roster_id;
        const user = userMap.get(roster.owner_id || "");

        let addsCount = 0;
        let dropsCount = 0;

        for (const txn of leagueTxns) {
          let rosterIds: number[] = [];
          try { rosterIds = txn.roster_ids ? JSON.parse(txn.roster_ids) : []; } catch {}
          if (!rosterIds.includes(rosterId)) continue;

          if (txn.status === "complete") {
            try {
              const adds = JSON.parse(txn.adds || "{}") as Record<string, number>;
              for (const [_, rid] of Object.entries(adds)) {
                if (rid === rosterId) addsCount++;
              }
            } catch {}

            try {
              const drops = JSON.parse(txn.drops || "{}") as Record<string, number>;
              for (const [_, rid] of Object.entries(drops)) {
                if (rid === rosterId) dropsCount++;
              }
            } catch {}
          }
        }

        const totalMoves = addsCount + dropsCount;
        const movesPerWeek = Math.round((totalMoves / estimatedWeeks) * 10) / 10;

        rosterChurn.push({
          roster_id: rosterId,
          owner_id: roster.owner_id,
          display_name: user?.display_name || `Team ${rosterId}`,
          adds: addsCount,
          drops: dropsCount,
          total_moves: totalMoves,
          moves_per_week: movesPerWeek,
          activity_level: "", // Will set after sorting
        });
      }

      // Sort by total moves descending
      rosterChurn.sort((a, b) => b.total_moves - a.total_moves);

      // Calculate league average for activity labels
      const avgMoves = rosterChurn.reduce((s, r) => s + r.total_moves, 0) / rosterChurn.length;

      // Assign activity levels and ranks
      for (let i = 0; i < rosterChurn.length; i++) {
        const r = rosterChurn[i];
        r.activity_level = r.total_moves > avgMoves * 1.5 ? "very_active" :
          r.total_moves > avgMoves ? "active" :
          r.total_moves > avgMoves * 0.5 ? "moderate" : "inactive";
      }

      const timeframeLabel = timeframe === "last30" ? "Last 30 Days" :
        timeframe === "lifetime" ? "All Time" : "This Season";

      res.json({
        league_id: leagueId,
        timeframe,
        timeframe_label: timeframeLabel,
        teams: rosters.length,
        league_avg_moves: Math.round(avgMoves * 10) / 10,
        rosters: rosterChurn,
        scope: "snapshot",
        scope_label: "Latest League Only",
      });
    } catch (e) {
      console.error("Scouting churn error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/league/:leagueId/scouting/trading
  // Returns Trade Propensity + Timing for ALL rosters
  app.get("/api/league/:leagueId/scouting/trading", async (req, res) => {
    const { leagueId } = req.params;

    try {
      const rosters = await cache.getRostersForLeague(leagueId);
      if (!rosters || rosters.length === 0) {
        return res.status(404).json({ message: "League not found or has no rosters" });
      }

      const leagueUsers = await cache.getLeagueUsers(leagueId);
      const userMap = new Map(leagueUsers.map(u => [u.user_id, u]));

      // Get all trades for this league
      const allTxns = await cache.getTradesForLeague(leagueId);
      // Filter to only trades (multiple roster_ids involved)
      const trades = allTxns.filter(t => {
        try {
          const rosterIds = t.roster_ids ? JSON.parse(t.roster_ids) : [];
          return rosterIds.length > 1;
        } catch { return false; }
      });

      // Calculate trading metrics for each roster
      const rosterTrading: Array<{
        roster_id: number;
        owner_id: string | null;
        display_name: string;
        trades_count: number;
        draft_window_trades: number;
        in_season_trades: number;
        offseason_trades: number;
        draft_window_pct: number;
        trade_aggression_index: number;
        trading_style: string;
      }> = [];

      for (const roster of rosters) {
        const rosterId = roster.roster_id;
        const user = userMap.get(roster.owner_id || "");

        let tradesCount = 0;
        let draftWindowTrades = 0;
        let inSeasonTrades = 0;
        let offseasonTrades = 0;

        for (const txn of trades) {
          let rosterIds: number[] = [];
          try { rosterIds = txn.roster_ids ? JSON.parse(txn.roster_ids) : []; } catch {}
          if (!rosterIds.includes(rosterId)) continue;

          tradesCount++;

          // Classify by timing based on created_at timestamp
          const ts = txn.created_at || 0;
          const date = new Date(ts);
          const month = date.getMonth(); // 0-11

          // Draft window: Aug-Sep (7-8), In-season: Sep-Dec (8-11), Offseason: Jan-Jul (0-6)
          if (month >= 7 && month <= 8) {
            draftWindowTrades++;
          } else if (month >= 9 && month <= 11) {
            inSeasonTrades++;
          } else {
            offseasonTrades++;
          }
        }

        const draftWindowPct = tradesCount > 0 
          ? Math.round((draftWindowTrades / tradesCount) * 100) 
          : 0;

        rosterTrading.push({
          roster_id: rosterId,
          owner_id: roster.owner_id,
          display_name: user?.display_name || `Team ${rosterId}`,
          trades_count: tradesCount,
          draft_window_trades: draftWindowTrades,
          in_season_trades: inSeasonTrades,
          offseason_trades: offseasonTrades,
          draft_window_pct: draftWindowPct,
          trade_aggression_index: 0, // Will calculate after
          trading_style: "", // Will set after
        });
      }

      // Calculate league median for Trade Aggression Index
      const tradeCounts = rosterTrading.map(r => r.trades_count).sort((a, b) => a - b);
      const mid = Math.floor(tradeCounts.length / 2);
      const leagueMedian = tradeCounts.length % 2 === 0
        ? (tradeCounts[mid - 1] + tradeCounts[mid]) / 2
        : tradeCounts[mid];

      // Calculate Trade Aggression Index and trading style
      for (const r of rosterTrading) {
        r.trade_aggression_index = leagueMedian > 0 
          ? Math.round((r.trades_count / leagueMedian) * 100) 
          : r.trades_count > 0 ? 100 : 0;

        // Trading style based on timing
        if (r.trades_count === 0) {
          r.trading_style = "inactive";
        } else if (r.draft_window_pct >= 60) {
          r.trading_style = "draft_focused";
        } else if (r.in_season_trades > r.draft_window_trades && r.in_season_trades > r.offseason_trades) {
          r.trading_style = "in_season_trader";
        } else if (r.offseason_trades > r.draft_window_trades && r.offseason_trades > r.in_season_trades) {
          r.trading_style = "offseason_builder";
        } else {
          r.trading_style = "balanced";
        }
      }

      // Sort by trades count descending
      rosterTrading.sort((a, b) => b.trades_count - a.trades_count);

      res.json({
        league_id: leagueId,
        total_trades: trades.length,
        league_median_trades: leagueMedian,
        teams: rosters.length,
        rosters: rosterTrading,
        scope: "snapshot",
        scope_label: "Latest League Only",
      });
    } catch (e) {
      console.error("Scouting trading error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // ============================================================================
  // PHASE 2 ENDPOINTS - Teams, Draft Capital, Trade Assets, Market
  // ============================================================================

  // DST mapping for team abbreviations to display names
  const DST_TEAMS: Record<string, string> = {
    "ARI": "Cardinals", "ATL": "Falcons", "BAL": "Ravens", "BUF": "Bills",
    "CAR": "Panthers", "CHI": "Bears", "CIN": "Bengals", "CLE": "Browns",
    "DAL": "Cowboys", "DEN": "Broncos", "DET": "Lions", "GB": "Packers",
    "HOU": "Texans", "IND": "Colts", "JAX": "Jaguars", "KC": "Chiefs",
    "LAC": "Chargers", "LAR": "Rams", "LV": "Raiders", "MIA": "Dolphins",
    "MIN": "Vikings", "NE": "Patriots", "NO": "Saints", "NYG": "Giants",
    "NYJ": "Jets", "PHI": "Eagles", "PIT": "Steelers", "SEA": "Seahawks",
    "SF": "49ers", "TB": "Buccaneers", "TEN": "Titans", "WAS": "Commanders",
  };

  // GET /api/league/:leagueId/teams - Returns all teams with rosters and draft capital
  app.get("/api/league/:leagueId/teams", async (req, res) => {
    const { leagueId } = req.params;

    try {
      // Get rosters, users, and roster players for this league
      const rosters = await cache.getRostersForLeague(leagueId);
      if (!rosters || rosters.length === 0) {
        return res.status(404).json({ message: "League not found or has no rosters" });
      }

      const leagueUsers = await cache.getLeagueUsers(leagueId);
      const userMap = new Map(leagueUsers.map(u => [u.user_id, u]));

      // Use the method that joins with rosters table to get roster_id
      const rosterPlayers = await cache.getAllRosterPlayersWithRosterId(leagueId);
      
      // Gather all unique player IDs
      const allPlayerIds = Array.from(new Set(rosterPlayers.map(rp => rp.player_id)));
      const players = await cache.getPlayersByIds(allPlayerIds);
      const playerMap = new Map(players.map(p => [p.player_id, p]));

      // Build teams data
      const teams = rosters.map(roster => {
        const user = userMap.get(roster.owner_id || "");
        // Filter by roster_id instead of owner_id to handle multi-roster owners correctly
        const rosterPlayerIds = rosterPlayers
          .filter(rp => rp.roster_id === roster.roster_id)
          .map(rp => rp.player_id);

        // Resolve player details
        const playersResolved = rosterPlayerIds.map(pid => {
          const player = playerMap.get(pid);
          
          // Handle DST identifiers - ONLY use the known DST_TEAMS lookup, no regex heuristics
          if (!player && DST_TEAMS[pid]) {
            return {
              player_id: pid,
              full_name: `${pid} DST`,
              position: "DEF",
              team: pid,
            };
          }
          
          // If no player found and not a known DST, mark as unknown
          if (!player) {
            return {
              player_id: pid,
              full_name: `Unknown (${pid})`,
              position: null,
              team: null,
            };
          }
          
          return {
            player_id: pid,
            full_name: player.full_name || `${player.first_name || ""} ${player.last_name || ""}`.trim() || pid,
            position: player.position,
            team: player.team,
          };
        });

        // Sort by position order
        const posOrder: Record<string, number> = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, DEF: 6 };
        playersResolved.sort((a, b) => {
          const aOrder = posOrder[a.position || ""] || 99;
          const bOrder = posOrder[b.position || ""] || 99;
          return aOrder - bOrder;
        });

        return {
          roster_id: roster.roster_id,
          owner_id: roster.owner_id,
          display_name: user?.display_name || user?.team_name || `Team ${roster.roster_id}`,
          team_name: user?.team_name || null,
          record: {
            wins: roster.wins,
            losses: roster.losses,
            ties: roster.ties,
          },
          points_for: roster.fpts,
          points_against: roster.fpts_against,
          players: playersResolved,
          player_count: playersResolved.length,
        };
      });

      // Sort by wins descending, then points_for
      teams.sort((a, b) => {
        if (b.record.wins !== a.record.wins) return b.record.wins - a.record.wins;
        return (b.points_for || 0) - (a.points_for || 0);
      });

      res.json({
        league_id: leagueId,
        teams_count: teams.length,
        teams,
      });
    } catch (e) {
      console.error("Teams endpoint error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/league/:leagueId/draft-capital/all - Returns draft capital for ALL teams
  app.get("/api/league/:leagueId/draft-capital/all", async (req, res) => {
    const { leagueId } = req.params;

    try {
      const rosters = await cache.getRostersForLeague(leagueId);
      if (!rosters || rosters.length === 0) {
        return res.status(404).json({ message: "League not found or has no rosters" });
      }

      const leagueUsers = await cache.getLeagueUsers(leagueId);
      const userMap = new Map(leagueUsers.map(u => [u.user_id, u]));

      // Get cached league to check season
      const league = await cache.getLeagueById(leagueId);
      const currentSeason = league?.season || new Date().getFullYear();

      // Fetch traded_picks from Sleeper API (or use cached trades)
      let tradedPicks: any[] = [];
      try {
        const resp = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`);
        if (resp.ok) {
          tradedPicks = await resp.json();
        }
      } catch (e) {
        console.error("Error fetching traded_picks:", e);
      }

      // Initialize default ownership: each roster owns their own picks
      // For years: current_season through current_season + 3 (4 years)
      // For rounds: 1-4 (most common)
      const years = [currentSeason, currentSeason + 1, currentSeason + 2, currentSeason + 3];
      const rounds = [1, 2, 3, 4];

      // Build ownership map: key = {year}:{round}:{original_owner_id} => current_owner_roster_id
      const ownershipMap = new Map<string, number>();

      // Default: each roster owns their own picks
      for (const roster of rosters) {
        for (const year of years) {
          for (const round of rounds) {
            const key = `${year}:${round}:${roster.roster_id}`;
            ownershipMap.set(key, roster.roster_id);
          }
        }
      }

      // Apply traded picks to update ownership
      for (const pick of tradedPicks) {
        const key = `${pick.season}:${pick.round}:${pick.roster_id}`;
        ownershipMap.set(key, pick.owner_id);
      }

      // Aggregate per roster: count picks by year and round
      const rosterCapital = rosters.map(roster => {
        const user = userMap.get(roster.owner_id || "");
        
        const byYear: Record<number, { r1: number; r2: number; r3: number; r4: number; total: number }> = {};
        let totalR1 = 0, totalR2 = 0, totalR3 = 0, totalR4 = 0, grandTotal = 0;

        for (const year of years) {
          byYear[year] = { r1: 0, r2: 0, r3: 0, r4: 0, total: 0 };
          
          for (const round of rounds) {
            // Count how many picks of this year/round this roster owns
            let count = 0;
            for (const origRoster of rosters) {
              const key = `${year}:${round}:${origRoster.roster_id}`;
              if (ownershipMap.get(key) === roster.roster_id) {
                count++;
              }
            }
            
            if (round === 1) { byYear[year].r1 = count; totalR1 += count; }
            else if (round === 2) { byYear[year].r2 = count; totalR2 += count; }
            else if (round === 3) { byYear[year].r3 = count; totalR3 += count; }
            else if (round === 4) { byYear[year].r4 = count; totalR4 += count; }
            
            byYear[year].total += count;
            grandTotal += count;
          }
        }

        // Pick Hoard Index = R1 + R2 (simplified from (R1*2 + R2))
        const pickHoardIndex = totalR1 + totalR2;

        return {
          roster_id: roster.roster_id,
          owner_id: roster.owner_id,
          display_name: user?.display_name || user?.team_name || `Team ${roster.roster_id}`,
          by_year: byYear,
          totals: { r1: totalR1, r2: totalR2, r3: totalR3, r4: totalR4, total: grandTotal },
          pick_hoard_index: pickHoardIndex,
        };
      });

      // Sort by pick_hoard_index descending
      rosterCapital.sort((a, b) => b.pick_hoard_index - a.pick_hoard_index);

      res.json({
        league_id: leagueId,
        current_season: currentSeason,
        years,
        teams_count: rosters.length,
        rosters: rosterCapital,
      });
    } catch (e) {
      console.error("Draft capital all error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // Helper function to normalize trades into trade_assets table
  async function normalizeTradesForLeague(leagueId: string): Promise<number> {
    const trades = await cache.getTradesForLeague(leagueId);
    if (!trades || trades.length === 0) return 0;

    const league = await cache.getLeagueById(leagueId);
    const season = league?.season || new Date().getFullYear();

    // Get player names for display
    const allPlayerIds = new Set<string>();
    for (const trade of trades) {
      if (trade.adds) {
        const adds = JSON.parse(trade.adds) as Record<string, string>;
        for (const playerId of Object.keys(adds)) {
          allPlayerIds.add(playerId);
        }
      }
      if (trade.drops) {
        const drops = JSON.parse(trade.drops) as Record<string, string>;
        for (const playerId of Object.keys(drops)) {
          allPlayerIds.add(playerId);
        }
      }
    }

    const players = await cache.getPlayersByIds(Array.from(allPlayerIds));
    const playerMap = new Map(players.map(p => [p.player_id, p.full_name || p.player_id]));

    // Clear existing assets for this league before re-normalizing
    await cache.clearTradeAssetsForLeague(leagueId);

    const assets: Array<{
      trade_id: string;
      league_id: string;
      season: number;
      created_at_ms: number;
      roster_id: number;
      counterparty_roster_ids: string | null;
      asset_type: string;
      asset_key: string;
      asset_name: string | null;
      direction: string;
    }> = [];

    for (const trade of trades) {
      const rosterIds = trade.roster_ids ? JSON.parse(trade.roster_ids) as number[] : [];
      const adds = trade.adds ? JSON.parse(trade.adds) as Record<string, string> : {};
      const drops = trade.drops ? JSON.parse(trade.drops) as Record<string, string> : {};
      const draftPicks = trade.draft_picks ? JSON.parse(trade.draft_picks) as Array<{
        season: string | number;
        round: number;
        roster_id: number;
        previous_owner_id: number;
        owner_id: number;
      }> : [];

      // Process adds: player_id -> roster_id that received them
      for (const [playerId, rosterId] of Object.entries(adds)) {
        const receiverRosterId = parseInt(rosterId, 10);
        const counterparties = rosterIds.filter(r => r !== receiverRosterId);
        
        assets.push({
          trade_id: trade.transaction_id,
          league_id: leagueId,
          season,
          created_at_ms: trade.created_at,
          roster_id: receiverRosterId,
          counterparty_roster_ids: counterparties.length > 0 ? JSON.stringify(counterparties) : null,
          asset_type: 'player',
          asset_key: playerId,
          asset_name: playerMap.get(playerId) || null,
          direction: 'received',
        });

        // Also record as sent by counterparties
        for (const senderId of counterparties) {
          assets.push({
            trade_id: trade.transaction_id,
            league_id: leagueId,
            season,
            created_at_ms: trade.created_at,
            roster_id: senderId,
            counterparty_roster_ids: JSON.stringify([receiverRosterId]),
            asset_type: 'player',
            asset_key: playerId,
            asset_name: playerMap.get(playerId) || null,
            direction: 'sent',
          });
        }
      }

      // Process draft picks
      for (const pick of draftPicks) {
        const pickYear = typeof pick.season === 'string' ? parseInt(pick.season, 10) : pick.season;
        const pickKey = `${pickYear}:${pick.round}:${pick.roster_id}`;
        const pickName = `${pickYear} Round ${pick.round} (${pick.roster_id})`;

        // Record as received by new owner
        assets.push({
          trade_id: trade.transaction_id,
          league_id: leagueId,
          season,
          created_at_ms: trade.created_at,
          roster_id: pick.owner_id,
          counterparty_roster_ids: JSON.stringify([pick.previous_owner_id]),
          asset_type: 'pick',
          asset_key: pickKey,
          asset_name: pickName,
          direction: 'received',
        });

        // Record as sent by previous owner
        assets.push({
          trade_id: trade.transaction_id,
          league_id: leagueId,
          season,
          created_at_ms: trade.created_at,
          roster_id: pick.previous_owner_id,
          counterparty_roster_ids: JSON.stringify([pick.owner_id]),
          asset_type: 'pick',
          asset_key: pickKey,
          asset_name: pickName,
          direction: 'sent',
        });
      }
    }

    // Upsert all assets
    await cache.upsertTradeAssets(assets);
    return assets.length;
  }

  // POST /api/league/:leagueId/normalize-trades - Normalize trades for a league
  app.post("/api/league/:leagueId/normalize-trades", async (req, res) => {
    const { leagueId } = req.params;

    try {
      const count = await normalizeTradesForLeague(leagueId);
      res.json({ success: true, assets_created: count });
    } catch (e) {
      console.error("Normalize trades error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/league/:leagueId/trade-assets - Get normalized trade assets for a league
  app.get("/api/league/:leagueId/trade-assets", async (req, res) => {
    const { leagueId } = req.params;
    const rosterId = req.query.roster_id ? parseInt(req.query.roster_id as string, 10) : undefined;

    try {
      let assets;
      if (rosterId !== undefined) {
        assets = await cache.getTradeAssetsForRoster(leagueId, rosterId);
      } else {
        assets = await cache.getTradeAssetsForLeague(leagueId);
      }

      // Group by trade_id for display
      const byTrade = new Map<string, {
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
      }>();

      for (const asset of assets) {
        if (!byTrade.has(asset.trade_id)) {
          byTrade.set(asset.trade_id, {
            trade_id: asset.trade_id,
            created_at_ms: asset.created_at_ms,
            season: asset.season,
            participants: [],
            assets: [],
          });
        }
        const group = byTrade.get(asset.trade_id)!;
        if (!group.participants.includes(asset.roster_id)) {
          group.participants.push(asset.roster_id);
        }
        group.assets.push({
          roster_id: asset.roster_id,
          direction: asset.direction,
          asset_type: asset.asset_type,
          asset_key: asset.asset_key,
          asset_name: asset.asset_name,
        });
      }

      const grouped = Array.from(byTrade.values()).sort((a, b) => b.created_at_ms - a.created_at_ms);

      res.json({
        league_id: leagueId,
        total_assets: assets.length,
        trades_count: grouped.length,
        trades: grouped,
      });
    } catch (e) {
      console.error("Trade assets error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/trade-assets/stats - Get global trade asset statistics
  app.get("/api/trade-assets/stats", async (req, res) => {
    try {
      const counts = await cache.getTradeAssetCounts();
      res.json(counts);
    } catch (e) {
      console.error("Trade assets stats error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/group/:groupId/trade-assets - Get normalized trade assets for all leagues in a group
  // Query params:
  //   season: number (optional - filter by specific season)
  app.get("/api/group/:groupId/trade-assets", async (req, res) => {
    const { groupId } = req.params;
    const seasonParam = req.query.season ? parseInt(req.query.season as string, 10) : undefined;

    try {
      const leaguesInGroup = await cache.getLeagueIdsForGroup(groupId);
      if (leaguesInGroup.length === 0) {
        return res.json({
          group_id: groupId,
          seasons: [],
          total_assets: 0,
          trades_count: 0,
          trades: [],
          debug: { leagues_count: 0, season_filter: seasonParam || null },
        });
      }

      const latestSeason = Math.max(...leaguesInGroup.map(l => l.season));
      const leagueIds = leaguesInGroup.map(l => l.league_id);
      const availableSeasons = Array.from(new Set(leaguesInGroup.map(l => l.season))).sort((a, b) => b - a);

      const assets = await cache.getTradeAssetsForLeagues(leagueIds, { season: seasonParam });

      const byTrade = new Map<string, {
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
      }>();

      for (const asset of assets) {
        if (!byTrade.has(asset.trade_id)) {
          byTrade.set(asset.trade_id, {
            trade_id: asset.trade_id,
            created_at_ms: asset.created_at_ms,
            season: asset.season,
            league_id: asset.league_id,
            participants: [],
            assets: [],
          });
        }
        const group = byTrade.get(asset.trade_id)!;
        if (!group.participants.includes(asset.roster_id)) {
          group.participants.push(asset.roster_id);
        }
        group.assets.push({
          roster_id: asset.roster_id,
          direction: asset.direction,
          asset_type: asset.asset_type,
          asset_key: asset.asset_key,
          asset_name: asset.asset_name,
        });
      }

      const grouped = Array.from(byTrade.values()).sort((a, b) => b.created_at_ms - a.created_at_ms);

      res.json({
        group_id: groupId,
        seasons: availableSeasons,
        latest_season: latestSeason,
        total_assets: assets.length,
        trades_count: grouped.length,
        trades: grouped,
        debug: {
          leagues_count: leagueIds.length,
          season_filter: seasonParam || null,
          default_season: latestSeason,
        },
      });
    } catch (e) {
      console.error("Group trade assets error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/compare/shared-leagues - Get shared leagues between two users
  app.get("/api/compare/shared-leagues", async (req, res) => {
    const { userA, userB } = req.query;
    if (!userA || !userB) {
      return res.status(400).json({ message: "Both userA and userB are required" });
    }

    try {
      // Get user IDs
      const cachedUserA = await cache.getUserByUsername(userA as string);
      const cachedUserB = await cache.getUserByUsername(userB as string);
      
      if (!cachedUserA || !cachedUserB) {
        return res.status(404).json({ message: "One or both users not found. Sync their data first." });
      }

      // Get leagues for each user
      const leaguesA = await cache.getLeaguesForUser(cachedUserA.user_id);
      const leaguesB = await cache.getLeaguesForUser(cachedUserB.user_id);
      
      // Find shared leagues (same league_id)
      const leagueIdSetA = new Set(leaguesA.map(l => l.league_id));
      const sharedLeagues = leaguesB.filter(l => leagueIdSetA.has(l.league_id));
      
      // Get roster data for each shared league
      const sharedLeagueDetails = await Promise.all(
        sharedLeagues.map(async (league) => {
          const rosters = await cache.getRostersForLeague(league.league_id);
          const leagueUsers = await cache.getLeagueUsers(league.league_id);
          
          const rosterA = rosters.find(r => r.owner_id === cachedUserA.user_id);
          const rosterB = rosters.find(r => r.owner_id === cachedUserB.user_id);
          
          // Get players for each roster
          const playersA = rosterA ? await cache.getRosterPlayersForUserInLeague(league.league_id, rosterA.owner_id) : [];
          const playersB = rosterB ? await cache.getRosterPlayersForUserInLeague(league.league_id, rosterB.owner_id) : [];
          
          // Get player details
          const playerIdsA = playersA.map((p: { player_id: string }) => p.player_id);
          const playerIdsB = playersB.map((p: { player_id: string }) => p.player_id);
          const allPlayerIds = Array.from(new Set([...playerIdsA, ...playerIdsB]));
          const playerDetails = await cache.getPlayersByIds(allPlayerIds);
          const playerMap = new Map(playerDetails.map(p => [p.player_id, p]));
          
          const formatPlayer = (pid: string) => {
            const player = playerMap.get(pid);
            if (DST_TEAMS[pid]) {
              return { player_id: pid, name: `${pid} DST`, position: "DEF" };
            }
            return {
              player_id: pid,
              name: player?.full_name || pid,
              position: player?.position || null,
            };
          };
          
          return {
            league_id: league.league_id,
            name: league.name,
            season: league.season,
            userA_roster_id: rosterA?.roster_id || null,
            userB_roster_id: rosterB?.roster_id || null,
            userA_players: playersA.map((p: { player_id: string }) => formatPlayer(p.player_id)),
            userB_players: playersB.map((p: { player_id: string }) => formatPlayer(p.player_id)),
          };
        })
      );
      
      res.json({
        userA: { user_id: cachedUserA.user_id, username: cachedUserA.username, display_name: cachedUserA.display_name },
        userB: { user_id: cachedUserB.user_id, username: cachedUserB.username, display_name: cachedUserB.display_name },
        shared_leagues: sharedLeagueDetails.sort((a, b) => b.season - a.season),
      });
    } catch (e) {
      console.error("Shared leagues error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // POST /api/market/sync - Normalize trades for all of a user's leagues
  app.post("/api/market/sync", async (req, res) => {
    try {
      const username = req.query.username as string;
      if (!username) {
        return res.status(400).json({ message: "username required" });
      }

      const user = await cache.getUserByUsername(username);
      if (!user) {
        return res.status(404).json({ message: "User not found. Please sync your profile first." });
      }

      const leagues = await cache.getLeaguesForUser(user.user_id);
      let totalAssets = 0;
      let leaguesProcessed = 0;

      for (const league of leagues) {
        try {
          const count = await normalizeTradesForLeague(league.league_id);
          totalAssets += count;
          leaguesProcessed++;
        } catch (e) {
          console.error(`Failed to normalize trades for league ${league.league_id}:`, e);
        }
      }

      res.json({
        success: true,
        leagues_processed: leaguesProcessed,
        total_assets: totalAssets,
      });
    } catch (e) {
      console.error("Market sync error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  // GET /api/market/trends - Get market trends across all leagues
  // Query params:
  //   timeframe: '7d' | '30d' | 'season' | 'all' (default: '30d')
  //   scope: 'active' | 'all' (default: 'active')
  //   username: string (required for active scope filtering)
  app.get("/api/market/trends", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const timeframe = (req.query.timeframe as string) || '30d';
      const scope = (req.query.scope as string) || 'active';
      const username = req.query.username as string;
      
      const now = Date.now();
      let minTimestamp: number | undefined;
      let season: number | undefined;
      let leagueIds: string[] | undefined;
      
      const currentSeason = getCurrentNFLSeason();
      
      switch (timeframe) {
        case '7d':
          minTimestamp = now - (7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          minTimestamp = now - (30 * 24 * 60 * 60 * 1000);
          break;
        case 'season':
          season = currentSeason;
          break;
        case 'all':
        default:
          break;
      }
      
      if (scope === 'active' && username) {
        const user = await cache.getUserByUsername(username);
        if (user) {
          leagueIds = await cache.getActiveLeagueIds(user.user_id);
        }
      }
      
      const filterOpts = { minTimestamp, leagueIds, season };
      
      const [counts, mostTradedPlayers, mostTradedPicks, bySeason] = await Promise.all([
        cache.getTradeAssetCountsFiltered(filterOpts),
        cache.getMostTradedPlayersFiltered(limit, filterOpts),
        cache.getMostTradedPicksFiltered(limit, filterOpts),
        cache.getTradesFilteredBySeason({ minTimestamp, leagueIds }),
      ]);
      
      const dateFrom = minTimestamp ? new Date(minTimestamp).toISOString().split('T')[0] : null;
      const dateTo = new Date(now).toISOString().split('T')[0];

      res.json({
        totals: counts,
        most_traded_players: mostTradedPlayers,
        most_traded_picks: mostTradedPicks,
        by_season: bySeason,
        debug: {
          timeframe,
          scope,
          date_from: dateFrom,
          date_to: dateTo,
          leagues_count: leagueIds?.length || 'all',
          season_filter: season || null,
        },
      });
    } catch (e) {
      console.error("Market trends error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  return httpServer;
}
