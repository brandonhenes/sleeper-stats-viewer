import { useParams, Link } from "wouter";
import { useSleeperOverview, useScoutingStats } from "@/hooks/use-sleeper";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, TrendingUp, TrendingDown, ArrowRight, Target } from "lucide-react";
import { Layout } from "@/components/Layout";
import { motion } from "framer-motion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface TradeStats {
  total_trades: number;
  total_picks_acquired: number;
  total_picks_traded: number;
  total_players_acquired: number;
  total_players_traded: number;
  leagues_with_trades: number;
  avg_trades_per_league: number;
  first_round_picks_acquired: number;
  first_round_picks_traded: number;
}

interface ScoutingData {
  username: string;
  total_current_leagues: number;
  trade_stats: TradeStats;
  draft_capital_score: number;
  trade_propensity: "low" | "medium" | "high";
}

export default function Scouting() {
  const { username } = useParams<{ username: string }>();
  const { data: overview, isLoading: overviewLoading, isError, error } = useSleeperOverview(username);
  const { data: scoutingData, isLoading: scoutingLoading } = useScoutingStats(username) as { 
    data: ScoutingData | null; 
    isLoading: boolean 
  };

  const isLoading = overviewLoading || scoutingLoading;

  return (
    <Layout username={username}>
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {isError && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-md mx-auto"
          >
            <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <AlertTitle className="ml-2 font-bold">Error</AlertTitle>
              <AlertDescription className="ml-2 mt-1 opacity-90">
                {error instanceof Error ? error.message : "Could not load data."}
              </AlertDescription>
            </Alert>
            <div className="text-center mt-4">
              <Link href="/">
                <Button variant="outline">Search Again</Button>
              </Link>
            </div>
          </motion.div>
        )}

        {isLoading && !isError && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium animate-pulse">Loading scouting report...</p>
          </div>
        )}

        {overview && scoutingData && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <Target className="w-6 h-6 text-primary" />
                <h1 className="text-2xl font-display font-bold">Scouting Report</h1>
                <span className="text-muted-foreground">for @{username}</span>
              </div>

              <Badge variant="outline">
                {scoutingData.total_current_leagues} Current Leagues
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Trade Propensity</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <Badge 
                      variant={scoutingData.trade_propensity === "high" ? "default" : "secondary"}
                      className={scoutingData.trade_propensity === "high" ? "bg-green-500/15 text-green-400" : ""}
                    >
                      {scoutingData.trade_propensity.toUpperCase()}
                    </Badge>
                    <span className="text-2xl font-bold">{scoutingData.trade_stats.avg_trades_per_league}</span>
                    <span className="text-muted-foreground text-sm">trades/league</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {scoutingData.trade_stats.total_trades} total trades across {scoutingData.trade_stats.leagues_with_trades} leagues
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Draft Capital Score</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    {scoutingData.draft_capital_score >= 0 ? (
                      <TrendingUp className="w-6 h-6 text-green-500" />
                    ) : (
                      <TrendingDown className="w-6 h-6 text-red-500" />
                    )}
                    <span className={`text-3xl font-bold ${scoutingData.draft_capital_score >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {scoutingData.draft_capital_score >= 0 ? "+" : ""}{scoutingData.draft_capital_score}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Net weighted picks (1st rounders count 3x)
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">First Round Picks</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <span className="text-green-500 font-mono">+{scoutingData.trade_stats.first_round_picks_acquired}</span>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    <span className="text-red-500 font-mono">-{scoutingData.trade_stats.first_round_picks_traded}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Net: {scoutingData.trade_stats.first_round_picks_acquired - scoutingData.trade_stats.first_round_picks_traded >= 0 ? "+" : ""}
                    {scoutingData.trade_stats.first_round_picks_acquired - scoutingData.trade_stats.first_round_picks_traded} 1st rounders
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Trade Activity Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div className="text-center">
                    <p className="text-3xl font-bold">{scoutingData.trade_stats.total_players_acquired}</p>
                    <p className="text-sm text-muted-foreground">Players Acquired</p>
                  </div>
                  <div className="text-center">
                    <p className="text-3xl font-bold">{scoutingData.trade_stats.total_players_traded}</p>
                    <p className="text-sm text-muted-foreground">Players Traded</p>
                  </div>
                  <div className="text-center">
                    <p className="text-3xl font-bold">{scoutingData.trade_stats.total_picks_acquired}</p>
                    <p className="text-sm text-muted-foreground">Picks Acquired</p>
                  </div>
                  <div className="text-center">
                    <p className="text-3xl font-bold">{scoutingData.trade_stats.total_picks_traded}</p>
                    <p className="text-sm text-muted-foreground">Picks Traded</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>
    </Layout>
  );
}
