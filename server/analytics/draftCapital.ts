import { cache } from "../cache";
import * as schema from "@shared/schema";
import { db } from "../db";
import { eq, and } from "drizzle-orm";

const BASE = "https://api.sleeper.app/v1";

interface TradedPick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

interface RosterDraftCapital {
  roster_id: number;
  owner_id: string | null;
  display_name: string;
  picks_by_year: Record<string, Record<number, number>>;
  totals: { r1: number; r2: number; r3: number; r4: number; total: number };
  draft_cap_score: number;
  future_1sts: number;
  acquired_count: number;
  traded_away_count: number;
}

interface DraftCapitalResult {
  league_id: string;
  season: number;
  years: string[];
  rounds: number[];
  rosters: RosterDraftCapital[];
  debug?: {
    baseline_years: string[];
    baseline_rounds: number;
    baseline_picks_created: number;
    traded_picks_applied: number;
  };
}

async function fetchTradedPicks(leagueId: string): Promise<TradedPick[] | null> {
  try {
    const res = await fetch(`${BASE}/league/${leagueId}/traded_picks`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function computeDraftCapital(
  leagueId: string,
  includeDebug = false
): Promise<DraftCapitalResult | null> {
  const rosters = await cache.getRostersForLeague(leagueId);
  if (!rosters || rosters.length === 0) return null;

  const league = await cache.getLeagueById(leagueId);
  const currentSeason = league?.season ?? new Date().getFullYear();
  const totalRosters = rosters.length;

  const leagueUsers = await cache.getLeagueUsers(leagueId);
  const userMap = new Map(leagueUsers.map((u) => [u.user_id, u]));

  const tradedPicks = await fetchTradedPicks(leagueId);

  const baselineRounds = 4;
  const rounds = Array.from({ length: baselineRounds }, (_, i) => i + 1);

  const baselineYears = [
    String(currentSeason),
    String(currentSeason + 1),
    String(currentSeason + 2),
  ];
  const yearsSet = new Set<string>(baselineYears);
  if (tradedPicks && Array.isArray(tradedPicks)) {
    for (const pick of tradedPicks) {
      if (parseInt(pick.season, 10) >= currentSeason) {
        yearsSet.add(pick.season);
      }
    }
  }
  const years = Array.from(yearsSet).sort();

  // ownership[rosterId][year][round] = count of that pick type owned
  const ownership: Map<number, Map<string, Map<number, number>>> = new Map();

  // Initialize ownership: each roster starts with 0 of every pick
  for (const roster of rosters) {
    const yearMap = new Map<string, Map<number, number>>();
    for (const year of years) {
      const roundMap = new Map<number, number>();
      for (const round of rounds) {
        roundMap.set(round, 0);
      }
      yearMap.set(year, roundMap);
    }
    ownership.set(roster.roster_id, yearMap);
  }

  // Each pick is uniquely identified by (original_roster_id, season, round)
  // We need to find the CURRENT owner of each unique pick
  // Create a map: pickKey -> current_owner_id
  const pickOwnership = new Map<string, number>();
  const makePickKey = (originalRosterId: number, year: string, round: number) =>
    `${originalRosterId}:${year}:${round}`;

  // First, set baseline: each roster owns their own pick
  for (const roster of rosters) {
    for (const year of years) {
      for (const round of rounds) {
        pickOwnership.set(makePickKey(roster.roster_id, year, round), roster.roster_id);
      }
    }
  }

  // Apply traded picks to update ownership - each record shows current state
  let tradedPicksApplied = 0;
  if (tradedPicks && Array.isArray(tradedPicks)) {
    for (const pick of tradedPicks) {
      if (parseInt(pick.season, 10) < currentSeason) continue;
      if (!years.includes(pick.season)) continue;
      if (!rounds.includes(pick.round)) continue;

      // roster_id = original owner (whose pick it was), owner_id = current owner
      const pickKey = makePickKey(pick.roster_id, pick.season, pick.round);
      pickOwnership.set(pickKey, pick.owner_id);
      tradedPicksApplied++;
    }
  }

  // Now tally up ownership counts from the pickOwnership map
  for (const entry of Array.from(pickOwnership.entries())) {
    const [pickKey, ownerId] = entry;
    const [, year, roundStr] = pickKey.split(":");
    const round = parseInt(roundStr, 10);
    
    const rosterOwnership = ownership.get(ownerId);
    if (rosterOwnership) {
      const yearOwnership = rosterOwnership.get(year);
      if (yearOwnership) {
        yearOwnership.set(round, (yearOwnership.get(round) ?? 0) + 1);
      }
    }
  }

  const rosterCapital: RosterDraftCapital[] = [];

  for (const roster of rosters) {
    const rosterId = roster.roster_id;
    const user = userMap.get(roster.owner_id || "");

    const picksByYear: Record<string, Record<number, number>> = {};
    let acquiredCount = 0;
    let tradedAwayCount = 0;

    const rosterOwnership = ownership.get(rosterId);
    for (const year of years) {
      picksByYear[year] = {};
      for (const round of rounds) {
        const count = rosterOwnership?.get(year)?.get(round) ?? 0;
        picksByYear[year][round] = count;
      }
    }

    if (tradedPicks && Array.isArray(tradedPicks)) {
      for (const pick of tradedPicks) {
        if (parseInt(pick.season, 10) < currentSeason) continue;
        if (pick.owner_id === rosterId && pick.roster_id !== rosterId) {
          acquiredCount++;
        }
        if (pick.roster_id === rosterId && pick.owner_id !== rosterId) {
          tradedAwayCount++;
        }
      }
    }

    let totalR1 = 0,
      totalR2 = 0,
      totalR3 = 0,
      totalR4 = 0;
    for (const year of years) {
      totalR1 += picksByYear[year][1] ?? 0;
      totalR2 += picksByYear[year][2] ?? 0;
      totalR3 += picksByYear[year][3] ?? 0;
      totalR4 += picksByYear[year][4] ?? 0;
    }
    const totalPicks = totalR1 + totalR2 + totalR3 + totalR4;

    const draftCapScore = totalR1 * 3 + totalR2 * 2 + totalR3 * 1 + totalR4 * 0.5;

    rosterCapital.push({
      roster_id: rosterId,
      owner_id: roster.owner_id,
      display_name: user?.display_name || `Team ${rosterId}`,
      picks_by_year: picksByYear,
      totals: { r1: totalR1, r2: totalR2, r3: totalR3, r4: totalR4, total: totalPicks },
      draft_cap_score: draftCapScore,
      future_1sts: totalR1,
      acquired_count: acquiredCount,
      traded_away_count: tradedAwayCount,
    });
  }

  rosterCapital.sort((a, b) => b.draft_cap_score - a.draft_cap_score);

  const baselinePicksCreated = rosters.length * years.length * rounds.length;

  return {
    league_id: leagueId,
    season: currentSeason,
    years,
    rounds,
    rosters: rosterCapital,
    ...(includeDebug && {
      debug: {
        baseline_years: baselineYears,
        baseline_rounds: baselineRounds,
        baseline_picks_created: baselinePicksCreated,
        traded_picks_applied: tradedPicksApplied,
      },
    }),
  };
}

export async function cacheDraftCapital(leagueId: string): Promise<void> {
  if (!db) return;

  const result = await computeDraftCapital(leagueId);
  if (!result) return;

  const now = Date.now();

  for (const roster of result.rosters) {
    for (const year of result.years) {
      for (const round of result.rounds) {
        const count = roster.picks_by_year[year]?.[round] ?? 0;
        await db
          .insert(schema.draft_capital_cache)
          .values({
            league_id: leagueId,
            roster_id: roster.roster_id,
            season_year: parseInt(year, 10),
            round,
            count,
            updated_at: now,
          })
          .onConflictDoUpdate({
            target: [
              schema.draft_capital_cache.league_id,
              schema.draft_capital_cache.roster_id,
              schema.draft_capital_cache.season_year,
              schema.draft_capital_cache.round,
            ],
            set: {
              count,
              updated_at: now,
            },
          });
      }
    }
  }
}

export async function getCachedDraftCapital(
  leagueId: string,
  maxAgeMs = 60 * 60 * 1000
): Promise<DraftCapitalResult | null> {
  if (!db) return null;

  const cached = await db
    .select()
    .from(schema.draft_capital_cache)
    .where(eq(schema.draft_capital_cache.league_id, leagueId));

  if (cached.length === 0) return null;

  const oldestUpdate = Math.min(...cached.map((r) => r.updated_at));
  if (Date.now() - oldestUpdate > maxAgeMs) return null;

  const rosters = await cache.getRostersForLeague(leagueId);
  const leagueUsers = await cache.getLeagueUsers(leagueId);
  const userMap = new Map(leagueUsers.map((u) => [u.user_id, u]));

  const yearsSet = new Set<string>();
  const roundsSet = new Set<number>();
  const rosterPicksMap = new Map<number, Record<string, Record<number, number>>>();

  for (const row of cached) {
    yearsSet.add(String(row.season_year));
    roundsSet.add(row.round);

    if (!rosterPicksMap.has(row.roster_id)) {
      rosterPicksMap.set(row.roster_id, {});
    }
    const byYear = rosterPicksMap.get(row.roster_id)!;
    const yearStr = String(row.season_year);
    if (!byYear[yearStr]) byYear[yearStr] = {};
    byYear[yearStr][row.round] = row.count;
  }

  const years = Array.from(yearsSet).sort();
  const rounds = Array.from(roundsSet).sort((a, b) => a - b);

  const rosterCapital: RosterDraftCapital[] = [];
  for (const roster of rosters) {
    const picksByYear = rosterPicksMap.get(roster.roster_id) || {};
    const user = userMap.get(roster.owner_id || "");

    let totalR1 = 0,
      totalR2 = 0,
      totalR3 = 0,
      totalR4 = 0;
    for (const year of years) {
      totalR1 += picksByYear[year]?.[1] ?? 0;
      totalR2 += picksByYear[year]?.[2] ?? 0;
      totalR3 += picksByYear[year]?.[3] ?? 0;
      totalR4 += picksByYear[year]?.[4] ?? 0;
    }
    const totalPicks = totalR1 + totalR2 + totalR3 + totalR4;
    const draftCapScore = totalR1 * 3 + totalR2 * 2 + totalR3 * 1 + totalR4 * 0.5;

    rosterCapital.push({
      roster_id: roster.roster_id,
      owner_id: roster.owner_id,
      display_name: user?.display_name || `Team ${roster.roster_id}`,
      picks_by_year: picksByYear,
      totals: { r1: totalR1, r2: totalR2, r3: totalR3, r4: totalR4, total: totalPicks },
      draft_cap_score: draftCapScore,
      future_1sts: totalR1,
      acquired_count: 0,
      traded_away_count: 0,
    });
  }

  rosterCapital.sort((a, b) => b.draft_cap_score - a.draft_cap_score);

  const league = await cache.getLeagueById(leagueId);

  return {
    league_id: leagueId,
    season: league?.season ?? new Date().getFullYear(),
    years,
    rounds,
    rosters: rosterCapital,
  };
}

export interface PickValueInfo {
  pick_year: number;
  pick_round: number;
  pick_tier: string;
  value: number;
  original_roster_id: number;
  owner_roster_id: number;
}

export interface RosterPicksValue {
  roster_id: number;
  picks: PickValueInfo[];
  total_value: number;
  picks_count: number;
}

function estimateTierFromMaxPfRank(
  maxPfRank: number,
  totalRosters: number,
  round: number
): string {
  const bucketSize = Math.ceil(totalRosters / 3);
  const topBucket = bucketSize;
  const midBucket = bucketSize * 2;
  
  if (round === 1) {
    if (maxPfRank <= topBucket) {
      return "1.07-1.12";
    } else if (maxPfRank <= midBucket) {
      return "1.04-1.06";
    } else {
      return "1.01-1.03";
    }
  } else if (round === 2) {
    if (maxPfRank <= Math.ceil(totalRosters / 2)) {
      return "late";
    } else {
      return "early";
    }
  } else if (round === 3) {
    if (maxPfRank <= Math.ceil(totalRosters / 2)) {
      return "late";
    } else {
      return "early";
    }
  } else {
    return "all";
  }
}

export async function computePicksValueForLeague(
  leagueId: string,
  maxPfRanks: Map<number, number>,
  isSuperflex: boolean
): Promise<Map<number, RosterPicksValue>> {
  const rosters = await cache.getRostersForLeague(leagueId);
  if (!rosters || rosters.length === 0) return new Map();

  const league = await cache.getLeagueById(leagueId);
  const currentSeason = league?.season ?? new Date().getFullYear();
  const totalRosters = rosters.length;

  const pickValueMap = new Map<string, { value_1qb: number; value_sf: number }>();
  
  if (db) {
    try {
      const allPickValues = await db
        .select()
        .from(schema.draft_pick_values);
      
      for (const pv of allPickValues) {
        const key = `${pv.pick_year}:${pv.pick_round}:${pv.pick_tier}`;
        pickValueMap.set(key, { value_1qb: pv.value_1qb, value_sf: pv.value_sf });
      }
    } catch (e) {
      console.log("[computePicksValueForLeague] DB query failed, using fallback values");
    }
  }

  const tradedPicks = await fetchTradedPicks(leagueId);
  const baselineRounds = 4;
  const rounds = Array.from({ length: baselineRounds }, (_, i) => i + 1);
  const baselineYears = [
    String(currentSeason),
    String(currentSeason + 1),
    String(currentSeason + 2),
  ];
  const yearsSet = new Set<string>(baselineYears);
  if (tradedPicks && Array.isArray(tradedPicks)) {
    for (const pick of tradedPicks) {
      if (parseInt(pick.season, 10) >= currentSeason) {
        yearsSet.add(pick.season);
      }
    }
  }
  const years = Array.from(yearsSet).sort();

  const pickOwnership = new Map<string, { owner: number; original: number }>();
  const makePickKey = (originalRosterId: number, year: string, round: number) =>
    `${originalRosterId}:${year}:${round}`;

  for (const roster of rosters) {
    for (const year of years) {
      for (const round of rounds) {
        pickOwnership.set(makePickKey(roster.roster_id, year, round), {
          owner: roster.roster_id,
          original: roster.roster_id,
        });
      }
    }
  }

  if (tradedPicks && Array.isArray(tradedPicks)) {
    for (const pick of tradedPicks) {
      if (parseInt(pick.season, 10) < currentSeason) continue;
      if (!years.includes(pick.season)) continue;
      if (!rounds.includes(pick.round)) continue;

      const pickKey = makePickKey(pick.roster_id, pick.season, pick.round);
      pickOwnership.set(pickKey, { owner: pick.owner_id, original: pick.roster_id });
    }
  }

  const result = new Map<number, RosterPicksValue>();
  for (const roster of rosters) {
    result.set(roster.roster_id, {
      roster_id: roster.roster_id,
      picks: [],
      total_value: 0,
      picks_count: 0,
    });
  }

  for (const entry of Array.from(pickOwnership.entries())) {
    const [pickKey, ownershipInfo] = entry;
    const [originalStr, yearStr, roundStr] = pickKey.split(":");
    const originalRosterId = parseInt(originalStr, 10);
    const year = parseInt(yearStr, 10);
    const round = parseInt(roundStr, 10);

    const maxPfRank = maxPfRanks.get(originalRosterId) ?? Math.ceil(totalRosters / 2);
    const tier = estimateTierFromMaxPfRank(maxPfRank, totalRosters, round);

    const valueKey = `${year}:${round}:${tier}`;
    const dbValue = pickValueMap.get(valueKey);
    
    let pickValue: number;
    if (dbValue) {
      pickValue = isSuperflex ? dbValue.value_sf : dbValue.value_1qb;
    } else {
      const baseValue = round === 1 ? 35 : round === 2 ? 18 : round === 3 ? 6 : 1;
      const yearsOut = Math.max(0, year - currentSeason);
      const discount = [1.0, 0.85, 0.72, 0.62][Math.min(yearsOut, 3)];
      pickValue = Math.round(baseValue * discount);
    }

    const ownerData = result.get(ownershipInfo.owner);
    if (ownerData) {
      ownerData.picks.push({
        pick_year: year,
        pick_round: round,
        pick_tier: tier,
        value: pickValue,
        original_roster_id: originalRosterId,
        owner_roster_id: ownershipInfo.owner,
      });
      ownerData.total_value += pickValue;
      ownerData.picks_count++;
    }
  }

  return result;
}
