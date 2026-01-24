import { cache, CachedRoster, CachedPlayer } from "../cache";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";

const BASE = "https://api.sleeper.app/v1";

interface MarketValue {
  player_id: string;
  position: string | null;
  trade_value_std: number | null;
  trade_value_sf: number | null;
  trade_value_tep: number | null;
}

export interface PlayerWithValue {
  player_id: string;
  full_name: string;
  position: string;
  age: number | null;
  value: number;
}

export interface SlotAssignment {
  slot: string;
  player_id: string;
  player_name: string;
  position: string;
  value: number;
}

interface PositionAgeCurve {
  position: string;
  primeAge: number;
  peakWindow: [number, number];
  declineStart: number;
}

const POSITION_AGE_CURVES: PositionAgeCurve[] = [
  { position: "RB", primeAge: 24, peakWindow: [22, 26], declineStart: 27 },
  { position: "WR", primeAge: 27, peakWindow: [24, 30], declineStart: 30 },
  { position: "TE", primeAge: 28, peakWindow: [25, 31], declineStart: 31 },
  { position: "QB", primeAge: 30, peakWindow: [26, 34], declineStart: 35 },
];

function getPositionAgeCurve(position: string): PositionAgeCurve {
  return POSITION_AGE_CURVES.find(c => c.position === position) || 
    { position, primeAge: 27, peakWindow: [24, 30], declineStart: 30 };
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
  const nonStarterSlots = ["BN", "IR", "TAXI"];
  return !nonStarterSlots.includes(slot);
}

export interface LineupResult {
  starters: SlotAssignment[];
  startersValue: number;
  benchPlayers: PlayerWithValue[];
  benchValue: number;
  totalValue: number;
  coveragePct: number;
}

export function computeOptimalLineup(
  players: PlayerWithValue[],
  rosterPositions: string[],
  isSf: boolean,
  isTep: boolean
): LineupResult {
  const starterSlots = rosterPositions.filter(isStarterSlot);
  const available = [...players].sort((a, b) => b.value - a.value);
  const assigned: SlotAssignment[] = [];
  const usedPlayerIds = new Set<string>();

  for (const slot of starterSlots) {
    const eligible = getEligiblePositions(slot);
    const candidate = available.find(
      p => eligible.includes(p.position) && !usedPlayerIds.has(p.player_id)
    );
    
    if (candidate) {
      usedPlayerIds.add(candidate.player_id);
      assigned.push({
        slot,
        player_id: candidate.player_id,
        player_name: candidate.full_name,
        position: candidate.position,
        value: candidate.value,
      });
    }
  }

  const startersValue = assigned.reduce((sum, a) => sum + a.value, 0);
  const benchPlayers = players.filter(p => !usedPlayerIds.has(p.player_id));
  const benchValue = benchPlayers.reduce((sum, p) => sum + p.value, 0);
  const totalValue = startersValue + benchValue;

  const valuedPlayers = players.filter(p => p.value > 0).length;
  const coveragePct = players.length > 0 ? (valuedPlayers / players.length) * 100 : 0;

  return {
    starters: assigned,
    startersValue,
    benchPlayers,
    benchValue,
    totalValue,
    coveragePct,
  };
}

export interface AgeScore {
  position: string;
  avgAge: number;
  score: number;
  inPrime: boolean;
  primeYearsLeft: number;
}

export interface WindowScore {
  overall: number;
  byPosition: AgeScore[];
  isContenderWindow: boolean;
  isRebuildWindow: boolean;
}

export function computeAgeScore(
  players: PlayerWithValue[],
  position: string
): AgeScore {
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
  const [peakStart, peakEnd] = curve.peakWindow;
  const inPrime = avgAge >= peakStart && avgAge <= peakEnd;
  const primeYearsLeft = Math.max(0, peakEnd - avgAge);

  let score = 50;
  if (avgAge < peakStart) {
    score = 70 + (peakStart - avgAge) * 3;
  } else if (avgAge <= peakEnd) {
    score = 90;
  } else {
    score = Math.max(10, 90 - (avgAge - peakEnd) * 10);
  }
  score = Math.min(100, Math.max(0, score));

  return { position, avgAge, score, inPrime, primeYearsLeft };
}

