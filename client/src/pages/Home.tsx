import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Sparkles, Loader2, TrendingUp } from "lucide-react";
import { motion } from "framer-motion";

export default function Home() {
  const [username, setUsername] = useState("");
  const [isNavigating, setIsNavigating] = useState(false);
  const [, setLocation] = useLocation();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    
    setIsNavigating(true);
    const trimmed = username.trim();
    localStorage.setItem("sleeper_username", trimmed);
    setLocation(`/u/${trimmed}`);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative overflow-hidden bg-gradient-to-b from-secondary/50 to-background min-h-screen flex items-center justify-center">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?q=80&w=2069&auto=format&fit=crop')] bg-cover bg-center opacity-[0.03]" />
        
        <div className="container mx-auto px-4 py-20 relative z-10 max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary border border-primary/20 mb-6">
              <Sparkles className="w-4 h-4" />
              <span className="text-sm font-medium">Fantasy Football Scouting Tool</span>
            </div>
            
            <h1 className="text-5xl md:text-7xl font-display font-extrabold tracking-tight mb-6 bg-gradient-to-r from-white via-white/90 to-white/50 bg-clip-text text-transparent">
              Sleeper Scout
            </h1>
            
            <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
              Search any Sleeper username to analyze league history, head-to-head records, player exposure, and compare fantasy managers.
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
                    data-testid="input-username"
                    disabled={isNavigating}
                  />
                </div>
                <Button 
                  type="submit" 
                  disabled={isNavigating || !username.trim()}
                  className="h-14 px-8 rounded-xl font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95"
                  data-testid="button-search"
                >
                  {isNavigating ? <Loader2 className="w-5 h-5 animate-spin" /> : "Scout"}
                </Button>
              </div>
            </form>

            <div className="mt-12 grid grid-cols-1 md:grid-cols-4 gap-4 text-center text-sm text-muted-foreground">
              <div className="p-4 rounded-lg bg-card/50 border border-border/30">
                <div className="font-semibold text-foreground mb-1">League History</div>
                <div>View aggregated records across seasons</div>
              </div>
              <div className="p-4 rounded-lg bg-card/50 border border-border/30">
                <div className="font-semibold text-foreground mb-1">Player Exposure</div>
                <div>See which players you own most</div>
              </div>
              <div className="p-4 rounded-lg bg-card/50 border border-border/30">
                <div className="font-semibold text-foreground mb-1">Compare Users</div>
                <div>Analyze tendencies between managers</div>
              </div>
              <div className="p-4 rounded-lg bg-card/50 border border-border/30">
                <div className="font-semibold text-foreground mb-1 flex items-center justify-center gap-1">
                  <TrendingUp className="w-4 h-4" />
                  Market Trends
                </div>
                <div>Most traded players and picks</div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
