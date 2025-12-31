import { useParams, Link } from "wouter";
import { useSleeperOverview } from "@/hooks/use-sleeper";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, AlertCircle, Users, ArrowLeft, Trophy } from "lucide-react";
import { Layout } from "@/components/Layout";
import { motion } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function CompareResults() {
  const { userA, userB } = useParams<{ userA: string; userB: string }>();
  
  const { data: dataA, isLoading: loadingA, error: errorA } = useSleeperOverview(userA);
  const { data: dataB, isLoading: loadingB, error: errorB } = useSleeperOverview(userB);

  const isLoading = loadingA || loadingB;
  const hasError = errorA || errorB;

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

        {isLoading && !hasError && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium animate-pulse">Loading comparison data...</p>
          </div>
        )}

        {dataA && dataB && (
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

            <Card className="p-8 text-center">
              <Trophy className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-lg text-muted-foreground">
                Detailed comparison features coming soon.
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                This will include player overlap, position exposure, and head-to-head in shared leagues.
              </p>
            </Card>
          </motion.div>
        )}
      </div>
    </Layout>
  );
}