export function computeWindowScore(
  players: PlayerWithValue[],
  picksValue: number,
  startersRank: number,
  totalRosters: number
): WindowScore {
  const positions = ["QB", "RB", "WR", "TE"];
  const byPosition = positions.map(pos => computeAgeScore(players, pos));
  
  const totalScore = byPosition.reduce((sum, a) => sum + a.score, 0);
  const avgScore = byPosition.length > 0 ? totalScore / byPosition.length : 50;

  const isTop = startersRank <= Math.ceil(totalRosters * 0.33);
  const isBottom = startersRank > Math.ceil(totalRosters * 0.67);
  
  const hasYoungCore = byPosition.filter(a => a.avgAge < 25).length >= 2;
  const hasPickCapital = picksValue > 100;

  const isContenderWindow = isTop && avgScore > 60;
  const isRebuildWindow = (isBottom || hasYoungCore) && hasPickCapital;

  return {
    overall: avgScore,
    byPosition,
    isContenderWindow,
    isRebuildWindow,
  };
}

export type TeamArchetype = "contender" | "rebuilder" | "tweener";

export interface TeamNeeds {
  archetype: TeamArchetype;
  buyPoints: number;
  buyYouth: number;
  sellPoints: number;
  weakestSlot: string | null;
  shallowPositions: string[];
  surplusPositions: string[];
  rationale: string;
}

export function computeTeamNeeds(
  startersRank: number,
  picksRank: number,
  windowScore: WindowScore,
  rosterPositions: string[],
  players: PlayerWithValue[],
  totalRosters: number
): TeamNeeds {
  let archetype: TeamArchetype = "tweener";
  let buyPoints = 50;
  let buyYouth = 50;
  let sellPoints = 50;
  let rationale = "";

  const startersPct = (startersRank / totalRosters) * 100;
  const picksPct = (picksRank / totalRosters) * 100;

  if (windowScore.isContenderWindow && startersPct <= 40) {
    archetype = "contender";
    buyPoints = 80;
    buyYouth = 20;
    sellPoints = 30;
    rationale = "Strong roster in competitive window - buy production now";
  } else if (windowScore.isRebuildWindow || startersPct > 70) {
    archetype = "rebuilder";
    buyPoints = 20;
    buyYouth = 85;
    sellPoints = 75;
    rationale = "Building for future - accumulate youth and picks";
  } else {
    archetype = "tweener";
    buyPoints = 50;
    buyYouth = 50;
    sellPoints = 50;
    rationale = "Mixed signals - could go either direction";
  }

  const positionCounts: Record<string, number> = {};
  const positions = ["QB", "RB", "WR", "TE"];
  for (const pos of positions) {
    positionCounts[pos] = players.filter(p => p.position === pos).length;
  }

  const slotNeeds: Record<string, number> = {};
  for (const slot of rosterPositions.filter(isStarterSlot)) {
    const eligible = getEligiblePositions(slot);
    for (const pos of eligible) {
      slotNeeds[pos] = (slotNeeds[pos] || 0) + 1;
    }
  }

  const shallowPositions: string[] = [];
  const surplusPositions: string[] = [];
  
  for (const pos of positions) {
    const needed = slotNeeds[pos] || 0;
    const have = positionCounts[pos] || 0;
    const depthBuffer = pos === "QB" ? 1 : 2;
    
    if (have < needed + depthBuffer) {
      shallowPositions.push(pos);
    } else if (have > needed + depthBuffer + 2) {
      surplusPositions.push(pos);
    }
  }

  let weakestSlot: string | null = null;
  let lowestValue = Infinity;
  const starterSlots = rosterPositions.filter(isStarterSlot);
  
  for (const slot of starterSlots) {
    const eligible = getEligiblePositions(slot);
    const slotPlayers = players.filter(p => eligible.includes(p.position));
    const bestValue = slotPlayers.length > 0 ? Math.max(...slotPlayers.map(p => p.value)) : 0;
    if (bestValue < lowestValue) {
      lowestValue = bestValue;
      weakestSlot = slot;
    }
  }

  return {
    archetype,
    buyPoints,
    buyYouth,
    sellPoints,
    weakestSlot,
    shallowPositions,
    surplusPositions,
    rationale,
  };
}

export interface DepthScore {
  overall: number;
  starterQuality: number;
  benchDepth: number;
  fragility: number;
}

