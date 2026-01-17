import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useSleeperOverview, useSleeperSync, useSyncStatus, useGroupAnalytics } from "@/hooks/use-sleeper";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, RefreshCw, Clock, Filter, LayoutList, LayoutGrid, ArrowUpDown, ChevronUp, ChevronDown, Trophy, TrendingUp } from "lucide-react";
import { LeagueGroupCard } from "@/components/LeagueCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { motion } from "framer-motion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { Layout } from "@/components/Layout";
import { useSeason } from "@/hooks/useSeason";
import { SeasonSelector } from "@/components/SeasonSelector";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type LeagueType = "all" | "dynasty" | "redraft" | "unknown";
type ViewMode = "active" | "history";
type DisplayMode = "cards" | "table";
type SortKey = "name" | "rank" | "starters" | "total" | "coverage";
type SortDir = "asc" | "desc";

export default function Profile() {
  const { username } = useParams<{ username: string }>();
  const [, setLocation] = useLocation();
  const [jobId, setJobId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<LeagueType>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("active");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("cards");
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const { toast } = useToast();

  const { data, isLoading, error, isError, refetch } = useSleeperOverview(username);
  const syncMutation = useSleeperSync();
  const { data: syncStatus } = useSyncStatus(jobId || undefined, !!jobId);
  
  // Derive available seasons before calling useGroupAnalytics
  const allLeagueGroupsForSeasons = data?.league_groups || [];
  const availableSeasonsEarly = useMemo(() => {
    const seasons = new Set<number>();
    allLeagueGroupsForSeasons.forEach(g => {
      for (let s = g.min_season; s <= g.max_season; s++) {
        seasons.add(s);
      }
    });
    return Array.from(seasons).sort((a, b) => b - a);
  }, [allLeagueGroupsForSeasons]);
  
  const latestCompletedSeasonEarly = (data as any)?.latest_completed_season ?? null;
  const { season, setSeason, seasons } = useSeason(availableSeasonsEarly, latestCompletedSeasonEarly);
  
  const { data: groupAnalytics, isLoading: analyticsLoading } = useGroupAnalytics(username, season || undefined);

  const autoSyncTriggeredRef = useRef(false);

  useEffect(() => {
    autoSyncTriggeredRef.current = false;
  }, [username]);

  useEffect(() => {
    if (
      data &&
      data.needs_sync === true &&
      data.sync_status === "not_started" &&
      username &&
      !autoSyncTriggeredRef.current &&
      !syncMutation.isPending &&
      !jobId
    ) {
      autoSyncTriggeredRef.current = true;
      syncMutation.mutate(username, {
        onSuccess: (result) => {
          setJobId(result.job_id);
        },
        onError: (err) => {
          toast({
            variant: "destructive",
            title: "Sync Failed",
            description: err instanceof Error ? err.message : "Could not sync data",
          });
        },
      });
    }
  }, [data, username, syncMutation.isPending, jobId, toast]);

  useEffect(() => {
    if (syncStatus && syncStatus.status === "done") {
      refetch();
      setJobId(null);
      toast({
        title: "Sync Complete",
        description: syncStatus.detail || "Data synchronized successfully",
      });
    } else if (syncStatus && syncStatus.status === "error") {
      setJobId(null);
      toast({
        variant: "destructive",
        title: "Sync Error",
        description: syncStatus.error || "Sync failed",
      });
    }
  }, [syncStatus?.status]);

  const handleManualSync = async () => {
    if (!username) return;
    try {
      const result = await syncMutation.mutateAsync(username);
      setJobId(result.job_id);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Sync Failed",
        description: err instanceof Error ? err.message : "Could not sync data",
      });
    }
  };

  const allLeagueGroups = data?.league_groups || [];

  // Split into active vs history groups based on is_active flag
  const activeGroups = allLeagueGroups.filter(g => g.is_active !== false);
  const historyGroups = allLeagueGroups.filter(g => g.is_active === false);
  
  // Use the selected view mode to determine base groups
  const leagueGroups = viewMode === "active" ? activeGroups : historyGroups;
  
  // Filter by season (show groups that include the selected season)
  const seasonFilteredGroups = season 
    ? leagueGroups.filter(g => g.min_season <= season && g.max_season >= season)
    : leagueGroups;
  
  const filteredGroups = seasonFilteredGroups.filter((g) => {
    if (typeFilter === "all") return true;
    const leagueType = g.league_type || "unknown";
    return leagueType === typeFilter;
  });

  const hasLeagues = filteredGroups.length > 0;
  const isSyncing = syncMutation.isPending || (syncStatus?.status === "running") || data?.sync_status === "running";

  const formatLastSync = (timestamp?: number) => {
    if (!timestamp) return "Never";
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  // Stats computed from active groups only (default view)
  const totalWins = activeGroups.reduce((acc, g) => acc + g.overall_record.wins, 0);
  const totalLosses = activeGroups.reduce((acc, g) => acc + g.overall_record.losses, 0);
  const totalTies = activeGroups.reduce((acc, g) => acc + g.overall_record.ties, 0);
  const totalGames = totalWins + totalLosses + totalTies;
  const winPct = totalGames > 0 ? ((totalWins + totalTies * 0.5) / totalGames * 100).toFixed(1) : "0.0";

  // Type counts for current view mode
  const dynastyCount = leagueGroups.filter(g => g.league_type === "dynasty").length;
  const redraftCount = leagueGroups.filter(g => g.league_type === "redraft").length;
  const unknownCount = leagueGroups.filter(g => !g.league_type || g.league_type === "unknown").length;

  const syncProgress = syncStatus?.leagues_total && syncStatus.leagues_total > 0
    ? Math.round((syncStatus.leagues_done || 0) / syncStatus.leagues_total * 100)
    : 0;

  // Build set of group IDs that match current filters
  const filteredGroupIds = useMemo(() => {
    return new Set(filteredGroups.map(g => g.group_id));
  }, [filteredGroups]);

  // Sorted analytics with rank distribution (filtered to match cards view)
  const sortedAnalytics = useMemo(() => {
    if (!groupAnalytics?.group_analytics) return [];
    
    // Filter analytics to only include groups matching current view/type/season filters
    const analytics = groupAnalytics.group_analytics.filter(a => filteredGroupIds.has(a.group_id));
    
    analytics.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.league_name.localeCompare(b.league_name);
          break;
        case "rank":
          cmp = (a.my_talent_rank ?? 999) - (b.my_talent_rank ?? 999);
          break;
        case "starters":
          cmp = b.starter_value - a.starter_value;
          break;
        case "total":
          cmp = b.total_value - a.total_value;
          break;
        case "coverage":
          cmp = b.coverage_pct - a.coverage_pct;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    
    return analytics;
  }, [groupAnalytics, sortKey, sortDir, filteredGroupIds]);

  // Rank distribution for summary
  const rankDistribution = useMemo(() => {
    if (!sortedAnalytics.length) return { top3: 0, top6: 0, bottom3: 0, avg: 0 };
    
    const rankedLeagues = sortedAnalytics.filter(a => a.my_talent_rank !== null);
    if (!rankedLeagues.length) return { top3: 0, top6: 0, bottom3: 0, avg: 0 };
    
    const top3 = rankedLeagues.filter(a => a.my_talent_rank! <= 3).length;
    const top6 = rankedLeagues.filter(a => a.my_talent_rank! <= 6).length;
    const bottom3 = rankedLeagues.filter(a => {
      const total = a.total_rosters;
      return a.my_talent_rank! > (total - 3);
    }).length;
    const avg = rankedLeagues.reduce((sum, a) => sum + (a.my_talent_rank || 0), 0) / rankedLeagues.length;
    
    return { top3, top6, bottom3, avg };
  }, [sortedAnalytics]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "asc");
    }
  };

  const fmtValue = (v: number) => {
    if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
    return v.toString();
  };

  const getRankBadgeColor = (rank: number | null, total: number) => {
    if (rank === null) return "bg-muted text-muted-foreground";
    const pct = rank / total;
    if (pct <= 0.25) return "bg-green-500/20 text-green-600 dark:text-green-400";
    if (pct <= 0.5) return "bg-blue-500/20 text-blue-600 dark:text-blue-400";
    if (pct <= 0.75) return "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400";
    return "bg-red-500/20 text-red-600 dark:text-red-400";
  };

  return (
    <Layout username={username}>
      <div className="pb-20">
        {isError && (
          <div className="container mx-auto px-4 py-12 max-w-6xl">
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-md mx-auto"
            >
              <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <AlertTitle className="ml-2 font-bold">Error Fetching Data</AlertTitle>
                <AlertDescription className="ml-2 mt-1 opacity-90">
                  {error instanceof Error ? error.message : "Could not find user or load leagues."}
                </AlertDescription>
              </Alert>
              <div className="text-center mt-4">
                <Link href="/">
                  <Button variant="outline">Search Again</Button>
                </Link>
              </div>
            </motion.div>
          </div>
        )}

        {isLoading && !isError && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium animate-pulse">Loading profile...</p>
          </div>
        )}

        {data && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            <div className="bg-secondary/30 border-b border-border/50">
              <div className="container mx-auto px-4 py-8 max-w-6xl">
                <div className="flex flex-col md:flex-row items-center gap-6">
                  <Avatar className="w-24 h-24 border-4 border-background shadow-xl">
                    <AvatarImage src={`https://sleepercdn.com/avatars/thumbs/${data.user.avatar}`} />
                    <AvatarFallback className="text-3xl font-bold bg-primary text-primary-foreground">
                      {data.user.display_name.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="text-center md:text-left flex-1">
                    <h1 className="text-3xl font-display font-bold">{data.user.display_name}</h1>
                    <p className="text-lg text-muted-foreground font-mono">@{data.user.username}</p>
                    {data.lastSyncedAt && (
                      <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1 justify-center md:justify-start">
                        <Clock className="w-3 h-3" />
                        Last synced: {formatLastSync(data.lastSyncedAt)}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-6 text-center items-center flex-wrap justify-center">
                    <div>
                      <div className="text-3xl font-bold text-primary font-display">{activeGroups.length}</div>
                      <div className="text-sm text-muted-foreground uppercase tracking-wider font-medium">Active</div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-primary font-display">
                        {totalWins}-{totalLosses}{totalTies > 0 ? `-${totalTies}` : ""}
                      </div>
                      <div className="text-sm text-muted-foreground uppercase tracking-wider font-medium">Overall</div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-primary font-display">{winPct}%</div>
                      <div className="text-sm text-muted-foreground uppercase tracking-wider font-medium">Win Rate</div>
                    </div>
                    <Button
                      onClick={handleManualSync}
                      disabled={isSyncing}
                      variant="outline"
                      className="gap-2"
                      data-testid="button-sync"
                    >
                      {isSyncing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                      {isSyncing ? "Syncing..." : "Sync Now"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="container mx-auto px-4 py-8 max-w-6xl">
              {isSyncing && syncStatus && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-8 p-4 rounded-xl bg-secondary/30 border border-border/50"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{syncStatus.detail || "Syncing..."}</span>
                    <span className="text-sm text-muted-foreground">
                      {syncStatus.leagues_done || 0} / {syncStatus.leagues_total || 0}
                    </span>
                  </div>
                  <Progress value={syncProgress} className="h-2" />
                </motion.div>
              )}

              <div className="flex items-center gap-4 mb-6 flex-wrap">
                <SeasonSelector 
                  season={season} 
                  seasons={seasons} 
                  onChange={setSeason} 
                />
                
                <div className="h-6 w-px bg-border" />
                
                <div className="flex gap-2">
                  <Button
                    variant={viewMode === "active" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setViewMode("active")}
                    data-testid="view-active"
                  >
                    Active ({activeGroups.length})
                  </Button>
                  <Button
                    variant={viewMode === "history" ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setViewMode("history")}
                    data-testid="view-history"
                  >
                    History ({historyGroups.length})
                  </Button>
                </div>
                
                <div className="h-6 w-px bg-border" />
                
                <div className="flex items-center gap-2 flex-wrap">
                  <Filter className="w-4 h-4 text-muted-foreground" />
                  <Badge
                    variant={typeFilter === "all" ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setTypeFilter("all")}
                    data-testid="filter-all"
                  >
                    All ({leagueGroups.length})
                  </Badge>
                  <Badge
                    variant={typeFilter === "dynasty" ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setTypeFilter("dynasty")}
                    data-testid="filter-dynasty"
                  >
                    Dynasty ({dynastyCount})
                  </Badge>
                  <Badge
                    variant={typeFilter === "redraft" ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setTypeFilter("redraft")}
                    data-testid="filter-redraft"
                  >
                    Redraft ({redraftCount})
                  </Badge>
                  {unknownCount > 0 && (
                    <Badge
                      variant={typeFilter === "unknown" ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => setTypeFilter("unknown")}
                      data-testid="filter-unknown"
                    >
                      Unknown ({unknownCount})
                    </Badge>
                  )}
                </div>
                
                <div className="ml-auto flex gap-1">
                  <Button
                    size="icon"
                    variant={displayMode === "cards" ? "default" : "outline"}
                    onClick={() => setDisplayMode("cards")}
                    data-testid="display-cards"
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant={displayMode === "table" ? "default" : "outline"}
                    onClick={() => setDisplayMode("table")}
                    data-testid="display-table"
                  >
                    <LayoutList className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {displayMode === "table" && (
                <div className="mb-8">
                  <Card>
                    <CardHeader className="py-4">
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <TrendingUp className="w-5 h-5 text-primary" />
                          Talent Rankings
                        </CardTitle>
                        {sortedAnalytics.length > 0 && (
                          <div className="flex gap-4 text-sm">
                            <div className="flex items-center gap-1">
                              <Trophy className="w-4 h-4 text-green-500" />
                              <span>Top 3: {rankDistribution.top3}</span>
                            </div>
                            <div>Top 6: {rankDistribution.top6}</div>
                            <div className="text-muted-foreground">
                              Avg Rank: {rankDistribution.avg.toFixed(1)}
                            </div>
                          </div>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      {analyticsLoading ? (
                        <div className="flex items-center justify-center py-12">
                          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : sortedAnalytics.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                          No talent data available
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-muted/30">
                                <th 
                                  className="text-left py-3 px-4 font-medium cursor-pointer hover-elevate"
                                  onClick={() => handleSort("name")}
                                  data-testid="sort-name"
                                >
                                  <div className="flex items-center gap-1">
                                    League
                                    {sortKey === "name" && (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                                  </div>
                                </th>
                                <th className="text-center py-3 px-2 font-medium">Format</th>
                                <th 
                                  className="text-center py-3 px-4 font-medium cursor-pointer hover-elevate"
                                  onClick={() => handleSort("rank")}
                                  data-testid="sort-rank"
                                >
                                  <div className="flex items-center justify-center gap-1">
                                    Rank
                                    {sortKey === "rank" && (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                                  </div>
                                </th>
                                <th 
                                  className="text-right py-3 px-4 font-medium cursor-pointer hover-elevate"
                                  onClick={() => handleSort("starters")}
                                  data-testid="sort-starters"
                                >
                                  <div className="flex items-center justify-end gap-1">
                                    Starters
                                    {sortKey === "starters" && (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                                  </div>
                                </th>
                                <th className="text-right py-3 px-4 font-medium">Bench</th>
                                <th className="text-right py-3 px-4 font-medium">Picks</th>
                                <th 
                                  className="text-right py-3 px-4 font-medium cursor-pointer hover-elevate"
                                  onClick={() => handleSort("total")}
                                  data-testid="sort-total"
                                >
                                  <div className="flex items-center justify-end gap-1">
                                    Total
                                    {sortKey === "total" && (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                                  </div>
                                </th>
                                <th 
                                  className="text-right py-3 px-4 font-medium cursor-pointer hover-elevate"
                                  onClick={() => handleSort("coverage")}
                                  data-testid="sort-coverage"
                                >
                                  <div className="flex items-center justify-end gap-1">
                                    Coverage
                                    {sortKey === "coverage" && (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                                  </div>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {sortedAnalytics.map((a) => (
                                <tr 
                                  key={a.group_id} 
                                  className="border-b last:border-0 hover-elevate cursor-pointer"
                                  onClick={() => setLocation(`/u/${username}/league/${a.group_id}`)}
                                  data-testid={`row-league-${a.group_id}`}
                                >
                                  <td className="py-3 px-4 font-medium">{a.league_name}</td>
                                  <td className="py-3 px-2 text-center">
                                    <div className="flex items-center justify-center gap-1">
                                      {a.format.superflex && (
                                        <Badge variant="outline" className="text-xs px-1.5 py-0.5">SF</Badge>
                                      )}
                                      {a.format.tep && (
                                        <Badge variant="outline" className="text-xs px-1.5 py-0.5">TEP</Badge>
                                      )}
                                      {!a.format.superflex && !a.format.tep && (
                                        <span className="text-muted-foreground text-xs">1QB</span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-3 px-4 text-center">
                                    <Badge className={`${getRankBadgeColor(a.my_talent_rank, a.total_rosters)} px-2`}>
                                      {a.my_talent_rank !== null ? `#${a.my_talent_rank}` : "—"} / {a.total_rosters}
                                    </Badge>
                                  </td>
                                  <td className="py-3 px-4 text-right font-mono">{fmtValue(a.starter_value)}</td>
                                  <td className="py-3 px-4 text-right font-mono text-muted-foreground">{fmtValue(a.bench_value)}</td>
                                  <td className="py-3 px-4 text-right font-mono text-muted-foreground">{fmtValue(a.pick_value)}</td>
                                  <td className="py-3 px-4 text-right font-mono font-bold">{fmtValue(a.total_value)}</td>
                                  <td className="py-3 px-4 text-right">
                                    <span className={a.coverage_pct >= 80 ? "text-green-600 dark:text-green-400" : a.coverage_pct >= 50 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}>
                                      {a.coverage_pct}%
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

              {displayMode === "cards" && hasLeagues && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredGroups.map((group, idx) => (
                    <LeagueGroupCard 
                      key={group.group_id} 
                      group={group} 
                      index={idx} 
                      username={username || ""} 
                      selectedSeason={season}
                    />
                  ))}
                </div>
              )}

              {!hasLeagues && !isSyncing && leagueGroups.length > 0 && (
                <div className="text-center py-20 opacity-50">
                  <p className="text-xl">No leagues match this filter.</p>
                </div>
              )}

              {!hasLeagues && !isSyncing && leagueGroups.length === 0 && (
                <div className="text-center py-20 opacity-50">
                  <p className="text-xl">No leagues found for this user.</p>
                  <p className="text-muted-foreground mt-2">Try clicking "Sync Now" to fetch data.</p>
                </div>
              )}

              {!hasLeagues && isSyncing && (
                <div className="text-center py-20">
                  <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
                  <p className="text-xl">Syncing your leagues...</p>
                  <p className="text-muted-foreground mt-2">This may take a moment.</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </Layout>
  );
}
