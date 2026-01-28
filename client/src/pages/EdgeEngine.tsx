import { useParams } from "wouter";
import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Zap, TrendingUp, Target, Users, Loader2, ChevronDown, ChevronUp, AlertCircle, ArrowUp, ArrowDown, Info } from "lucide-react";
import { useSleeperOverview, usePowerRankings, PowerRankingsTeam, CoreAsset } from "@/hooks/use-sleeper";
import { motion } from "framer-motion";
import { useState, useMemo } from "react";
import { ArchetypeBadge } from "@/components/AgeScaleBar";
import { AgeScaleBar } from "@/components/AgeScaleBar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function fmtNum(v: unknown, decimals = 1, fallback = "—"): string {
  if (v == null) return fallback;
  const num = Number(v);
  if (Number.isNaN(num)) return fallback;
  return num.toFixed(decimals);
}

function fmtPct(v: unknown, fallback = "—"): string {
  if (v == null) return fallback;
  const num = Number(v);
  if (Number.isNaN(num)) return fallback;
  return `${Math.round(num)}%`;
}

function getConfidenceBadge(coverage: number | null): { label: string; variant: "default" | "secondary" | "destructive" } {
  if (coverage == null) return { label: "N/A", variant: "secondary" };
  if (coverage >= 80) return { label: "High", variant: "default" };
  if (coverage >= 50) return { label: "Med", variant: "secondary" };
  return { label: "Low", variant: "destructive" };
}

type SortField = "rank" | "starters" | "bench" | "picks" | "window" | "total";
type SortDir = "asc" | "desc";

