import { useParams, Link } from "wouter";
import { useSleeperOverview, usePlayerExposure } from "@/hooks/use-sleeper";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, Layers, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Layout } from "@/components/Layout";
import { motion } from "framer-motion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState, useEffect } from "react";

interface ExposureResponse {
  username: string;
  active_leagues: number;
  history_leagues: number;
  total_leagues: number;
  total_players: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  exposures: Array<{
    player: {
      player_id: string;
      full_name: string | null;
      position: string | null;
      team: string | null;
    };
    leagues_owned: number;
    total_leagues: number;
    exposure_pct: number;
    league_names: string[];
  }>;
}

export default function Players() {
  const { username } = useParams<{ username: string }>();
  const { data, isLoading, isError, error } = useSleeperOverview(username);
  
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("exposure_desc");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    setPage(1);
  }, [positionFilter, sortBy]);

  const { data: exposureData, isLoading: exposureLoading } = usePlayerExposure({
    username,
    page,
    pageSize: 100,
    pos: positionFilter,
    search: debouncedSearch,
    sort: sortBy,
  }) as { data: ExposureResponse | null; isLoading: boolean };

  const positions = ["QB", "RB", "WR", "TE", "K", "DEF"];

  return (
    <Layout username={username}>
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {isError && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-md mx-auto"
          >
            <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <AlertTitle className="ml-2 font-bold">Error</AlertTitle>
              <AlertDescription className="ml-2 mt-1 opacity-90">
                {error instanceof Error ? error.message : "Could not load data."}
              </AlertDescription>
            </Alert>
            <div className="text-center mt-4">
              <Link href="/">
                <Button variant="outline">Search Again</Button>
              </Link>
            </div>
          </motion.div>
        )}

        {(isLoading || exposureLoading) && !isError && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium animate-pulse">Loading player exposure...</p>
          </div>
        )}

        {data && exposureData && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <Layers className="w-6 h-6 text-primary" />
                <h1 className="text-2xl font-display font-bold">Player Exposure</h1>
                <span className="text-muted-foreground">for @{username}</span>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant="outline" data-testid="badge-active-leagues">
                  {exposureData.active_leagues || exposureData.total_leagues} Active Leagues
                </Badge>
                {exposureData.history_leagues > 0 && (
                  <Badge variant="secondary" className="text-muted-foreground" data-testid="badge-history-leagues">
                    +{exposureData.history_leagues} History
                  </Badge>
                )}
                <Badge variant="outline" data-testid="badge-total-players">
                  {exposureData.total_players} Players
                </Badge>
              </div>
            </div>

            <Card className="mb-6">
              <div className="p-4 flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search players..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                    data-testid="input-player-search"
                  />
                </div>
                
                <Select value={positionFilter} onValueChange={setPositionFilter}>
                  <SelectTrigger className="w-40" data-testid="select-position-filter">
                    <SelectValue placeholder="Position" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Positions</SelectItem>
                    {positions.map((pos) => (
                      <SelectItem key={pos} value={pos}>{pos}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-44" data-testid="select-sort">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="exposure_desc">Exposure (High)</SelectItem>
                    <SelectItem value="exposure_asc">Exposure (Low)</SelectItem>
                    <SelectItem value="leagues_desc">Leagues (Most)</SelectItem>
                    <SelectItem value="leagues_asc">Leagues (Least)</SelectItem>
                    <SelectItem value="name_asc">Name (A-Z)</SelectItem>
                    <SelectItem value="name_desc">Name (Z-A)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Card>

            {exposureData.exposures.length === 0 ? (
              <Card className="p-12 text-center">
                <div className="text-muted-foreground">
                  <Layers className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg">No players found.</p>
                  <p className="text-sm mt-2">Try adjusting your search or filters.</p>
                </div>
              </Card>
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Player</TableHead>
                      <TableHead className="text-center">Pos</TableHead>
                      <TableHead className="text-center">Team</TableHead>
                      <TableHead className="text-center">Leagues</TableHead>
                      <TableHead className="text-center">Exposure</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exposureData.exposures.map((exp) => {
                      const exposurePct = exp.exposure_pct;
                      const isHighExposure = exposurePct >= 50;
                      const isMedExposure = exposurePct >= 25 && exposurePct < 50;
                      
                      return (
                        <TableRow key={exp.player.player_id} data-testid={`row-player-${exp.player.player_id}`}>
                          <TableCell>
                            <div className="font-medium">
                              {exp.player.full_name || exp.player.player_id}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="text-xs">
                              {exp.player.position || "?"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="text-muted-foreground text-sm">
                              {exp.player.team || "FA"}
                            </span>
                          </TableCell>
                          <TableCell className="text-center font-mono">
                            {exp.leagues_owned}/{exp.total_leagues}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge 
                              variant={isHighExposure ? "default" : isMedExposure ? "secondary" : "outline"}
                              className={isHighExposure ? "bg-green-500/15 text-green-400" : ""}
                            >
                              {exposurePct}%
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                
                <div className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    Showing {((page - 1) * exposureData.pageSize) + 1}–{Math.min(page * exposureData.pageSize, exposureData.total_players)} of {exposureData.total_players} players
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => p - 1)}
                      disabled={!exposureData.hasPrev}
                      data-testid="button-prev-page"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      Prev
                    </Button>
                    
                    <span className="text-sm px-2">
                      Page {exposureData.page} of {exposureData.totalPages}
                    </span>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => p + 1)}
                      disabled={!exposureData.hasNext}
                      data-testid="button-next-page"
                    >
                      Next
                      <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </motion.div>
        )}
      </div>
    </Layout>
  );
}
