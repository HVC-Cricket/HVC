/**
 * View-model types used by the home page's match cards. Lives next to
 * `page.tsx` so the page itself reads as a data-fetch + transform +
 * compose, with all presentational shapes co-located here.
 */

export type TeamView = {
  id: string;
  name: string;
  short_name: string;
  logo_url: string | null;
};

export type InningsScore = {
  innings_number: number;
  batting_team_id: string;
  runs: number;
  wickets: number;
  overs: string; // X.Y notation
  target: number | null;
  legal_balls: number;
};

export type LiveMatchView = {
  id: string;
  status: "live" | "innings_break";
  tournament: { slug: string; name: string };
  matchNumber: number;
  oversPerInnings: number;
  teamA: TeamView;
  teamB: TeamView;
  innings1: InningsScore | null;
  innings2: InningsScore | null;
};

export type UpcomingMatchView = {
  id: string;
  tournament: { slug: string; name: string };
  matchNumber: number;
  scheduledAt: string;
  teamA: TeamView;
  teamB: TeamView;
};

export type RecentMatchView = {
  id: string;
  tournament: { slug: string; name: string };
  matchNumber: number;
  teamA: TeamView;
  teamB: TeamView;
  innings1: InningsScore | null;
  innings2: InningsScore | null;
};

export type UpcomingTournamentView = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  venue: string | null;
  teamCount: number;
  matchCount: number;
  firstScheduledAt: string | null;
};
