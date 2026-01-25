import { useParams } from "wouter";
import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, Target, History, TrendingUp, Loader2 } from "lucide-react";
import { useSleeperOverview, useH2h, useSeasonSummaries } from "@/hooks/use-sleeper";
import { motion } from "framer-motion";
import { useState } from "react";

function fmtNum(v: unknown, decimals = 1, fallback = "—"): string {
  if (v == null) return fallback;
  const num = Number(v);
  if (Number.isNaN(num)) return fallback;
  return num.toFixed(decimals);
}

function fmtPct(v: unknown, decimals = 1, fallback = "—"): string {
  if (v == null) return fallback;
  const num = Number(v);
  if (Number.isNaN(num)) return fallback;
  return `${(num * 100).toFixed(decimals)}%`;
}

export default function TrophyRoom() {
  const { username } = useParams<{ username: string }>();
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  const { data: overview, isLoading: loadingOverview } = useSleeperOverview(username);
  
  const groups = overview?.league_groups ?? [];
  const activeGroupId = selectedGroup ?? groups[0]?.group_id;
  
  const { data: h2hData, isLoading: loadingH2H } = useH2h(activeGroupId, username);
  const { data: seasonsData, isLoading: loadingSeasons } = useSeasonSummaries(activeGroupId, username);

  if (loadingOverview) {
    return (
      <Layout username={username}>
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout username={username}>
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="flex items-center gap-3">
            <Trophy className="w-8 h-8 text-yellow-500" />
            <div>
              <h1 className="text-3xl font-bold">Trophy Room</h1>
              <p className="text-muted-foreground">Your dynasty legacy and historical achievements</p>
            </div>
          </div>

          {groups.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {groups.map((group: any) => (
                <Badge
                  key={group.group_id}
                  variant={activeGroupId === group.group_id ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setSelectedGroup(group.group_id)}
                  data-testid={`badge-group-${group.group_id}`}
                >
                  {group.name}
                </Badge>
              ))}
            </div>
          )}

          <Tabs defaultValue="seasons" className="w-full">
            <TabsList className="w-full justify-start overflow-x-auto flex-wrap h-auto gap-1 bg-muted/50 p-1">
              <TabsTrigger value="seasons" className="gap-1" data-testid="trophy-tab-seasons">
                <History className="w-3 h-3" />
                Season History
              </TabsTrigger>
              <TabsTrigger value="h2h" className="gap-1" data-testid="trophy-tab-h2h">
                <Target className="w-3 h-3" />
                Head-to-Head
              </TabsTrigger>
              <TabsTrigger value="achievements" className="gap-1" data-testid="trophy-tab-achievements">
                <Trophy className="w-3 h-3" />
                Achievements
              </TabsTrigger>
            </TabsList>

            <TabsContent value="seasons" className="mt-6">
              {loadingSeasons ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : (
                <div className="space-y-4">
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <TrendingUp className="w-5 h-5" />
                    Season-by-Season Results
                  </h2>
                  {seasonsData?.seasons?.length ? (
                    <div className="grid gap-4">
                      {seasonsData.seasons.map((season: any) => (
                        <Card key={season.season} className="p-4">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-3">
                              <Badge variant="outline" className="text-lg font-bold">
                                {season.season}
                              </Badge>
                              <div>
                                <div className="font-semibold">
                                  Finished #{season.final_rank ?? season.placement ?? "—"}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {season.wins ?? 0}-{season.losses ?? 0} ({fmtPct((season.wins ?? 0) / ((season.wins ?? 0) + (season.losses ?? 0) || 1))})
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-4 text-sm">
                              <div>
                                <span className="text-muted-foreground">PF:</span>{" "}
                                <span className="font-medium">{fmtNum(season.points_for, 1)}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">PA:</span>{" "}
                                <span className="font-medium">{fmtNum(season.points_against, 1)}</span>
                              </div>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <Card className="p-6 text-center text-muted-foreground">
                      No season history available yet.
                    </Card>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="h2h" className="mt-6">
              {loadingH2H ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : (
                <div className="space-y-4">
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <Target className="w-5 h-5" />
                    Head-to-Head Records
                  </h2>
                  {h2hData?.opponents?.length ? (
                    <div className="grid gap-3">
                      {h2hData.opponents.map((record: any, idx: number) => (
                        <Card key={idx} className="p-4">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="font-medium">{record.display_name || record.team_name || `Opponent ${record.opp_owner_id}`}</div>
                            <div className="flex items-center gap-2">
                              <Badge 
                                variant={record.wins > record.losses ? "default" : record.wins < record.losses ? "destructive" : "secondary"}
                              >
                                {record.wins}-{record.losses}
                              </Badge>
                              <span className="text-sm text-muted-foreground">
                                ({fmtPct(record.wins / ((record.wins + record.losses) || 1))})
                              </span>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <Card className="p-6 text-center text-muted-foreground">
                      No head-to-head records available yet.
                    </Card>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="achievements" className="mt-6">
              <div className="space-y-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-yellow-500" />
                  Achievements & Milestones
                </h2>
                <Card className="p-6 text-center text-muted-foreground">
                  Achievements coming soon! Track your championships, playoff appearances, and milestone games.
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>
    </Layout>
  );
}
