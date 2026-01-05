import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, AlertCircle, Target, Search, ChevronDown, ChevronUp } from "lucide-react";
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
  const [showAll, setShowAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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

  const filteredTargets = useMemo(() => {
    if (!data?.targets) return [];
    const query = searchQuery.toLowerCase();
    return data.targets.filter(t => 
      t.opponent_username.toLowerCase().includes(query) ||
      (t.opponent_display_name?.toLowerCase().includes(query) ?? false)
    );
  }, [data?.targets, searchQuery]);

  const displayedTargets = showAll ? filteredTargets : filteredTargets.slice(0, 5);
  const hasMore = filteredTargets.length > 5;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="modal-trade-targets">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="w-5 h-5" />
            Trade Targets
            {leagueName && (
              <span className="text-muted-foreground font-normal text-base">
                in {leagueName}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground mb-3">
          All league opponents ranked by interest in your players (based on their cross-league exposure).
        </p>

        {data && data.targets.length > 0 && (
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search opponents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-targets"
            />
          </div>
        )}

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
            <p>No opponents found in this league.</p>
          </div>
        )}

        {data && displayedTargets.length > 0 && (
          <div className="space-y-3">
            {displayedTargets.map((target, idx) => (
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
                    {target.meta.needs_sync ? (
                      <span className="text-xs text-amber-500">
                        {syncingUsers.has(target.opponent_username) ? "Building..." : "Needs sync"}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {formatSyncTime(target.meta.last_synced_at)}
                      </span>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleSyncUser(target.opponent_username)}
                      disabled={syncingUsers.has(target.opponent_username) || !target.meta.has_valid_username}
                      title={!target.meta.has_valid_username ? "Username not synced yet" : "Refresh exposure profile"}
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
                    {target.meta.needs_sync
                      ? "Click sync to build exposure profile"
                      : "No matching players found"}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {hasMore && !showAll && (
          <Button
            variant="ghost"
            className="w-full mt-2 gap-2"
            onClick={() => setShowAll(true)}
            data-testid="button-show-all-targets"
          >
            <ChevronDown className="w-4 h-4" />
            Show all ({filteredTargets.length})
          </Button>
        )}

        {showAll && hasMore && (
          <Button
            variant="ghost"
            className="w-full mt-2 gap-2"
            onClick={() => setShowAll(false)}
            data-testid="button-collapse-targets"
          >
            <ChevronUp className="w-4 h-4" />
            Show less
          </Button>
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
