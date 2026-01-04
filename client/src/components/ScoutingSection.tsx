import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, TrendingUp, Target, RefreshCw, ArrowRightLeft, Layers } from "lucide-react";
import { 
  useScoutingDraftCapital, 
  useScoutingStrength, 
  useScoutingConsistency, 
  useScoutingChurn, 
  useScoutingTrading 
} from "@/hooks/use-sleeper";
import { motion } from "framer-motion";

interface ScoutingSectionProps {
  leagueId: string | undefined;
  username?: string;
}

export function ScoutingSection({ leagueId, username }: ScoutingSectionProps) {
  const [activeTab, setActiveTab] = useState("draft-capital");
  const [churnTimeframe, setChurnTimeframe] = useState("season");

  const { data: draftCapitalData, isLoading: draftCapitalLoading } = useScoutingDraftCapital(leagueId);
  const { data: strengthData, isLoading: strengthLoading } = useScoutingStrength(leagueId);
  const { data: consistencyData, isLoading: consistencyLoading } = useScoutingConsistency(leagueId);
  const { data: churnData, isLoading: churnLoading } = useScoutingChurn(leagueId, churnTimeframe);
  const { data: tradingData, isLoading: tradingLoading } = useScoutingTrading(leagueId);

  if (!leagueId) {
    return null;
  }

  const renderScopeLabel = (scope: string, scopeLabel: string) => (
    <Badge variant="outline" className="text-xs" data-testid={`badge-scope-${scope}`}>
      {scopeLabel}
    </Badge>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.3 }}
      className="mt-8"
    >
      <div className="flex items-center gap-3 mb-6">
        <Target className="w-6 h-6 text-primary" />
        <h2 className="text-2xl font-display font-bold">League Scouting</h2>
      </div>

      <Card className="p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4 flex-wrap">
            <TabsTrigger value="draft-capital" data-testid="tab-draft-capital">
              <Layers className="w-4 h-4 mr-2" />
              Draft Capital
            </TabsTrigger>
            <TabsTrigger value="strength" data-testid="tab-strength">
              <TrendingUp className="w-4 h-4 mr-2" />
              Strength
            </TabsTrigger>
            <TabsTrigger value="consistency" data-testid="tab-consistency">
              <Target className="w-4 h-4 mr-2" />
              Consistency
            </TabsTrigger>
            <TabsTrigger value="churn" data-testid="tab-churn">
              <RefreshCw className="w-4 h-4 mr-2" />
              Roster Activity
            </TabsTrigger>
            <TabsTrigger value="trading" data-testid="tab-trading">
              <ArrowRightLeft className="w-4 h-4 mr-2" />
              Trading
            </TabsTrigger>
          </TabsList>

          <TabsContent value="draft-capital">
            {draftCapitalLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : draftCapitalData ? (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-sm text-muted-foreground">Scope:</span>
                  {renderScopeLabel(draftCapitalData.scope, draftCapitalData.scope_label)}
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>Team</TableHead>
                        <TableHead className="text-center">R1</TableHead>
                        <TableHead className="text-center">R2</TableHead>
                        <TableHead className="text-center">R3</TableHead>
                        <TableHead className="text-center">R4</TableHead>
                        <TableHead className="text-center">Total</TableHead>
                        <TableHead className="text-center">Hoard Index</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {draftCapitalData.rosters?.map((roster: any, idx: number) => {
                        const isCurrentUser = username && roster.display_name?.toLowerCase() === username.toLowerCase();
                        return (
                          <TableRow 
                            key={roster.roster_id} 
                            className={isCurrentUser ? "bg-primary/10" : ""}
                            data-testid={`row-draft-capital-${roster.roster_id}`}
                          >
                            <TableCell className="font-mono text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell className="font-medium">{roster.display_name}</TableCell>
                            <TableCell className="text-center font-mono">{roster.totals?.r1 || 0}</TableCell>
                            <TableCell className="text-center font-mono">{roster.totals?.r2 || 0}</TableCell>
                            <TableCell className="text-center font-mono">{roster.totals?.r3 || 0}</TableCell>
                            <TableCell className="text-center font-mono">{roster.totals?.r4 || 0}</TableCell>
                            <TableCell className="text-center font-mono font-bold">{roster.totals?.total || 0}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant={roster.pick_hoard_index > 4 ? "default" : "outline"}>
                                {roster.pick_hoard_index}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground mt-3" data-testid="text-draft-capital-explanation">
                  Hoard Index = (R1 picks x 2) + R2 picks. Higher = more premium capital.
                </p>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">No draft capital data available</p>
            )}
          </TabsContent>

          <TabsContent value="strength">
            {strengthLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : strengthData ? (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-sm text-muted-foreground" data-testid="text-strength-summary">
                    {strengthData.weeks_played} weeks analyzed, {strengthData.teams} teams
                  </span>
                  {renderScopeLabel(strengthData.scope, strengthData.scope_label)}
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>Team</TableHead>
                        <TableHead className="text-center">Record</TableHead>
                        <TableHead className="text-center">All-Play</TableHead>
                        <TableHead className="text-center">All-Play %</TableHead>
                        <TableHead className="text-center">PF</TableHead>
                        <TableHead className="text-center">Expected W</TableHead>
                        <TableHead className="text-center">Luck</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {strengthData.rosters?.map((roster: any, idx: number) => {
                        const isCurrentUser = username && roster.display_name?.toLowerCase() === username.toLowerCase();
                        return (
                          <TableRow 
                            key={roster.roster_id}
                            className={isCurrentUser ? "bg-primary/10" : ""}
                            data-testid={`row-strength-${roster.roster_id}`}
                          >
                            <TableCell className="font-mono text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell className="font-medium">{roster.display_name}</TableCell>
                            <TableCell className="text-center font-mono">
                              {roster.actual.wins}-{roster.actual.losses}
                              {roster.actual.ties > 0 && `-${roster.actual.ties}`}
                            </TableCell>
                            <TableCell className="text-center font-mono">
                              {roster.all_play.wins}-{roster.all_play.losses}
                            </TableCell>
                            <TableCell className="text-center font-mono font-bold">
                              {roster.all_play.win_rate}%
                            </TableCell>
                            <TableCell className="text-center font-mono">{roster.points_for}</TableCell>
                            <TableCell className="text-center font-mono">{roster.expected_wins}</TableCell>
                            <TableCell className="text-center">
                              <Badge 
                                variant={roster.luck_index > 5 ? "default" : roster.luck_index < -5 ? "secondary" : "outline"}
                                className={roster.luck_index > 5 ? "bg-green-600" : roster.luck_index < -5 ? "bg-red-600" : ""}
                              >
                                {roster.luck_index > 0 ? "+" : ""}{roster.luck_index}%
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground mt-3" data-testid="text-strength-explanation">
                  Sorted by All-Play Win %. Luck = difference between actual record and expected.
                </p>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">No strength data available</p>
            )}
          </TabsContent>

          <TabsContent value="consistency">
            {consistencyLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : consistencyData ? (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-sm text-muted-foreground" data-testid="text-consistency-summary">
                    {consistencyData.weeks_analyzed} weeks analyzed
                  </span>
                  {renderScopeLabel(consistencyData.scope, consistencyData.scope_label)}
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>Team</TableHead>
                        <TableHead className="text-center">Avg Pts</TableHead>
                        <TableHead className="text-center">Std Dev</TableHead>
                        <TableHead className="text-center">Best</TableHead>
                        <TableHead className="text-center">Worst</TableHead>
                        <TableHead className="text-center">Above Median</TableHead>
                        <TableHead className="text-center">Consistency</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {consistencyData.rosters?.map((roster: any, idx: number) => {
                        const isCurrentUser = username && roster.display_name?.toLowerCase() === username.toLowerCase();
                        return (
                          <TableRow 
                            key={roster.roster_id}
                            className={isCurrentUser ? "bg-primary/10" : ""}
                            data-testid={`row-consistency-${roster.roster_id}`}
                          >
                            <TableCell className="font-mono text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell className="font-medium">{roster.display_name}</TableCell>
                            <TableCell className="text-center font-mono">{roster.avg_points}</TableCell>
                            <TableCell className="text-center font-mono">{roster.std_dev}</TableCell>
                            <TableCell className="text-center font-mono text-green-600">{roster.best_week}</TableCell>
                            <TableCell className="text-center font-mono text-red-600">{roster.worst_week}</TableCell>
                            <TableCell className="text-center font-mono">{roster.median_beat_pct}%</TableCell>
                            <TableCell className="text-center">
                              <Badge variant={roster.consistency_score >= 80 ? "default" : "outline"}>
                                {roster.consistency_score}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground mt-3" data-testid="text-consistency-explanation">
                  Consistency Score = 100 - (StdDev/Avg * 100). Higher = more consistent performer.
                </p>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">No consistency data available</p>
            )}
          </TabsContent>

          <TabsContent value="churn">
            <div className="flex items-center gap-4 mb-4">
              <span className="text-sm text-muted-foreground">Timeframe:</span>
              <Select value={churnTimeframe} onValueChange={setChurnTimeframe}>
                <SelectTrigger className="w-40" data-testid="select-churn-timeframe">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="season" data-testid="select-churn-season">This Season</SelectItem>
                  <SelectItem value="last30" data-testid="select-churn-last30">Last 30 Days</SelectItem>
                  <SelectItem value="lifetime" data-testid="select-churn-lifetime">All Time</SelectItem>
                </SelectContent>
              </Select>
              {churnData && renderScopeLabel(churnData.scope, churnData.scope_label)}
            </div>
            
            {churnLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : churnData ? (
              <div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>Team</TableHead>
                        <TableHead className="text-center">Adds</TableHead>
                        <TableHead className="text-center">Drops</TableHead>
                        <TableHead className="text-center">Total</TableHead>
                        <TableHead className="text-center">Moves/Week</TableHead>
                        <TableHead className="text-center">Activity</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {churnData.rosters?.map((roster: any, idx: number) => {
                        const isCurrentUser = username && roster.display_name?.toLowerCase() === username.toLowerCase();
                        return (
                          <TableRow 
                            key={roster.roster_id}
                            className={isCurrentUser ? "bg-primary/10" : ""}
                            data-testid={`row-churn-${roster.roster_id}`}
                          >
                            <TableCell className="font-mono text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell className="font-medium">{roster.display_name}</TableCell>
                            <TableCell className="text-center font-mono text-green-600">+{roster.adds}</TableCell>
                            <TableCell className="text-center font-mono text-red-600">-{roster.drops}</TableCell>
                            <TableCell className="text-center font-mono font-bold">{roster.total_moves}</TableCell>
                            <TableCell className="text-center font-mono">{roster.moves_per_week}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant={
                                roster.activity_level === "very_active" ? "default" :
                                roster.activity_level === "active" ? "secondary" : "outline"
                              } className="capitalize">
                                {roster.activity_level.replace("_", " ")}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground mt-3" data-testid="text-churn-explanation">
                  League avg: {churnData.league_avg_moves} moves. Timeframe: {churnData.timeframe_label}.
                </p>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">No roster activity data available</p>
            )}
          </TabsContent>

          <TabsContent value="trading">
            {tradingLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : tradingData ? (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-sm text-muted-foreground" data-testid="text-trading-summary">
                    {tradingData.total_trades} total trades, median: {tradingData.league_median_trades}
                  </span>
                  {renderScopeLabel(tradingData.scope, tradingData.scope_label)}
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>Team</TableHead>
                        <TableHead className="text-center">Trades</TableHead>
                        <TableHead className="text-center">Draft Window</TableHead>
                        <TableHead className="text-center">In-Season</TableHead>
                        <TableHead className="text-center">Offseason</TableHead>
                        <TableHead className="text-center">Aggression</TableHead>
                        <TableHead className="text-center">Style</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tradingData.rosters?.map((roster: any, idx: number) => {
                        const isCurrentUser = username && roster.display_name?.toLowerCase() === username.toLowerCase();
                        return (
                          <TableRow 
                            key={roster.roster_id}
                            className={isCurrentUser ? "bg-primary/10" : ""}
                            data-testid={`row-trading-${roster.roster_id}`}
                          >
                            <TableCell className="font-mono text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell className="font-medium">{roster.display_name}</TableCell>
                            <TableCell className="text-center font-mono font-bold">{roster.trades_count}</TableCell>
                            <TableCell className="text-center font-mono">{roster.draft_window_trades}</TableCell>
                            <TableCell className="text-center font-mono">{roster.in_season_trades}</TableCell>
                            <TableCell className="text-center font-mono">{roster.offseason_trades}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant={roster.trade_aggression_index > 100 ? "default" : "outline"}>
                                {roster.trade_aggression_index}%
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className="capitalize">
                                {roster.trading_style.replace(/_/g, " ")}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground mt-3" data-testid="text-trading-explanation">
                  Aggression Index = trades / league median * 100. Style based on timing patterns.
                </p>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">No trading data available</p>
            )}
          </TabsContent>
        </Tabs>
      </Card>
    </motion.div>
  );
}
