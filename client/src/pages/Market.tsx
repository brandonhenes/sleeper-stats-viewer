import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";
import { TrendingUp, Users, Calendar, Package, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Layout } from "@/components/Layout";

interface MarketTrends {
  totals: {
    total: number;
    players: number;
    picks: number;
  };
  most_traded_players: {
    player_id: string;
    player_name: string | null;
    trade_count: number;
  }[];
  most_traded_picks: {
    pick_type: string;
    trade_count: number;
  }[];
  by_season: {
    season: number;
    trade_count: number;
    player_count: number;
    pick_count: number;
  }[];
}

function useMarketTrends(enabled: boolean) {
  return useQuery<MarketTrends>({
    queryKey: ["/api/market/trends"],
    enabled,
  });
}

function useMarketSync(username: string) {
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/market/sync?username=${encodeURIComponent(username)}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/market/trends"] });
    },
  });
}

export default function Market() {
  const { username } = useParams<{ username: string }>();
  const [hasSynced, setHasSynced] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  
  const syncMutation = useMarketSync(username || "");
  const { data, isLoading, error, refetch } = useMarketTrends(hasSynced && !syncError);

  useEffect(() => {
    if (username && !hasSynced && !syncMutation.isPending && !syncError) {
      syncMutation.mutate(undefined, {
        onSuccess: () => {
          setHasSynced(true);
          setSyncError(null);
        },
        onError: (err: Error) => {
          setHasSynced(true);
          if (err.message.includes("404") || err.message.includes("not found")) {
            setSyncError("Please sync your profile first to see market trends.");
          } else {
            setSyncError(err.message || "Failed to sync trade data.");
          }
        },
      });
    }
  }, [username, hasSynced, syncMutation.isPending, syncError]);

  const handleRefresh = () => {
    if (username) {
      setSyncError(null);
      syncMutation.mutate(undefined, {
        onSuccess: () => {
          refetch();
        },
        onError: (err: Error) => {
          setSyncError(err.message || "Failed to sync trade data.");
        },
      });
    }
  };

  if (!username) {
    return (
      <Layout>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Card className="max-w-md">
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground mb-4">
                Please access Market Trends from your profile page.
              </p>
              <Link href="/">
                <Button data-testid="link-go-home">Go Home</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  if (syncMutation.isPending || (isLoading && !data && !syncError)) {
    return (
      <Layout username={username}>
        <main className="container mx-auto px-4 py-6 max-w-6xl">
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">
              {syncMutation.isPending ? "Syncing trade data from your leagues..." : "Loading market trends..."}
            </p>
          </div>
        </main>
      </Layout>
    );
  }

  if (syncError) {
    return (
      <Layout username={username}>
        <main className="container mx-auto px-4 py-6 max-w-6xl">
          <Card>
            <CardContent className="py-8 text-center space-y-4">
              <p className="text-muted-foreground">{syncError}</p>
              <Link href={`/u/${username}`}>
                <Button data-testid="link-sync-profile">
                  Go to Profile
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout username={username}>
        <main className="container mx-auto px-4 py-6 max-w-6xl">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Failed to load market trends. Try syncing your profile first.
            </CardContent>
          </Card>
        </main>
      </Layout>
    );
  }

  const { totals, most_traded_players, most_traded_picks, by_season } = data!;

  return (
    <Layout username={username}>
      <main className="container mx-auto px-4 py-6 max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Market Trends
          </h1>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={syncMutation.isPending}
            data-testid="button-refresh-market"
          >
            {syncMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Refresh
          </Button>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid gap-4 md:grid-cols-3"
        >
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Trade Assets
              </CardTitle>
              <Package className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-assets">
                {totals.total.toLocaleString()}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Players Traded
              </CardTitle>
              <Users className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-players-traded">
                {totals.players.toLocaleString()}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Picks Traded
              </CardTitle>
              <Calendar className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-picks-traded">
                {totals.picks.toLocaleString()}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <Tabs defaultValue="players" className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="players" data-testid="tab-players">Players</TabsTrigger>
            <TabsTrigger value="picks" data-testid="tab-picks">Picks</TabsTrigger>
            <TabsTrigger value="seasons" data-testid="tab-seasons">By Season</TabsTrigger>
          </TabsList>

          <TabsContent value="players" className="mt-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Most Traded Players</CardTitle>
                </CardHeader>
                <CardContent>
                  {most_traded_players.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">
                      No player trades found in your leagues yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {most_traded_players.map((player, index) => (
                        <div
                          key={player.player_id}
                          className="flex items-center justify-between py-2 border-b last:border-b-0"
                          data-testid={`row-player-${index}`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground w-6 text-right">
                              {index + 1}.
                            </span>
                            <span className="font-medium">
                              {player.player_name || player.player_id}
                            </span>
                          </div>
                          <Badge variant="secondary">
                            {player.trade_count} trade{player.trade_count !== 1 ? "s" : ""}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>

          <TabsContent value="picks" className="mt-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Most Traded Picks</CardTitle>
                </CardHeader>
                <CardContent>
                  {most_traded_picks.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">
                      No pick trades found in your leagues yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {most_traded_picks.map((pick, index) => (
                        <div
                          key={pick.pick_type}
                          className="flex items-center justify-between py-2 border-b last:border-b-0"
                          data-testid={`row-pick-${index}`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground w-6 text-right">
                              {index + 1}.
                            </span>
                            <span className="font-medium">{pick.pick_type}</span>
                          </div>
                          <Badge variant="secondary">
                            {pick.trade_count} trade{pick.trade_count !== 1 ? "s" : ""}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>

          <TabsContent value="seasons" className="mt-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Trade Activity by Season</CardTitle>
                </CardHeader>
                <CardContent>
                  {by_season.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">
                      No trade data available yet.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {by_season.map((season, index) => (
                        <div
                          key={season.season}
                          className="flex items-center justify-between py-2 border-b last:border-b-0"
                          data-testid={`row-season-${index}`}
                        >
                          <div className="font-medium">{season.season}</div>
                          <div className="flex items-center gap-3 flex-wrap">
                            <Badge variant="outline">
                              {season.trade_count} trade{season.trade_count !== 1 ? "s" : ""}
                            </Badge>
                            <Badge variant="secondary">
                              {season.player_count} player{season.player_count !== 1 ? "s" : ""}
                            </Badge>
                            <Badge variant="secondary">
                              {season.pick_count} pick{season.pick_count !== 1 ? "s" : ""}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>
        </Tabs>
      </main>
    </Layout>
  );
}
