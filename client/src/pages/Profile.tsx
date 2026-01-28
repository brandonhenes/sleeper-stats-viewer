import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useSleeperOverview, useSleeperSync, useSyncStatus } from "@/hooks/use-sleeper";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, RefreshCw, Clock, Filter, Trophy, Zap, TrendingUp, ArrowRight } from "lucide-react";
import { LeagueGroupCard } from "@/components/LeagueCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { motion } from "framer-motion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { Layout } from "@/components/Layout";
import { useSeason } from "@/hooks/useSeason";
import { SeasonSelector } from "@/components/SeasonSelector";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

type LeagueType = "all" | "dynasty" | "redraft" | "unknown";

export default function Profile() {
  const { username } = useParams<{ username: string }>();
  const [, setLocation] = useLocation();
  const [jobId, setJobId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<LeagueType>("all");
  const { toast } = useToast();

  const { data, isLoading, error, isError, refetch } = useSleeperOverview(username);
  const syncMutation = useSleeperSync();
  const { data: syncStatus } = useSyncStatus(jobId || undefined, !!jobId);
  
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
  const activeGroups = allLeagueGroups.filter(g => g.is_active !== false);
  
  const seasonFilteredGroups = season 
    ? activeGroups.filter(g => g.min_season <= season && g.max_season >= season)
    : activeGroups;
  
  const filteredGroups = seasonFilteredGroups.filter((g) => {
    if (typeFilter === "all") return true;
    const leagueType = g.league_type || "unknown";
    return leagueType === typeFilter;
  });

  const isSyncing = syncMutation.isPending || (syncStatus?.status === "running") || data?.sync_status === "running";

  const formatLastSync = (timestamp?: number) => {
    if (!timestamp) return "Never";
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const totalWins = activeGroups.reduce((acc, g) => acc + g.overall_record.wins, 0);
  const totalLosses = activeGroups.reduce((acc, g) => acc + g.overall_record.losses, 0);
  const totalTies = activeGroups.reduce((acc, g) => acc + g.overall_record.ties, 0);
  const totalGames = totalWins + totalLosses + totalTies;
  const winPct = totalGames > 0 ? ((totalWins + totalTies * 0.5) / totalGames * 100).toFixed(1) : "0.0";

  const dynastyCount = activeGroups.filter(g => g.league_type === "dynasty").length;
  const redraftCount = activeGroups.filter(g => g.league_type === "redraft").length;
  const unknownCount = activeGroups.filter(g => !g.league_type || g.league_type === "unknown").length;

  const syncProgress = syncStatus?.leagues_total && syncStatus.leagues_total > 0
    ? Math.round((syncStatus.leagues_done || 0) / syncStatus.leagues_total * 100)
    : 0;

  const sortedFilteredGroups = useMemo(() => {
    return [...filteredGroups].sort((a, b) => {
      const aPower = a.power;
      const bPower = b.power;
      
      if (!aPower && !bPower) return a.name.localeCompare(b.name);
      if (!aPower) return 1;
      if (!bPower) return -1;
      
      if (aPower.lowConfidence && !bPower.lowConfidence) return 1;
      if (!aPower.lowConfidence && bPower.lowConfidence) return -1;
      
      if (aPower.rank !== bPower.rank) return aPower.rank - bPower.rank;
      
      return bPower.total - aPower.total;
    });
  }, [filteredGroups]);

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

              <div className="grid md:grid-cols-2 gap-4 mb-8">
                <Link href={`/trophy/${username}`}>
                  <Card className="hover-elevate cursor-pointer h-full">
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <div className="p-3 rounded-lg bg-yellow-500/10">
                          <Trophy className="w-8 h-8 text-yellow-500" />
                        </div>
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            Trophy Room
                            <ArrowRight className="w-4 h-4" />
                          </CardTitle>
                          <CardDescription>View your historical achievements</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Season history, head-to-head records, championships, and milestones from your dynasty legacy.
                      </p>
                    </CardContent>
                  </Card>
                </Link>
                
                <Link href={`/edge/${username}`}>
                  <Card className="hover-elevate cursor-pointer h-full">
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <div className="p-3 rounded-lg bg-blue-500/10">
                          <Zap className="w-8 h-8 text-blue-500" />
                        </div>
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            Edge Engine
                            <ArrowRight className="w-4 h-4" />
                          </CardTitle>
                          <CardDescription>Strategic decision-making tools</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Power rankings, team archetypes, age curves, trade radar, and roster analysis.
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              </div>

              <div className="flex items-center gap-4 mb-6 flex-wrap">
                <SeasonSelector 
                  season={season} 
                  seasons={seasons} 
                  onChange={setSeason} 
                />
                
                <div className="h-6 w-px bg-border" />
                
                <div className="flex items-center gap-2 flex-wrap">
                  <Filter className="w-4 h-4 text-muted-foreground" />
                  <Badge
                    variant={typeFilter === "all" ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setTypeFilter("all")}
                    data-testid="filter-all"
                  >
                    All ({activeGroups.length})
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
              </div>

              {sortedFilteredGroups.length === 0 ? (
                <div className="text-center py-12">
                  <TrendingUp className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-xl font-semibold mb-2">No Leagues Found</h3>
                  <p className="text-muted-foreground">
                    {typeFilter !== "all" 
                      ? `No ${typeFilter} leagues found for this season.`
                      : "No active leagues found. Try syncing your data."}
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {sortedFilteredGroups.map((group, idx) => (
                    <motion.div
                      key={group.group_id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                    >
                      <LeagueGroupCard 
                        group={group} 
                        index={idx}
                        username={username || ""} 
                        selectedSeason={season}
                      />
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </Layout>
  );
}
