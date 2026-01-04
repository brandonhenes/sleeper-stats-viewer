import { useParams, Link } from "wouter";
import { useSleeperOverview, usePlayerExposure, useSleeperSync, useSyncStatus, useSharedLeagues } from "@/hooks/use-sleeper";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, AlertCircle, Users, ArrowLeft, Trophy, RefreshCw, Target, Handshake, ChevronDown, ChevronRight } from "lucide-react";
import { Layout } from "@/components/Layout";
import { motion, AnimatePresence } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useEffect, useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export default function CompareResults() {
  const { userA, userB } = useParams<{ userA: string; userB: string }>();
  const queryClient = useQueryClient();
  
  const { data: dataA, isLoading: loadingA, error: errorA } = useSleeperOverview(userA);
  const { data: dataB, isLoading: loadingB, error: errorB } = useSleeperOverview(userB);
  const { data: exposureA, isLoading: exposureLoadingA } = usePlayerExposure(userA);
  const { data: exposureB, isLoading: exposureLoadingB } = usePlayerExposure(userB);
  const { data: sharedLeaguesData, isLoading: sharedLeaguesLoading } = useSharedLeagues(userA, userB);
  
  const [expandedLeagues, setExpandedLeagues] = useState<Set<string>>(new Set());

  const syncMutationA = useSleeperSync();
  const syncMutationB = useSleeperSync();
  const [jobIdA, setJobIdA] = useState<string | null>(null);
  const [jobIdB, setJobIdB] = useState<string | null>(null);
  
  const { data: statusA } = useSyncStatus(jobIdA || undefined, !!jobIdA);
  const { data: statusB } = useSyncStatus(jobIdB || undefined, !!jobIdB);

  const isLoading = loadingA || loadingB || exposureLoadingA || exposureLoadingB;
  const hasError = errorA || errorB;

  // Track if we've already triggered sync
  const [syncTriggeredA, setSyncTriggeredA] = useState(false);
  const [syncTriggeredB, setSyncTriggeredB] = useState(false);

  // Auto-sync if needed (only once per session)
  useEffect(() => {
    if (dataA?.needs_sync && dataA.sync_status !== "running" && !syncMutationA.isPending && !jobIdA && !syncTriggeredA) {
      setSyncTriggeredA(true);
      syncMutationA.mutate(userA!, {
        onSuccess: (data) => setJobIdA(data.job_id),
        onError: () => setSyncTriggeredA(false), // Allow retry on error
      });
    }
  }, [dataA?.needs_sync, dataA?.sync_status, syncMutationA.isPending, jobIdA, userA, syncTriggeredA]);

  useEffect(() => {
    if (dataB?.needs_sync && dataB.sync_status !== "running" && !syncMutationB.isPending && !jobIdB && !syncTriggeredB) {
      setSyncTriggeredB(true);
      syncMutationB.mutate(userB!, {
        onSuccess: (data) => setJobIdB(data.job_id),
        onError: () => setSyncTriggeredB(false), // Allow retry on error
      });
    }
  }, [dataB?.needs_sync, dataB?.sync_status, syncMutationB.isPending, jobIdB, userB, syncTriggeredB]);

  // Refetch when sync completes
  useEffect(() => {
    if (statusA?.status === "done") {
      queryClient.invalidateQueries({ queryKey: ["/api/overview", userA] });
      queryClient.invalidateQueries({ queryKey: ["/api/players/exposure", userA] });
      setJobIdA(null);
      setSyncTriggeredA(false); // Allow future resyncs
    }
  }, [statusA?.status, userA, queryClient]);

  useEffect(() => {
    if (statusB?.status === "done") {
      queryClient.invalidateQueries({ queryKey: ["/api/overview", userB] });
      queryClient.invalidateQueries({ queryKey: ["/api/players/exposure", userB] });
      setJobIdB(null);
      setSyncTriggeredB(false); // Allow future resyncs
    }
  }, [statusB?.status, userB, queryClient]);

  const calculateStats = (data: typeof dataA) => {
    if (!data) return { wins: 0, losses: 0, ties: 0, leagues: 0, winPct: "0.0" };
    const groups = data.league_groups || [];
    const wins = groups.reduce((acc, g) => acc + g.overall_record.wins, 0);
    const losses = groups.reduce((acc, g) => acc + g.overall_record.losses, 0);
    const ties = groups.reduce((acc, g) => acc + g.overall_record.ties, 0);
    const total = wins + losses + ties;
    const winPct = total > 0 ? ((wins + ties * 0.5) / total * 100).toFixed(1) : "0.0";
    return { wins, losses, ties, leagues: groups.length, winPct };
  };

  const statsA = calculateStats(dataA);
  const statsB = calculateStats(dataB);

  // Compute shared and unique players
  const comparison = useMemo(() => {
    if (!exposureA?.exposures || !exposureB?.exposures) {
      return { shared: [], uniqueA: [], uniqueB: [] };
    }

    const playersAMap: Record<string, typeof exposureA.exposures[0]> = {};
    const playersBMap: Record<string, typeof exposureB.exposures[0]> = {};
    
    for (const e of exposureA.exposures) {
      playersAMap[e.player.player_id] = e;
    }
    for (const e of exposureB.exposures) {
      playersBMap[e.player.player_id] = e;
    }

    const shared: Array<{ player_id: string; name: string; position: string | null; exposureA: number; exposureB: number }> = [];
    const uniqueA: Array<{ player_id: string; name: string; position: string | null; exposure: number }> = [];
    const uniqueB: Array<{ player_id: string; name: string; position: string | null; exposure: number }> = [];

    for (const id of Object.keys(playersAMap)) {
      const expA = playersAMap[id];
      const expB = playersBMap[id];
      const name = expA.player.full_name || id;
      if (expB) {
        shared.push({
          player_id: id,
          name,
          position: expA.player.position || null,
          exposureA: expA.exposure_pct,
          exposureB: expB.exposure_pct,
        });
      } else {
        uniqueA.push({
          player_id: id,
          name,
          position: expA.player.position || null,
          exposure: expA.exposure_pct,
        });
      }
    }

    for (const id of Object.keys(playersBMap)) {
      if (!playersAMap[id]) {
        const expB = playersBMap[id];
        uniqueB.push({
          player_id: id,
          name: expB.player.full_name || id,
          position: expB.player.position || null,
          exposure: expB.exposure_pct,
        });
      }
    }

    // Sort by exposure
    shared.sort((a, b) => (b.exposureA + b.exposureB) - (a.exposureA + a.exposureB));
    uniqueA.sort((a, b) => b.exposure - a.exposure);
    uniqueB.sort((a, b) => b.exposure - a.exposure);

    return { shared, uniqueA, uniqueB };
  }, [exposureA, exposureB]);

  const isSyncing = (statusA?.status === "running") || (statusB?.status === "running");

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <Link href="/compare">
          <Button variant="ghost" size="sm" className="mb-6 gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Compare
          </Button>
        </Link>

        {hasError && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-md mx-auto"
          >
            <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <AlertTitle className="ml-2 font-bold">Error Loading Data</AlertTitle>
              <AlertDescription className="ml-2 mt-1 opacity-90">
                {errorA ? `User A: ${errorA instanceof Error ? errorA.message : "Not found"}` : ""}
                {errorA && errorB ? " | " : ""}
                {errorB ? `User B: ${errorB instanceof Error ? errorB.message : "Not found"}` : ""}
              </AlertDescription>
            </Alert>
          </motion.div>
        )}

        {isSyncing && (
          <Card className="p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <RefreshCw className="w-5 h-5 animate-spin text-primary" />
              <span className="font-medium">Syncing data...</span>
            </div>
            {statusA?.status === "running" && (
              <div className="mb-2">
                <div className="text-sm text-muted-foreground mb-1">@{userA}: {statusA.detail}</div>
                <Progress value={((statusA.leagues_done || 0) / Math.max(statusA.leagues_total || 1, 1)) * 100} />
              </div>
            )}
            {statusB?.status === "running" && (
              <div>
                <div className="text-sm text-muted-foreground mb-1">@{userB}: {statusB.detail}</div>
                <Progress value={((statusB.leagues_done || 0) / Math.max(statusB.leagues_total || 1, 1)) * 100} />
              </div>
            )}
          </Card>
        )}

        {isLoading && !hasError && !isSyncing && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium animate-pulse">Loading comparison data...</p>
          </div>
        )}

        {dataA && dataB && !isSyncing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <div className="flex items-center justify-center gap-4 mb-8">
              <Users className="w-6 h-6 text-primary" />
              <h1 className="text-2xl font-display font-bold">User Comparison</h1>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <Card className="p-6">
                <div className="flex items-center gap-4 mb-4">
                  <Avatar className="w-16 h-16 border-2 border-primary">
                    <AvatarImage src={`https://sleepercdn.com/avatars/thumbs/${dataA.user.avatar}`} />
                    <AvatarFallback className="text-xl font-bold bg-primary text-primary-foreground">
                      {dataA.user.display_name.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h2 className="text-xl font-bold">{dataA.user.display_name}</h2>
                    <p className="text-muted-foreground">@{dataA.user.username}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold font-mono">{statsA.leagues}</div>
                    <div className="text-xs text-muted-foreground uppercase">Leagues</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold font-mono">
                      {statsA.wins}-{statsA.losses}
                    </div>
                    <div className="text-xs text-muted-foreground uppercase">Record</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold font-mono">{statsA.winPct}%</div>
                    <div className="text-xs text-muted-foreground uppercase">Win %</div>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center gap-4 mb-4">
                  <Avatar className="w-16 h-16 border-2 border-accent">
                    <AvatarImage src={`https://sleepercdn.com/avatars/thumbs/${dataB.user.avatar}`} />
                    <AvatarFallback className="text-xl font-bold bg-accent text-accent-foreground">
                      {dataB.user.display_name.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h2 className="text-xl font-bold">{dataB.user.display_name}</h2>
                    <p className="text-muted-foreground">@{dataB.user.username}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold font-mono">{statsB.leagues}</div>
                    <div className="text-xs text-muted-foreground uppercase">Leagues</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold font-mono">
                      {statsB.wins}-{statsB.losses}
                    </div>
                    <div className="text-xs text-muted-foreground uppercase">Record</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold font-mono">{statsB.winPct}%</div>
                    <div className="text-xs text-muted-foreground uppercase">Win %</div>
                  </div>
                </div>
              </Card>
            </div>

            {/* Shared Players */}
            <Card className="mb-6">
              <div className="p-4 border-b flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-semibold flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-primary" />
                  Shared Players
                </h3>
                <Badge variant="outline">{comparison.shared.length} players</Badge>
              </div>
              {comparison.shared.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No shared players found.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Player</TableHead>
                      <TableHead className="text-center">Pos</TableHead>
                      <TableHead className="text-center">@{userA}</TableHead>
                      <TableHead className="text-center">@{userB}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comparison.shared.slice(0, 25).map((p) => (
                      <TableRow key={p.player_id} data-testid={`row-shared-${p.player_id}`}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-xs">{p.position || "?"}</Badge>
                        </TableCell>
                        <TableCell className="text-center font-mono">{p.exposureA}%</TableCell>
                        <TableCell className="text-center font-mono">{p.exposureB}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>

            {/* Unique Players Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <div className="p-4 border-b flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="font-semibold">Only @{userA}</h3>
                  <Badge variant="outline">{comparison.uniqueA.length} players</Badge>
                </div>
                {comparison.uniqueA.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    No unique players.
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto">
                    <Table>
                      <TableBody>
                        {comparison.uniqueA.slice(0, 20).map((p) => (
                          <TableRow key={p.player_id}>
                            <TableCell className="font-medium">{p.name}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className="text-xs">{p.position || "?"}</Badge>
                            </TableCell>
                            <TableCell className="text-center font-mono text-muted-foreground">{p.exposure}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>

              <Card>
                <div className="p-4 border-b flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="font-semibold">Only @{userB}</h3>
                  <Badge variant="outline">{comparison.uniqueB.length} players</Badge>
                </div>
                {comparison.uniqueB.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    No unique players.
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto">
                    <Table>
                      <TableBody>
                        {comparison.uniqueB.slice(0, 20).map((p) => (
                          <TableRow key={p.player_id}>
                            <TableCell className="font-medium">{p.name}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className="text-xs">{p.position || "?"}</Badge>
                            </TableCell>
                            <TableCell className="text-center font-mono text-muted-foreground">{p.exposure}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>
            </div>

            {/* Trade Targeting - Shared Leagues */}
            <Card className="mt-6">
              <div className="p-4 border-b flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-semibold flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" />
                  Trade Targeting - Shared Leagues
                </h3>
                <Badge variant="outline">
                  {sharedLeaguesLoading ? "Loading..." : `${sharedLeaguesData?.shared_leagues.length || 0} leagues`}
                </Badge>
              </div>
              {sharedLeaguesLoading ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                  Loading shared leagues...
                </div>
              ) : !sharedLeaguesData || sharedLeaguesData.shared_leagues.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Handshake className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  No shared leagues found between these users.
                </div>
              ) : (
                <div className="divide-y">
                  {sharedLeaguesData.shared_leagues.map((league, leagueIndex) => {
                    const isExpanded = expandedLeagues.has(league.league_id);
                    const toggleExpand = () => {
                      setExpandedLeagues(prev => {
                        const next = new Set(prev);
                        if (next.has(league.league_id)) {
                          next.delete(league.league_id);
                        } else {
                          next.add(league.league_id);
                        }
                        return next;
                      });
                    };
                    
                    // Find trade bait: players userA has that userB doesn't (and vice versa)
                    // Guard against null/undefined player arrays
                    const userAPlayers = league.userA_players || [];
                    const userBPlayers = league.userB_players || [];
                    const userAPlayerIds = new Set(userAPlayers.map(p => p.player_id));
                    const userBPlayerIds = new Set(userBPlayers.map(p => p.player_id));
                    const tradeBaitFromA = userAPlayers.filter(p => !userBPlayerIds.has(p.player_id));
                    const tradeBaitFromB = userBPlayers.filter(p => !userAPlayerIds.has(p.player_id));
                    
                    return (
                      <Collapsible key={league.league_id} open={isExpanded} onOpenChange={toggleExpand}>
                        <CollapsibleTrigger className="w-full p-4 flex items-center justify-between gap-2 hover-elevate" data-testid={`league-toggle-${leagueIndex}`}>
                          <div className="flex items-center gap-3">
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            <span className="font-medium">{league.name}</span>
                            <Badge variant="secondary">{league.season}</Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{(league.userA_players || []).length} vs {(league.userB_players || []).length} players</Badge>
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="px-4 pb-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="p-3 rounded-md bg-muted/30">
                                <div className="text-sm font-medium mb-2 flex items-center gap-2">
                                  <Target className="w-3 h-3" />
                                  @{userA} can offer ({tradeBaitFromA.length})
                                </div>
                                {tradeBaitFromA.length === 0 ? (
                                  <p className="text-sm text-muted-foreground">No unique players</p>
                                ) : (
                                  <div className="flex flex-wrap gap-1">
                                    {tradeBaitFromA.slice(0, 10).map((p, idx) => (
                                      <Badge key={p.player_id} variant="outline" className="text-xs" data-testid={`bait-a-${leagueIndex}-${idx}`}>
                                        {p.name} ({p.position || "?"})
                                      </Badge>
                                    ))}
                                    {tradeBaitFromA.length > 10 && (
                                      <Badge variant="secondary" className="text-xs">+{tradeBaitFromA.length - 10} more</Badge>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="p-3 rounded-md bg-muted/30">
                                <div className="text-sm font-medium mb-2 flex items-center gap-2">
                                  <Target className="w-3 h-3" />
                                  @{userB} can offer ({tradeBaitFromB.length})
                                </div>
                                {tradeBaitFromB.length === 0 ? (
                                  <p className="text-sm text-muted-foreground">No unique players</p>
                                ) : (
                                  <div className="flex flex-wrap gap-1">
                                    {tradeBaitFromB.slice(0, 10).map((p, idx) => (
                                      <Badge key={p.player_id} variant="outline" className="text-xs" data-testid={`bait-b-${leagueIndex}-${idx}`}>
                                        {p.name} ({p.position || "?"})
                                      </Badge>
                                    ))}
                                    {tradeBaitFromB.length > 10 && (
                                      <Badge variant="secondary" className="text-xs">+{tradeBaitFromB.length - 10} more</Badge>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
                </div>
              )}
            </Card>
          </motion.div>
        )}
      </div>
    </Layout>
  );
}
