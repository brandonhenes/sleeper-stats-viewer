export type AgeCurveZone = "Ascent" | "Prime" | "Decline" | "Cliff" | "Unknown";
export type AgeCurveColor = "blue" | "green" | "gold" | "orange" | "red" | "gray";

export interface AgeCurveStatus {
  age: number | null;
  position: string;
  score: number;
  zone: AgeCurveZone;
  color: AgeCurveColor;
  label: string;
  prime_start: number | null;
  prime_end: number | null;
  dot_pct: number;
}

interface CurveEntry {
  score: number;
  zone: AgeCurveZone;
}

const RB_CURVE: Record<number, CurveEntry> = {
  20: { score: 60, zone: "Ascent" },
  21: { score: 75, zone: "Ascent" },
  22: { score: 90, zone: "Ascent" },
  23: { score: 100, zone: "Prime" },
  24: { score: 100, zone: "Prime" },
  25: { score: 100, zone: "Prime" },
  26: { score: 100, zone: "Prime" },
  27: { score: 85, zone: "Decline" },
  28: { score: 70, zone: "Decline" },
};

const WR_CURVE: Record<number, CurveEntry> = {
  21: { score: 70, zone: "Ascent" },
  22: { score: 80, zone: "Ascent" },
  23: { score: 90, zone: "Ascent" },
  24: { score: 100, zone: "Prime" },
  25: { score: 100, zone: "Prime" },
  26: { score: 100, zone: "Prime" },
  27: { score: 100, zone: "Prime" },
  28: { score: 100, zone: "Prime" },
  29: { score: 85, zone: "Decline" },
  30: { score: 85, zone: "Decline" },
  31: { score: 70, zone: "Decline" },
};

const TE_CURVE: Record<number, CurveEntry> = {
  21: { score: 60, zone: "Ascent" },
  22: { score: 70, zone: "Ascent" },
  23: { score: 80, zone: "Ascent" },
  24: { score: 85, zone: "Ascent" },
  25: { score: 100, zone: "Prime" },
  26: { score: 100, zone: "Prime" },
  27: { score: 100, zone: "Prime" },
  28: { score: 100, zone: "Prime" },
  29: { score: 100, zone: "Prime" },
  30: { score: 100, zone: "Prime" },
  31: { score: 80, zone: "Decline" },
  32: { score: 80, zone: "Decline" },
};

const QB_CURVE: Record<number, CurveEntry> = {
  21: { score: 70, zone: "Ascent" },
  22: { score: 75, zone: "Ascent" },
  23: { score: 80, zone: "Ascent" },
  24: { score: 85, zone: "Ascent" },
  25: { score: 90, zone: "Ascent" },
  26: { score: 100, zone: "Prime" },
  27: { score: 100, zone: "Prime" },
  28: { score: 100, zone: "Prime" },
  29: { score: 100, zone: "Prime" },
  30: { score: 100, zone: "Prime" },
  31: { score: 100, zone: "Prime" },
  32: { score: 100, zone: "Prime" },
  33: { score: 100, zone: "Prime" },
  34: { score: 85, zone: "Decline" },
  35: { score: 85, zone: "Decline" },
  36: { score: 85, zone: "Decline" },
};

const POSITION_PRIMES: Record<string, { start: number; end: number; cliffAge: number; cliffScore: number }> = {
  RB: { start: 23, end: 26, cliffAge: 29, cliffScore: 45 },
  WR: { start: 24, end: 28, cliffAge: 32, cliffScore: 45 },
  TE: { start: 25, end: 30, cliffAge: 33, cliffScore: 45 },
  QB: { start: 26, end: 33, cliffAge: 37, cliffScore: 55 },
};

function getCurveForPosition(position: string): Record<number, CurveEntry> | null {
  switch (position) {
    case "RB": return RB_CURVE;
    case "WR": return WR_CURVE;
    case "TE": return TE_CURVE;
    case "QB": return QB_CURVE;
    default: return null;
  }
}

function getColorFromZoneAndScore(zone: AgeCurveZone, score: number): AgeCurveColor {
  if (zone === "Ascent" && score < 75) return "blue";
  if (zone === "Ascent" && score >= 75) return "green";
  if (zone === "Prime") return "gold";
  if (zone === "Decline") return "orange";
  if (zone === "Cliff") return "red";
  return "gray";
}

export function getAgeCurveStatus(position: string, age: number | null | undefined): AgeCurveStatus {
  const normalizedPosition = position?.toUpperCase() || "";
  
  if (age === null || age === undefined || !Number.isFinite(age)) {
    return {
      age: null,
      position: normalizedPosition,
      score: 0,
      zone: "Unknown",
      color: "gray",
      label: "Unknown",
      prime_start: null,
      prime_end: null,
      dot_pct: 0,
    };
  }

  const primeInfo = POSITION_PRIMES[normalizedPosition];
  if (!primeInfo) {
    return {
      age,
      position: normalizedPosition,
      score: 0,
      zone: "Unknown",
      color: "gray",
      label: "Unknown",
      prime_start: null,
      prime_end: null,
      dot_pct: 0,
    };
  }

  const curve = getCurveForPosition(normalizedPosition);
  if (!curve) {
    return {
      age,
      position: normalizedPosition,
      score: 0,
      zone: "Unknown",
      color: "gray",
      label: "Unknown",
      prime_start: null,
      prime_end: null,
      dot_pct: 0,
    };
  }

  let score: number;
  let zone: AgeCurveZone;

  if (age >= primeInfo.cliffAge) {
    score = primeInfo.cliffScore;
    zone = "Cliff";
  } else if (curve[age]) {
    score = curve[age].score;
    zone = curve[age].zone;
  } else if (age < Math.min(...Object.keys(curve).map(Number))) {
    const minAge = Math.min(...Object.keys(curve).map(Number));
    score = curve[minAge].score;
    zone = "Ascent";
  } else {
    score = primeInfo.cliffScore;
    zone = "Cliff";
  }

  const color = getColorFromZoneAndScore(zone, score);
  const label = zone === "Prime" 
    ? `Prime (${primeInfo.start}–${primeInfo.end})`
    : zone === "Unknown"
    ? "Unknown"
    : zone;

  return {
    age,
    position: normalizedPosition,
    score,
    zone,
    color,
    label,
    prime_start: primeInfo.start,
    prime_end: primeInfo.end,
    dot_pct: Math.min(1, Math.max(0, score / 100)),
  };
}

export function getPositionPrimeLabel(position: string): string {
  const primeInfo = POSITION_PRIMES[position?.toUpperCase()];
  if (!primeInfo) return "Unknown";
  return `Prime (${primeInfo.start}–${primeInfo.end})`;
}
