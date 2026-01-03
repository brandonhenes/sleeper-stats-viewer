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

interface LeagueDebugData {
  group_found: boolean;
  group_id?: string;
  group_name?: string;
  seasons?: number[];
  league_ids?: string[];
  latest_league_id?: string;
  is_active?: boolean;
  league_type?: string;
  user_roster_id?: number | null;
  user_in_latest_league?: boolean;
  roster_count?: number;
  group_trades_count?: number;
  total_wins?: number;
  total_losses?: number;
  current_nfl_season?: number;
  error?: string;
  total_groups_available?: number;
  available_group_ids?: string[];
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

  const { data: leagueDebugData, isLoading: leagueLoading } = useQuery<LeagueDebugData>({
    queryKey: ["/api/debug/league", groupId, username],
    queryFn: async () => {
      const res = await fetch(`/api/debug/league?groupId=${encodeURIComponent(groupId!)}&username=${encodeURIComponent(username!)}`);
      if (!res.ok) throw new Error("Failed to fetch league debug data");
      return res.json();
    },
    enabled: isVisible && !!groupId && !!username,
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
                      {leagueLoading && (
                        <div className="text-muted-foreground text-[10px]">Loading...</div>
                      )}
                      {leagueDebugData && leagueDebugData.group_found && (
                        <>
                          <div className="flex justify-between">
                            <span>Name:</span>
                            <span className="font-mono text-[10px] truncate max-w-[120px]" title={leagueDebugData.group_name}>
                              {leagueDebugData.group_name}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Seasons:</span>
                            <span className="font-mono text-[10px]">
                              {leagueDebugData.seasons?.join(", ")}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Status:</span>
                            <Badge 
                              variant={leagueDebugData.is_active ? "default" : "secondary"} 
                              className="text-[10px] px-1.5"
                            >
                              {leagueDebugData.is_active ? "Active" : "History"}
                            </Badge>
                          </div>
                          <div className="flex justify-between">
                            <span>Type:</span>
                            <span className="font-mono text-[10px] capitalize">{leagueDebugData.league_type}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Latest League:</span>
                            <span className="font-mono text-[10px]">{leagueDebugData.latest_league_id?.slice(0, 12)}...</span>
                          </div>
                          <div className="flex justify-between">
                            <span>User Roster ID:</span>
                            <span className="font-mono text-[10px]">{leagueDebugData.user_roster_id ?? "N/A"}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Roster Count:</span>
                            <span className="font-mono">{leagueDebugData.roster_count}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Group Trades:</span>
                            <span className="font-mono">{leagueDebugData.group_trades_count}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Record:</span>
                            <span className="font-mono">{leagueDebugData.total_wins}-{leagueDebugData.total_losses}</span>
                          </div>
                        </>
                      )}
                      {leagueDebugData && !leagueDebugData.group_found && (
                        <div className="text-red-500 text-[10px]">{leagueDebugData.error || "Group not found"}</div>
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
