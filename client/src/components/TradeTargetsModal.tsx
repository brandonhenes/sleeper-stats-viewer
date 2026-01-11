import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Loader2, RefreshCw, AlertCircle, Target, Search, ChevronDown, ChevronUp, CheckCircle2, XCircle } from "lucide-react";
import { useTradeTargets, useExposureSync } from "@/hooks/use-sleeper";
import { useToast } from "@/hooks/use-toast";

interface TradeTargetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  username: string;
  leagueId: string;
  leagueName?: string;
}

type SyncStatus = "idle" | "syncing" | "success" | "failed";

interface SyncState {
  [userId: string]: {
    status: SyncStatus;
    error?: string;
  };
}

const CONCURRENCY_LIMIT = 2;

export function TradeTargetsModal({
  isOpen,
  onClose,
  username,
  leagueId,
  leagueName,
}: TradeTargetsModalProps) {
  const { data, isLoading, error, refetch } = useTradeTargets(username, leagueId);
  const exposureSync = useExposureSync();
  const { toast } = useToast();
  
  const [syncStates, setSyncStates] = useState<SyncState>({});
  const [showAll, setShowAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [autoSyncProgress, setAutoSyncProgress] = useState({ current: 0, total: 0, active: false });
  const autoSyncRanRef = useRef(false);

  const updateSyncState = useCallback((userId: string, status: SyncStatus, error?: string) => {
    setSyncStates(prev => ({
      ...prev,
      [userId]: { status, error }
    }));
  }, []);

  const syncUser = useCallback(async (target: { opponent_user_id: string; opponent_username: string; meta: { has_valid_username: boolean } }) => {
    const userId = target.opponent_user_id;
    updateSyncState(userId, "syncing");
    
    try {
      if (target.meta.has_valid_username) {
        await exposureSync.mutateAsync({ username: target.opponent_username });
      } else {
        await exposureSync.mutateAsync({ user_id: userId });
      }
      updateSyncState(userId, "success");
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Sync failed";
      updateSyncState(userId, "failed", errorMsg);
      return false;
    }
  }, [exposureSync, updateSyncState]);

  const handleSyncUser = async (target: { opponent_user_id: string; opponent_username: string; meta: { has_valid_username: boolean } }) => {
    await syncUser(target);
    refetch();
  };

  const runAutoSync = useCallback(async (targets: Array<{ opponent_user_id: string; opponent_username: string; meta: { needs_sync: boolean; has_valid_username: boolean } }>) => {
    const needsSync = targets.filter(t => t.meta.needs_sync);
    
    if (needsSync.length === 0) return;
    
    setAutoSyncProgress({ current: 0, total: needsSync.length, active: true });
    
    let completed = 0;
    const queue = [...needsSync];
    const results: boolean[] = [];
    
    const processQueue = async () => {
      const activePromises: Promise<void>[] = [];
      
      while (queue.length > 0 || activePromises.length > 0) {
        while (activePromises.length < CONCURRENCY_LIMIT && queue.length > 0) {
          const target = queue.shift()!;
          const promise = syncUser(target).then(success => {
            results.push(success);
            completed++;
            setAutoSyncProgress(prev => ({ ...prev, current: completed }));
          }).finally(() => {
            const idx = activePromises.indexOf(promise);
            if (idx > -1) activePromises.splice(idx, 1);
          });
          activePromises.push(promise);
        }
        
        if (activePromises.length > 0) {
          await Promise.race(activePromises);
        }
      }
    };
    
    await processQueue();
    
    const successCount = results.filter(r => r).length;
    const failCount = results.filter(r => !r).length;
    
    if (failCount > 0) {
      toast({
        title: "Sync completed with errors",
        description: `${successCount} synced, ${failCount} failed`,
        variant: "destructive",
      });
    } else if (successCount > 0) {
      toast({
        title: "Profiles synced",
        description: `${successCount} opponent profiles built`,
      });
    }
    
    setAutoSyncProgress(prev => ({ ...prev, active: false }));
    refetch();
  }, [syncUser, refetch, toast]);

  const runAutoSyncRef = useRef(runAutoSync);
  runAutoSyncRef.current = runAutoSync;

  useEffect(() => {
    if (isOpen && data?.targets && !autoSyncRanRef.current) {
      autoSyncRanRef.current = true;
      runAutoSyncRef.current(data.targets);
    }
    
    if (!isOpen) {
      autoSyncRanRef.current = false;
      setSyncStates({});
      setAutoSyncProgress({ current: 0, total: 0, active: false });
    }
  }, [isOpen, data?.targets]);

  const formatSyncTime = (timestamp: number | null) => {
    if (!timestamp) return "Never synced";
    const diff = Date.now() - timestamp;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return "< 1h ago";
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const getSyncStatusForTarget = (target: { opponent_user_id: string; meta: { needs_sync: boolean; last_synced_at: number | null } }) => {
    const state = syncStates[target.opponent_user_id];
    if (!state) {
      if (target.meta.needs_sync) return { status: "needs_sync" as const, label: "Needs sync" };
      return { status: "ready" as const, label: formatSyncTime(target.meta.last_synced_at) };
    }
    
    switch (state.status) {
      case "syncing": return { status: "syncing" as const, label: "Building..." };
      case "success": return { status: "success" as const, label: "Synced" };
      case "failed": return { status: "failed" as const, label: state.error || "Failed" };
      default: return { status: "ready" as const, label: formatSyncTime(target.meta.last_synced_at) };
    }
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

        {autoSyncProgress.active && autoSyncProgress.total > 0 && (
          <div className="mb-4 p-3 rounded-md bg-muted/50" data-testid="auto-sync-progress">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Building profiles...</span>
              <span className="text-sm text-muted-foreground">
                {autoSyncProgress.current}/{autoSyncProgress.total}
              </span>
            </div>
            <Progress 
              value={(autoSyncProgress.current / autoSyncProgress.total) * 100} 
              className="h-2"
            />
          </div>
        )}

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
            {displayedTargets.map((target, idx) => {
              const syncStatus = getSyncStatusForTarget(target);
              const isSyncing = syncStatus.status === "syncing";
              
              return (
                <div
                  key={target.opponent_user_id}
                  className="border rounded-md p-3"
                  data-testid={`target-row-${idx}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {target.opponent_display_name || target.opponent_username}
                      </span>
                      {target.target_score != null && target.target_score > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          Score: {target.target_score.toFixed(0)}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {syncStatus.status === "syncing" && (
                        <span className="text-xs text-blue-500 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Building...
                        </span>
                      )}
                      {syncStatus.status === "success" && (
                        <span className="text-xs text-green-500 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Synced
                        </span>
                      )}
                      {syncStatus.status === "failed" && (
                        <span className="text-xs text-destructive flex items-center gap-1">
                          <XCircle className="w-3 h-3" />
                          {syncStatus.label}
                        </span>
                      )}
                      {syncStatus.status === "needs_sync" && (
                        <span className="text-xs text-amber-500">
                          Needs sync
                        </span>
                      )}
                      {syncStatus.status === "ready" && (
                        <span className="text-xs text-muted-foreground">
                          {syncStatus.label}
                        </span>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleSyncUser(target)}
                        disabled={isSyncing}
                        title="Refresh exposure profile"
                        data-testid={`button-sync-${target.opponent_username}`}
                      >
                        {isSyncing ? (
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
                      {syncStatus.status === "needs_sync" || syncStatus.status === "syncing"
                        ? "Building exposure profile..."
                        : syncStatus.status === "failed"
                        ? "Retry sync to build profile"
                        : "No matching players found"}
                    </p>
                  )}
                </div>
              );
            })}
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
