import { Link, useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { User, Users, Layers } from "lucide-react";

interface LayoutProps {
  username?: string;
  children: React.ReactNode;
}

export function Layout({ username, children }: LayoutProps) {
  const [location] = useLocation();
  
  const getActiveTab = () => {
    if (location.includes("/players/")) return "players";
    if (location.includes("/compare")) return "compare";
    return "profile";
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
                  Sleeper Scout
                </span>
              </Link>
              
              <Tabs value={getActiveTab()} className="w-auto">
                <TabsList className="bg-secondary/50">
                  {username && (
                    <Link href={`/u/${username}`}>
                      <TabsTrigger value="profile" className="gap-2" data-testid="tab-profile">
                        <User className="w-4 h-4" />
                        Profile
                      </TabsTrigger>
                    </Link>
                  )}
                  {username && (
                    <Link href={`/players/${username}`}>
                      <TabsTrigger value="players" className="gap-2" data-testid="tab-players">
                        <Layers className="w-4 h-4" />
                        Players
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
    </div>
  );
}
