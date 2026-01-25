import { useParams } from "wouter";
import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Zap, TrendingUp, Target, Users, Settings, Loader2, ChevronDown, ChevronUp, AlertCircle, ArrowUp, ArrowDown } from "lucide-react";
import { useSleeperOverview, useEdgeEngine, EdgeEngineWeights } from "@/hooks/use-sleeper";
import { motion } from "framer-motion";
import { useState, useMemo } from "react";
import { Slider } from "@/components/ui/slider";

function fmtNum(v: unknown, decimals = 1, fallback = "—"): string {
  if (v == null) return fallback;
  const num = Number(v);
  if (Number.isNaN(num)) return fallback;
  return num.toFixed(decimals);
}

function getConfidenceBadge(coverage: number): { label: string; variant: "default" | "secondary" | "destructive" } {
  if (coverage >= 0.8) return { label: "High", variant: "default" };
  if (coverage >= 0.5) return { label: "Med", variant: "secondary" };
  return { label: "Low", variant: "destructive" };
}

function getArchetypeInfo(archetype: string): { label: string; color: string; description: string } {
  switch (archetype) {
    case "all-in-contender":
      return { label: "All-In Contender", color: "text-green-600", description: "Maximized to win now" };
    case "fragile-contender":
      return { label: "Fragile Contender", color: "text-yellow-600", description: "Competitive but aging core" };
    case "productive-struggle":
      return { label: "Productive Struggle", color: "text-blue-600", description: "Building while competing" };
    case "dead-zone":
      return { label: "Dead Zone", color: "text-red-600", description: "Stuck in the middle" };
    case "rebuilder":
      return { label: "Rebuilder", color: "text-purple-600", description: "Accumulating youth & picks" };
    default:
      return { label: archetype || "Unknown", color: "text-muted-foreground", description: "" };
  }
}

type SortField = "rank" | "starters" | "bench" | "maxPf" | "picks" | "age" | "efficiency";
type SortDir = "asc" | "desc";

