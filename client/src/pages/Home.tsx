import { useState } from "react";
import { useSleeperOverview } from "@/hooks/use-sleeper";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Loader2, Sparkles, AlertCircle } from "lucide-react";
import { LeagueCard } from "@/components/LeagueCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { motion, AnimatePresence } from "framer-motion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

export default function Home() {
  const [username, setUsername] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading, error, isError } = useSleeperOverview(searchQuery);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    setSearchQuery(username.trim());
  };

  const hasLeagues = data && Object.keys(data.leaguesBySeason).length > 0;
  const seasons = data ? Object.keys(data.leaguesBySeason).sort((a, b) => Number(b) - Number(a)) : [];

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      {/* Hero Section */}
      <div className="relative overflow-hidden bg-gradient-to-b from-secondary/50 to-background border-b border-border/50">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?q=80&w=2069&auto=format&fit=crop')] bg-cover bg-center opacity-[0.03]" />
        
        <div className="container mx-auto px-4 py-20 relative z-10 max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary border border-primary/20 mb-6">
              <Sparkles className="w-4 h-4" />
              <span className="text-sm font-medium">Fantasy Football Analytics</span>
            </div>
            
            <h1 className="text-5xl md:text-7xl font-display font-extrabold tracking-tight mb-6 bg-gradient-to-r from-white via-white/90 to-white/50 bg-clip-text text-transparent">
              Sleeper Dashboard
            </h1>
            
            <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
              Visualize your league history, analyze performance, and explore detailed stats across all your seasons.
            </p>

            <form onSubmit={handleSearch} className="max-w-md mx-auto relative group">
              <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="relative flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input 
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter Sleeper username..." 
                    className="pl-11 h-14 rounded-xl bg-card border-border/50 text-lg shadow-lg focus-visible:ring-primary/50 transition-all"
                  />
                </div>
                <Button 
                  type="submit" 
                  disabled={isLoading}
                  className="h-14 px-8 rounded-xl font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95"
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Analyze"}
                </Button>
              </div>
            </form>
          </motion.div>
        </div>
      </div>

      {/* Content Section */}
      <div className="container mx-auto px-4 py-12 max-w-6xl">
        {isError && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-md mx-auto"
          >
            <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <AlertTitle className="ml-2 font-bold">Error Fetching Data</AlertTitle>
              <AlertDescription className="ml-2 mt-1 opacity-90">
                {error instanceof Error ? error.message : "Could not find user or load leagues."}
              </AlertDescription>
            </Alert>
          </motion.div>
        )}

        {isLoading && !isError && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium animate-pulse">Scanning seasons history...</p>
          </div>
        )}

        {data && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            {/* User Profile */}
            <div className="flex flex-col md:flex-row items-center gap-6 mb-12 p-8 rounded-3xl bg-secondary/30 border border-border/50 backdrop-blur-sm">
              <Avatar className="w-24 h-24 border-4 border-background shadow-xl">
                <AvatarImage src={`https://sleepercdn.com/avatars/thumbs/${data.user.avatar}`} />
                <AvatarFallback className="text-3xl font-bold bg-primary text-primary-foreground">
                  {data.user.display_name.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="text-center md:text-left">
                <h2 className="text-3xl font-display font-bold">{data.user.display_name}</h2>
                <p className="text-lg text-muted-foreground font-mono">@{data.user.username}</p>
              </div>
              <div className="md:ml-auto flex gap-8 text-center">
                <div>
                  <div className="text-3xl font-bold text-primary font-display">{seasons.length}</div>
                  <div className="text-sm text-muted-foreground uppercase tracking-wider font-medium">Seasons</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-primary font-display">
                    {Object.values(data.leaguesBySeason).reduce((acc, leagues) => acc + leagues.length, 0)}
                  </div>
                  <div className="text-sm text-muted-foreground uppercase tracking-wider font-medium">Leagues</div>
                </div>
              </div>
            </div>

            {/* Seasons Grid */}
            <div className="space-y-12">
              {seasons.map((season) => (
                <div key={season} className="relative">
                  <div className="flex items-center gap-4 mb-6">
                    <h3 className="text-2xl font-display font-bold text-white/90">{season} Season</h3>
                    <div className="h-px bg-border/50 flex-1" />
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {data.leaguesBySeason[season].map((league, idx) => (
                      <LeagueCard key={league.league_id} league={league} index={idx} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {!hasLeagues && (
              <div className="text-center py-20 opacity-50">
                <p className="text-xl">No leagues found for this user.</p>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
