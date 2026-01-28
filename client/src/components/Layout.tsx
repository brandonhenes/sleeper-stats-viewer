import { Link, useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LayoutDashboard, Users, Trophy, Zap, TrendingUp } from "lucide-react";
import { DebugDrawer } from "./DebugDrawer";

interface LayoutProps {
  username?: string;
  groupId?: string;
  leagueId?: string;
  children: React.ReactNode;
}

export function Layout({ username, groupId, leagueId, children }: LayoutProps) {
  const [location] = useLocation();
  
  const getActiveTab = () => {
    if (location.includes("/trophy/")) return "trophy";
    if (location.includes("/edge/") || location.includes("/scouting/")) return "edge";
    if (location.includes("/players/") || location.includes("/market/")) return "market";
    if (location.includes("/compare")) return "compare";
    return "dashboard";
  };

  const showTabs = location !== "/" && (username || location.includes("/compare"));

  return (
    <div className="min-h-screen bg-background text-foreground">
      {showTabs && (
        <nav className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b border-border">
          <div className="container mx-auto px-4 py-2 max-w-6xl">
            <div className="flex items-center justify-between gap-4">
              <Link href="/">
                <span className="font-display font-bold text-lg cursor-pointer hover:text-primary transition-colors" data-testid="link-home">
                  Dynasty Edge
                </span>
              </Link>
              
              <Tabs value={getActiveTab()} className="w-auto">
                <TabsList className="bg-secondary/50">
                  {username && (
                    <Link href={`/u/${username}`}>
                      <TabsTrigger value="dashboard" className="gap-2" data-testid="tab-dashboard">
                        <LayoutDashboard className="w-4 h-4" />
                        Dashboard
                      </TabsTrigger>
                    </Link>
                  )}
                  {username && (
                    <Link href={`/trophy/${username}`}>
                      <TabsTrigger value="trophy" className="gap-2" data-testid="tab-trophy-room">
                        <Trophy className="w-4 h-4" />
                        Trophy Room
                      </TabsTrigger>
                    </Link>
                  )}
                  {username && (
                    <Link href={`/edge/${username}`}>
                      <TabsTrigger value="edge" className="gap-2" data-testid="tab-edge-engine">
                        <Zap className="w-4 h-4" />
                        Edge Engine
                      </TabsTrigger>
                    </Link>
                  )}
                  {username && (
                    <Link href={`/players/${username}`}>
                      <TabsTrigger value="market" className="gap-2" data-testid="tab-player-market">
                        <TrendingUp className="w-4 h-4" />
                        Player Market
                      </TabsTrigger>
                    </Link>
                  )}
                  <Link href="/compare">
                    <TabsTrigger value="compare" className="gap-2" data-testid="tab-compare">
                      <Users className="w-4 h-4" />
                      Compare
                    </TabsTrigger>
                  </Link>
                </TabsList>
              </Tabs>
            </div>
          </div>
        </nav>
      )}
      {children}
      <DebugDrawer username={username} groupId={groupId} leagueId={leagueId} />
    </div>
  );
}
