import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import LeagueDetails from "@/pages/LeagueDetails";
import LeagueGroupDetails from "@/pages/LeagueGroupDetails";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/league/:id" component={LeagueDetails} />
      <Route path="/group/:groupId" component={LeagueGroupDetails} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
