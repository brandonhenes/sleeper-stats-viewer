import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Trophy, Users, Activity } from "lucide-react";
import { motion } from "framer-motion";
import type { League } from "@shared/schema";

interface LeagueCardProps {
  league: League;
  index: number;
}

export function LeagueCard({ league, index }: LeagueCardProps) {
  return (
    <Link href={`/league/${league.league_id}`} className="block h-full">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: index * 0.05 }}
        whileHover={{ y: -4 }}
      >
        <Card className="h-full p-6 bg-card hover:bg-card/80 border-border/50 hover:border-primary/50 transition-all duration-300 cursor-pointer shadow-lg hover:shadow-primary/10 group relative overflow-hidden">
          {/* Subtle gradient overlay on hover */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          
          <div className="relative z-10 flex flex-col h-full gap-4">
            <div className="flex justify-between items-start">
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 font-mono">
                {league.season}
              </Badge>
              <Badge variant={league.status === 'active' ? 'default' : 'secondary'} className={league.status === 'active' ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25' : ''}>
                {league.status}
              </Badge>
            </div>

            <h3 className="text-xl font-display font-bold text-foreground group-hover:text-primary transition-colors line-clamp-2">
              {league.name}
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
