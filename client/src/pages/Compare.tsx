import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Users, ArrowRight } from "lucide-react";
import { Layout } from "@/components/Layout";
import { motion } from "framer-motion";

export default function Compare() {
  const [userA, setUserA] = useState("");
  const [userB, setUserB] = useState("");
  const [, setLocation] = useLocation();

  const handleCompare = (e: React.FormEvent) => {
    e.preventDefault();
    if (userA.trim() && userB.trim()) {
      setLocation(`/compare/${userA.trim()}/${userB.trim()}`);
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="text-center mb-8">
            <Users className="w-12 h-12 text-primary mx-auto mb-4" />
            <h1 className="text-3xl font-display font-bold">Compare Users</h1>
            <p className="text-muted-foreground mt-2">
              Compare fantasy performance, player exposure, and tendencies between two users.
            </p>
          </div>

          <Card className="p-8">
            <form onSubmit={handleCompare} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-[1fr,auto,1fr] gap-4 items-center">
                <div>
                  <label className="text-sm font-medium mb-2 block">User A</label>
                  <Input
                    value={userA}
                    onChange={(e) => setUserA(e.target.value)}
                    placeholder="Enter Sleeper username..."
                    className="h-12"
                    data-testid="input-user-a"
                  />
                </div>
                
                <div className="hidden md:flex items-center justify-center pt-6">
                  <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                    <span className="text-muted-foreground font-bold">vs</span>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">User B</label>
                  <Input
                    value={userB}
                    onChange={(e) => setUserB(e.target.value)}
                    placeholder="Enter Sleeper username..."
                    className="h-12"
                    data-testid="input-user-b"
                  />
                </div>
              </div>

              <div className="text-center">
                <Button 
                  type="submit" 
                  size="lg"
                  disabled={!userA.trim() || !userB.trim()}
                  className="gap-2"
                  data-testid="button-compare"
                >
                  Compare Users
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </form>
          </Card>

          <div className="mt-8 text-center text-muted-foreground text-sm">
            <p>Comparison includes:</p>
            <ul className="mt-2 space-y-1">
              <li>Overall W-L-T records and win percentages</li>
              <li>Player overlap and unique roster tendencies</li>
              <li>Position exposure breakdown</li>
              <li>Head-to-head in shared leagues (if available)</li>
            </ul>
          </div>
        </motion.div>
      </div>
    </Layout>
  );
}