export function computeDepthScore(
  lineup: LineupResult,
  players: PlayerWithValue[]
): DepthScore {
  const starterValues = lineup.starters.map(s => s.value);
  const avgStarterValue = starterValues.length > 0 
    ? starterValues.reduce((a, b) => a + b, 0) / starterValues.length 
    : 0;

  const minStarterValue = starterValues.length > 0 ? Math.min(...starterValues) : 0;
  const starterQuality = Math.min(100, avgStarterValue / 10);

  const benchWithValue = lineup.benchPlayers.filter(p => p.value > 0);
  const startableThreshold = minStarterValue * 0.5;
  const startableBench = benchWithValue.filter(p => p.value >= startableThreshold).length;
  const benchDepth = Math.min(100, startableBench * 15);

  const spreadRatio = avgStarterValue > 0 ? minStarterValue / avgStarterValue : 0;
  const fragility = 100 - (spreadRatio * 50 + benchDepth * 0.5);

  const overall = (starterQuality * 0.4) + (benchDepth * 0.4) + ((100 - fragility) * 0.2);

  return {
    overall: Math.min(100, Math.max(0, overall)),
    starterQuality: Math.min(100, Math.max(0, starterQuality)),
    benchDepth: Math.min(100, Math.max(0, benchDepth)),
    fragility: Math.min(100, Math.max(0, fragility)),
  };
}

export interface SurplusPlayer {
  player_id: string;
  player_name: string;
  position: string;
  value: number;
  surplusScore: number;
}

export interface SurplusResult {
  surplus: SurplusPlayer[];
  deficits: string[];
}

export function computeSurplus(
  lineup: LineupResult,
  players: PlayerWithValue[],
  rosterPositions: string[]
): SurplusResult {
  const positions = ["QB", "RB", "WR", "TE"];
  const starterSlots = rosterPositions.filter(isStarterSlot);
  
  const slotNeeds: Record<string, number> = {};
  for (const slot of starterSlots) {
    const eligible = getEligiblePositions(slot);
    for (const pos of eligible) {
      slotNeeds[pos] = (slotNeeds[pos] || 0) + 0.5;
    }
  }

  const starterIds = new Set(lineup.starters.map(s => s.player_id));
  const surplus: SurplusPlayer[] = [];
  const deficits: string[] = [];

  for (const pos of positions) {
    const posPlayers = players.filter(p => p.position === pos);
    const needed = Math.ceil(slotNeeds[pos] || 1);
    const depthBuffer = pos === "QB" ? 1 : 2;
    const targetCount = needed + depthBuffer;

    if (posPlayers.length < targetCount) {
      deficits.push(pos);
    }

    const benchAtPos = posPlayers
      .filter(p => !starterIds.has(p.player_id))
      .sort((a, b) => b.value - a.value);

    const excessCount = Math.max(0, posPlayers.length - targetCount);
    const surplusPlayers = benchAtPos.slice(0, excessCount);

    for (const p of surplusPlayers) {
      surplus.push({
        player_id: p.player_id,
        player_name: p.full_name,
        position: p.position,
        value: p.value,
        surplusScore: p.value * (excessCount / targetCount),
      });
    }
  }

  surplus.sort((a, b) => b.surplusScore - a.surplusScore);

  return { surplus, deficits };
}

export interface TradeSuggestion {
  partnerId: number;
  partnerName: string;
  myAssets: { type: "player" | "pick"; id: string; name: string; value: number }[];
  theirAssets: { type: "player" | "pick"; id: string; name: string; value: number }[];
  myValue: number;
  theirValue: number;
  delta: number;
  rationale: string;
  fitScore: number;
}

export interface EdgeEngineResult {
  rosterId: number;
  ownerName: string;
  lineup: LineupResult;
  windowScore: WindowScore;
  depthScore: DepthScore;
  teamNeeds: TeamNeeds;
  surplus: SurplusResult;
  picksValue: number;
  compositeScore: number;
  rank: number;
}

export const DEFAULT_WEIGHTS = {
  starters: 45,
  bench: 15,
  picks: 15,
  depth: 20,
  age: 5,
};

export function computeCompositeScore(
  startersValue: number,
  benchValue: number,
  picksValue: number,
  depthScore: number,
  ageScore: number,
  weights = DEFAULT_WEIGHTS
): number {
  const maxStarters = 1500;
  const maxBench = 500;
  const maxPicks = 500;

  const startersNorm = Math.min(100, (startersValue / maxStarters) * 100);
  const benchNorm = Math.min(100, (benchValue / maxBench) * 100);
  const picksNorm = Math.min(100, (picksValue / maxPicks) * 100);

  const totalWeight = weights.starters + weights.bench + weights.picks + weights.depth + weights.age;
  
  const score = 
    (startersNorm * weights.starters / totalWeight) +
    (benchNorm * weights.bench / totalWeight) +
    (picksNorm * weights.picks / totalWeight) +
    (depthScore * weights.depth / totalWeight) +
    (ageScore * weights.age / totalWeight);

  return Math.round(score * 10) / 10;
}
