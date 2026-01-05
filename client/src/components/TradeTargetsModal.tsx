import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, AlertCircle, Target } from "lucide-react";
import { useTradeTargets, useExposureSync } from "@/hooks/use-sleeper";

interface TradeTargetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  username: string;
  leagueId: string;
  leagueName?: string;
}

export function TradeTargetsModal({
  isOpen,
  onClose,
  username,
  leagueId,
  leagueName,
}: TradeTargetsModalProps) {
  const { data, isLoading, error, refetch } = useTradeTargets(username, leagueId);
  const exposureSync = useExposureSync();
  const [syncingUsers, setSyncingUsers] = useState<Set<string>>(new Set());

  const handleSyncUser = async (oppUsername: string) => {
    setSyncingUsers(prev => new Set(prev).add(oppUsername));
    try {
      await exposureSync.mutateAsync(oppUsername);
      refetch();
    } catch {
    } finally {
      setSyncingUsers(prev => {
        const next = new Set(prev);
        next.delete(oppUsername);
        return next;
      });
    }
  };

  const formatSyncTime = (timestamp: number | null) => {
    if (!timestamp) return "Never synced";
    const diff = Date.now() - timestamp;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return "< 1h ago";
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="modal-trade-targets">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="w-5 h-5" />
            Trade Targets
            {leagueName && (
              <span className="text-muted-foreground font-normal">
                in {leagueName}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground mb-4">
          Opponents ranked by how much they want players on your roster (based on their cross-league exposure).
        </p>

        {isLoading && (
          <div className="flex items-center justify-center py-8" data-testid="targets-loading">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-destructive py-4" data-testid="targets-error">
            <AlertCircle className="w-5 h-5" />
            <span>{error.message}</span>
          </div>
        )}

        {data && data.targets.length === 0 && (
          <div className="text-center py-8 text-muted-foreground" data-testid="targets-empty">
            <p>No targeting data available yet.</p>
            <p className="text-sm mt-2">
              Click the sync button next to opponents to build their exposure profiles.
            </p>
          </div>
        )}

        {data && data.targets.length > 0 && (
          <div className="space-y-4">
            {data.targets.slice(0, 8).map((target, idx) => (
              <div
                key={target.opponent_username}
                className="border rounded-md p-3"
                data-testid={`target-row-${idx}`}
              >
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {target.opponent_display_name || target.opponent_username}
                    </span>
                    {target.target_score > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        Score: {target.target_score.toFixed(0)}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {target.meta.is_partial ? (
                        <span className="text-amber-500">Partial</span>
                      ) : (
                        formatSyncTime(target.meta.last_synced_at)
                      )}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleSyncUser(target.opponent_username)}
                      disabled={syncingUsers.has(target.opponent_username)}
                      data-testid={`button-sync-${target.opponent_username}`}
                    >
                      {syncingUsers.has(target.opponent_username) ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {target.matched_assets.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {target.matched_assets.map((asset) => (
                      <Badge
                        key={asset.player_id}
                        variant="outline"
                        className="text-xs"
                        data-testid={`asset-${asset.player_id}`}
                      >
                        {asset.name}
                        {asset.pos && ` (${asset.pos})`}
                        <span className="ml-1 text-muted-foreground">
                          {asset.exposure_pct}%
                        </span>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {target.meta.active_league_count === 0
                      ? "No exposure profile - click sync to build"
                      : "No matching players found"}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end mt-4">
          <Button variant="outline" onClick={onClose} data-testid="button-close-targets">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
