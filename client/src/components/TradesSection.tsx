import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTradeAssets, useNormalizeTrades, useLeagueTeams } from "@/hooks/use-sleeper";
import { RefreshCw, User, Calendar, TrendingUp, TrendingDown } from "lucide-react";
import { motion } from "framer-motion";

interface TradesSectionProps {
  leagueId: string;
  username?: string;
  currentRosterId?: number;
}

export function TradesSection({ leagueId, username, currentRosterId }: TradesSectionProps) {
  const { data, isLoading, error, refetch } = useTradeAssets(leagueId);
  const { data: teamsData } = useLeagueTeams(leagueId);
  const normalizeMutation = useNormalizeTrades();
  const [filterRosterId, setFilterRosterId] = useState<number | undefined>(undefined);

  const handleNormalize = async () => {
    try {
      await normalizeMutation.mutateAsync(leagueId);
      refetch();
    } catch (e) {
      console.error("Failed to normalize trades:", e);
    }
  };

  const rosterToTeamName = new Map<number, string>();
  if (teamsData?.teams) {
    for (const team of teamsData.teams) {
      rosterToTeamName.set(team.roster_id, team.display_name || `Team ${team.roster_id}`);
    }
  }

  const getTeamName = (rosterId: number): string => {
    return rosterToTeamName.get(rosterId) || `Team ${rosterId}`;
  };

  const formatDate = (ms: number): string => {
    const date = new Date(ms);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  if (isLoading) {
    return (
      <Card data-testid="card-trades-section-loading">
        <CardHeader>
          <CardTitle className="text-lg">Trade Assets</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card data-testid="card-trades-section-error">
        <CardHeader>
          <CardTitle className="text-lg">Trade Assets</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Failed to load trade assets</p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNormalize}
            disabled={normalizeMutation.isPending}
            className="mt-2"
            data-testid="button-normalize-trades-error"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${normalizeMutation.isPending ? "animate-spin" : ""}`} />
            Normalize Trades
          </Button>
        </CardContent>
      </Card>
    );
  }

  const trades = data?.trades || [];
  const filteredTrades = filterRosterId !== undefined
    ? trades.filter(t => t.participants.includes(filterRosterId))
    : trades;

  return (
    <Card data-testid="card-trades-section">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-lg">Trade Assets</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" data-testid="badge-trades-total-count">
            {filteredTrades.length} trades
          </Badge>
          {data?.total_assets === 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleNormalize}
              disabled={normalizeMutation.isPending}
              data-testid="button-normalize-trades-header"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${normalizeMutation.isPending ? "animate-spin" : ""}`} />
              Normalize
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {trades.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">No normalized trade assets found</p>
            <Button
              variant="default"
              onClick={handleNormalize}
              disabled={normalizeMutation.isPending}
              data-testid="button-normalize-trades-empty"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${normalizeMutation.isPending ? "animate-spin" : ""}`} />
              Normalize Trade Data
            </Button>
            {normalizeMutation.isSuccess && (
              <p className="text-sm text-muted-foreground mt-2">
                Created {normalizeMutation.data?.assets_created || 0} trade asset records
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredTrades.map((trade, tradeIndex) => (
              <TradeCard
                key={trade.trade_id}
                trade={trade}
                tradeIndex={tradeIndex}
                currentRosterId={currentRosterId}
                getTeamName={getTeamName}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface TradeCardProps {
  trade: {
    trade_id: string;
    created_at_ms: number;
    season: number;
    participants: number[];
    assets: Array<{
      roster_id: number;
      direction: string;
      asset_type: string;
      asset_key: string;
      asset_name: string | null;
    }>;
  };
  tradeIndex: number;
  currentRosterId?: number;
  getTeamName: (rosterId: number) => string;
  formatDate: (ms: number) => string;
}

function TradeCard({ trade, tradeIndex, currentRosterId, getTeamName, formatDate }: TradeCardProps) {
  const groupedByRoster = new Map<number, { received: string[]; sent: string[] }>();

  for (const asset of trade.assets) {
    if (!groupedByRoster.has(asset.roster_id)) {
      groupedByRoster.set(asset.roster_id, { received: [], sent: [] });
    }
    const group = groupedByRoster.get(asset.roster_id)!;
    const displayName = asset.asset_name || (asset.asset_type === "pick" ? asset.asset_key : asset.asset_key);
    
    if (asset.direction === "received") {
      group.received.push(displayName);
    } else {
      group.sent.push(displayName);
    }
  }

  const participants = Array.from(groupedByRoster.keys());
  const isCurrentUserTrade = currentRosterId !== undefined && participants.includes(currentRosterId);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border rounded-md p-4 ${isCurrentUserTrade ? "ring-2 ring-primary/50" : ""}`}
      data-testid={`card-trade-${tradeIndex}`}
    >
      <div className="flex items-center gap-2 mb-3 text-sm text-muted-foreground">
        <Calendar className="w-4 h-4" />
        <span data-testid={`text-trade-date-${tradeIndex}`}>{formatDate(trade.created_at_ms)}</span>
        <Badge variant="outline" className="ml-auto" data-testid={`badge-trade-season-${tradeIndex}`}>
          {trade.season}
        </Badge>
        {participants.length > 2 && (
          <Badge variant="secondary" data-testid={`badge-trade-multiway-${tradeIndex}`}>
            {participants.length}-way
          </Badge>
        )}
      </div>

      <div className="space-y-3">
        {participants.map((rosterId, rosterIndex) => {
          const group = groupedByRoster.get(rosterId)!;
          const isCurrentUser = rosterId === currentRosterId;

          return (
            <div
              key={rosterId}
              className={`p-3 rounded-md ${isCurrentUser ? "bg-primary/10" : "bg-muted/50"}`}
              data-testid={`div-trade-roster-${tradeIndex}-${rosterIndex}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <User className="w-4 h-4" />
                <span className="font-medium" data-testid={`text-roster-name-${tradeIndex}-${rosterIndex}`}>
                  {getTeamName(rosterId)}
                </span>
                {isCurrentUser && (
                  <Badge variant="default" className="text-xs" data-testid={`badge-current-user-${tradeIndex}-${rosterIndex}`}>
                    You
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="flex items-center gap-1 text-green-600 dark:text-green-400 mb-1">
                    <TrendingUp className="w-3 h-3" />
                    <span className="text-xs font-medium">Received</span>
                  </div>
                  <div className="space-y-1">
                    {group.received.length > 0 ? (
                      group.received.map((item, i) => (
                        <div key={i} className="text-xs" data-testid={`text-received-${tradeIndex}-${rosterIndex}-${i}`}>
                          {item}
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-muted-foreground">-</div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-1 text-red-600 dark:text-red-400 mb-1">
                    <TrendingDown className="w-3 h-3" />
                    <span className="text-xs font-medium">Sent</span>
                  </div>
                  <div className="space-y-1">
                    {group.sent.length > 0 ? (
                      group.sent.map((item, i) => (
                        <div key={i} className="text-xs" data-testid={`text-sent-${tradeIndex}-${rosterIndex}-${i}`}>
                          {item}
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-muted-foreground">-</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
