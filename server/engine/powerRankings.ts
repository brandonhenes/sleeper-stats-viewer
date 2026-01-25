import { cache, CachedRoster, CachedPlayer } from "../cache";
import { db } from "../db";
import * as schema from "@shared/schema";

const BASE = "https://api.sleeper.app/v1";

export interface LeagueContext {
  leagueId: string;
  season: number;
  totalRosters: number;
  rosterPositions: string[];
  scoringSettings: Record<string, number>;
  isSuperflex: boolean;
  isTep: boolean;
}

export interface PlayerValue {
  player_id: string;
  full_name: string;
  position: string;
  age: number | null;
  value: number;
  hasValue: boolean;
}

export interface PickBreakdown {
  year: number;
  round: number;
  tier: string;
  value: number;
  originalOwnerRosterId: number;
  valueSource: "db" | "fallback";
}

export interface DebugInfo {
  isSuperflex: boolean;
  isTep: boolean;
  rosterPositionsSample: string[];
  valueColumn: "sf" | "1qb";
  tierAssignments: PickBreakdown[];
  normalizationStats: {
    starters: { min: number; max: number; median: number };
    bench: { min: number; max: number; median: number };
    picks: { min: number; max: number; median: number };
    window: { min: number; max: number; median: number };
  };
  strengthRankSource: "maxPf" | "composite" | "actualPts";
}

export interface PositionAgeScore {
  position: string;
  avgAge: number;
  score: number;
  inPrime: boolean;
  primeYearsLeft: number;
}

export interface TeamRanking {
  roster_id: number;
  owner_id: string | null;
  display_name: string;
  rank: number;
  starters_value: number;
  bench_value: number;
  picks_value: number;
  scaled_picks_value: number;
  window_value: number;
  starters_score: number;
  bench_score: number;
  picks_score: number;
  window_score: number;
  age_score: number;
  total_score: number;
  coverage_pct: number | null;
  picks_breakdown: PickBreakdown[];
  draft_capital_counts: Record<number, number>;
  age_by_position: PositionAgeScore[];
  actual_pf: number;
  max_pf: number;
  max_pf_score: number;
  efficiency_pct: number;
  luck_flag: string | null;
  archetype: string;
}

export interface PowerRankingsResult {
  leagueId: string;
  season: number;
  totalRosters: number;
  formatFlags: { superflex: boolean; tep: boolean };
  weights: typeof DEFAULT_WEIGHTS;
  teams: TeamRanking[];
  debug?: DebugInfo;
}

export const DEFAULT_WEIGHTS = {
  starters: 45,
  bench: 15,
  picks: 25,
  window: 10,
  age: 5,
};

// Scaling factor to normalize pick values (0-60 range) to starters range (1000-2000)
// This ensures a 1.12 pick adds more than 2.11 + 3.11 combined
const PICK_VALUE_SCALE_FACTOR = 20; // Converts 50 pick value to ~1000 starters-equivalent

const POSITION_AGE_CURVES = [
  { position: "RB", primeStart: 23, primeEnd: 26, declineStart: 28 },
  { position: "WR", primeStart: 24, primeEnd: 29, declineStart: 31 },
  { position: "TE", primeStart: 25, primeEnd: 30, declineStart: 33 },
  { position: "QB", primeStart: 27, primeEnd: 33, declineStart: 35 },
];

const FALLBACK_PICK_VALUES: Record<number, { "1qb": number; sf: number }> = {
  1: { "1qb": 55, sf: 75 },
  2: { "1qb": 30, sf: 40 },
  3: { "1qb": 15, sf: 20 },
  4: { "1qb": 7, sf: 10 },
};

const YEAR_DISCOUNTS: Record<number, number> = {
  0: 1.0,
  1: 0.85,
  2: 0.72,
  3: 0.62,
};

export function isSuperflexLeague(rosterPositions: string[]): boolean {
  return rosterPositions.includes("SUPER_FLEX");
}

export function isTepLeague(scoringSettings: Record<string, number>): boolean {
  const bonusRecTe = scoringSettings.bonus_rec_te || 0;
  const recTe = scoringSettings.rec_te || 0;
  const rec = scoringSettings.rec || 0;
  return bonusRecTe > 0 || recTe > rec;
}

