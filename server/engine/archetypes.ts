import { getAgeCurveStatus, AgeCurveStatus } from "./ageCurves";

export interface ArchetypeConfig {
  dynastyJuggernaut: { powerMin: number; windowMin: number };
  allInContender: { powerMin: number; draftMax: number };
  fragileContender: { powerMin: number; windowMax: number };
  productiveStruggle: { lowNowMax: number; draftMin: number; windowMin: number };
  rebuilder: { powerMax: number };
  deadZone: { powerMin: number; powerMax: number; draftMax: number; windowMax: number };
}

export const DEFAULT_ARCHETYPE_CONFIG: ArchetypeConfig = {
  dynastyJuggernaut: { powerMin: 80, windowMin: 70 },
  allInContender: { powerMin: 75, draftMax: 40 },
  fragileContender: { powerMin: 70, windowMax: 40 },
  productiveStruggle: { lowNowMax: 40, draftMin: 70, windowMin: 60 },
  rebuilder: { powerMax: 30 },
  deadZone: { powerMin: 40, powerMax: 60, draftMax: 50, windowMax: 50 },
};

export interface ArchetypeResult {
  archetype: string;
  reasons: string[];
}

export interface RosterAxes {
  roster_id: number;
  owner_id: string | null;
  display_name: string;
  
  starters_value: number;
  starters_coverage_pct: number;
  power_pct: number;
  
  draft_value: number;
  draft_pct: number;
  
  window_core_raw: number;
  window_core_pct: number;
  window_core_coverage_pct: number;
  
  window_total_raw: number;
  window_total_pct: number;
  window_total_coverage_pct: number;
  
  max_pf: number | null;
  max_pf_pct: number | null;
  
  archetype: string;
  reasons: string[];
  
  core_assets: CoreAsset[];
}

export interface CoreAsset {
  player_id: string;
  full_name: string;
  position: string;
  value: number;
  age: number | null;
  age_curve: AgeCurveStatus;
}

export function percentileRank(valuesArray: number[], value: number): number {
  if (valuesArray.length === 0) return 50;
  if (valuesArray.length === 1) return 50;
  
  const sorted = [...valuesArray].sort((a, b) => a - b);
  let count = 0;
  for (const v of sorted) {
    if (v < value) count++;
  }
  return (count / sorted.length) * 100;
}

export function classifyArchetype(
  powerPct: number,
  draftPct: number,
  windowPct: number,
  maxPfPct: number | null,
  config: ArchetypeConfig = DEFAULT_ARCHETYPE_CONFIG
): ArchetypeResult {
  const reasons: string[] = [];
  
  const powerLabel = powerPct >= 80 ? "elite starters" 
    : powerPct >= 60 ? "strong starters" 
    : powerPct >= 40 ? "average starters" 
    : "weak starters";
  reasons.push(`Power ${Math.round(powerPct)}th pct (${powerLabel})`);
  
  const windowLabel = windowPct >= 70 ? "young core" 
    : windowPct >= 50 ? "prime window" 
    : windowPct >= 30 ? "aging core" 
    : "declining core";
  reasons.push(`Window ${Math.round(windowPct)}th pct (${windowLabel})`);
  
  const draftLabel = draftPct >= 70 ? "loaded with picks" 
    : draftPct >= 50 ? "decent capital" 
    : draftPct >= 30 ? "low capital" 
    : "no ammo";
  reasons.push(`Draft ${Math.round(draftPct)}th pct (${draftLabel})`);
  
  if (maxPfPct !== null) {
    const maxPfLabel = maxPfPct < 30 ? "intentional tank profile" 
      : maxPfPct < 50 ? "underperforming" 
      : "competitive";
    reasons.push(`MaxPF ${Math.round(maxPfPct)}th pct (${maxPfLabel})`);
  }

  if (powerPct > config.dynastyJuggernaut.powerMin && windowPct > config.dynastyJuggernaut.windowMin) {
    return { archetype: "Dynasty Juggernaut", reasons: reasons.slice(0, 4) };
  }

  if (powerPct > config.allInContender.powerMin && draftPct < config.allInContender.draftMax) {
    return { archetype: "All-In Contender", reasons: reasons.slice(0, 4) };
  }

  if (powerPct > config.fragileContender.powerMin && windowPct < config.fragileContender.windowMax) {
    return { archetype: "Fragile Contender", reasons: reasons.slice(0, 4) };
  }

  const lowNow = maxPfPct !== null ? maxPfPct : powerPct;
  if (lowNow < config.productiveStruggle.lowNowMax && 
      draftPct > config.productiveStruggle.draftMin && 
      windowPct > config.productiveStruggle.windowMin) {
    return { archetype: "Productive Struggle", reasons: reasons.slice(0, 4) };
  }

  if (powerPct < config.rebuilder.powerMax) {
    return { archetype: "Rebuilder", reasons: reasons.slice(0, 4) };
  }

  if (powerPct >= config.deadZone.powerMin && 
      powerPct <= config.deadZone.powerMax && 
      draftPct < config.deadZone.draftMax && 
      windowPct < config.deadZone.windowMax) {
    return { archetype: "Dead Zone", reasons: reasons.slice(0, 4) };
  }

  return { archetype: "Competitor", reasons: reasons.slice(0, 4) };
}

export interface PlayerWithValue {
  player_id: string;
  full_name: string;
  position: string;
  age: number | null;
  value: number;
}

export function computeValueWeightedWindow(
  players: PlayerWithValue[]
): { raw: number; coverage_pct: number } {
  const eligiblePlayers = players.filter(p => p.value > 0);
  
  if (eligiblePlayers.length === 0) {
    return { raw: 0, coverage_pct: 0 };
  }
  
  let numerator = 0;
  let denominator = 0;
  
  for (const p of eligiblePlayers) {
    const ageStatus = getAgeCurveStatus(p.position, p.age);
    numerator += p.value * ageStatus.score;
    denominator += p.value;
  }
  
  if (denominator === 0) {
    return { raw: 0, coverage_pct: 0 };
  }
  
  const raw = numerator / denominator;
  const coverage_pct = (eligiblePlayers.length / Math.max(1, players.length)) * 100;
  
  return { raw, coverage_pct };
}

export function selectCoreAssets(
  players: PlayerWithValue[],
  startersCount: number
): PlayerWithValue[] {
  const coreN = Math.min(12, startersCount + 3);
  const sorted = [...players].sort((a, b) => b.value - a.value);
  return sorted.slice(0, coreN);
}

export function isStarterSlot(slot: string): boolean {
  return !["BN", "IR", "TAXI"].includes(slot);
}

export function countStarterSlots(rosterPositions: string[]): number {
  return rosterPositions.filter(isStarterSlot).length;
}

export function isSuperflexFromPositions(rosterPositions: string[]): boolean {
  if (rosterPositions.includes("SUPER_FLEX")) return true;
  const qbCount = rosterPositions.filter(p => p === "QB").length;
  return qbCount >= 2;
}
