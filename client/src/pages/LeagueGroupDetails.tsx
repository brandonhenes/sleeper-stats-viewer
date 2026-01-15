import { useState, useMemo } from "react";
import { useParams, Link } from "wouter";
import { useSleeperOverview, useH2h, useTrades, useDraftCapital, useChurnStats, useTradeTiming, useAllPlay, useSeasonSummaries } from "@/hooks/use-sleeper";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Loader2, Trophy, Target, TrendingUp, ArrowRightLeft, Layers, RefreshCw, Calendar, Sparkles, Clock, History, Users, BarChart3, Percent } from "lucide-react";
import { motion } from "framer-motion";
import { Layout } from "@/components/Layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Trade } from "@shared/schema";
import { ScoutingSection } from "@/components/ScoutingSection";
import { TeamsSection } from "@/components/TeamsSection";
import { TradesSection } from "@/components/TradesSection";
import { TradeTargetsModal } from "@/components/TradeTargetsModal";

function fmtNum(v: unknown, decimals = 1, fallback = "—"): string {
  if (v == null) return fallback;
  const num = Number(v);
  if (Number.isNaN(num)) return fallback;
  return num.toFixed(decimals);
}

function fmtPct(v: unknown, decimals = 1, fallback = "—"): string {
  const formatted = fmtNum(v, decimals, fallback);
  return formatted === fallback ? fallback : `${formatted}%`;
}

