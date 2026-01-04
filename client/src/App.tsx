import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import Profile from "@/pages/Profile";
import LeagueDetails from "@/pages/LeagueDetails";
import LeagueGroupDetails from "@/pages/LeagueGroupDetails";
import Players from "@/pages/Players";
import Compare from "@/pages/Compare";
import CompareResults from "@/pages/CompareResults";
import Scouting from "@/pages/Scouting";
import Market from "@/pages/Market";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/u/:username" component={Profile} />
      <Route path="/u/:username/league/:groupId" component={LeagueGroupDetails} />
      <Route path="/players/:username" component={Players} />
      <Route path="/scouting/:username" component={Scouting} />
      <Route path="/compare" component={Compare} />
      <Route path="/compare/:userA/:userB" component={CompareResults} />
      <Route path="/market/:username" component={Market} />
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