export default function EdgeEngine() {
  const { username } = useParams<{ username: string }>();
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedTeam, setExpandedTeam] = useState<number | null>(null);
  const [sortField, setSortField] = useState<SortField>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  
  const [weights, setWeights] = useState<EdgeEngineWeights>({
    starters: 45,
    bench: 15,
    maxPf: 15,
    picks: 20,
    age: 5
  });

  const { data: overview, isLoading: loadingOverview } = useSleeperOverview(username);
  
  const groups = overview?.league_groups ?? [];
  const activeGroup = groups.find((g: any) => g.group_id === selectedLeague) ?? groups[0];
  const activeLeagueId = activeGroup?.latest_league_id ?? activeGroup?.league_ids?.[activeGroup?.league_ids?.length - 1];
  
  const { data: edgeData, isLoading: loadingEdge } = useEdgeEngine(activeLeagueId, username, weights);

  const handleWeightChange = (key: keyof typeof weights, value: number) => {
    const total = Object.values(weights).reduce((a, b) => a + b, 0) - weights[key] + value;
    if (total <= 100) {
      setWeights(prev => ({ ...prev, [key]: value }));
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir(field === "rank" ? "asc" : "desc");
    }
  };

  const teams = edgeData?.teams ?? [];
  
  const sortedTeams = useMemo(() => {
    const getValue = (t: any) => {
      switch (sortField) {
        case "rank": return t.rank ?? 0;
        case "starters": return t.starters_value ?? 0;
        case "bench": return t.bench_value ?? 0;
        case "maxPf": return t.max_pf ?? 0;
        case "picks": return t.picks_value ?? 0;
        case "age": return t.age_score ?? 0;
        case "efficiency": return t.max_pf > 0 ? (t.actual_pf / t.max_pf) * 100 : 0;
        default: return 0;
      }
    };
    return [...teams].sort((a, b) => {
      const aVal = getValue(a);
      const bVal = getValue(b);
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });
  }, [teams, sortField, sortDir]);
  
  const myTeam = teams.find(t => t.roster_id === edgeData?.my_roster_id);
  const tradeMatches = useMemo(() => {
    if (!myTeam) return [];
    const mySurplus = myTeam.surplus_players ?? [];
    const myDeficits = myTeam.deficit_positions ?? [];
    
    const matches: Array<{
      target_team: string;
      their_need: string;
      your_surplus: string;
      suggested_framework: string;
    }> = [];
    
    for (const otherTeam of teams) {
      if (otherTeam.roster_id === myTeam.roster_id) continue;
      const theirDeficits = otherTeam.deficit_positions ?? [];
      const theirSurplus = otherTeam.surplus_players ?? [];
      
      for (const surplusPlayer of mySurplus) {
        if (theirDeficits.includes(surplusPlayer.position)) {
          const theyCanGive = theirSurplus.find(p => myDeficits.includes(p.position));
          matches.push({
            target_team: otherTeam.owner_name || `Team ${otherTeam.roster_id}`,
            their_need: surplusPlayer.position,
            your_surplus: surplusPlayer.player_name,
            suggested_framework: theyCanGive 
              ? `Your ${surplusPlayer.player_name} → Their ${theyCanGive.player_name}`
              : `Your ${surplusPlayer.player_name} for their ${surplusPlayer.position} need`
          });
        }
      }
    }
    return matches.slice(0, 10);
  }, [teams, myTeam]);

  return (
    <Layout username={username}>
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <Zap className="w-8 h-8 text-yellow-500" />
              <div>
                <h1 className="text-3xl font-bold">Edge Engine</h1>
                <p className="text-muted-foreground">Find your competitive advantages</p>
              </div>
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setShowSettings(!showSettings)}
              data-testid="button-settings-toggle"
            >
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </Button>
          </div>

          {groups.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {groups.map((group: any) => (
                <Badge
                  key={group.group_id}
                  variant={activeGroup?.group_id === group.group_id ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setSelectedLeague(group.group_id)}
                  data-testid={`badge-league-${group.group_id}`}
                >
                  {group.name}
                </Badge>
              ))}
            </div>
          )}

          {showSettings && (
            <Card className="p-4">
              <h3 className="font-semibold mb-4">Power Ranking Weights</h3>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {[
                  { key: "starters", label: "Starters Value" },
                  { key: "bench", label: "Bench Value" },
                  { key: "maxPf", label: "Max PF (Luck)" },
                  { key: "picks", label: "Draft Capital" },
                  { key: "age", label: "Age Window" }
                ].map(({ key, label }) => (
                  <div key={key} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>{label}</span>
                      <span className="font-medium">{weights[key as keyof typeof weights]}%</span>
                    </div>
                    <Slider
                      value={[weights[key as keyof typeof weights]]}
                      onValueChange={([v]) => handleWeightChange(key as keyof typeof weights, v)}
                      max={100}
                      step={5}
                      data-testid={`slider-weight-${key}`}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 text-sm text-muted-foreground">
                Total: {Object.values(weights).reduce((a, b) => a + b, 0)}%
              </div>
            </Card>
          )}

          <Tabs defaultValue="rankings" className="w-full">
            <TabsList className="w-full justify-start overflow-x-auto flex-wrap h-auto gap-1 bg-muted/50 p-1">
              <TabsTrigger value="rankings" className="gap-1" data-testid="edge-tab-rankings">
                <TrendingUp className="w-3 h-3" />
                Power Rankings
              </TabsTrigger>
              <TabsTrigger value="radar" className="gap-1" data-testid="edge-tab-radar">
                <Target className="w-3 h-3" />
                Trade Radar
              </TabsTrigger>
              <TabsTrigger value="needs" className="gap-1" data-testid="edge-tab-needs">
                <Users className="w-3 h-3" />
                Team Needs
              </TabsTrigger>
            </TabsList>

            <TabsContent value="rankings" className="mt-6">
              {loadingEdge ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold">True Power Rankings</h2>
                    <Badge variant="outline" className="text-xs">
                      {weights.starters}/{weights.bench}/{weights.maxPf}/{weights.picks}/{weights.age} Formula
                    </Badge>
                  </div>
                  
                  {sortedTeams.length ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2 overflow-x-auto flex-wrap">
                        <span className="mr-2">Sort by:</span>
                        {[
                          { key: "rank", label: "Rank" },
                          { key: "starters", label: "Starters" },
                          { key: "bench", label: "Bench" },
                          { key: "maxPf", label: "Max PF" },
                          { key: "picks", label: "Picks" },
                          { key: "age", label: "Age" },
                          { key: "efficiency", label: "Efficiency" },
                        ].map(({ key, label }) => (
                          <Button
                            key={key}
                            variant={sortField === key ? "default" : "ghost"}
                            size="sm"
                            onClick={() => handleSort(key as SortField)}
                            className="gap-1"
                            data-testid={`sort-${key}`}
                          >
                            {label}
                            {sortField === key && (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </Button>
                        ))}
                      </div>
                      {sortedTeams.map((team: any, idx: number) => {
                        const confidence = getConfidenceBadge(team.coverage_pct ?? 0);
                        const archetype = getArchetypeInfo(team.archetype);
                        const isExpanded = expandedTeam === team.roster_id;
                        const efficiency = team.max_pf > 0 ? Math.round((team.actual_pf / team.max_pf) * 100) : 0;
                        
                        return (
                          <Card 
                            key={team.roster_id} 
                            className="p-4 cursor-pointer hover-elevate"
                            onClick={() => setExpandedTeam(isExpanded ? null : team.roster_id)}
                            data-testid={`card-team-${team.roster_id}`}
                          >
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="flex items-center gap-3">
                                <Badge variant={idx < 3 ? "default" : idx < 6 ? "secondary" : "outline"} className="text-lg font-bold min-w-[2.5rem] justify-center">
                                  #{idx + 1}
                                </Badge>
                                <div>
                                  <div className="font-semibold">{team.team_name || team.owner_name || `Team ${team.roster_id}`}</div>
                                  <div className={`text-sm ${archetype.color}`}>{archetype.label}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="text-right">
                                  <div className="font-bold text-lg">{fmtNum(team.composite_score, 0)}</div>
                                  <div className="text-xs text-muted-foreground">Total Score</div>
                                </div>
                                <Badge variant={confidence.variant}>{confidence.label}</Badge>
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </div>
                            </div>
                            
                            {isExpanded && (
                              <div className="mt-4 pt-4 border-t space-y-4">
                                <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
                                  <div>
                                    <div className="text-muted-foreground">Starters</div>
                                    <div className="font-medium">{fmtNum(team.starters_value, 0)}</div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Bench</div>
                                    <div className="font-medium">{fmtNum(team.bench_value, 0)}</div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Actual / Max PF</div>
                                    <div className="font-medium">{fmtNum(team.actual_pf, 0)} / {fmtNum(team.max_pf, 0)}</div>
                                    <div className="flex items-center gap-1 mt-1">
                                      <span className="text-xs text-muted-foreground">{efficiency}%</span>
                                      {team.luck_flag && (
                                        <Badge variant={team.luck_flag === "Efficient" ? "default" : "destructive"} className="text-xs">{team.luck_flag}</Badge>
                                      )}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Draft Capital</div>
                                    <div className="font-medium">{fmtNum(team.picks_value, 0)}</div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Age Window</div>
                                    <div className="font-medium">{fmtNum(team.age_score, 1)}</div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Confidence</div>
                                    <div className="font-medium">{Math.round((team.coverage_pct || 0) * 100)}%</div>
                                  </div>
                                </div>
                                
                                {team.window?.by_position?.length > 0 && (
                                  <div className="pt-3 border-t">
                                    <div className="text-sm text-muted-foreground mb-2">Position Age Windows</div>
                                    <div className="flex flex-wrap gap-2">
                                      {team.window.by_position.map((pos: any) => (
                                        <div key={pos.position} className="flex items-center gap-1 text-xs">
                                          <Badge 
                                            variant={pos.inPrime ? "default" : pos.primeYearsLeft > 0 ? "secondary" : "destructive"}
                                            className="text-xs"
                                          >
                                            {pos.position}
                                          </Badge>
                                          <span className="text-muted-foreground">
                                            {pos.avgAge.toFixed(1)}y / {pos.primeYearsLeft > 0 ? `${pos.primeYearsLeft}yr left` : "past prime"}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {(team.shallow_positions?.length > 0 || team.surplus_positions?.length > 0) && (
                                  <div className="pt-3 border-t flex flex-wrap gap-4 text-sm">
                                    {team.shallow_positions?.length > 0 && (
                                      <div>
                                        <span className="text-muted-foreground">Needs:</span>
                                        <span className="ml-2">{team.shallow_positions.join(", ")}</span>
                                      </div>
                                    )}
                                    {team.surplus_positions?.length > 0 && (
                                      <div>
                                        <span className="text-muted-foreground">Surplus:</span>
                                        <span className="ml-2">{team.surplus_positions.join(", ")}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </Card>
                        );
                      })}
                    </div>
                  ) : (
                    <Card className="p-6 text-center text-muted-foreground">
                      No power rankings available. Select a league to analyze.
                    </Card>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="radar" className="mt-6">
              <div className="space-y-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Target className="w-5 h-5" />
                  Trade Radar
                </h2>
                <p className="text-muted-foreground">Matches your surplus assets with league needs</p>
                
                {loadingEdge ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : tradeMatches.length ? (
                  <div className="space-y-3">
                    {tradeMatches.map((match: any, idx: number) => (
                      <Card key={idx} className="p-4">
                        <div className="flex items-start justify-between flex-wrap gap-3">
                          <div>
                            <div className="font-semibold">{match.target_team}</div>
                            <div className="text-sm text-muted-foreground mt-1">
                              Their need: <Badge variant="outline">{match.their_need}</Badge>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-muted-foreground">Your surplus:</div>
                            <Badge variant="secondary">{match.your_surplus}</Badge>
                          </div>
                        </div>
                        {match.suggested_framework && (
                          <div className="mt-3 pt-3 border-t text-sm">
                            <span className="text-muted-foreground">Suggested:</span> {match.suggested_framework}
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card className="p-6 text-center text-muted-foreground">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    No trade matches found. This could mean your roster is well-balanced or data is still loading.
                  </Card>
                )}
              </div>
            </TabsContent>

            <TabsContent value="needs" className="mt-6">
              <div className="space-y-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Team Needs Analysis
                </h2>
                
                {loadingEdge ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : teams.length ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {teams.map((team: any) => {
                      const archetype = getArchetypeInfo(team.archetype);
                      const deficits = team.deficit_positions ?? [];
                      const surplusPlayers = team.surplus_players ?? [];
                      return (
                        <Card key={team.roster_id} className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="font-semibold">{team.team_name || team.owner_name || `Team ${team.roster_id}`}</div>
                            <Badge variant="outline" className={archetype.color}>{archetype.label}</Badge>
                          </div>
                          <div className="space-y-2 text-sm">
                            {deficits.length > 0 && (
                              <div>
                                <span className="text-green-600 font-medium">Needs:</span>{" "}
                                {deficits.join(", ")}
                              </div>
                            )}
                            {surplusPlayers.length > 0 && (
                              <div>
                                <span className="text-red-600 font-medium">Surplus:</span>{" "}
                                {surplusPlayers.map((p: any) => p.player_name).slice(0, 3).join(", ")}
                                {surplusPlayers.length > 3 && ` +${surplusPlayers.length - 3} more`}
                              </div>
                            )}
                            {!deficits.length && !surplusPlayers.length && (
                              <div className="text-muted-foreground">Balanced roster</div>
                            )}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                ) : (
                  <Card className="p-6 text-center text-muted-foreground">
                    No team needs data available.
                  </Card>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>
    </Layout>
  );
}