export default function LeagueGroupDetails() {
  const params = useParams<{ groupId: string; username?: string }>();
  const groupId = params.groupId;
  
  const username = params.username || localStorage.getItem("sleeper_username") || undefined;
  
  const isDebug = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';
  
  const [viewMode, setViewMode] = useState<"current" | "history">("current");
  const [activeTab, setActiveTab] = useState("overview");
  const [showTargetsModal, setShowTargetsModal] = useState(false);

  const { data: overviewData, isLoading: overviewLoading } = useSleeperOverview(username);
  // Note: H2H and trades are filtered by season in their respective hooks (updated below after displayedSeason is computed)

  const leagueGroup = overviewData?.league_groups.find((g) => g.group_id === groupId);
  
  const latestLeagueId = leagueGroup?.latest_league_id || leagueGroup?.league_ids[leagueGroup.league_ids.length - 1];
  
  const [churnTimeframe, setChurnTimeframe] = useState<string>("season");
  const [draftCapitalYearFilter, setDraftCapitalYearFilter] = useState<string>("all");
  
  const { data: seasonData, isLoading: seasonLoading } = useSeasonSummaries(groupId, username);
  
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const displayedSeason = selectedSeason ?? seasonData?.seasons[0]?.season ?? null;
  const selectedSeasonData = seasonData?.seasons.find(s => s.season === displayedSeason);
  
  // Compute season-aware activeLeagueId using seasons_to_league mapping
  const activeLeagueId = useMemo(() => {
    if (displayedSeason && leagueGroup?.seasons_to_league) {
      const match = leagueGroup.seasons_to_league.find(s => s.season === displayedSeason);
      if (match) return match.league_id;
    }
    return latestLeagueId;
  }, [displayedSeason, leagueGroup?.seasons_to_league, latestLeagueId]);
  
  // Use activeLeagueId (season-aware) for all hooks
  const { data: draftCapitalData, isLoading: draftCapitalLoading } = useDraftCapital(activeLeagueId, username);
  const { data: churnData, isLoading: churnLoading } = useChurnStats(activeLeagueId, username, churnTimeframe, groupId);
  const { data: tradeTimingData, isLoading: tradeTimingLoading } = useTradeTiming(activeLeagueId, username);
  const { data: allPlayData, isLoading: allPlayLoading } = useAllPlay(activeLeagueId, username);
  
  // Season-aware H2H and trades hooks
  const { data: h2hData, isLoading: h2hLoading, error: h2hError } = useH2h(groupId, username, displayedSeason);
  const { data: tradesData, isLoading: tradesLoading } = useTrades(groupId, viewMode, displayedSeason);

  const backLink = username ? `/u/${username}` : "/";

  if (!username) {
    return (
      <Layout>
        <div className="min-h-screen p-8">
          <div className="max-w-4xl mx-auto text-center py-20">
            <p className="text-xl text-muted-foreground">Please search for a username first.</p>
            <Link href="/">
              <Button className="mt-4">Go Home</Button>
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  if (overviewLoading) {
    return (
      <Layout username={username}>
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!leagueGroup) {
    return (
      <Layout username={username}>
        <div className="min-h-screen p-8">
          <div className="max-w-4xl mx-auto text-center py-20">
            <p className="text-xl text-muted-foreground">League group not found.</p>
            <Link href={backLink}>
              <Button className="mt-4">Go Back</Button>
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  const formatRecord = (wins: number, losses: number, ties: number) => {
    if (ties > 0) return `${wins}-${losses}-${ties}`;
    return `${wins}-${losses}`;
  };

  const winPct = (wins: number, losses: number, ties: number) => {
    const total = wins + losses + ties;
    if (total === 0) return 0;
    return ((wins + ties * 0.5) / total * 100).toFixed(1);
  };

  return (
    <Layout username={username}>
      <div className="pb-20">
        {/* HEADER SECTION */}
        <div className="bg-secondary/30 border-b border-border/50 p-6">
          <div className="max-w-6xl mx-auto">
            <Link href={backLink}>
              <Button variant="ghost" size="sm" className="mb-4 gap-2">
                <ArrowLeft className="w-4 h-4" />
                Back to Profile
              </Button>
            </Link>
            
            <div className="flex flex-col md:flex-row md:items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h1 className="text-3xl font-display font-bold">{leagueGroup.name}</h1>
                  {leagueGroup.league_type && (
                    <Badge variant="outline" className="capitalize">
                      {leagueGroup.league_type}
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground mt-1">
                  {leagueGroup.min_season === leagueGroup.max_season 
                    ? `Season ${leagueGroup.min_season}`
                    : `${leagueGroup.min_season} - ${leagueGroup.max_season}`
                  } ({leagueGroup.seasons_count} season{leagueGroup.seasons_count !== 1 ? 's' : ''})
                </p>
                
                {/* Current/History Toggle */}
                <div className="flex gap-1 p-1 bg-muted rounded-md mt-3 w-fit" data-testid="view-mode-toggle">
                  <Button
                    variant={viewMode === "current" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("current")}
                    className="gap-1"
                    data-testid="button-view-current"
                  >
                    <Clock className="w-3 h-3" />
                    Current
                  </Button>
                  <Button
                    variant={viewMode === "history" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("history")}
                    className="gap-1"
                    disabled={leagueGroup.seasons_count <= 1}
                    data-testid="button-view-history"
                  >
                    <History className="w-3 h-3" />
                    History
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ABOVE THE FOLD: Season Result + Quick Actions */}
        <div className="max-w-6xl mx-auto p-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* Season Result Card */}
            <Card className="p-6 mb-6">
              <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-primary" />
                  <h2 className="text-lg font-semibold">Season Result</h2>
                  <Badge variant="outline" className="text-xs">
                    {viewMode === "current" ? "Latest Season" : "All-Time"}
                  </Badge>
                </div>
                {seasonData?.seasons && seasonData.seasons.length > 1 && (
                  <select
                    className="px-3 py-1.5 rounded-md border bg-background text-sm"
                    value={displayedSeason ?? ""}
                    onChange={(e) => setSelectedSeason(e.target.value ? parseInt(e.target.value) : null)}
                    data-testid="select-season"
                  >
                    {seasonData.seasons.map(s => (
                      <option key={s.season} value={s.season}>{s.season}</option>
                    ))}
                  </select>
                )}
              </div>

              {seasonLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : selectedSeasonData ? (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="text-center p-3 rounded-md bg-muted/30">
                    <div className="text-2xl font-bold">
                      {selectedSeasonData.finish_place ? `#${selectedSeasonData.finish_place}` : "?"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {selectedSeasonData.finish_place ? "Final Finish" : "Final: Unknown"}
                    </div>
                    {selectedSeasonData.playoff_finish && (
                      <Badge variant={selectedSeasonData.playoff_finish === "Champion" ? "default" : "secondary"} className="mt-1">
                        {selectedSeasonData.playoff_finish === "Champion" && <Trophy className="w-3 h-3 mr-1" />}
                        {selectedSeasonData.playoff_finish}
                      </Badge>
                    )}
                  </div>
                  <div className="text-center p-3 rounded-md bg-muted/30">
                    <div className="text-2xl font-bold">
                      {selectedSeasonData.regular_rank ? `#${selectedSeasonData.regular_rank}` : "-"}
                    </div>
                    <div className="text-xs text-muted-foreground">Regular Rank</div>
                  </div>
                  <div className="text-center p-3 rounded-md bg-muted/30">
                    <div className="text-2xl font-bold font-mono">
                      {selectedSeasonData.record.wins}-{selectedSeasonData.record.losses}
                      {selectedSeasonData.record.ties > 0 && `-${selectedSeasonData.record.ties}`}
                    </div>
                    <div className="text-xs text-muted-foreground">Record</div>
                  </div>
                  <div className="text-center p-3 rounded-md bg-muted/30">
                    <div className="text-2xl font-bold">
                      {winPct(selectedSeasonData.record.wins, selectedSeasonData.record.losses, selectedSeasonData.record.ties)}%
                    </div>
                    <div className="text-xs text-muted-foreground">Win %</div>
                  </div>
                  <div className="text-center p-3 rounded-md bg-muted/30">
                    <div className="text-2xl font-bold">
                      {fmtNum(selectedSeasonData.pf, 0)}
                    </div>
                    <div className="text-xs text-muted-foreground">Points For</div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="text-center p-3 rounded-md bg-muted/30">
                    <div className="text-2xl font-bold font-mono">
                      {formatRecord(leagueGroup.overall_record.wins, leagueGroup.overall_record.losses, leagueGroup.overall_record.ties)}
                    </div>
                    <div className="text-xs text-muted-foreground">Record</div>
                  </div>
                  <div className="text-center p-3 rounded-md bg-muted/30">
                    <div className="text-2xl font-bold">
                      {winPct(leagueGroup.overall_record.wins, leagueGroup.overall_record.losses, leagueGroup.overall_record.ties)}%
                    </div>
                    <div className="text-xs text-muted-foreground">Win Rate</div>
                  </div>
                </div>
              )}
            </Card>

            {/* Quick Actions Row */}
            <div className="flex flex-wrap gap-2 mb-6">
              <Button 
                variant="outline" 
                size="sm" 
                className="gap-2"
                onClick={() => setShowTargetsModal(true)}
                data-testid="button-quick-trade-targets"
              >
                <Target className="w-4 h-4" />
                Trade Targets
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="gap-2"
                onClick={() => setActiveTab("teams")}
                data-testid="button-quick-my-roster"
              >
                <Users className="w-4 h-4" />
                My Roster
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="gap-2"
                onClick={() => setActiveTab("overview")}
                data-testid="button-quick-draft-capital"
              >
                <Layers className="w-4 h-4" />
                Draft Capital
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="gap-2"
                onClick={() => setActiveTab("trades")}
                data-testid="button-quick-trade-history"
              >
                <ArrowRightLeft className="w-4 h-4" />
                Trade History
              </Button>
            </div>

            {/* TABBED SECTION */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="w-full justify-start overflow-x-auto flex-wrap h-auto gap-1 bg-muted/50 p-1">
                <TabsTrigger value="overview" className="gap-1" data-testid="tab-overview">
                  <BarChart3 className="w-3 h-3" />
                  Overview
                </TabsTrigger>
                <TabsTrigger value="teams" className="gap-1" data-testid="tab-teams">
                  <Users className="w-3 h-3" />
                  Teams
                </TabsTrigger>
                <TabsTrigger value="trades" className="gap-1" data-testid="tab-trades">
                  <ArrowRightLeft className="w-3 h-3" />
                  Trades
                </TabsTrigger>
                <TabsTrigger value="h2h" className="gap-1" data-testid="tab-h2h">
                  <Target className="w-3 h-3" />
                  Head-to-Head
                </TabsTrigger>
                <TabsTrigger value="history" className="gap-1" data-testid="tab-history">
                  <History className="w-3 h-3" />
                  History
                </TabsTrigger>
              </TabsList>

              {/* OVERVIEW TAB */}
              <TabsContent value="overview" className="mt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Draft Capital Card */}
                  <Card className="p-6">
                    <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                      <div className="flex items-center gap-3">
                        <Layers className="w-5 h-5 text-primary" />
                        <h3 className="text-lg font-bold">Current Pick Ownership</h3>
                      </div>
                      <Badge variant="outline" className="text-xs">Latest League</Badge>
                    </div>
                    <div className="flex gap-1 mb-3">
                      <Button
                        variant={draftCapitalYearFilter === "current" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setDraftCapitalYearFilter("current")}
                        data-testid="button-draft-capital-current"
                      >
                        {new Date().getFullYear()} Only
                      </Button>
                      <Button
                        variant={draftCapitalYearFilter === "all" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setDraftCapitalYearFilter("all")}
                        data-testid="button-draft-capital-all"
                      >
                        All Future
                      </Button>
                    </div>
                    
                    {draftCapitalLoading && (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      </div>
                    )}

                    {!draftCapitalLoading && draftCapitalData && (
                      <>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-20">Year</TableHead>
                              <TableHead className="text-center">R1</TableHead>
                              <TableHead className="text-center">R2</TableHead>
                              <TableHead className="text-center">R3</TableHead>
                              <TableHead className="text-center">R4</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {Object.entries(draftCapitalData.picks_by_year)
                              .filter(([year]) => {
                                if (draftCapitalYearFilter === "current") {
                                  return parseInt(year, 10) === new Date().getFullYear();
                                }
                                return true;
                              })
                              .map(([year, rounds]: [string, any]) => (
                              <TableRow key={year}>
                                <TableCell className="font-mono text-muted-foreground">{year}</TableCell>
                                <TableCell className="text-center">
                                  <Badge variant={rounds[1] > 1 ? "default" : rounds[1] === 0 ? "secondary" : "outline"}>
                                    {rounds[1]}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-center">
                                  <Badge variant={rounds[2] > 1 ? "default" : rounds[2] === 0 ? "secondary" : "outline"}>
                                    {rounds[2]}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-center">
                                  <Badge variant={rounds[3] > 1 ? "default" : rounds[3] === 0 ? "secondary" : "outline"}>
                                    {rounds[3]}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-center">
                                  <Badge variant={rounds[4] > 1 ? "default" : rounds[4] === 0 ? "secondary" : "outline"}>
                                    {rounds[4]}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        <div className="mt-4 pt-4 border-t border-border/50 flex items-center justify-between gap-4 flex-wrap">
                          <div>
                            <div className="text-sm text-muted-foreground">Total Picks</div>
                            <div className="text-xl font-bold font-mono">{draftCapitalData.totals.total}</div>
                          </div>
                          <div>
                            <div className="text-sm text-muted-foreground">Hoard Index</div>
                            <div className="text-xl font-bold font-mono">{draftCapitalData.pick_hoard_index}</div>
                          </div>
                        </div>
                      </>
                    )}

                    {!draftCapitalLoading && !draftCapitalData && (
                      <p className="text-sm text-muted-foreground text-center py-4">No draft capital data available</p>
                    )}
                  </Card>

                  {/* Roster Activity Card */}
                  <Card className="p-6">
                    <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                      <div className="flex items-center gap-3">
                        <RefreshCw className="w-5 h-5 text-primary" />
                        <h3 className="text-lg font-bold">Roster Activity</h3>
                      </div>
                      <Badge variant="outline" className="text-xs">Latest League</Badge>
                    </div>
                    <div className="flex gap-1 mb-3">
                      <Button
                        variant={churnTimeframe === "season" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setChurnTimeframe("season")}
                        data-testid="button-churn-timeframe-season"
                      >
                        Season
                      </Button>
                      <Button
                        variant={churnTimeframe === "last30" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setChurnTimeframe("last30")}
                        data-testid="button-churn-timeframe-last30"
                      >
                        30 Days
                      </Button>
                      <Button
                        variant={churnTimeframe === "lifetime" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setChurnTimeframe("lifetime")}
                        data-testid="button-churn-timeframe-lifetime"
                      >
                        All Time
                      </Button>
                    </div>

                    {churnLoading && (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      </div>
                    )}

                    {!churnLoading && churnData && (
                      <>
                        <div className="grid grid-cols-3 gap-4 mb-4">
                          <div className="text-center">
                            <div className="text-2xl font-bold font-mono">{churnData.adds}</div>
                            <div className="text-xs text-muted-foreground">Adds</div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold font-mono">{churnData.drops}</div>
                            <div className="text-xs text-muted-foreground">Drops</div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold font-mono">{churnData.trades}</div>
                            <div className="text-xs text-muted-foreground">Trades</div>
                          </div>
                        </div>

                        <div className="mt-4 pt-4 border-t border-border/50 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Total Moves</span>
                            <span className="font-mono font-bold">{churnData.total_moves}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Moves/Week</span>
                            <span className="font-mono">{churnData.churn_rate}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">League Rank</span>
                            <span className="font-mono">#{churnData.league_rank} of {churnData.league_size}</span>
                          </div>
                        </div>
                      </>
                    )}

                    {!churnLoading && !churnData && (
                      <p className="text-sm text-muted-foreground text-center py-4">No roster activity data available</p>
                    )}
                  </Card>

                  {/* All-Play / Luck Index Card */}
                  <Card className="p-6">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div className="flex items-center gap-3">
                        <Sparkles className="w-5 h-5 text-primary" />
                        <h3 className="text-lg font-bold">Luck Index</h3>
                      </div>
                      <Badge variant="outline" className="text-xs">Season-to-Date</Badge>
                    </div>

                    {allPlayLoading && (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      </div>
                    )}

                    {!allPlayLoading && allPlayData && (
                      <>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div className="text-center p-3 rounded-md bg-muted/30">
                            <div className="text-2xl font-bold font-mono">
                              {allPlayData.all_play_wins}-{allPlayData.all_play_losses}
                            </div>
                            <div className="text-xs text-muted-foreground">All-Play Record</div>
                          </div>
                          <div className="text-center p-3 rounded-md bg-muted/30">
                            <div className={`text-2xl font-bold ${(allPlayData.luck_index ?? 0) > 0 ? 'text-green-500' : (allPlayData.luck_index ?? 0) < 0 ? 'text-red-500' : ''}`}>
                              {(allPlayData.luck_index ?? 0) > 0 ? '+' : ''}{fmtNum(allPlayData.luck_index)}
                            </div>
                            <div className="text-xs text-muted-foreground">Luck Index</div>
                          </div>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">All-Play Win %</span>
                            <span className="font-mono">{fmtPct(allPlayData.all_play_pct)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Expected Wins</span>
                            <span className="font-mono">{fmtNum(allPlayData.expected_wins)}</span>
                          </div>
                        </div>
                      </>
                    )}

                    {!allPlayLoading && !allPlayData && (
                      <p className="text-sm text-muted-foreground text-center py-4">No luck data available</p>
                    )}
                  </Card>

                  {/* Trade Timing Card */}
                  <Card className="p-6">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div className="flex items-center gap-3">
                        <Calendar className="w-5 h-5 text-primary" />
                        <h3 className="text-lg font-bold">Trade Timing</h3>
                      </div>
                      <Badge variant="outline" className="text-xs">Latest League</Badge>
                    </div>

                    {tradeTimingLoading && (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      </div>
                    )}

                    {!tradeTimingLoading && tradeTimingData && (
                      <>
                        <div className="text-center mb-4">
                          <Badge variant="default" className="text-sm">
                            {tradeTimingData.trading_style}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center mb-4">
                          <div className="p-2 rounded-md bg-muted/30">
                            <div className="text-lg font-bold font-mono">{tradeTimingData.preseason}</div>
                            <div className="text-xs text-muted-foreground">Preseason</div>
                          </div>
                          <div className="p-2 rounded-md bg-muted/30">
                            <div className="text-lg font-bold font-mono">{tradeTimingData.in_season}</div>
                            <div className="text-xs text-muted-foreground">In-Season</div>
                          </div>
                          <div className="p-2 rounded-md bg-muted/30">
                            <div className="text-lg font-bold font-mono">{tradeTimingData.postseason}</div>
                            <div className="text-xs text-muted-foreground">Postseason</div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Total Trades</span>
                          <span className="font-mono font-bold">{tradeTimingData.total}</span>
                        </div>
                      </>
                    )}

                    {!tradeTimingLoading && !tradeTimingData && (
                      <p className="text-sm text-muted-foreground text-center py-4">No trade timing data available</p>
                    )}
                  </Card>
                </div>

                {/* Scouting Leaderboards */}
                <div className="mt-6">
                  <ScoutingSection leagueId={activeLeagueId} username={username} />
                </div>
              </TabsContent>

              {/* TEAMS TAB */}
              <TabsContent value="teams" className="mt-6">
                <TeamsSection leagueId={activeLeagueId} username={username} />
              </TabsContent>

              {/* TRADES TAB */}
              <TabsContent value="trades" className="mt-6">
                <TradesSection groupId={groupId} leagueId={activeLeagueId} username={username} />
                
                {/* Trade Log */}
                <Card className="p-6 mt-6">
                  <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <ArrowRightLeft className="w-5 h-5 text-primary" />
                      <h2 className="text-lg font-semibold">Trade Log</h2>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {viewMode === "current" ? "Current Season" : "All Seasons"}
                    </Badge>
                  </div>

                  {tradesLoading && (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  )}

                  {tradesData && tradesData.trades.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      No trades found.
                    </div>
                  )}

                  {tradesData && tradesData.trades.length > 0 && (
                    <div className="space-y-4">
                      {tradesData.trades.slice(0, 20).map((trade: Trade) => {
                        const addedPlayerIds = trade.adds ? Object.keys(trade.adds) : [];
                        const droppedPlayerIds = trade.drops ? Object.keys(trade.drops) : [];
                        
                        return (
                          <Card key={trade.transaction_id} className="p-4" data-testid={`trade-card-${trade.transaction_id}`}>
                            <div className="flex items-start justify-between gap-4 flex-wrap">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                  <Badge variant="outline">{trade.season || "?"}</Badge>
                                  {trade.league_name && (
                                    <span className="text-sm text-muted-foreground">{trade.league_name}</span>
                                  )}
                                </div>

                                {addedPlayerIds.length > 0 && (
                                  <div className="mb-2">
                                    <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Acquired</div>
                                    <div className="flex flex-wrap gap-1">
                                      {addedPlayerIds.slice(0, 5).map((playerId, idx) => (
                                        <Badge key={idx} variant="secondary" className="text-xs">
                                          {playerId}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {droppedPlayerIds.length > 0 && (
                                  <div className="mb-2">
                                    <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Traded Away</div>
                                    <div className="flex flex-wrap gap-1">
                                      {droppedPlayerIds.slice(0, 5).map((playerId, idx) => (
                                        <Badge key={idx} variant="outline" className="text-xs">
                                          {playerId}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {trade.draft_picks && trade.draft_picks.length > 0 && (
                                  <div className="mt-2">
                                    <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Draft Picks</div>
                                    <div className="flex flex-wrap gap-1">
                                      {trade.draft_picks.map((pick: any, idx: number) => (
                                        <Badge key={idx} variant="outline" className="text-xs">
                                          {pick.season} R{pick.round}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                              
                              <div className="text-xs text-muted-foreground">
                                {new Date(trade.created_at).toLocaleDateString()}
                              </div>
                            </div>
                          </Card>
                        );
                      })}

                      {tradesData.trades.length > 20 && (
                        <p className="text-center text-muted-foreground text-sm">
                          Showing 20 of {tradesData.trades.length} trades
                        </p>
                      )}
                    </div>
                  )}
                </Card>
              </TabsContent>

              {/* H2H TAB */}
              <TabsContent value="h2h" className="mt-6">
                <Card className="p-6">
                  <div className="flex items-center gap-3 mb-6">
                    <Target className="w-6 h-6 text-primary" />
                    <h2 className="text-2xl font-display font-bold">Head-to-Head Records</h2>
                    <Badge variant="outline" className="text-xs">
                      {viewMode === "current" ? "Latest Season" : "All Seasons"}
                    </Badge>
                  </div>

                  {h2hLoading && (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      <span className="ml-3 text-muted-foreground">Computing head-to-head records...</span>
                    </div>
                  )}

                  {h2hError && (
                    <div className="p-6 text-center text-muted-foreground">
                      <p>Failed to load head-to-head data.</p>
                      <p className="text-sm mt-1">{h2hError instanceof Error ? h2hError.message : "Unknown error"}</p>
                    </div>
                  )}

                  {h2hData && (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        <div className="p-4 rounded-md bg-muted/30">
                          <div className="flex items-center gap-3">
                            <Trophy className="w-5 h-5 text-accent" />
                            <div>
                              <div className="text-xl font-bold font-mono">
                                {formatRecord(h2hData.h2h_overall.wins, h2hData.h2h_overall.losses, h2hData.h2h_overall.ties)}
                              </div>
                              <div className="text-xs text-muted-foreground">H2H Overall</div>
                            </div>
                          </div>
                        </div>
                        <div className="p-4 rounded-md bg-muted/30">
                          <div className="flex items-center gap-3">
                            <TrendingUp className="w-5 h-5 text-green-500" />
                            <div>
                              <div className="text-xl font-bold">{h2hData.opponents.length}</div>
                              <div className="text-xs text-muted-foreground">Opponents Faced</div>
                            </div>
                          </div>
                        </div>
                        <div className="p-4 rounded-md bg-muted/30">
                          <div className="flex items-center gap-3">
                            <Target className="w-5 h-5 text-accent" />
                            <div>
                              <div className="text-xl font-bold">
                                {h2hData.opponents.reduce((acc, o) => acc + o.games, 0)}
                              </div>
                              <div className="text-xs text-muted-foreground">Total Games</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Opponent</TableHead>
                            <TableHead className="text-center">Record</TableHead>
                            <TableHead className="text-center">Win %</TableHead>
                            <TableHead className="text-center">Games</TableHead>
                            <TableHead className="text-right">PF</TableHead>
                            <TableHead className="text-right">PA</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {h2hData.opponents.map((opp) => {
                            const oppWinPct = opp.games > 0 
                              ? ((opp.wins + opp.ties * 0.5) / opp.games * 100).toFixed(1)
                              : "0.0";
                            const isWinning = opp.wins > opp.losses;
                            const isLosing = opp.losses > opp.wins;
                            
                            return (
                              <TableRow key={opp.opp_owner_id}>
                                <TableCell>
                                  <div>
                                    <div className="font-medium">{opp.display_name || "Unknown"}</div>
                                    {opp.team_name && (
                                      <div className="text-xs text-muted-foreground">{opp.team_name}</div>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-center font-mono">
                                  <Badge 
                                    variant={isWinning ? "default" : isLosing ? "secondary" : "outline"}
                                    className={isWinning ? "bg-green-500/15 text-green-400" : ""}
                                  >
                                    {formatRecord(opp.wins, opp.losses, opp.ties)}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-center">
                                  <span className={isWinning ? "text-green-400" : isLosing ? "text-red-400" : ""}>
                                    {oppWinPct}%
                                  </span>
                                </TableCell>
                                <TableCell className="text-center">{opp.games}</TableCell>
                                <TableCell className="text-right font-mono">{fmtNum(opp.pf)}</TableCell>
                                <TableCell className="text-right font-mono">{fmtNum(opp.pa)}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </>
                  )}
                </Card>
              </TabsContent>

              {/* HISTORY TAB */}
              <TabsContent value="history" className="mt-6">
                <Card className="p-6">
                  <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <History className="w-5 h-5 text-primary" />
                      <h2 className="text-lg font-semibold">Season History</h2>
                    </div>
                  </div>
                  
                  {seasonLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : !seasonData?.seasons || seasonData.seasons.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No season data available yet
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Season</TableHead>
                          <TableHead>Record</TableHead>
                          <TableHead>Win %</TableHead>
                          <TableHead>Reg Rank</TableHead>
                          <TableHead>Final</TableHead>
                          <TableHead>PF</TableHead>
                          <TableHead>Result</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {seasonData.seasons.map((s) => (
                          <TableRow 
                            key={s.season} 
                            data-testid={`row-season-${s.season}`}
                          >
                            <TableCell className="font-medium">{s.season}</TableCell>
                            <TableCell className="font-mono">
                              {s.record.wins}-{s.record.losses}
                              {s.record.ties > 0 && `-${s.record.ties}`}
                            </TableCell>
                            <TableCell>
                              {winPct(s.record.wins, s.record.losses, s.record.ties)}%
                            </TableCell>
                            <TableCell>{s.regular_rank ? `#${s.regular_rank}` : "-"}</TableCell>
                            <TableCell>{s.finish_place ? `#${s.finish_place}` : "?"}</TableCell>
                            <TableCell className="font-mono">{fmtNum(s.pf)}</TableCell>
                            <TableCell>
                              {s.playoff_finish ? (
                                <Badge variant={s.playoff_finish === "Champion" ? "default" : "outline"}>
                                  {s.playoff_finish === "Champion" && <Trophy className="w-3 h-3 mr-1" />}
                                  {s.playoff_finish}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-sm">-</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Card>
              </TabsContent>
            </Tabs>
          </motion.div>
          
          {/* Debug Panel */}
          {isDebug && leagueGroup && (
            <Card className="mt-8 p-4 bg-muted/50 border-dashed">
              <div className="flex items-center gap-2 mb-3">
                <Badge variant="outline" className="text-xs">DEBUG</Badge>
                <span className="text-sm font-mono font-medium">Phase 2.4 Diagnostics</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono">
                <div>
                  <span className="text-muted-foreground">activeLeagueId:</span>
                  <div className="truncate">{activeLeagueId || 'N/A'}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">groupId:</span>
                  <div className="truncate">{groupId}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">viewMode:</span>
                  <div>{viewMode}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">activeTab:</span>
                  <div>{activeTab}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">seasons:</span>
                  <div>{leagueGroup.min_season}-{leagueGroup.max_season} ({leagueGroup.seasons_count})</div>
                </div>
                <div>
                  <span className="text-muted-foreground">placement_source:</span>
                  <div>{selectedSeasonData?.source || 'N/A'}</div>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Trade Targets Modal */}
      {activeLeagueId && (
        <TradeTargetsModal
          isOpen={showTargetsModal}
          onClose={() => setShowTargetsModal(false)}
          username={username}
          leagueId={activeLeagueId}
          leagueName={leagueGroup.name}
        />
      )}
    </Layout>
  );
}
