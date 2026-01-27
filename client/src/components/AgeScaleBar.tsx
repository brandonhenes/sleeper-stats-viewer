import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface AgeCurveStatus {
  age: number | null;
  position: string;
  score: number;
  zone: "Ascent" | "Prime" | "Decline" | "Cliff" | "Unknown";
  color: "blue" | "green" | "gold" | "orange" | "red" | "gray";
  label: string;
  prime_start: number | null;
  prime_end: number | null;
  dot_pct: number;
}

interface AgeScaleBarProps {
  ageCurve: AgeCurveStatus;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
}

const zoneColors: Record<string, { bg: string; text: string; border: string }> = {
  blue: { bg: "bg-blue-500", text: "text-blue-500", border: "border-blue-500" },
  green: { bg: "bg-green-500", text: "text-green-500", border: "border-green-500" },
  gold: { bg: "bg-amber-400", text: "text-amber-500", border: "border-amber-400" },
  orange: { bg: "bg-orange-500", text: "text-orange-500", border: "border-orange-500" },
  red: { bg: "bg-red-500", text: "text-red-500", border: "border-red-500" },
  gray: { bg: "bg-gray-400", text: "text-gray-500", border: "border-gray-400" },
};

const zoneBgGradients: Record<string, string> = {
  Ascent: "bg-gradient-to-r from-blue-200 via-green-200 to-green-300",
  Prime: "bg-gradient-to-r from-amber-200 to-amber-300",
  Decline: "bg-gradient-to-r from-orange-200 to-orange-300",
  Cliff: "bg-gradient-to-r from-red-200 to-red-300",
  Unknown: "bg-gray-200",
};

export function AgeScaleBar({ ageCurve, showLabel = true, size = "md" }: AgeScaleBarProps) {
  const colors = zoneColors[ageCurve.color] || zoneColors.gray;
  
  const heightClass = size === "sm" ? "h-2" : size === "lg" ? "h-4" : "h-3";
  const dotSize = size === "sm" ? "w-2 h-2" : size === "lg" ? "w-4 h-4" : "w-3 h-3";
  
  const primeLabel = ageCurve.prime_start && ageCurve.prime_end 
    ? `Prime ${ageCurve.prime_start}–${ageCurve.prime_end}`
    : "Unknown";
  
  const tooltipText = ageCurve.age !== null
    ? `Age ${ageCurve.age} (${ageCurve.position}) — ${ageCurve.zone} — ${ageCurve.score}/100 — ${primeLabel}`
    : `${ageCurve.position} — Unknown`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div 
          className="flex items-center gap-2 cursor-help" 
          data-testid={`age-scale-bar-${ageCurve.position}`}
        >
          <div className={`relative flex-1 min-w-16 rounded-full ${heightClass} bg-gradient-to-r from-blue-200 via-amber-200 via-60% to-red-200 dark:from-blue-900 dark:via-amber-800 dark:to-red-900`}>
            <div 
              className={`absolute ${dotSize} rounded-full ${colors.bg} border-2 border-white dark:border-gray-800 shadow-sm transform -translate-y-1/2 top-1/2`}
              style={{ left: `calc(${ageCurve.dot_pct * 100}% - ${size === "sm" ? "4px" : size === "lg" ? "8px" : "6px"})` }}
            />
          </div>
          {showLabel && (
            <span className={`text-xs font-medium ${colors.text} whitespace-nowrap`}>
              {ageCurve.zone === "Unknown" ? "?" : ageCurve.score}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="text-sm">{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  );
}

interface ArchetypeBadgeProps {
  archetype: string;
  reasons?: string[];
  size?: "sm" | "md" | "lg";
}

const archetypeStyles: Record<string, { bg: string; text: string; border: string }> = {
  "Dynasty Juggernaut": { 
    bg: "bg-purple-100 dark:bg-purple-900/30", 
    text: "text-purple-700 dark:text-purple-300", 
    border: "border-purple-300 dark:border-purple-700" 
  },
  "All-In Contender": { 
    bg: "bg-green-100 dark:bg-green-900/30", 
    text: "text-green-700 dark:text-green-300", 
    border: "border-green-300 dark:border-green-700" 
  },
  "Fragile Contender": { 
    bg: "bg-amber-100 dark:bg-amber-900/30", 
    text: "text-amber-700 dark:text-amber-300", 
    border: "border-amber-300 dark:border-amber-700" 
  },
  "Productive Struggle": { 
    bg: "bg-blue-100 dark:bg-blue-900/30", 
    text: "text-blue-700 dark:text-blue-300", 
    border: "border-blue-300 dark:border-blue-700" 
  },
  "Rebuilder": { 
    bg: "bg-orange-100 dark:bg-orange-900/30", 
    text: "text-orange-700 dark:text-orange-300", 
    border: "border-orange-300 dark:border-orange-700" 
  },
  "Dead Zone": { 
    bg: "bg-gray-100 dark:bg-gray-800/50", 
    text: "text-gray-600 dark:text-gray-400", 
    border: "border-gray-300 dark:border-gray-600" 
  },
  "Competitor": { 
    bg: "bg-slate-100 dark:bg-slate-800/50", 
    text: "text-slate-700 dark:text-slate-300", 
    border: "border-slate-300 dark:border-slate-600" 
  },
};

export function ArchetypeBadge({ archetype, reasons, size = "md" }: ArchetypeBadgeProps) {
  const style = archetypeStyles[archetype] || archetypeStyles["Competitor"];
  
  const sizeClasses = size === "sm" 
    ? "text-xs px-1.5 py-0.5" 
    : size === "lg" 
    ? "text-sm px-3 py-1.5" 
    : "text-xs px-2 py-1";

  if (reasons && reasons.length > 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span 
            className={`inline-flex items-center rounded-md border font-medium cursor-help ${style.bg} ${style.text} ${style.border} ${sizeClasses}`}
            data-testid={`archetype-badge-${archetype.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {archetype}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <ul className="text-xs space-y-0.5">
            {reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <span 
      className={`inline-flex items-center rounded-md border font-medium ${style.bg} ${style.text} ${style.border} ${sizeClasses}`}
      data-testid={`archetype-badge-${archetype.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {archetype}
    </span>
  );
}

interface PercentileBarProps {
  label: string;
  value: number;
  color?: "blue" | "green" | "amber" | "orange" | "red" | "gray";
}

export function PercentileBar({ label, value, color = "blue" }: PercentileBarProps) {
  const colorClasses: Record<string, string> = {
    blue: "bg-blue-500",
    green: "bg-green-500",
    amber: "bg-amber-500",
    orange: "bg-orange-500",
    red: "bg-red-500",
    gray: "bg-gray-500",
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-16 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div 
          className={`h-full ${colorClasses[color]} rounded-full transition-all`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <span className="text-xs font-medium w-10 text-right">{Math.round(value)}%</span>
    </div>
  );
}
