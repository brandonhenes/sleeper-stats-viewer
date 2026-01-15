import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Users, ChevronDown, ChevronRight, Layers, ArrowUpDown, TrendingUp, Hash } from "lucide-react";
import { useLeagueTeams, useAllDraftCapital, useMarketValues } from "@/hooks/use-sleeper";
import { motion } from "framer-motion";

interface TeamsSectionProps {
  leagueId: string | undefined;
  username?: string;
  season?: number;
}

interface Player {
  player_id: string;
  full_name: string;
  position: string | null;
  team: string | null;
}

interface Team {
  roster_id: number;
  owner_id: string;
  display_name: string;
  team_name: string | null;
  record: { wins: number; losses: number; ties: number };
  points_for: number;
  points_against: number;
  players: Player[];
  player_count: number;
}

export function TeamsSection({ leagueId, username, season }: TeamsSectionProps) {
  const [expandedTeams, setExpandedTeams] = useState<Set<number>>(new Set());
  const [showCapital, setShowCapital] = useState(false);
  // Per-team view mode: tracks which teams are showing capital (overrides global)
  const [teamCapitalView, setTeamCapitalView] = useState<Map<number, boolean>>(new Map());
  // Sort mode for roster players: "rank" (FP Rank) or "value" (Trade Value)
  const [sortMode, setSortMode] = useState<"rank" | "value">("rank");

  const { data: teamsData, isLoading: teamsLoading } = useLeagueTeams(leagueId);
  const { data: capitalData, isLoading: capitalLoading } = useAllDraftCapital(leagueId);
  
  // Collect all player IDs from all teams for market values query
  const allPlayerIds = useMemo(() => {
    if (!teamsData?.teams) return [];
    const ids = new Set<string>();
    for (const team of teamsData.teams) {
      for (const player of team.players) {
        ids.add(player.player_id);
      }
    }
    return Array.from(ids);
  }, [teamsData?.teams]);
  
  // Use provided season or default to 2025
  const marketYear = season || 2025;
  const { data: marketData } = useMarketValues(allPlayerIds, { asOf: marketYear, sf: false, tep: false });
  
  // Create a map for quick lookups
  const marketValueMap = useMemo(() => {
    if (!marketData?.values) return new Map<string, { fp_rank: number | null; trade_value: number | null }>();
    return new Map(
      marketData.values.map(v => [v.player_id, { 
        fp_rank: v.fp_rank, 
        trade_value: v.trade_value_effective 
      }])
    );
  }, [marketData?.values]);
  
  // Toggle per-team capital view
  const toggleTeamCapitalView = (rosterId: number, e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setTeamCapitalView(prev => {
      const newMap = new Map(prev);
      const current = newMap.get(rosterId) ?? showCapital;
      newMap.set(rosterId, !current);
      return newMap;
    });
  };
  
  // Get effective view mode for a team (per-team override or global default)
  const getTeamViewMode = (rosterId: number): boolean => {
    if (teamCapitalView.has(rosterId)) {
      return teamCapitalView.get(rosterId)!;
    }
    return showCapital;
  };

  if (!leagueId) {
    return null;
  }

  const toggleTeam = (rosterId: number) => {
    setExpandedTeams(prev => {
      const newSet = new Set(prev);
      if (newSet.has(rosterId)) {
        newSet.delete(rosterId);
      } else {
        newSet.add(rosterId);
      }
      return newSet;
    });
  };

  const formatRecord = (record: { wins: number; losses: number; ties: number }) => {
    if (record.ties > 0) {
      return `${record.wins}-${record.losses}-${record.ties}`;
    }
    return `${record.wins}-${record.losses}`;
  };

  const positionColor = (pos: string | null) => {
    switch (pos) {
      case "QB": return "bg-red-500/20 text-red-700 dark:text-red-300";
      case "RB": return "bg-green-500/20 text-green-700 dark:text-green-300";
      case "WR": return "bg-blue-500/20 text-blue-700 dark:text-blue-300";
      case "TE": return "bg-orange-500/20 text-orange-700 dark:text-orange-300";
      case "K": return "bg-purple-500/20 text-purple-700 dark:text-purple-300";
      case "DEF": return "bg-gray-500/20 text-gray-700 dark:text-gray-300";
      default: return "bg-gray-500/20 text-gray-700 dark:text-gray-300";
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.4 }}
      className="mt-8"
    >
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-display font-bold">Teams</h2>
        </div>
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => {
            setShowCapital(!showCapital);
            setTeamCapitalView(new Map()); // Reset per-team overrides
          }}
          data-testid="button-toggle-capital"
        >
          <Layers className="w-4 h-4 mr-2" />
          {showCapital ? "Show Rosters" : "Show Draft Capital"}
        </Button>
      </div>

      {teamsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="ml-3 text-muted-foreground">Loading teams...</span>
        </div>
      ) : teamsData && teamsData.teams ? (
        <div className="space-y-3">
          {teamsData.teams.map((team: Team) => {
            const isCurrentUser = username && team.display_name?.toLowerCase() === username.toLowerCase();
            const isExpanded = expandedTeams.has(team.roster_id);
            
            // Get capital data for this team
            const teamCapital = capitalData?.rosters?.find((r: any) => r.roster_id === team.roster_id);

            return (
              <Collapsible
                key={team.roster_id}
                open={isExpanded}
                onOpenChange={() => toggleTeam(team.roster_id)}
              >
                <Card 
                  className={`overflow-visible ${isCurrentUser ? "ring-2 ring-primary/50" : ""}`}
                  data-testid={`card-team-${team.roster_id}`}
                >
                  <CollapsibleTrigger asChild>
                    <div className="flex items-center justify-between p-4 cursor-pointer hover-elevate">
                      <div className="flex items-center gap-4 flex-1">
                        <Button variant="ghost" size="icon" className="shrink-0">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </Button>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold truncate" data-testid={`text-team-name-${team.roster_id}`}>
                              {team.display_name}
                            </span>
                            {isCurrentUser && (
                              <Badge variant="secondary" className="text-xs">You</Badge>
                            )}
                          </div>
                          {team.team_name && team.team_name !== team.display_name && (
                            <span className="text-sm text-muted-foreground truncate block">
                              {team.team_name}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        <div className="text-right">
                          <div className="font-mono font-bold" data-testid={`text-record-${team.roster_id}`}>
                            {formatRecord(team.record)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {team.points_for != null ? team.points_for.toFixed(1) : "—"} PF
                          </div>
                        </div>
                        
                        <Badge variant="outline" className="font-mono">
                          {team.player_count} players
                        </Badge>
                      </div>
                    </div>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="border-t p-4">
                      {/* Per-team toggle + sort controls */}
                      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground mr-1">Sort:</span>
                          <Button
                            variant={sortMode === "rank" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); setSortMode("rank"); }}
                            data-testid={`button-sort-rank-${team.roster_id}`}
                          >
                            <Hash className="w-3 h-3 mr-1" />
                            Rank
                          </Button>
                          <Button
                            variant={sortMode === "value" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); setSortMode("value"); }}
                            data-testid={`button-sort-value-${team.roster_id}`}
                          >
                            <TrendingUp className="w-3 h-3 mr-1" />
                            Value
                          </Button>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => toggleTeamCapitalView(team.roster_id, e)}
                          data-testid={`button-team-toggle-${team.roster_id}`}
                        >
                          <Layers className="w-3 h-3 mr-1" />
                          {getTeamViewMode(team.roster_id) ? "Roster" : "Capital"}
                        </Button>
                      </div>
                      {!getTeamViewMode(team.roster_id) ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                          {[...team.players]
                            .sort((a, b) => {
                              const mvA = marketValueMap.get(a.player_id);
                              const mvB = marketValueMap.get(b.player_id);
                              if (sortMode === "rank") {
                                const rA = mvA?.fp_rank ?? 999;
                                const rB = mvB?.fp_rank ?? 999;
                                return rA - rB;
                              } else {
                                const vA = mvA?.trade_value ?? 0;
                                const vB = mvB?.trade_value ?? 0;
                                return vB - vA;
                              }
                            })
                            .map((player) => {
                              const mv = marketValueMap.get(player.player_id);
                              return (
                                <div 
                                  key={player.player_id}
                                  className="flex flex-col gap-1 p-2 rounded-md bg-muted/50"
                                  data-testid={`player-${team.roster_id}-${player.player_id}`}
                                >
                                  <div className="flex items-center gap-2">
                                    <Badge 
                                      variant="outline" 
                                      className={`text-xs shrink-0 ${positionColor(player.position)}`}
                                    >
                                      {player.position || "?"}
                                    </Badge>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-medium truncate">
                                        {player.full_name}
                                      </div>
                                      {player.team && (
                                        <div className="text-xs text-muted-foreground">
                                          {player.team}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  {mv && (mv.fp_rank || mv.trade_value) && (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                                      {mv.fp_rank && (
                                        <span className="flex items-center gap-0.5">
                                          <Hash className="w-3 h-3" />
                                          {mv.fp_rank}
                                        </span>
                                      )}
                                      {mv.trade_value && (
                                        <span className="flex items-center gap-0.5">
                                          <TrendingUp className="w-3 h-3" />
                                          {mv.trade_value}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      ) : teamCapital ? (
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-sm font-medium">Draft Capital</span>
                            <Badge variant="default">
                              Hoard Index: {teamCapital.pick_hoard_index}
                            </Badge>
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Year</TableHead>
                                <TableHead className="text-center">R1</TableHead>
                                <TableHead className="text-center">R2</TableHead>
                                <TableHead className="text-center">R3</TableHead>
                                <TableHead className="text-center">R4</TableHead>
                                <TableHead className="text-center">Total</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {capitalData.years.map((year: number) => (
                                <TableRow key={year}>
                                  <TableCell className="font-mono">{year}</TableCell>
                                  <TableCell className="text-center font-mono">
                                    {teamCapital.by_year[year]?.r1 || 0}
                                  </TableCell>
                                  <TableCell className="text-center font-mono">
                                    {teamCapital.by_year[year]?.r2 || 0}
                                  </TableCell>
                                  <TableCell className="text-center font-mono">
                                    {teamCapital.by_year[year]?.r3 || 0}
                                  </TableCell>
                                  <TableCell className="text-center font-mono">
                                    {teamCapital.by_year[year]?.r4 || 0}
                                  </TableCell>
                                  <TableCell className="text-center font-mono font-bold">
                                    {teamCapital.by_year[year]?.total || 0}
                                  </TableCell>
                                </TableRow>
                              ))}
                              <TableRow className="bg-muted/50">
                                <TableCell className="font-bold">Totals</TableCell>
                                <TableCell className="text-center font-mono font-bold">
                                  {teamCapital.totals.r1}
                                </TableCell>
                                <TableCell className="text-center font-mono font-bold">
                                  {teamCapital.totals.r2}
                                </TableCell>
                                <TableCell className="text-center font-mono font-bold">
                                  {teamCapital.totals.r3}
                                </TableCell>
                                <TableCell className="text-center font-mono font-bold">
                                  {teamCapital.totals.r4}
                                </TableCell>
                                <TableCell className="text-center font-mono font-bold">
                                  {teamCapital.totals.total}
                                </TableCell>
                              </TableRow>
                            </TableBody>
                          </Table>
                        </div>
                      ) : capitalLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="w-4 h-4 animate-spin" />
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No draft capital data available</p>
                      )}
                    </div>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          })}
        </div>
      ) : (
        <Card className="p-6 text-center text-muted-foreground">
          <p>No teams found for this league.</p>
        </Card>
      )}
    </motion.div>
  );
}
