import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Eye, Copy, Check } from "lucide-react";
import { usePlayerValuesCoverage } from "@/hooks/use-sleeper";
import { Badge } from "@/components/ui/badge";

interface CoverageWarningProps {
  leagueId: string | undefined;
  ownerId: string | undefined;
  threshold?: number;
}

export function CoverageWarning({ leagueId, ownerId, threshold = 98 }: CoverageWarningProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: coverage, isLoading } = usePlayerValuesCoverage(leagueId, ownerId);

  if (isLoading || !coverage) return null;
  if (coverage.coverage_pct >= threshold) return null;

  const missingPct = (100 - coverage.coverage_pct).toFixed(1);

  const handleCopyPlayerIds = () => {
    const ids = coverage.missing.map(p => p.player_id).join("\n");
    navigator.clipboard.writeText(ids);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Alert variant="destructive" className="mb-4">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Coverage Warning</AlertTitle>
      <AlertDescription className="flex items-center justify-between flex-wrap gap-2">
        <span>
          {missingPct}% of your roster has no trade value match ({coverage.matched_players}/{coverage.total_players} players).
          Mode: <Badge variant="outline" className="ml-1">{coverage.mode.toUpperCase()}</Badge>
        </span>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" data-testid="button-view-missing-players">
              <Eye className="w-4 h-4 mr-2" />
              View List
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-auto">
            <DialogHeader>
              <DialogTitle>Missing Player Values ({coverage.missing.length})</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleCopyPlayerIds}
                  data-testid="button-copy-player-ids"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Player IDs
                    </>
                  )}
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Position</TableHead>
                    <TableHead>Player</TableHead>
                    <TableHead>Player ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {coverage.missing.map((player) => (
                    <TableRow key={player.player_id}>
                      <TableCell>
                        <Badge variant="secondary">{player.position}</Badge>
                      </TableCell>
                      <TableCell>{player.full_name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {player.player_id}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </DialogContent>
        </Dialog>
      </AlertDescription>
    </Alert>
  );
}
