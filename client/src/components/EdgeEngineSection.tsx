import { useState, useMemo } from "react";
import { useEdgeEngine, type EdgeEngineTeam, type EdgeEngineWeights } from "@/hooks/use-sleeper";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Trophy, TrendingUp, TrendingDown, Target, Users, 
  Zap, BarChart3, Settings, ChevronDown, ChevronUp,
  Loader2, AlertCircle, Star, Sparkles
} from "lucide-react";

function fmtNum(v: unknown, decimals = 1): string {
  if (v == null) return "—";
  const num = Number(v);
  if (Number.isNaN(num)) return "—";
  return num.toFixed(decimals);
}

function fmtPct(v: unknown): string {
  const formatted = fmtNum(v, 0);
  return formatted === "—" ? "—" : `${formatted}%`;
}

const DEFAULT_WEIGHTS: EdgeEngineWeights = {
  starters: 45,
  bench: 15,
  picks: 15,
  depth: 20,
  age: 5,
};

interface Props {
  leagueId: string;
  username?: string;
  myRosterId?: number;
}

type SortKey = "rank" | "composite_score" | "starters_value" | "picks_value" | "age_score" | "buy_points" | "buy_youth";

export function EdgeEngineSection({ leagueId, username, myRosterId }: Props) {
  const [weights, setWeights] = useState<EdgeEngineWeights>(() => {
    const stored = localStorage.getItem("edge_engine_weights");
    return stored ? JSON.parse(stored) : DEFAULT_WEIGHTS;
  });
  const [showWeights, setShowWeights] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortAsc, setSortAsc] = useState(true);
  const [expandedTeam, setExpandedTeam] = useState<number | null>(null);

  const { data, isLoading, error } = useEdgeEngine(leagueId, username, weights);

  const handleWeightChange = (key: keyof EdgeEngineWeights, value: number) => {
    const newWeights = { ...weights, [key]: value };
    setWeights(newWeights);
    localStorage.setItem("edge_engine_weights", JSON.stringify(newWeights));
  };

  const sortedTeams = useMemo(() => {
    if (!data?.teams) return [];
    const teams = [...data.teams];
    teams.sort((a, b) => {
      let aVal = a[sortKey] as number;
      let bVal = b[sortKey] as number;
      if (sortAsc) return aVal - bVal;
      return bVal - aVal;
    });
    return teams;
  }, [data?.teams, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === "rank");
    }
  };

  const SortHeader = ({ label, sortKeyVal }: { label: string; sortKeyVal: SortKey }) => (
    <TableHead 
      className="cursor-pointer hover:bg-muted/50 whitespace-nowrap"
      onClick={() => toggleSort(sortKeyVal)}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortKey === sortKeyVal && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </div>
    </TableHead>
  );

  const getArchetypeBadge = (archetype: string) => {
    switch (archetype) {
      case "contender":
        return <Badge className="bg-green-500/20 text-green-600 border-green-500/30">Contender</Badge>;
      case "rebuilder":
        return <Badge className="bg-blue-500/20 text-blue-600 border-blue-500/30">Rebuilder</Badge>;
      default:
        return <Badge variant="outline">Tweener</Badge>;
    }
  };

  const getRankBadge = (rank: number, total: number) => {
    const pct = rank / total;
    if (pct <= 0.25) return <Badge className="bg-green-500 text-white">{rank}</Badge>;
    if (pct <= 0.5) return <Badge className="bg-blue-500 text-white">{rank}</Badge>;
    if (pct <= 0.75) return <Badge variant="secondary">{rank}</Badge>;
    return <Badge variant="outline">{rank}</Badge>;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <AlertCircle className="w-5 h-5 mr-2" />
        Failed to load Edge Engine data
      </div>
    );
  }

  const myTeam = data.teams.find(t => t.roster_id === myRosterId);

  return (
    <div className="space-y-6">
      <Tabs defaultValue="power" className="w-full">
        <TabsList className="grid w-full grid-cols-4 gap-1">
          <TabsTrigger value="power" data-testid="tab-power-rankings">
            <Trophy className="w-4 h-4 mr-1" />
            Power
          </TabsTrigger>
          <TabsTrigger value="needs" data-testid="tab-team-needs">
            <Target className="w-4 h-4 mr-1" />
            Needs
          </TabsTrigger>
          <TabsTrigger value="surplus" data-testid="tab-surplus">
            <Sparkles className="w-4 h-4 mr-1" />
            Surplus
          </TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">
            <Settings className="w-4 h-4 mr-1" />
            Weights
          </TabsTrigger>
        </TabsList>

        <TabsContent value="power" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Trophy className="w-5 h-5 text-yellow-500" />
                Power Rankings
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortHeader label="Rank" sortKeyVal="rank" />
                      <TableHead>Team</TableHead>
                      <SortHeader label="Score" sortKeyVal="composite_score" />
                      <SortHeader label="Starters" sortKeyVal="starters_value" />
                      <SortHeader label="Picks" sortKeyVal="picks_value" />
                      <SortHeader label="Age" sortKeyVal="age_score" />
                      <TableHead>Type</TableHead>
                      <TableHead>Coverage</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedTeams.map((team) => (
                      <TableRow 
                        key={team.roster_id}
                        className={team.roster_id === myRosterId ? "bg-primary/5" : ""}
                        data-testid={`row-team-${team.roster_id}`}
                      >
                        <TableCell>{getRankBadge(team.rank, data.total_rosters)}</TableCell>
                        <TableCell className="font-medium">
                          {team.owner_name}
                          {team.roster_id === myRosterId && (
                            <Star className="w-3 h-3 inline ml-1 text-yellow-500" />
                          )}
                        </TableCell>
                        <TableCell className="font-mono">{fmtNum(team.composite_score)}</TableCell>
                        <TableCell className="font-mono">{fmtNum(team.starters_value, 0)}</TableCell>
                        <TableCell className="font-mono">{fmtNum(team.picks_value, 0)}</TableCell>
                        <TableCell className="font-mono">{fmtNum(team.age_score)}</TableCell>
                        <TableCell>{getArchetypeBadge(team.archetype)}</TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger>
                              <span className={team.coverage_pct < 70 ? "text-amber-500" : ""}>
                                {fmtPct(team.coverage_pct)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              Value Coverage: % of roster with known trade values
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="needs" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Target className="w-5 h-5 text-primary" />
                Team Needs & Trade Signals
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Team</TableHead>
                      <TableHead>Type</TableHead>
                      <SortHeader label="Buy Points" sortKeyVal="buy_points" />
                      <SortHeader label="Buy Youth" sortKeyVal="buy_youth" />
                      <TableHead>Weakest Slot</TableHead>
                      <TableHead>Shallow</TableHead>
                      <TableHead>Surplus</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedTeams.map((team) => (
                      <TableRow 
                        key={team.roster_id}
                        className={team.roster_id === myRosterId ? "bg-primary/5" : ""}
                      >
                        <TableCell className="font-medium">
                          {team.owner_name}
                          {team.roster_id === myRosterId && (
                            <Star className="w-3 h-3 inline ml-1 text-yellow-500" />
                          )}
                        </TableCell>
                        <TableCell>{getArchetypeBadge(team.archetype)}</TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger>
                              <div className="flex items-center gap-1">
                                {team.buy_points >= 70 && <TrendingUp className="w-3 h-3 text-green-500" />}
                                <span className={team.buy_points >= 70 ? "text-green-600 font-medium" : ""}>
                                  {fmtNum(team.buy_points, 0)}
                                </span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              Higher = team should acquire veteran production
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger>
                              <div className="flex items-center gap-1">
                                {team.buy_youth >= 70 && <TrendingUp className="w-3 h-3 text-blue-500" />}
                                <span className={team.buy_youth >= 70 ? "text-blue-600 font-medium" : ""}>
                                  {fmtNum(team.buy_youth, 0)}
                                </span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              Higher = team should acquire youth and picks
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          {team.weakest_slot ? (
                            <Badge variant="outline" className="text-xs">
                              {team.weakest_slot}
                            </Badge>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {team.shallow_positions.map(pos => (
                              <Badge key={pos} variant="destructive" className="text-xs">
                                {pos}
                              </Badge>
                            ))}
                            {team.shallow_positions.length === 0 && "—"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {team.surplus_positions.map(pos => (
                              <Badge key={pos} className="text-xs bg-green-500/20 text-green-600">
                                {pos}
                              </Badge>
                            ))}
                            {team.surplus_positions.length === 0 && "—"}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="surplus" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            {myTeam && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Sparkles className="w-5 h-5 text-green-500" />
                    My Surplus Players
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {myTeam.surplus_players.length > 0 ? (
                    <div className="space-y-2">
                      {myTeam.surplus_players.map((p, i) => (
                        <div key={p.player_id} className="flex items-center justify-between py-2 border-b last:border-0">
                          <div>
                            <span className="font-medium">{p.player_name}</span>
                            <Badge variant="outline" className="ml-2 text-xs">{p.position}</Badge>
                          </div>
                          <div className="text-right">
                            <div className="font-mono text-sm">{fmtNum(p.value, 0)}</div>
                            <div className="text-xs text-muted-foreground">surplus: {fmtNum(p.surplusScore, 0)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">No surplus players identified</p>
                  )}
                  
                  {myTeam.deficit_positions.length > 0 && (
                    <div className="mt-4 pt-4 border-t">
                      <div className="text-sm text-muted-foreground mb-2">Position Needs:</div>
                      <div className="flex flex-wrap gap-1">
                        {myTeam.deficit_positions.map(pos => (
                          <Badge key={pos} variant="destructive">{pos}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Users className="w-5 h-5 text-blue-500" />
                  Trade Partners
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {sortedTeams
                    .filter(t => t.roster_id !== myRosterId)
                    .sort((a, b) => {
                      const myDeficits = myTeam?.deficit_positions || [];
                      const aHas = a.surplus_positions.filter(p => myDeficits.includes(p)).length;
                      const bHas = b.surplus_positions.filter(p => myDeficits.includes(p)).length;
                      return bHas - aHas;
                    })
                    .slice(0, 5)
                    .map((team) => (
                      <div key={team.roster_id} className="flex items-center justify-between py-2 border-b last:border-0">
                        <div>
                          <div className="font-medium">{team.owner_name}</div>
                          <div className="text-xs text-muted-foreground">{team.rationale}</div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {team.surplus_positions.slice(0, 3).map(pos => (
                            <Badge key={pos} variant="outline" className="text-xs">{pos}</Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Settings className="w-5 h-5 text-muted-foreground" />
                Power Ranking Weights
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-sm text-muted-foreground">
                Adjust how different factors contribute to the overall power score. 
                These settings are saved locally.
              </p>
              
              {(Object.entries(weights) as [keyof EdgeEngineWeights, number][]).map(([key, value]) => (
                <div key={key} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium capitalize">{key}</label>
                    <span className="text-sm font-mono text-muted-foreground">{value}%</span>
                  </div>
                  <Slider
                    value={[value]}
                    min={0}
                    max={100}
                    step={5}
                    onValueChange={([v]) => handleWeightChange(key, v)}
                    data-testid={`slider-weight-${key}`}
                  />
                </div>
              ))}

              <div className="pt-4 border-t">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Total Weight:</span>
                  <span className={
                    Object.values(weights).reduce((a, b) => a + b, 0) === 100 
                      ? "text-green-600" 
                      : "text-amber-500"
                  }>
                    {Object.values(weights).reduce((a, b) => a + b, 0)}%
                  </span>
                </div>
              </div>

              <Button 
                variant="outline" 
                onClick={() => {
                  setWeights(DEFAULT_WEIGHTS);
                  localStorage.setItem("edge_engine_weights", JSON.stringify(DEFAULT_WEIGHTS));
                }}
                data-testid="button-reset-weights"
              >
                Reset to Defaults
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
