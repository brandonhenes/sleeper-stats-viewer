import { Card } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Crown, Shield, TrendingUp, TrendingDown } from "lucide-react";
import type { LeagueUser, Roster } from "@shared/schema";

interface RosterCardProps {
  roster: Roster;
  user?: LeagueUser;
}

export function RosterCard({ roster, user }: RosterCardProps) {
  const wins = roster.settings?.wins ?? 0;
  const losses = roster.settings?.losses ?? 0;
  const ties = roster.settings?.ties ?? 0;
  const fpts = roster.settings?.fpts ?? 0;

  const totalGames = wins + losses + ties;
  const winRate = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(0) : "0";

  return (
    <Card className="p-5 bg-card/50 backdrop-blur-sm border-border/50 hover:bg-card hover:border-border transition-all duration-200">
      <div className="flex items-start gap-4">
        <div className="relative">
          <Avatar className="w-16 h-16 border-2 border-border shadow-sm">
            <AvatarImage 
              src={user?.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : undefined} 
              alt={user?.display_name || "Unknown"} 
            />
            <AvatarFallback className="bg-secondary text-lg font-bold">
              {(user?.display_name || "??").substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {user?.is_owner && (
            <div className="absolute -top-2 -right-2 bg-yellow-500/20 p-1.5 rounded-full border border-yellow-500/50" title="Commissioner">
              <Crown className="w-3 h-3 text-yellow-500" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h4 className="font-display font-semibold text-lg truncate text-foreground">
            {user?.display_name || "Unknown Manager"}
          </h4>
          <p className="text-sm text-muted-foreground truncate font-mono">
            @{user?.username || "unknown"}
          </p>
          
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="outline" className="bg-secondary/50 border-border/50">
              Rank #{roster.settings?.rank ?? "-"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {roster.starters?.length ?? 0} Starters
            </span>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-background/50 border border-border/50 flex flex-col items-center justify-center">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Record</span>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold font-mono text-foreground">{wins}-{losses}</span>
            {ties > 0 && <span className="text-sm text-muted-foreground">-{ties}</span>}
          </div>
        </div>
        
        <div className="p-3 rounded-lg bg-background/50 border border-border/50 flex flex-col items-center justify-center">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Win Rate</span>
          <div className="flex items-center gap-1.5">
            {Number(winRate) >= 50 ? (
              <TrendingUp className="w-4 h-4 text-green-500" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-500" />
            )}
            <span className={`text-xl font-bold font-mono ${Number(winRate) >= 50 ? "text-green-500" : "text-red-500"}`}>
              {winRate}%
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-border/50 flex justify-between items-center text-xs text-muted-foreground font-mono">
        <span>FPTS: {fpts}</span>
        <span>Moves: {roster.settings?.total_moves ?? 0}</span>
      </div>
    </Card>
  );
}
