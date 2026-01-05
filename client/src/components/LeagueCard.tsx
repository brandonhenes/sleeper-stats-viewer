import { useState } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Trophy, Users, Calendar, ArrowRightLeft, Target } from "lucide-react";
import { motion } from "framer-motion";
import type { LeagueGroup } from "@shared/schema";
import { TradeTargetsModal } from "./TradeTargetsModal";

interface LeagueGroupCardProps {
  group: LeagueGroup;
  index: number;
  username?: string;
}

export function LeagueGroupCard({ group, index, username }: LeagueGroupCardProps) {
  const [targetsOpen, setTargetsOpen] = useState(false);
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

  const linkHref = username ? `/u/${username}/league/${group.group_id}` : `/group/${group.group_id}`;
  
  return (
    <Link href={linkHref} className="block h-full">
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

            {group.trade_summary && group.trade_summary.trade_count > 0 && (
              <div className="pt-3 border-t border-border/50 space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <ArrowRightLeft className="w-3 h-3 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    {group.trade_summary.trade_count} Trade{group.trade_summary.trade_count !== 1 ? 's' : ''}
                  </span>
                  {group.trade_summary.trading_style && (
                    <Badge variant="outline" className="text-xs">
                      {group.trade_summary.trading_style}
                    </Badge>
                  )}
                </div>
                {group.trade_summary.top_partner && (
                  <div className="text-xs text-muted-foreground">
                    Top partner: {group.trade_summary.top_partner.display_name || 'Unknown'} ({group.trade_summary.top_partner.trade_count})
                  </div>
                )}
              </div>
            )}

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
            
            <div className="pt-3 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setTargetsOpen(true);
                }}
                data-testid={`button-targets-${group.group_id}`}
              >
                <Target className="w-3 h-3" />
                Targets
              </Button>
            </div>
          </div>
        </Card>
      </motion.div>

      {username && group.latest_league_id && (
        <TradeTargetsModal
          isOpen={targetsOpen}
          onClose={() => setTargetsOpen(false)}
          username={username}
          leagueId={group.latest_league_id}
          leagueName={group.name}
        />
      )}
    </Link>
  );
}