function getEligiblePositions(slot: string): string[] {
  switch (slot) {
    case "QB": return ["QB"];
    case "RB": return ["RB"];
    case "WR": return ["WR"];
    case "TE": return ["TE"];
    case "K": return ["K"];
    case "DEF": return ["DEF"];
    case "FLEX": return ["RB", "WR", "TE"];
    case "SUPER_FLEX": return ["QB", "RB", "WR", "TE"];
    case "REC_FLEX": return ["WR", "TE"];
    case "WRRB_FLEX": return ["WR", "RB"];
    case "IDP_FLEX": return ["DL", "LB", "DB"];
    default: return ["QB", "RB", "WR", "TE"];
  }
}

function isStarterSlot(slot: string): boolean {
  return !["BN", "IR", "TAXI"].includes(slot);
}

function getPositionAgeCurve(position: string) {
  return POSITION_AGE_CURVES.find(c => c.position === position) || 
    { position, primeStart: 24, primeEnd: 30, declineStart: 31 };
}

function safeNumber(val: unknown, fallback = 0): number {
  if (typeof val === "number" && !isNaN(val) && isFinite(val)) return val;
  return fallback;
}

function percentileRank(value: number, allValues: number[]): number {
  if (allValues.length === 0) return 50;
  const sorted = [...allValues].sort((a, b) => a - b);
  let count = 0;
  for (const v of sorted) {
    if (v < value) count++;
  }
  return (count / sorted.length) * 100;
}

