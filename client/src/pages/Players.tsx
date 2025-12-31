import { useParams, Link } from "wouter";
import { useSleeperOverview } from "@/hooks/use-sleeper";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, AlertCircle, Layers } from "lucide-react";
import { Layout } from "@/components/Layout";
import { motion } from "framer-motion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function Players() {
  const { username } = useParams<{ username: string }>();
  const { data, isLoading, isError, error } = useSleeperOverview(username);

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

        {isLoading && !isError && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium animate-pulse">Loading...</p>
          </div>
        )}

        {data && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <Layers className="w-6 h-6 text-primary" />
              <h1 className="text-2xl font-display font-bold">Player Exposure</h1>
              <span className="text-muted-foreground">for @{username}</span>
            </div>

            <Card className="p-12 text-center">
              <div className="text-muted-foreground">
                <Layers className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg">Player exposure analysis coming soon.</p>
                <p className="text-sm mt-2">This feature will show which players you own across leagues.</p>
              </div>
            </Card>
          </motion.div>
        )}
      </div>
    </Layout>
  );
}
