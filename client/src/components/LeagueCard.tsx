import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Trophy, Users, Activity } from "lucide-react";
import { motion } from "framer-motion";
import type { LeagueWithRecord } from "@shared/schema";

interface LeagueCardProps {
  league: LeagueWithRecord;
  index: number;
}

export function LeagueCard({ league, index }: LeagueCardProps) {
  // Format W-L or W-L-T record
  const formatRecord = () => {
    const { wins, losses, ties } = league.my_record || { wins: 0, losses: 0, ties: 0 };
    if (ties > 0) {
      return `${wins}-${losses}-${ties}`;
    }
    return `${wins}-${losses}`;
  };

  return (
    <Link href={`/league/${league.league_id}`} className="block h-full">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: index * 0.03 }}
        whileHover={{ y: -4 }}
      >
        <Card className="h-full p-6 bg-card hover:bg-card/80 border-border/50 hover:border-primary/50 transition-all duration-300 cursor-pointer shadow-lg hover:shadow-primary/10 group relative overflow-hidden">
          {/* Subtle gradient overlay on hover */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          
          <div className="relative z-10 flex flex-col h-full gap-4">
            <div className="flex justify-between items-start gap-2 flex-wrap">
              <Badge variant={league.status === 'active' ? 'default' : 'secondary'} className={league.status === 'active' ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25' : ''}>
                {league.status}
              </Badge>
              {/* W-L Record Badge */}
              <Badge variant="outline" className="bg-accent/20 text-accent-foreground border-accent/30 font-mono font-bold">
                {formatRecord()}
              </Badge>
            </div>

            {/* League name with year */}
            <h3 className="text-xl font-display font-bold text-foreground group-hover:text-primary transition-colors line-clamp-2">
              {league.name} <span className="text-muted-foreground font-normal">({league.season})</span>
            </h3>

            <div className="mt-auto grid grid-cols-2 gap-4 pt-4 border-t border-border/50">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Trophy className="w-4 h-4 text-accent" />
                <span className="capitalize">{league.sport}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="w-4 h-4 text-accent" />
                <span>{league.total_rosters} Teams</span>
              </div>
            </div>
          </div>
        </Card>
      </motion.div>
    </Link>
  );
}