export default function EdgeEngine() {
  const { username } = useParams<{ username: string }>();
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null);
  const [expandedTeam, setExpandedTeam] = useState<number | null>(null);
  const [sortField, setSortField] = useState<SortField>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const { data: overview, isLoading: loadingOverview } = useSleeperOverview(username);
  
  const groups = overview?.league_groups ?? [];
  const activeGroup = groups.find((g: any) => g.group_id === selectedLeague) ?? groups[0];
  const activeLeagueId = activeGroup?.latest_league_id ?? activeGroup?.league_ids?.[activeGroup?.league_ids?.length - 1];
  
  const { data: powerData, isLoading: loadingPower } = usePowerRankings(activeLeagueId);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir(field === "rank" ? "asc" : "desc");
    }
  };

  const teams = powerData?.teams ?? [];
  const weights = powerData?.weights;
  const formatMode = powerData?.mode === "sf" ? "Superflex" : "1QB";
  
  const sortedTeams = useMemo(() => {
    const getValue = (t: PowerRankingsTeam) => {
      switch (sortField) {
        case "rank": return t.rank ?? 0;
        case "starters": return t.starters_value ?? 0;
        case "bench": return t.bench_value ?? 0;
        case "picks": return t.picks_value ?? 0;
        case "window": return t.window_score ?? 0;
        case "total": return t.total_score ?? 0;
        default: return 0;
      }
    };
    return [...teams].sort((a, b) => {
      const aVal = getValue(a);
      const bVal = getValue(b);
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });
  }, [teams, sortField, sortDir]);

  const myTeam = teams.find(t => t.owner_id === overview?.user?.user_id);

  if (loadingOverview) {
    return (
      <Layout username={username}>
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        </div>
      </Layout>
    );
  }

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
                <p className="text-muted-foreground">Strategic decision-making dashboard</p>
              </div>
            </div>
            {powerData && (
              <div className="flex items-center gap-2">
                <Badge variant="outline">{formatMode}</Badge>
                {weights && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="secondary" className="cursor-help">
                        {weights.starters}/{weights.bench}/{weights.picks}/{weights.window}/{weights.maxPf || 5}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Starters / Bench / Picks / Window / Age</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}
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

          {myTeam && (
            <Card className="p-4 bg-primary/5 border-primary/20">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Your Team</div>
                    <div className="font-semibold text-lg">{myTeam.display_name}</div>
                  </div>
                  <ArchetypeBadge 
                    archetype={myTeam.archetype} 
                    reasons={myTeam.archetype_reasons}
                  />
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-center">
                    <div className="text-2xl font-bold">#{myTeam.rank}</div>
                    <div className="text-muted-foreground">Rank</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">{fmtNum(myTeam.total_score, 1)}</div>
                    <div className="text-muted-foreground">Score</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">{fmtPct(myTeam.power_pct)}</div>
                    <div className="text-muted-foreground">Power</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">{fmtPct(myTeam.window_core_pct)}</div>
                    <div className="text-muted-foreground">Window</div>
                  </div>
                </div>
              </div>
            </Card>
          )}

          <Tabs defaultValue="rankings" className="w-full">
            <TabsList className="w-full justify-start overflow-x-auto flex-wrap h-auto gap-1 bg-muted/50 p-1">
              <TabsTrigger value="rankings" className="gap-1" data-testid="edge-tab-rankings">
                <TrendingUp className="w-3 h-3" />
                Power Rankings
              </TabsTrigger>
              <TabsTrigger value="core-assets" className="gap-1" data-testid="edge-tab-core-assets">
                <Users className="w-3 h-3" />
                Core Assets
              </TabsTrigger>
              <TabsTrigger value="radar" className="gap-1" data-testid="edge-tab-radar">
                <Target className="w-3 h-3" />
                Trade Radar
              </TabsTrigger>
            </TabsList>

            <TabsContent value="rankings" className="mt-6">
              {loadingPower ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h2 className="text-xl font-semibold">True Power Rankings</h2>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Sort:</span>
                      {[
                        { key: "rank", label: "Rank" },
                        { key: "starters", label: "Starters" },
                        { key: "bench", label: "Bench" },
                        { key: "picks", label: "Picks" },
                        { key: "window", label: "Window" },
                        { key: "total", label: "Total" },
                      ].map(({ key, label }) => (
                        <Button
                          key={key}
                          variant={sortField === key ? "default" : "ghost"}
                          size="sm"
                          onClick={() => handleSort(key as SortField)}
                          className="gap-1 h-7 px-2"
                          data-testid={`sort-${key}`}
                        >
                          {label}
                          {sortField === key && (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </Button>
                      ))}
                    </div>
                  </div>
                  
                  {sortedTeams.length ? (
                    <div className="space-y-2">
                      {sortedTeams.map((team: PowerRankingsTeam) => {
                        const confidence = getConfidenceBadge(team.coverage_pct);
                        const isExpanded = expandedTeam === team.roster_id;
                        const isMyTeam = team.owner_id === overview?.user?.user_id;
                        
                        return (
                          <Card 
                            key={team.roster_id} 
                            className={`p-4 cursor-pointer hover-elevate ${isMyTeam ? 'ring-1 ring-primary/50' : ''}`}
                            onClick={() => setExpandedTeam(isExpanded ? null : team.roster_id)}
                            data-testid={`card-team-${team.roster_id}`}
                          >
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="flex items-center gap-3">
                                <Badge variant={team.rank <= 3 ? "default" : team.rank <= 6 ? "secondary" : "outline"} className="text-lg font-bold min-w-[2.5rem] justify-center">
                                  #{team.rank}
                                </Badge>
                                <div>
                                  <div className="font-semibold flex items-center gap-2">
                                    {team.display_name}
                                    {isMyTeam && <Badge variant="outline" className="text-xs">You</Badge>}
                                  </div>
                                  <ArchetypeBadge 
                                    archetype={team.archetype} 
                                    reasons={team.archetype_reasons}
                                    size="sm"
                                  />
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="text-right">
                                  <div className="font-bold text-lg">{fmtNum(team.total_score, 1)}</div>
                                  <div className="text-xs text-muted-foreground">Score</div>
                                </div>
                                <Badge variant={confidence.variant}>{confidence.label}</Badge>
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </div>
                            </div>
                            
                            {isExpanded && (
                              <div className="mt-4 pt-4 border-t space-y-4">
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                                  <div>
                                    <div className="text-muted-foreground">Starters</div>
                                    <div className="font-medium">{fmtNum(team.starters_value, 0)} <span className="text-xs text-muted-foreground">({fmtNum(team.starters_score, 0)}%)</span></div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Bench</div>
                                    <div className="font-medium">{fmtNum(team.bench_value, 0)} <span className="text-xs text-muted-foreground">({fmtNum(team.bench_score, 0)}%)</span></div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Draft Capital</div>
                                    <div className="font-medium">{fmtNum(team.picks_value, 0)} <span className="text-xs text-muted-foreground">({fmtNum(team.picks_score, 0)}%)</span></div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Window</div>
                                    <div className="font-medium">{fmtPct(team.window_core_pct)} <span className="text-xs text-muted-foreground">core</span></div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Coverage</div>
                                    <div className="font-medium">{fmtPct(team.coverage_pct)}</div>
                                  </div>
                                </div>
                                
                                {team.archetype_reasons && team.archetype_reasons.length > 0 && (
                                  <div className="pt-3 border-t">
                                    <div className="text-sm text-muted-foreground mb-2 flex items-center gap-1">
                                      <Info className="w-3 h-3" /> Archetype Analysis
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      {team.archetype_reasons.map((reason, idx) => (
                                        <Badge key={idx} variant="outline" className="text-xs">
                                          {reason}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {team.age_by_position && team.age_by_position.length > 0 && (
                                  <div className="pt-3 border-t">
                                    <div className="text-sm text-muted-foreground mb-2">Position Age Windows</div>
                                    <div className="flex flex-wrap gap-2">
                                      {team.age_by_position.map((pos) => (
                                        <div key={pos.position} className="flex items-center gap-1 text-xs">
                                          <Badge 
                                            variant={pos.inPrime ? "default" : pos.primeYearsLeft > 0 ? "secondary" : "destructive"}
                                            className="text-xs"
                                          >
                                            {pos.position}
                                          </Badge>
                                          <span className="text-muted-foreground">
                                            {pos.avgAge.toFixed(1)}y / {pos.primeYearsLeft > 0 ? `${pos.primeYearsLeft.toFixed(1)}yr left` : "past prime"}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
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

            <TabsContent value="core-assets" className="mt-6">
              <div className="space-y-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Core Assets & Age Curves
                </h2>
                <p className="text-muted-foreground">Top players by value with position-specific age analysis</p>
                
                {loadingPower ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : teams.length ? (
                  <div className="grid gap-4">
                    {teams.slice(0, 6).map((team: PowerRankingsTeam) => {
                      const coreAssets = team.core_assets ?? [];
                      const isMyTeam = team.owner_id === overview?.user?.user_id;
                      
                      return (
                        <Card key={team.roster_id} className={`p-4 ${isMyTeam ? 'ring-1 ring-primary/50' : ''}`}>
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">#{team.rank}</Badge>
                              <span className="font-semibold">{team.display_name}</span>
                              {isMyTeam && <Badge variant="default" className="text-xs">You</Badge>}
                            </div>
                            <ArchetypeBadge 
                              archetype={team.archetype} 
                              reasons={team.archetype_reasons}
                              size="sm"
                            />
                          </div>
                          
                          {coreAssets.length > 0 ? (
                            <div className="space-y-2">
                              {coreAssets.slice(0, 6).map((asset: CoreAsset) => (
                                <div key={asset.player_id} className="flex items-center justify-between gap-2 p-2 rounded bg-muted/30">
                                  <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <Badge variant="outline" className="shrink-0 text-xs">
                                      {asset.position}
                                    </Badge>
                                    <span className="font-medium truncate">{asset.full_name}</span>
                                    <span className="text-sm text-muted-foreground shrink-0">
                                      {asset.age ?? "?"}yo
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3 shrink-0">
                                    <span className="text-sm font-medium">{asset.value}</span>
                                    <div className="w-32">
                                      <AgeScaleBar ageCurve={asset.age_curve} size="sm" />
                                    </div>
                                  </div>
                                </div>
                              ))}
                              {coreAssets.length > 6 && (
                                <div className="text-xs text-muted-foreground text-center pt-1">
                                  +{coreAssets.length - 6} more core assets
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground text-center py-4">
                              No core assets data available
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                ) : (
                  <Card className="p-6 text-center text-muted-foreground">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    No team data available.
                  </Card>
                )}
              </div>
            </TabsContent>

            <TabsContent value="radar" className="mt-6">
              <div className="space-y-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Target className="w-5 h-5" />
                  Trade Radar
                </h2>
                <p className="text-muted-foreground">Identify trade opportunities based on roster composition</p>
                
                {loadingPower ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : myTeam ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <Card className="p-4">
                      <h3 className="font-semibold mb-3 flex items-center gap-2">
                        <Badge variant="default">Your Strengths</Badge>
                      </h3>
                      {myTeam.core_assets && myTeam.core_assets.length > 0 ? (
                        <div className="space-y-2">
                          {myTeam.core_assets.slice(0, 5).map((asset: CoreAsset) => (
                            <div key={asset.player_id} className="flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs">{asset.position}</Badge>
                                <span>{asset.full_name}</span>
                              </div>
                              <span className="font-medium">{asset.value}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No core assets data</p>
                      )}
                    </Card>
                    
                    <Card className="p-4">
                      <h3 className="font-semibold mb-3 flex items-center gap-2">
                        <Badge variant="secondary">Position Windows</Badge>
                      </h3>
                      {myTeam.age_by_position && myTeam.age_by_position.length > 0 ? (
                        <div className="space-y-2">
                          {myTeam.age_by_position.map((pos) => (
                            <div key={pos.position} className="flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2">
                                <Badge 
                                  variant={pos.inPrime ? "default" : pos.primeYearsLeft > 0 ? "secondary" : "destructive"}
                                  className="text-xs"
                                >
                                  {pos.position}
                                </Badge>
                                <span className="text-muted-foreground">Avg: {pos.avgAge.toFixed(1)}yo</span>
                              </div>
                              <span className={pos.inPrime ? "text-green-600" : pos.primeYearsLeft > 0 ? "text-yellow-600" : "text-red-600"}>
                                {pos.inPrime ? "In Prime" : pos.primeYearsLeft > 0 ? `${pos.primeYearsLeft.toFixed(1)}yr left` : "Past Prime"}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No position age data</p>
                      )}
                    </Card>
                  </div>
                ) : (
                  <Card className="p-6 text-center text-muted-foreground">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    Could not find your team. Make sure you're viewing a league you're in.
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
