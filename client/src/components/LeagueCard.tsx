import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Trophy, Users, Calendar } from "lucide-react";
import { motion } from "framer-motion";
import type { LeagueGroup } from "@shared/schema";

interface LeagueGroupCardProps {
  group: LeagueGroup;
  index: number;
}

export function LeagueGroupCard({ group, index }: LeagueGroupCardProps) {
  // Format W-L or W-L-T record
  const formatRecord = () => {
    const { wins, losses, ties } = group.overall_record;
    if (ties > 0) {
      return `${wins}-${losses}-${ties}`;
    }
    return `${wins}-${losses}`;
  };

  // Format years range
  const formatYears = () => {
    if (group.min_season === group.max_season) {
      return String(group.min_season);
    }
    return `${group.min_season}-${group.max_season}`;
  };

  return (
    <Link href={`/group/${group.group_id}`} className="block h-full">
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
              {/* Years badge */}
              <Badge variant="secondary" className="gap-1">
                <Calendar className="w-3 h-3" />
                {formatYears()}
              </Badge>
              {/* W-L Record Badge */}
              <Badge variant="outline" className="bg-accent/20 text-accent-foreground border-accent/30 font-mono font-bold">
                {formatRecord()}
              </Badge>
            </div>

            {/* League name */}
            <h3 className="text-xl font-display font-bold text-foreground group-hover:text-primary transition-colors line-clamp-2">
              {group.name}
            </h3>

            <div className="mt-auto grid grid-cols-2 gap-4 pt-4 border-t border-border/50">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Trophy className="w-4 h-4 text-accent" />
                <span>{group.seasons_count} Season{group.seasons_count !== 1 ? 's' : ''}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="w-4 h-4 text-accent" />
                <span>{group.league_ids.length} League{group.league_ids.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>
        </Card>
      </motion.div>
    </Link>
  );
}
