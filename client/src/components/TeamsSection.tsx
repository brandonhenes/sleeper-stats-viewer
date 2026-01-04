import { useState } from "react";
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
import { Loader2, Users, ChevronDown, ChevronRight, Layers } from "lucide-react";
import { useLeagueTeams, useAllDraftCapital } from "@/hooks/use-sleeper";
import { motion } from "framer-motion";

interface TeamsSectionProps {
  leagueId: string | undefined;
  username?: string;
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

export function TeamsSection({ leagueId, username }: TeamsSectionProps) {
  const [expandedTeams, setExpandedTeams] = useState<Set<number>>(new Set());
  const [showCapital, setShowCapital] = useState(false);

  const { data: teamsData, isLoading: teamsLoading } = useLeagueTeams(leagueId);
  const { data: capitalData, isLoading: capitalLoading } = useAllDraftCapital(leagueId);

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
          onClick={() => setShowCapital(!showCapital)}
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
                            {team.points_for?.toFixed(1)} PF
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
                      {!showCapital ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                          {team.players.map((player) => (
                            <div 
                              key={player.player_id}
                              className="flex items-center gap-2 p-2 rounded-md bg-muted/50"
                              data-testid={`player-${team.roster_id}-${player.player_id}`}
                            >
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
                          ))}
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
