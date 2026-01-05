import { useState } from "react";
import { useParams, Link } from "wouter";
import { useSleeperOverview, useH2h, useTrades, useDraftCapital, useChurnStats, useTradeTiming, useAllPlay } from "@/hooks/use-sleeper";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Trophy, Target, TrendingUp, ArrowRightLeft, Layers, RefreshCw, Calendar, Sparkles } from "lucide-react";
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

export default function LeagueGroupDetails() {
  const params = useParams<{ groupId: string; username?: string }>();
  const groupId = params.groupId;
  
  const username = params.username || localStorage.getItem("sleeper_username") || undefined;

  const { data: overviewData, isLoading: overviewLoading } = useSleeperOverview(username);
  const { data: h2hData, isLoading: h2hLoading, error: h2hError } = useH2h(groupId, username);
  const { data: tradesData, isLoading: tradesLoading } = useTrades(groupId);

  const leagueGroup = overviewData?.league_groups.find((g) => g.group_id === groupId);
  
  // Get the latest league_id for the group (for draft capital and churn)
  const latestLeagueId = leagueGroup?.league_ids[leagueGroup.league_ids.length - 1];
  
  // Churn timeframe state: "season", "last30", "lifetime"
  const [churnTimeframe, setChurnTimeframe] = useState<string>("season");
  
  const { data: draftCapitalData, isLoading: draftCapitalLoading } = useDraftCapital(latestLeagueId, username);
  const { data: churnData, isLoading: churnLoading } = useChurnStats(latestLeagueId, username, churnTimeframe, groupId);
  const { data: tradeTimingData, isLoading: tradeTimingLoading } = useTradeTiming(latestLeagueId, username);
  const { data: allPlayData, isLoading: allPlayLoading } = useAllPlay(latestLeagueId, username);

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
    if (ties > 0) {
      return `${wins}-${losses}-${ties}`;
    }
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
        <div className="bg-secondary/30 border-b border-border/50 p-6">
          <div className="max-w-6xl mx-auto">
            <Link href={backLink}>
              <Button variant="ghost" size="sm" className="mb-4 gap-2">
                <ArrowLeft className="w-4 h-4" />
                Back to Profile
              </Button>
            </Link>
            
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
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
              </div>
              
              <div className="flex gap-4">
                <Card className="p-4 text-center">
                  <div className="text-2xl font-bold font-mono">
                    {formatRecord(
                      leagueGroup.overall_record.wins,
                      leagueGroup.overall_record.losses,
                      leagueGroup.overall_record.ties
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Official Record</div>
                </Card>
                <Card className="p-4 text-center">
                  <div className="text-2xl font-bold font-mono">
                    {winPct(
                      leagueGroup.overall_record.wins,
                      leagueGroup.overall_record.losses,
                      leagueGroup.overall_record.ties
                    )}%
                  </div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Win Rate</div>
                </Card>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto p-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <Target className="w-6 h-6 text-primary" />
              <h2 className="text-2xl font-display font-bold">Head-to-Head Records</h2>
            </div>

            {h2hLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <span className="ml-3 text-muted-foreground">Computing head-to-head records...</span>
              </div>
            )}

            {h2hError && (
              <Card className="p-6 text-center text-muted-foreground">
                <p>Failed to load head-to-head data.</p>
                <p className="text-sm mt-1">{h2hError instanceof Error ? h2hError.message : "Unknown error"}</p>
              </Card>
            )}

            {h2hData && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <Card className="p-4">
                    <div className="flex items-center gap-3">
                      <Trophy className="w-5 h-5 text-accent" />
                      <div>
                        <div className="text-xl font-bold font-mono">
                          {formatRecord(
                            h2hData.h2h_overall.wins,
                            h2hData.h2h_overall.losses,
                            h2hData.h2h_overall.ties
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">H2H Overall</div>
                      </div>
                    </div>
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center gap-3">
                      <TrendingUp className="w-5 h-5 text-green-500" />
                      <div>
                        <div className="text-xl font-bold">{h2hData.opponents.length}</div>
                        <div className="text-xs text-muted-foreground">Opponents Faced</div>
                      </div>
                    </div>
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center gap-3">
                      <Target className="w-5 h-5 text-accent" />
                      <div>
                        <div className="text-xl font-bold">
                          {h2hData.opponents.reduce((acc, o) => acc + o.games, 0)}
                        </div>
                        <div className="text-xs text-muted-foreground">Total Games</div>
                      </div>
                    </div>
                  </Card>
                </div>

                {(h2hData.h2h_overall.wins !== leagueGroup.overall_record.wins ||
                  h2hData.h2h_overall.losses !== leagueGroup.overall_record.losses) && (
                  <div className="mb-4 p-3 rounded-lg bg-accent/10 border border-accent/20 text-sm text-muted-foreground">
                    Note: Official record differs from H2H total. This is likely due to median-match scoring or bye weeks.
                  </div>
                )}

                <Card>
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
                            <TableCell className="text-right font-mono">{opp.pf.toFixed(1)}</TableCell>
                            <TableCell className="text-right font-mono">{opp.pa.toFixed(1)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Card>
              </>
            )}
          </motion.div>

          {/* Draft Capital, Churn & Trade Timing Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="mt-8"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Draft Capital Card */}
              <Card className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Layers className="w-5 h-5 text-primary" />
                  <h3 className="text-lg font-bold">Draft Capital</h3>
                </div>
                
                {draftCapitalLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                )}

                {!draftCapitalLoading && draftCapitalData && (
                  <>
                    <div className="space-y-3">
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
                          {Object.entries(draftCapitalData.picks_by_year).map(([year, rounds]: [string, any]) => (
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
                    </div>

                    <div className="mt-4 pt-4 border-t border-border/50 flex items-center justify-between gap-4 flex-wrap">
                      <div>
                        <div className="text-sm text-muted-foreground">Total Picks</div>
                        <div className="text-xl font-bold font-mono">{draftCapitalData.totals.total}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Hoard Index</div>
                        <div className="text-xl font-bold font-mono">{draftCapitalData.pick_hoard_index}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">1st Rounders</div>
                        <div className="text-xl font-bold font-mono">{draftCapitalData.totals.r1}</div>
                      </div>
                    </div>
                  </>
                )}

                {!draftCapitalLoading && !draftCapitalData && (
                  <p className="text-sm text-muted-foreground text-center py-4">No draft capital data available</p>
                )}
              </Card>

              {/* Churn Rate Card */}
              <Card className="p-6">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <RefreshCw className="w-5 h-5 text-primary" />
                    <h3 className="text-lg font-bold">Roster Activity</h3>
                  </div>
                  <div className="flex gap-1">
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
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Activity Level</span>
                        <Badge variant={
                          churnData.activity_level === "very_active" ? "default" :
                          churnData.activity_level === "active" ? "secondary" : "outline"
                        }>
                          {churnData.activity_level.replace("_", " ")}
                        </Badge>
                      </div>
                    </div>
                  </>
                )}

                {!churnLoading && !churnData && (
                  <p className="text-sm text-muted-foreground text-center py-4">No activity data available</p>
                )}
              </Card>

              {/* Trade Timing Card */}
              <Card className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Calendar className="w-5 h-5 text-primary" />
                  <h3 className="text-lg font-bold">Trade Timing</h3>
                </div>

                {tradeTimingLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                )}

                {!tradeTimingLoading && tradeTimingData && tradeTimingData.total_trades > 0 && (
                  <>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold font-mono">{tradeTimingData.draft_window}</div>
                        <div className="text-xs text-muted-foreground">Draft Window</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold font-mono">{tradeTimingData.in_season}</div>
                        <div className="text-xs text-muted-foreground">In-Season</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold font-mono">{tradeTimingData.playoffs}</div>
                        <div className="text-xs text-muted-foreground">Playoffs</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold font-mono">{tradeTimingData.offseason}</div>
                        <div className="text-xs text-muted-foreground">Offseason</div>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-border/50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Total Trades</span>
                        <span className="font-mono font-bold">{tradeTimingData.total_trades}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Trading Style</span>
                        <Badge variant="outline" className="capitalize">
                          {tradeTimingData.trading_style.replace("_", " ")}
                        </Badge>
                      </div>
                    </div>
                  </>
                )}

                {!tradeTimingLoading && (!tradeTimingData || tradeTimingData.total_trades === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">No trade data available</p>
                )}
              </Card>

              {/* All-Play / Luck Index Card */}
              <Card className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <h3 className="text-lg font-bold">Luck Index</h3>
                </div>

                {allPlayLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                )}

                {!allPlayLoading && allPlayData && allPlayData.weeks_played > 0 && (
                  <>
                    <div className="text-xs text-muted-foreground text-center mb-3">
                      Based on {allPlayData.weeks_played} week{allPlayData.weeks_played !== 1 ? 's' : ''} played
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold font-mono">
                          {allPlayData.actual.wins}-{allPlayData.actual.losses}
                          {allPlayData.actual.ties > 0 && `-${allPlayData.actual.ties}`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Actual ({allPlayData.actual.games} game{allPlayData.actual.games !== 1 ? 's' : ''})
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold font-mono">
                          {allPlayData.all_play.wins}-{allPlayData.all_play.losses}
                          {allPlayData.all_play.ties > 0 && `-${allPlayData.all_play.ties}`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          All-Play ({allPlayData.all_play.games} game{allPlayData.all_play.games !== 1 ? 's' : ''})
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-border/50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Expected Wins (based on {allPlayData.all_play.games} games)
                        </span>
                        <span className="font-mono">
                          {typeof allPlayData.expected_wins === 'number' 
                            ? allPlayData.expected_wins.toFixed(1) 
                            : allPlayData.expected_wins}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Luck Diff (actual - expected)</span>
                        <span className={`font-mono ${
                          allPlayData.luck_diff > 0 ? "text-green-500" : 
                          allPlayData.luck_diff < 0 ? "text-red-500" : ""
                        }`}>
                          {allPlayData.luck_diff > 0 ? "+" : ""}
                          {typeof allPlayData.luck_diff === 'number' 
                            ? allPlayData.luck_diff.toFixed(1) 
                            : allPlayData.luck_diff} wins
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Luck Index</span>
                        <span className={`font-mono font-bold ${
                          allPlayData.luck_index > 5 ? "text-green-500" : 
                          allPlayData.luck_index < -5 ? "text-red-500" : ""
                        }`}>
                          {allPlayData.luck_index > 0 ? "+" : ""}{allPlayData.luck_index}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Status</span>
                        <Badge variant={
                          allPlayData.luck_label.includes("lucky") ? "default" :
                          allPlayData.luck_label.includes("unlucky") ? "secondary" : "outline"
                        } className="capitalize">
                          {allPlayData.luck_label.replace("_", " ")}
                        </Badge>
                      </div>
                    </div>
                  </>
                )}

                {!allPlayLoading && (!allPlayData || allPlayData.weeks_played === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">No matchup data available</p>
                )}
              </Card>
            </div>
          </motion.div>

          {/* Trades Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 }}
            className="mt-8"
          >
            <div className="flex items-center gap-3 mb-6">
              <ArrowRightLeft className="w-6 h-6 text-primary" />
              <h2 className="text-2xl font-display font-bold">Trade History</h2>
            </div>

            {tradesLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <span className="ml-3 text-muted-foreground">Loading trades...</span>
              </div>
            )}

            {!tradesLoading && tradesData && tradesData.trades.length === 0 && (
              <Card className="p-6 text-center text-muted-foreground">
                <p>No trades found for this league group.</p>
                <p className="text-sm mt-2">
                  Checked {tradesData.seasons_checked || 0} season{(tradesData.seasons_checked || 0) !== 1 ? 's' : ''} (rounds 0-22 each).
                  {(tradesData.total_trades_in_db || 0) > 0 
                    ? ` Found ${tradesData.total_trades_in_db} trade(s) in database, but none match current filters.`
                    : ' No trades stored yet - sync to fetch trade data.'}
                </p>
              </Card>
            )}

            {tradesData && tradesData.trades.length > 0 && (
              <div className="space-y-4">
                {tradesData.trades.slice(0, 20).map((trade: Trade) => (
                  <Card key={trade.transaction_id} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="text-xs">
                            {trade.season}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {trade.league_name}
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {trade.adds && Object.keys(trade.adds).length > 0 && (
                            <div>
                              <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Acquired</div>
                              <div className="flex flex-wrap gap-1">
                                {Object.entries(trade.adds).map(([playerId, info]: [string, any]) => (
                                  <Badge key={playerId} variant="secondary">
                                    {info?.name || playerId}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {trade.drops && Object.keys(trade.drops).length > 0 && (
                            <div>
                              <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Traded Away</div>
                              <div className="flex flex-wrap gap-1">
                                {Object.entries(trade.drops).map(([playerId, info]: [string, any]) => (
                                  <Badge key={playerId} variant="outline">
                                    {info?.name || playerId}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {trade.draft_picks && trade.draft_picks.length > 0 && (
                          <div className="mt-2">
                            <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Draft Picks</div>
                            <div className="flex flex-wrap gap-1">
                              {trade.draft_picks.map((pick, idx) => (
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
                ))}

                {tradesData.trades.length > 20 && (
                  <p className="text-center text-muted-foreground text-sm">
                    Showing 20 of {tradesData.trades.length} trades
                  </p>
                )}
              </div>
            )}
          </motion.div>

          {/* Scouting Section - Phase 1 Leaderboards */}
          <ScoutingSection leagueId={latestLeagueId} username={username} />

          {/* Teams Section - Phase 2 */}
          <TeamsSection leagueId={latestLeagueId} username={username} />

          {/* Trade Assets Section - Phase 2 */}
          <TradesSection groupId={groupId} leagueId={latestLeagueId} username={username} />
        </div>
      </div>
    </Layout>
  );
}
