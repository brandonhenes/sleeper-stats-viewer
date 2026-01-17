import { cache, CachedRoster, CachedPlayer } from "../cache";

const BASE = "https://api.sleeper.app/v1";

async function jget(url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export interface PowerResult {
  roster_id: number;
  owner_id: string | null;
  rank: number;
  outOf: number;
  starters: number;
  bench: number;
  picksCount: number;
  picksValue: number;
  total: number;
  coveragePct: number;
  lowConfidence: boolean;
  formatFlags: { superflex: boolean; tep: boolean };
}

export interface LeaguePowerResults {
  leagueId: string;
  season: number;
  totalRosters: number;
  formatFlags: { superflex: boolean; tep: boolean };
  teams: PowerResult[];
}

const BENCH_WEIGHT = 0.30;

const DEFAULT_PICK_VALUES: Record<number, number> = {
  1: 55,
  2: 30,
  3: 15,
  4: 7,
};

const YEAR_DISCOUNTS: Record<number, number> = {
  0: 1.00,
  1: 0.85,
  2: 0.72,
  3: 0.62,
};

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

interface MarketValue {
  player_id: string;
  position: string | null;
  trade_value_std: number | null;
  trade_value_sf: number | null;
  trade_value_tep: number | null;
}

interface PickValue {
  pick_round: number;
  pick_tier: string;
  value_1qb: number;
  value_sf: number;
}

export async function computeLeaguePower(
  leagueId: string,
  userId?: string
): Promise<LeaguePowerResults | null> {
  const league = await cache.getLeagueById(leagueId);
  if (!league) return null;

  const rawJson = league.raw_json ? JSON.parse(league.raw_json) : {};
  const rosterPositions: string[] = rawJson.roster_positions || [];
  const scoringSettings = rawJson.scoring_settings || {};
  const totalRosters = rawJson.total_rosters || 12;
  const leagueSeason = league.season || new Date().getFullYear();

  const isSuperflex = rosterPositions.includes("SUPER_FLEX");
  const isTep = scoringSettings.bonus_rec_te > 0 || 
    (scoringSettings.rec_te && scoringSettings.rec_te > (scoringSettings.rec || 0));

  const formatFlags = { superflex: isSuperflex, tep: isTep };
  const asOfYear = new Date().getFullYear();
  const currentYear = new Date().getFullYear();

  const rosters = await cache.getRostersForLeague(leagueId);
  const allRosterPlayers = await cache.getAllRosterPlayersForLeague(leagueId);

  const rosterPlayersMap = new Map<string, string[]>();
  for (const rp of allRosterPlayers) {
    const key = rp.owner_id;
    if (!rosterPlayersMap.has(key)) rosterPlayersMap.set(key, []);
    rosterPlayersMap.get(key)!.push(rp.player_id);
  }

  const allPlayerIds = new Set<string>();
  for (const rp of allRosterPlayers) allPlayerIds.add(rp.player_id);

  const marketValues = await cache.getMarketValuesByIds(Array.from(allPlayerIds), asOfYear) as MarketValue[];
  const marketMap = new Map(marketValues.map(m => [m.player_id, m]));

  const playerRecords = await cache.getPlayersByIds(Array.from(allPlayerIds));
  const playerInfoMap = new Map(playerRecords.map((p: CachedPlayer) => [p.player_id, { position: p.position }]));

  const pickValuesCache = await cache.getAllDraftPickValues(asOfYear) as PickValue[];
  const draftCapital: any[] = await jget(`${BASE}/league/${leagueId}/traded_picks`) || [];

  const starterSlots = rosterPositions.filter((p: string) => 
    p !== "BN" && p !== "IR" && p !== "TAXI"
  );

  const getPickValue = (round: number, order: number | null, pickYear?: number): number => {
    const effectiveOrder = order ?? Math.ceil(totalRosters / 2);
    let tier = "all";

    if (round === 1) {
      const percentile = (effectiveOrder - 1) / Math.max(totalRosters - 1, 1);
      if (percentile <= 0.25) tier = "1.01-1.03";
      else if (percentile <= 0.50) tier = "1.04-1.06";
      else tier = "1.07-1.12";
    } else if (round === 2 || round === 3) {
      const percentile = (effectiveOrder - 1) / Math.max(totalRosters - 1, 1);
      tier = percentile <= 0.50 ? "early" : "late";
    }

    const effectiveRound = round >= 4 ? 4 : round;
    const match = pickValuesCache.find((pv: PickValue) => pv.pick_round === effectiveRound && pv.pick_tier === tier);
    
    let baseValue = 0;
    if (match) {
      baseValue = isSuperflex ? match.value_sf : match.value_1qb;
    } else {
      baseValue = DEFAULT_PICK_VALUES[effectiveRound] || 7;
    }

    const yearsOut = Math.min(Math.max((pickYear || currentYear) - currentYear, 0), 3);
    const discount = YEAR_DISCOUNTS[yearsOut] ?? 0.62;
    
    return Math.round(baseValue * discount);
  };

  const results: Array<{
    roster_id: number;
    owner_id: string | null;
    starters: number;
    bench: number;
    picksCount: number;
    picksValue: number;
    total: number;
    coveragePct: number;
    playersWithValue: number;
    playerCount: number;
  }> = [];

  for (const roster of rosters) {
    const ownerId = roster.owner_id;
    const players = rosterPlayersMap.get(ownerId || "") || [];
    
    let playersWithValue = 0;
    const playerData = players.map((pid: string) => {
      const mv = marketMap.get(pid);
      const playerInfo = playerInfoMap.get(pid);
      const position = mv?.position || playerInfo?.position || "FLEX";
      
      let effectiveValue = 0;
      let hasValue = false;
      
      if (mv) {
        const baseValue = mv.trade_value_std ?? null;
        if (baseValue !== null) {
          hasValue = true;
          effectiveValue = baseValue;
          if (isSuperflex && mv.position === "QB" && mv.trade_value_sf != null) {
            effectiveValue = mv.trade_value_sf;
          }
          if (isTep && mv.position === "TE" && mv.trade_value_tep != null) {
            effectiveValue = mv.trade_value_tep;
          }
        }
      }
      
      if (hasValue) playersWithValue++;
      
      return { player_id: pid, position, value: effectiveValue, has_value: hasValue };
    });

    playerData.sort((a, b) => b.value - a.value);

    const usedPlayerIds = new Set<string>();
    let startersValue = 0;

    for (const slot of starterSlots) {
      const eligiblePositions = getEligiblePositions(slot);
      const bestFit = playerData.find(p => 
        eligiblePositions.includes(p.position) && !usedPlayerIds.has(p.player_id)
      );
      if (bestFit) {
        usedPlayerIds.add(bestFit.player_id);
        startersValue += bestFit.value;
      }
    }

    const benchValue = playerData
      .filter(p => !usedPlayerIds.has(p.player_id))
      .reduce((sum, p) => sum + p.value * BENCH_WEIGHT, 0);

    let picksValue = 0;
    let picksCount = 0;
    for (const pick of draftCapital) {
      if (pick.owner_id === roster.owner_id || pick.roster_id === roster.roster_id) {
        const val = getPickValue(pick.round, pick.order || null, pick.season);
        picksValue += val;
        picksCount++;
      }
    }

    const coveragePct = players.length > 0 
      ? Math.round((playersWithValue / players.length) * 100) 
      : 0;

    results.push({
      roster_id: roster.roster_id,
      owner_id: roster.owner_id,
      starters: Math.round(startersValue),
      bench: Math.round(benchValue),
      picksCount,
      picksValue: Math.round(picksValue),
      total: Math.round(startersValue + benchValue + picksValue),
      coveragePct,
      playersWithValue,
      playerCount: players.length,
    });
  }

  results.sort((a, b) => {
    if (b.starters !== a.starters) return b.starters - a.starters;
    return b.total - a.total;
  });

  const teams: PowerResult[] = results.map((r, i) => ({
    roster_id: r.roster_id,
    owner_id: r.owner_id,
    rank: i + 1,
    outOf: totalRosters,
    starters: r.starters,
    bench: r.bench,
    picksCount: r.picksCount,
    picksValue: r.picksValue,
    total: r.total,
    coveragePct: r.coveragePct,
    lowConfidence: r.coveragePct < 70,
    formatFlags,
  }));

  return {
    leagueId,
    season: leagueSeason,
    totalRosters,
    formatFlags,
    teams,
  };
}

export async function getUserPowerForLeague(
  leagueId: string,
  userId: string
): Promise<PowerResult | null> {
  const results = await computeLeaguePower(leagueId, userId);
  if (!results) return null;
  
  return results.teams.find(t => t.owner_id === userId) || null;
}

export async function computeGroupPower(
  groupId: string,
  userId: string,
  leagueId: string,
  season: number
): Promise<PowerResult | null> {
  return getUserPowerForLeague(leagueId, userId);
}
