import { useParams, Link } from "wouter";
import { useLeagueDetails } from "@/hooks/use-sleeper";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Loader2, Trophy, Users, AlertTriangle } from "lucide-react";
import { RosterCard } from "@/components/RosterCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { motion } from "framer-motion";

export default function LeagueDetails() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useLeagueDetails(id!);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
        <Alert variant="destructive" className="max-w-md bg-destructive/10 border-destructive/20 text-destructive mb-6">
          <AlertTriangle className="h-5 w-5" />
          <AlertTitle className="font-bold ml-2">Error</AlertTitle>
          <AlertDescription className="ml-2">Failed to load league details.</AlertDescription>
        </Alert>
        <Link href="/">
          <Button variant="outline">Return Home</Button>
        </Link>
      </div>
    );
  }

  // Helper to find user for a roster
  const getUserForRoster = (ownerId?: string | null) => {
    if (!ownerId) return undefined;
    return data.users.find(u => u.user_id === ownerId);
  };

  // Sort rosters by wins (descending)
  const sortedRosters = [...data.rosters].sort((a, b) => {
    const winsA = a.settings?.wins ?? 0;
    const winsB = b.settings?.wins ?? 0;
    const fptsA = a.settings?.fpts ?? 0;
    const fptsB = b.settings?.fpts ?? 0;
    
    if (winsA !== winsB) return winsB - winsA;
    return fptsB - fptsA;
  });

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="bg-secondary/30 border-b border-border/50">
        <div className="container mx-auto px-4 py-8">
          <Link href="/">
            <Button variant="ghost" className="mb-6 hover:bg-white/5 pl-0 gap-2">
              <ChevronLeft className="w-4 h-4" />
              Back to Search
            </Button>
          </Link>
          
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-mono mb-3">
                ID: {data.leagueId}
              </div>
              <h1 className="text-4xl font-display font-bold text-white mb-2">League Standings</h1>
              <p className="text-muted-foreground flex items-center gap-6">
                <span className="flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  {data.rosters.length} Teams
                </span>
                <span className="flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-yellow-500" />
                  Season Leader: {getUserForRoster(sortedRosters[0]?.owner_id)?.display_name ?? "TBD"}
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Roster Grid */}
      <div className="container mx-auto px-4 py-12">
        <motion.div 
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          {sortedRosters.map((roster, idx) => (
            <motion.div
              key={roster.roster_id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: idx * 0.05 }}
            >
              <RosterCard 
                roster={roster} 
                user={getUserForRoster(roster.owner_id)} 
              />
            </motion.div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