function computeNormStats(values: number[]): { min: number; max: number; median: number } {
  if (values.length === 0) return { min: 0, max: 0, median: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { min, max, median };
}

function estimateTierFromStrengthRank(
  strengthRank: number,
  totalRosters: number,
  round: number
): string {
  if (round >= 4) return "all";
  
  if (round === 1) {
    const earlyCount = Math.ceil(totalRosters * 0.25);
    const midCount = Math.ceil(totalRosters * 0.25);
    const lateCount = totalRosters - earlyCount - midCount;
    
    if (strengthRank <= lateCount) {
      return "1.07-1.12";
    } else if (strengthRank <= lateCount + midCount) {
      return "1.04-1.06";
    } else {
      return "1.01-1.03";
    }
  }
  
  const halfPoint = Math.ceil(totalRosters / 2);
  return strengthRank > halfPoint ? "early" : "late";
}

async function fetchTradedPicks(leagueId: string): Promise<any[]> {
  try {
    const res = await fetch(`${BASE}/league/${leagueId}/traded_picks`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function loadPickValuesFromDb(): Promise<Map<string, { value_1qb: number; value_sf: number }>> {
  const pickValueMap = new Map<string, { value_1qb: number; value_sf: number }>();
  
  if (!db) return pickValueMap;
  
  try {
    const allPickValues = await db.select().from(schema.draft_pick_values);
    for (const pv of allPickValues) {
      const key = `${pv.pick_year}:${pv.pick_round}:${pv.pick_tier}`;
      pickValueMap.set(key, { value_1qb: pv.value_1qb, value_sf: pv.value_sf });
    }
  } catch (e) {
    console.log("[powerRankings] DB pick values unavailable, using fallback");
  }
  
  return pickValueMap;
}

function computeOptimalLineup(
  players: PlayerValue[],
  rosterPositions: string[]
): { starters: PlayerValue[]; startersValue: number; bench: PlayerValue[]; benchValue: number } {
  const starterSlots = rosterPositions.filter(isStarterSlot);
  const available = [...players].sort((a, b) => b.value - a.value);
  const starters: PlayerValue[] = [];
  const usedIds = new Set<string>();

  for (const slot of starterSlots) {
    const eligible = getEligiblePositions(slot);
    const candidate = available.find(
      p => eligible.includes(p.position) && !usedIds.has(p.player_id)
    );
    if (candidate) {
      usedIds.add(candidate.player_id);
      starters.push(candidate);
    }
  }

  const startersValue = starters.reduce((sum, p) => sum + p.value, 0);
  const bench = players.filter(p => !usedIds.has(p.player_id));
  const benchValue = bench.reduce((sum, p) => sum + p.value, 0);

  return { starters, startersValue, bench, benchValue };
}

function computePositionAgeScore(players: PlayerValue[], position: string): PositionAgeScore {
  const curve = getPositionAgeCurve(position);
  const posPlayers = players.filter(p => p.position === position && p.age != null);
  
  if (posPlayers.length === 0) {
    return { position, avgAge: 0, score: 50, inPrime: false, primeYearsLeft: 0 };
  }

  const totalValue = posPlayers.reduce((sum, p) => sum + p.value, 0);
  const weightedAgeSum = posPlayers.reduce((sum, p) => {
    const weight = totalValue > 0 ? p.value / totalValue : 1 / posPlayers.length;
    return sum + (p.age ?? 25) * weight;
  }, 0);

  const avgAge = weightedAgeSum;
  const inPrime = avgAge >= curve.primeStart && avgAge <= curve.primeEnd;
  const primeYearsLeft = Math.max(0, curve.primeEnd - avgAge);

  let score = 50;
  if (avgAge < curve.primeStart) {
    score = 70 + (curve.primeStart - avgAge) * 3;
  } else if (avgAge <= curve.primeEnd) {
    score = 90;
  } else {
    score = Math.max(10, 90 - (avgAge - curve.primeEnd) * 10);
  }
  score = Math.min(100, Math.max(0, score));

  return { position, avgAge: Math.round(avgAge * 10) / 10, score, inPrime, primeYearsLeft: Math.round(primeYearsLeft * 10) / 10 };
}

function computeWindowValue(players: PlayerValue[]): { value: number; byPosition: PositionAgeScore[] } {
  const positions = ["QB", "RB", "WR", "TE"];
  const byPosition = positions.map(pos => computePositionAgeScore(players, pos));
  const totalScore = byPosition.reduce((sum, a) => sum + a.score, 0);
  const avgScore = byPosition.length > 0 ? totalScore / byPosition.length : 50;
  return { value: avgScore, byPosition };
}

function determineArchetype(
  startersRank: number,
  picksRank: number,
  windowValue: number,
  avgPrimeYearsLeft: number,
  totalRosters: number
): string {
  const startersPct = (startersRank / totalRosters) * 100;
  const picksPct = (picksRank / totalRosters) * 100;
  const isContenderWindow = windowValue > 60 && startersPct <= 33;
  const isRebuildWindow = startersPct > 75 || (avgPrimeYearsLeft < 2 && picksPct <= 50);

  if (isContenderWindow && startersPct <= 33) {
    if (avgPrimeYearsLeft >= 2 && picksPct <= 50) {
      return "all-in-contender";
    } else {
      return "fragile-contender";
    }
  } else if (isRebuildWindow || startersPct > 75) {
    return "rebuilder";
  } else if (startersPct <= 50 && avgPrimeYearsLeft >= 3) {
    return "productive-struggle";
  }
  return "dead-zone";
}

export async function computePowerRankings(
  leagueId: string,
  options: { includeDebug?: boolean; weights?: typeof DEFAULT_WEIGHTS } = {}
): Promise<PowerRankingsResult | null> {
  const league = await cache.getLeagueById(leagueId);
  if (!league) return null;

  const rawJson = league.raw_json ? JSON.parse(league.raw_json) : {};
  const rosterPositions: string[] = rawJson.roster_positions || [];
  const scoringSettings = rawJson.scoring_settings || {};
  const totalRosters = rawJson.total_rosters || 12;
  const leagueSeason = league.season || new Date().getFullYear();
  const currentYear = new Date().getFullYear();

  const isSuperflex = isSuperflexLeague(rosterPositions);
  const isTep = isTepLeague(scoringSettings);
  const weights = options.weights || DEFAULT_WEIGHTS;

  const rosters = await cache.getRostersForLeague(leagueId);
  if (!rosters || rosters.length === 0) return null;

  const leagueUsers = await cache.getLeagueUsers(leagueId);
  const userMap = new Map(leagueUsers.map(u => [u.user_id, u]));

  const allRosterPlayers = await cache.getAllRosterPlayersForLeague(leagueId);
  const rosterPlayersMap = new Map<string, string[]>();
  for (const rp of allRosterPlayers) {
    const key = rp.owner_id;
    if (!rosterPlayersMap.has(key)) rosterPlayersMap.set(key, []);
    rosterPlayersMap.get(key)!.push(rp.player_id);
  }

  const allPlayerIds = new Set<string>();
  for (const rp of allRosterPlayers) allPlayerIds.add(rp.player_id);

  const marketValues = await cache.getMarketValuesByIds(Array.from(allPlayerIds), currentYear);
  const marketMap = new Map(marketValues.map((m: any) => [m.player_id, m]));

  const playerRecords = await cache.getPlayersByIds(Array.from(allPlayerIds));
  const playerInfoMap = new Map(playerRecords.map((p: CachedPlayer) => [p.player_id, p]));

  const pickValuesDb = await loadPickValuesFromDb();
  const tradedPicks = await fetchTradedPicks(leagueId);

  const baselineYears = [leagueSeason, leagueSeason + 1, leagueSeason + 2];
  const yearsSet = new Set(baselineYears);
  for (const pick of tradedPicks) {
    const pickYear = parseInt(pick.season, 10);
    if (pickYear >= leagueSeason) yearsSet.add(pickYear);
  }
  const years = Array.from(yearsSet).sort();

  const rosterIdToOwnerId = new Map<number, string>();
  for (const roster of rosters) {
    if (roster.owner_id) rosterIdToOwnerId.set(roster.roster_id, roster.owner_id);
  }

  const ownerIdToRosterId = new Map<string, number>();
  for (const roster of rosters) {
    if (roster.owner_id) ownerIdToRosterId.set(roster.owner_id, roster.roster_id);
  }

  interface RosterData {
    roster: CachedRoster;
    players: PlayerValue[];
    lineup: { starters: PlayerValue[]; startersValue: number; bench: PlayerValue[]; benchValue: number };
    windowData: { value: number; byPosition: PositionAgeScore[] };
    picksBreakdown: PickBreakdown[];
    picksValue: number;
    draftCapitalCounts: Record<number, number>;
    coveragePct: number | null;
    actualPf: number;
    maxPf: number;
  }

  const rosterDataList: RosterData[] = [];

  for (const roster of rosters) {
    const ownerId = roster.owner_id;
    const playerIds = rosterPlayersMap.get(ownerId || "") || [];
    
    let playersWithValue = 0;
    const players: PlayerValue[] = playerIds.map(pid => {
      const mv = marketMap.get(pid) as any;
      const playerInfo = playerInfoMap.get(pid);
      const position = mv?.position || playerInfo?.position || "FLEX";
      const fullName = playerInfo?.full_name || pid;
      const age = playerInfo?.age || null;
      
      let effectiveValue = 0;
      let hasValue = false;
      
      if (mv) {
        const baseValue = mv.trade_value_std ?? null;
        if (baseValue !== null) {
          hasValue = true;
          effectiveValue = baseValue;
          if (isSuperflex && position === "QB" && mv.trade_value_sf != null) {
            effectiveValue = mv.trade_value_sf;
          }
          if (isTep && position === "TE" && mv.trade_value_tep != null) {
            effectiveValue = mv.trade_value_tep;
          }
        }
      }
      
      if (hasValue) playersWithValue++;
      
      return { player_id: pid, full_name: fullName, position, age, value: effectiveValue, hasValue };
    });

    const lineup = computeOptimalLineup(players, rosterPositions);
    const windowData = computeWindowValue(players);

    const coveragePct = playerIds.length > 0 
      ? Math.round((playersWithValue / playerIds.length) * 100) 
      : null;

    const actualPf = safeNumber(roster.fpts);
    const maxPf = lineup.startersValue * 10;

    rosterDataList.push({
      roster,
      players,
      lineup,
      windowData,
      picksBreakdown: [],
      picksValue: 0,
      draftCapitalCounts: { 1: 0, 2: 0, 3: 0, 4: 0 },
      coveragePct,
      actualPf,
      maxPf,
    });
  }

  rosterDataList.sort((a, b) => b.maxPf - a.maxPf);
  const maxPfRankMap = new Map<number, number>();
  rosterDataList.forEach((rd, idx) => {
    maxPfRankMap.set(rd.roster.roster_id, idx + 1);
  });

  const ownership: Map<number, Map<number, Map<number, number>>> = new Map();
  for (const roster of rosters) {
    const yearMap = new Map<number, Map<number, number>>();
    for (const year of years) {
      const roundMap = new Map<number, number>();
      for (let r = 1; r <= 4; r++) roundMap.set(r, 0);
      yearMap.set(year, roundMap);
    }
    ownership.set(roster.roster_id, yearMap);
  }

  for (const roster of rosters) {
    for (const year of years) {
      for (let r = 1; r <= 4; r++) {
        ownership.get(roster.roster_id)!.get(year)!.set(r, 1);
      }
    }
  }

  for (const pick of tradedPicks) {
    const pickYear = parseInt(pick.season, 10);
    if (!years.includes(pickYear)) continue;
    
    const prevRosterId = pick.previous_owner_id ?? pick.roster_id;
    const newRosterId = pick.owner_id;
    const round = Math.min(pick.round, 4);

    const prevMap = ownership.get(prevRosterId)?.get(pickYear);
    const newMap = ownership.get(newRosterId)?.get(pickYear);

    if (prevMap) {
      const current = prevMap.get(round) || 0;
      prevMap.set(round, Math.max(0, current - 1));
    }
    if (newMap) {
      const current = newMap.get(round) || 0;
      newMap.set(round, current + 1);
    }
  }

  const allTierAssignments: PickBreakdown[] = [];

  for (const rd of rosterDataList) {
    const rosterId = rd.roster.roster_id;
    const yearMap = ownership.get(rosterId);
    if (!yearMap) continue;

    let totalPicksValue = 0;
    const picksBreakdown: PickBreakdown[] = [];
    const draftCapitalCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

    for (const [year, roundMap] of Array.from(yearMap.entries())) {
      for (const [round, count] of Array.from(roundMap.entries())) {
        if (count <= 0) continue;

        for (let i = 0; i < count; i++) {
          const originalOwnerRosterId = rosterId;
          const strengthRank = maxPfRankMap.get(originalOwnerRosterId) || Math.ceil(totalRosters / 2);
          const tier = estimateTierFromStrengthRank(strengthRank, totalRosters, round);
          
          const dbKey = `${year}:${round}:${tier}`;
          const dbValue = pickValuesDb.get(dbKey);
          
          let pickValue: number;
          let valueSource: "db" | "fallback" = "fallback";
          
          if (dbValue) {
            pickValue = isSuperflex ? dbValue.value_sf : dbValue.value_1qb;
            valueSource = "db";
          } else {
            const fallback = FALLBACK_PICK_VALUES[Math.min(round, 4)] || FALLBACK_PICK_VALUES[4];
            pickValue = isSuperflex ? fallback.sf : fallback["1qb"];
          }

          const yearsOut = Math.min(Math.max(year - currentYear, 0), 3);
          const discount = YEAR_DISCOUNTS[yearsOut] ?? 0.62;
          pickValue = Math.round(pickValue * discount);

          totalPicksValue += pickValue;
          draftCapitalCounts[Math.min(round, 4)]++;
          
          const breakdown: PickBreakdown = {
            year,
            round,
            tier,
            value: pickValue,
            originalOwnerRosterId,
            valueSource,
          };
          picksBreakdown.push(breakdown);
          allTierAssignments.push(breakdown);
        }
      }
    }

    rd.picksValue = totalPicksValue;
    rd.picksBreakdown = picksBreakdown;
    rd.draftCapitalCounts = draftCapitalCounts;
  }

  // Absolute Valuation Engine: Use raw market values with proper scaling
  // Starters: 1000-2000 range, Bench: 100-500 range, Picks: 0-60 raw -> scaled by PICK_VALUE_SCALE_FACTOR
  // Window: 50-100 (age curve score), Age: computed from average team age
  
  const allStartersValues = rosterDataList.map(rd => rd.lineup.startersValue);
  const allBenchValues = rosterDataList.map(rd => rd.lineup.benchValue);
  const allPicksValues = rosterDataList.map(rd => rd.picksValue);
  const allWindowValues = rosterDataList.map(rd => rd.windowData.value);
  const allMaxPfValues = rosterDataList.map(rd => rd.maxPf);

  // Compute team average age for age score
  function computeTeamAgeScore(players: PlayerValue[]): number {
    const playersWithAge = players.filter(p => p.age != null && p.value > 0);
    if (playersWithAge.length === 0) return 50;
    
    const totalValue = playersWithAge.reduce((sum, p) => sum + p.value, 0);
    const weightedAge = playersWithAge.reduce((sum, p) => {
      const weight = totalValue > 0 ? p.value / totalValue : 1 / playersWithAge.length;
      return sum + (p.age ?? 25) * weight;
    }, 0);
    
    // Younger teams score higher: 22 avg age = 100, 30 avg age = 0
    const ageScore = Math.max(0, Math.min(100, (30 - weightedAge) * 12.5));
    return ageScore;
  }

  interface ScoredRoster extends RosterData {
    startersScore: number;
    benchScore: number;
    picksScore: number;
    windowScore: number;
    ageScore: number;
    maxPfScore: number;
    totalScore: number;
    scaledPicksValue: number;
  }

  const scoredRosters: ScoredRoster[] = rosterDataList.map(rd => {
    // Scale picks to be proportional to starters (0-60 range -> ~0-1200 range)
    const scaledPicksValue = rd.picksValue * PICK_VALUE_SCALE_FACTOR;
    
    // Compute age score
    const ageScore = computeTeamAgeScore(rd.players);
    
    // Absolute values: use raw values directly
    // For fair comparison, we use percentile ranks on the absolute values
    // This ensures teams are ranked relative to each other
    const startersScore = percentileRank(rd.lineup.startersValue, allStartersValues);
    const benchScore = percentileRank(rd.lineup.benchValue, allBenchValues);
    const picksScore = percentileRank(rd.picksValue, allPicksValues);
    const windowScore = percentileRank(rd.windowData.value, allWindowValues);
    const maxPfScore = percentileRank(rd.maxPf, allMaxPfValues);

    // Apply new weights: 45% starters, 15% bench, 25% picks, 10% window, 5% age
    const totalWeight = weights.starters + weights.bench + weights.picks + weights.window + weights.age;
    const totalScore = 
      (startersScore * weights.starters / totalWeight) +
      (benchScore * weights.bench / totalWeight) +
      (picksScore * weights.picks / totalWeight) +
      (windowScore * weights.window / totalWeight) +
      (ageScore * weights.age / totalWeight);

    return {
      ...rd,
      startersScore,
      benchScore,
      picksScore,
      windowScore,
      ageScore,
      maxPfScore,
      totalScore: Math.round(totalScore * 10) / 10,
      scaledPicksValue,
    };
  });

  scoredRosters.sort((a, b) => b.totalScore - a.totalScore);

  const teams: TeamRanking[] = scoredRosters.map((sr, idx) => {
    const user = userMap.get(sr.roster.owner_id || "");
    const displayName = user?.display_name || `Team ${sr.roster.roster_id}`;
    
    const avgPrimeYearsLeft = sr.windowData.byPosition.length > 0
      ? sr.windowData.byPosition.reduce((sum, p) => sum + p.primeYearsLeft, 0) / sr.windowData.byPosition.length
      : 0;

    const startersRank = idx + 1;
    const picksRank = scoredRosters
      .slice()
      .sort((a, b) => b.picksValue - a.picksValue)
      .findIndex(r => r.roster.roster_id === sr.roster.roster_id) + 1;

    const archetype = determineArchetype(
      startersRank,
      picksRank,
      sr.windowData.value,
      avgPrimeYearsLeft,
      totalRosters
    );

    const efficiencyPct = sr.maxPf > 0 ? (sr.actualPf / sr.maxPf) * 100 : 0;
    let luckFlag: string | null = null;
    if (efficiencyPct >= 95) luckFlag = "unlucky";
    else if (efficiencyPct <= 80) luckFlag = "lucky";

    return {
      roster_id: sr.roster.roster_id,
      owner_id: sr.roster.owner_id,
      display_name: displayName,
      rank: idx + 1,
      starters_value: Math.round(sr.lineup.startersValue),
      bench_value: Math.round(sr.lineup.benchValue),
      picks_value: Math.round(sr.picksValue),
      scaled_picks_value: Math.round(sr.scaledPicksValue),
      window_value: Math.round(sr.windowData.value),
      starters_score: Math.round(sr.startersScore * 10) / 10,
      bench_score: Math.round(sr.benchScore * 10) / 10,
      picks_score: Math.round(sr.picksScore * 10) / 10,
      window_score: Math.round(sr.windowScore * 10) / 10,
      age_score: Math.round(sr.ageScore * 10) / 10,
      total_score: sr.totalScore,
      coverage_pct: sr.coveragePct,
      picks_breakdown: sr.picksBreakdown,
      draft_capital_counts: sr.draftCapitalCounts,
      age_by_position: sr.windowData.byPosition,
      actual_pf: Math.round(sr.actualPf),
      max_pf: Math.round(sr.maxPf),
      max_pf_score: Math.round(sr.maxPfScore * 10) / 10,
      efficiency_pct: Math.round(efficiencyPct * 10) / 10,
      luck_flag: luckFlag,
      archetype,
    };
  });

  const result: PowerRankingsResult = {
    leagueId,
    season: leagueSeason,
    totalRosters,
    formatFlags: { superflex: isSuperflex, tep: isTep },
    weights,
    teams,
  };

  if (options.includeDebug) {
    result.debug = {
      isSuperflex,
      isTep,
      rosterPositionsSample: rosterPositions.slice(0, 10),
      valueColumn: isSuperflex ? "sf" : "1qb",
      tierAssignments: allTierAssignments.slice(0, 20),
      normalizationStats: {
        starters: computeNormStats(allStartersValues),
        bench: computeNormStats(allBenchValues),
        picks: computeNormStats(allPicksValues),
        window: computeNormStats(allWindowValues),
      },
      strengthRankSource: "maxPf",
    };
  }

  return result;
}
