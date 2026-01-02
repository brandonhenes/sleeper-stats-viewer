import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bug, ChevronUp, ChevronDown, X } from "lucide-react";

interface DebugData {
  user_exists: boolean;
  username?: string;
  user_id?: string;
  leagues_count?: number;
  rosters_count?: number;
  rosters_with_players?: number;
  total_groups?: number;
  active_groups?: number;
  history_groups?: number;
  active_latest_league_ids?: string[];
  trades_count?: number;
  players_master_count?: number;
  current_nfl_season?: number;
}

interface DebugDrawerProps {
  username?: string;
  groupId?: string;
  leagueId?: string;
}

export function DebugDrawer({ username, groupId, leagueId }: DebugDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setIsVisible(params.get("debug") === "1");
  }, []);

  const { data: debugData, isLoading } = useQuery<DebugData>({
    queryKey: ["/api/debug/db", username],
    queryFn: async () => {
      const res = await fetch(`/api/debug/db?username=${encodeURIComponent(username!)}`);
      if (!res.ok) throw new Error("Failed to fetch debug data");
      return res.json();
    },
    enabled: isVisible && !!username,
  });

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!isOpen ? (
        <Button
          size="icon"
          variant="outline"
          onClick={() => setIsOpen(true)}
          className="rounded-full shadow-lg bg-background"
          data-testid="button-open-debug"
        >
          <Bug className="w-4 h-4" />
        </Button>
      ) : (
        <Card className="w-80 max-h-96 overflow-auto shadow-lg">
          <div className="p-3 border-b flex items-center justify-between gap-2 sticky top-0 bg-card">
            <div className="flex items-center gap-2">
              <Bug className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium text-sm">Debug Info</span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setIsOpen(false)}
              className="h-6 w-6"
              data-testid="button-close-debug"
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
          
          <div className="p-3 space-y-3 text-xs">
            <div>
              <div className="text-muted-foreground mb-1">Profile</div>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span>Username:</span>
                  <span className="font-mono">{username || "—"}</span>
                </div>
                {debugData && (
                  <>
                    <div className="flex justify-between">
                      <span>User ID:</span>
                      <span className="font-mono text-[10px]">{debugData.user_id?.slice(0, 12)}...</span>
                    </div>
                    <div className="flex justify-between">
                      <span>NFL Season:</span>
                      <span className="font-mono">{debugData.current_nfl_season}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {debugData && (
              <>
                <div>
                  <div className="text-muted-foreground mb-1">Leagues</div>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span>Total Groups:</span>
                      <Badge variant="outline" className="text-[10px] px-1.5">
                        {debugData.total_groups}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Active Groups:</span>
                      <Badge variant="default" className="text-[10px] px-1.5 bg-green-500/20 text-green-400">
                        {debugData.active_groups}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>History Groups:</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5">
                        {debugData.history_groups}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Leagues (DB):</span>
                      <span className="font-mono">{debugData.leagues_count}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Rosters:</span>
                      <span className="font-mono">{debugData.rosters_count}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Rosters w/ Players:</span>
                      <span className="font-mono">{debugData.rosters_with_players}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-muted-foreground mb-1">Data Counts</div>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span>Trades:</span>
                      <span className="font-mono">{debugData.trades_count}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Players Master:</span>
                      <span className="font-mono">{debugData.players_master_count}</span>
                    </div>
                  </div>
                </div>

                {groupId && (
                  <div>
                    <div className="text-muted-foreground mb-1">Current Group</div>
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span>Group ID:</span>
                        <span className="font-mono text-[10px]">{groupId.slice(0, 12)}...</span>
                      </div>
                      {leagueId && (
                        <div className="flex justify-between">
                          <span>League ID:</span>
                          <span className="font-mono text-[10px]">{leagueId.slice(0, 12)}...</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {isLoading && (
              <div className="text-muted-foreground text-center py-2">Loading...</div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
