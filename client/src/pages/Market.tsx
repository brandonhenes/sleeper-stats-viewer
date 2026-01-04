import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";
import { ArrowLeft, TrendingUp, Users, Calendar, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";

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

function useMarketTrends() {
  return useQuery<MarketTrends>({
    queryKey: ["/api/market/trends"],
  });
}

export default function Market() {
  const { data, isLoading, error } = useMarketTrends();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card/50">
          <div className="container mx-auto px-4 py-4">
            <Skeleton className="h-8 w-48" />
          </div>
        </header>
        <main className="container mx-auto px-4 py-6">
          <div className="grid gap-4 md:grid-cols-3 mb-6">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-96" />
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card/50">
          <div className="container mx-auto px-4 py-4">
            <Link href="/">
              <Button variant="ghost" size="sm" data-testid="link-back-home">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            </Link>
          </div>
        </header>
        <main className="container mx-auto px-4 py-6">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Failed to load market trends. Try syncing some league data first.
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const { totals, most_traded_players, most_traded_picks, by_season } = data!;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm" data-testid="link-back-home">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Market Trends
          </h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
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
                      No player trades found. Sync some leagues to see data.
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
                      No pick trades found. Sync some leagues to see data.
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
                      No trade data available. Sync some leagues to see data.
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
                          <div className="flex items-center gap-3">
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
    </div>
  );
}
