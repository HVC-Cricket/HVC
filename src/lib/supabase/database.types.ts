// Hand-written stub. Replace with full Supabase-generated types via:
//   pnpm gen:types
// (requires `pnpm supabase login` first, or SUPABASE_ACCESS_TOKEN env var.)
//
// Only the tables Phase 1–3 read/write are typed below; the rest will be
// covered when the generator is wired up.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type TournamentFormat =
  | "league"
  | "knockout"
  | "group_then_knockout"
  | "round_robin_playoff_final";
type TournamentStatus =
  | "draft"
  | "upcoming"
  | "active"
  | "completed"
  | "archived";
type TournamentAdminRole = "organizer" | "scorer";
type TeamPlayerRole = "captain" | "vice_captain" | "wicket_keeper" | "player";
type MatchStage =
  | "group"
  | "qualifier"
  | "qualifier_1"
  | "eliminator"
  | "qualifier_2"
  | "quarter"
  | "semi"
  | "final"
  | "exhibition";
type MatchStatus =
  | "scheduled"
  | "live"
  | "innings_break"
  | "completed"
  | "abandoned";
type MatchResultType =
  | "normal"
  | "tie"
  | "super_over"
  | "no_result"
  | "abandoned";
type TossDecision = "bat" | "bowl";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_url: string | null;
          phone: string | null;
          is_super_admin: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          avatar_url?: string | null;
          phone?: string | null;
          is_super_admin?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          avatar_url?: string | null;
          phone?: string | null;
          is_super_admin?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tournaments: {
        Row: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          format: TournamentFormat;
          default_overs_per_innings: number;
          default_players_per_side: number;
          start_date: string | null;
          end_date: string | null;
          venue: string | null;
          rules: Json;
          logo_url: string | null;
          banner_url: string | null;
          status: TournamentStatus;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          description?: string | null;
          format: TournamentFormat;
          default_overs_per_innings?: number;
          default_players_per_side?: number;
          start_date?: string | null;
          end_date?: string | null;
          venue?: string | null;
          rules?: Json;
          logo_url?: string | null;
          banner_url?: string | null;
          status?: TournamentStatus;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          description?: string | null;
          format?: TournamentFormat;
          default_overs_per_innings?: number;
          default_players_per_side?: number;
          start_date?: string | null;
          end_date?: string | null;
          venue?: string | null;
          rules?: Json;
          logo_url?: string | null;
          banner_url?: string | null;
          status?: TournamentStatus;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tournament_admins: {
        Row: {
          id: string;
          tournament_id: string;
          user_id: string;
          role: TournamentAdminRole;
          added_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tournament_id: string;
          user_id: string;
          role: TournamentAdminRole;
          added_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tournament_id?: string;
          user_id?: string;
          role?: TournamentAdminRole;
          added_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      teams: {
        Row: {
          id: string;
          tournament_id: string;
          name: string;
          short_name: string;
          logo_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tournament_id: string;
          name: string;
          short_name: string;
          logo_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tournament_id?: string;
          name?: string;
          short_name?: string;
          logo_url?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      players: {
        Row: {
          id: string;
          display_name: string;
          phone: string | null;
          photo_url: string | null;
          batting_style: string | null;
          bowling_style: string | null;
          category: 1 | 2 | 3 | null;
          linked_user_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          display_name: string;
          phone?: string | null;
          photo_url?: string | null;
          batting_style?: string | null;
          bowling_style?: string | null;
          category?: 1 | 2 | 3 | null;
          linked_user_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          phone?: string | null;
          photo_url?: string | null;
          batting_style?: string | null;
          bowling_style?: string | null;
          category?: 1 | 2 | 3 | null;
          linked_user_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      team_players: {
        Row: {
          id: string;
          team_id: string;
          player_id: string;
          role: TeamPlayerRole;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          player_id: string;
          role?: TeamPlayerRole;
          created_at?: string;
        };
        Update: {
          id?: string;
          team_id?: string;
          player_id?: string;
          role?: TeamPlayerRole;
          created_at?: string;
        };
        Relationships: [];
      };
      matches: {
        Row: {
          id: string;
          tournament_id: string;
          match_number: number;
          stage: MatchStage;
          // NOTE: the DB column is now nullable (Q2 / Final scheduled
          // pre-bracket carry null on both sides until the playoff
          // resolver populates them). The TS type stays `string` here
          // to avoid an audit of every reader on the live-tournament
          // critical path. The two surfaces that actually encounter
          // null rows (tournament match list + match detail) have
          // their own local null guards.
          team_a_id: string;
          team_b_id: string;
          scheduled_at: string | null;
          started_at: string | null;
          ended_at: string | null;
          venue: string | null;
          overs_per_innings: number;
          players_per_side: number;
          format_overrides: Json | null;
          toss_winner_id: string | null;
          toss_decision: TossDecision | null;
          status: MatchStatus;
          result_type: MatchResultType | null;
          winner_id: string | null;
          win_margin: string | null;
          player_of_match_id: string | null;
          current_innings_id: string | null;
          primary_scorer_id: string | null;
          primary_scorer_heartbeat_at: string | null;
          pending_scorer_request_id: string | null;
          pending_scorer_request_at: string | null;
          umpire_1: string | null;
          umpire_2: string | null;
          scorer: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tournament_id: string;
          match_number: number;
          stage?: MatchStage;
          team_a_id: string;
          team_b_id: string;
          scheduled_at?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          venue?: string | null;
          overs_per_innings: number;
          players_per_side: number;
          format_overrides?: Json | null;
          toss_winner_id?: string | null;
          toss_decision?: TossDecision | null;
          status?: MatchStatus;
          result_type?: MatchResultType | null;
          winner_id?: string | null;
          win_margin?: string | null;
          player_of_match_id?: string | null;
          current_innings_id?: string | null;
          primary_scorer_id?: string | null;
          primary_scorer_heartbeat_at?: string | null;
          pending_scorer_request_id?: string | null;
          pending_scorer_request_at?: string | null;
          umpire_1?: string | null;
          umpire_2?: string | null;
          scorer?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tournament_id?: string;
          match_number?: number;
          stage?: MatchStage;
          team_a_id?: string;
          team_b_id?: string;
          scheduled_at?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          venue?: string | null;
          overs_per_innings?: number;
          players_per_side?: number;
          format_overrides?: Json | null;
          toss_winner_id?: string | null;
          toss_decision?: TossDecision | null;
          status?: MatchStatus;
          result_type?: MatchResultType | null;
          winner_id?: string | null;
          win_margin?: string | null;
          player_of_match_id?: string | null;
          current_innings_id?: string | null;
          primary_scorer_id?: string | null;
          primary_scorer_heartbeat_at?: string | null;
          pending_scorer_request_id?: string | null;
          pending_scorer_request_at?: string | null;
          umpire_1?: string | null;
          umpire_2?: string | null;
          scorer?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      match_players: {
        Row: {
          id: string;
          match_id: string;
          team_id: string;
          player_id: string;
          batting_order: number | null;
          is_keeper: boolean;
          is_captain: boolean;
          is_substitute: boolean;
        };
        Insert: {
          id?: string;
          match_id: string;
          team_id: string;
          player_id: string;
          batting_order?: number | null;
          is_keeper?: boolean;
          is_captain?: boolean;
          is_substitute?: boolean;
        };
        Update: {
          id?: string;
          match_id?: string;
          team_id?: string;
          player_id?: string;
          batting_order?: number | null;
          is_keeper?: boolean;
          is_captain?: boolean;
          is_substitute?: boolean;
        };
        Relationships: [];
      };
      innings: {
        Row: {
          id: string;
          match_id: string;
          innings_number: number;
          batting_team_id: string;
          bowling_team_id: string;
          total_runs: number;
          total_wickets: number;
          total_legal_balls: number;
          extras_wides: number;
          extras_no_balls: number;
          extras_byes: number;
          extras_leg_byes: number;
          extras_penalty: number;
          target: number | null;
          declared: boolean;
          is_complete: boolean;
          started_at: string | null;
          ended_at: string | null;
          initial_striker_id: string | null;
          initial_non_striker_id: string | null;
          initial_bowler_id: string | null;
        };
        Insert: {
          id?: string;
          match_id: string;
          innings_number: number;
          batting_team_id: string;
          bowling_team_id: string;
          total_runs?: number;
          total_wickets?: number;
          total_legal_balls?: number;
          extras_wides?: number;
          extras_no_balls?: number;
          extras_byes?: number;
          extras_leg_byes?: number;
          extras_penalty?: number;
          target?: number | null;
          declared?: boolean;
          is_complete?: boolean;
          started_at?: string | null;
          ended_at?: string | null;
          initial_striker_id?: string | null;
          initial_non_striker_id?: string | null;
          initial_bowler_id?: string | null;
        };
        Update: {
          id?: string;
          match_id?: string;
          innings_number?: number;
          batting_team_id?: string;
          bowling_team_id?: string;
          total_runs?: number;
          total_wickets?: number;
          total_legal_balls?: number;
          extras_wides?: number;
          extras_no_balls?: number;
          extras_byes?: number;
          extras_leg_byes?: number;
          extras_penalty?: number;
          target?: number | null;
          declared?: boolean;
          is_complete?: boolean;
          started_at?: string | null;
          ended_at?: string | null;
          initial_striker_id?: string | null;
          initial_non_striker_id?: string | null;
          initial_bowler_id?: string | null;
        };
        Relationships: [];
      };
      balls: {
        Row: {
          id: string;
          innings_id: string;
          over_number: number;
          ball_in_over: number;
          legal_ball_seq: number | null;
          batter_id: string;
          non_striker_id: string;
          bowler_id: string;
          runs_off_bat: number;
          extras: number;
          extra_type: "wide" | "no_ball" | "bye" | "leg_bye" | "penalty" | null;
          is_wicket: boolean;
          wicket_type: string | null;
          player_out_id: string | null;
          fielder_id: string | null;
          is_free_hit: boolean;
          is_powerplay: boolean;
          counts_for_innings_total: boolean;
          shot_type: string | null;
          shot_zone: string | null;
          pitch_x: number | null;
          pitch_y: number | null;
          wagon_x: number | null;
          wagon_y: number | null;
          commentary: string | null;
          custom_data: Json | null;
          is_voided: boolean;
          voided_by: string | null;
          voided_at: string | null;
          scored_by: string;
          scored_at: string;
        };
        Insert: {
          id?: string;
          innings_id: string;
          over_number: number;
          ball_in_over: number;
          legal_ball_seq?: number | null;
          batter_id: string;
          non_striker_id: string;
          bowler_id: string;
          runs_off_bat?: number;
          extras?: number;
          extra_type?: "wide" | "no_ball" | "bye" | "leg_bye" | "penalty" | null;
          is_wicket?: boolean;
          wicket_type?: string | null;
          player_out_id?: string | null;
          fielder_id?: string | null;
          is_free_hit?: boolean;
          is_powerplay?: boolean;
          counts_for_innings_total?: boolean;
          shot_type?: string | null;
          shot_zone?: string | null;
          pitch_x?: number | null;
          pitch_y?: number | null;
          wagon_x?: number | null;
          wagon_y?: number | null;
          commentary?: string | null;
          custom_data?: Json | null;
          is_voided?: boolean;
          voided_by?: string | null;
          voided_at?: string | null;
          scored_by: string;
          scored_at?: string;
        };
        Update: {
          id?: string;
          innings_id?: string;
          over_number?: number;
          ball_in_over?: number;
          legal_ball_seq?: number | null;
          batter_id?: string;
          non_striker_id?: string;
          bowler_id?: string;
          runs_off_bat?: number;
          extras?: number;
          extra_type?: "wide" | "no_ball" | "bye" | "leg_bye" | "penalty" | null;
          is_wicket?: boolean;
          wicket_type?: string | null;
          player_out_id?: string | null;
          fielder_id?: string | null;
          is_free_hit?: boolean;
          is_powerplay?: boolean;
          counts_for_innings_total?: boolean;
          shot_type?: string | null;
          shot_zone?: string | null;
          pitch_x?: number | null;
          pitch_y?: number | null;
          wagon_x?: number | null;
          wagon_y?: number | null;
          commentary?: string | null;
          custom_data?: Json | null;
          is_voided?: boolean;
          voided_by?: string | null;
          voided_at?: string | null;
          scored_by?: string;
          scored_at?: string;
        };
        Relationships: [];
      };
      match_audit_events: {
        Row: {
          id: string;
          match_id: string;
          event_type: string;
          actor_id: string | null;
          payload: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          match_id: string;
          event_type: string;
          actor_id?: string | null;
          payload?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          match_id?: string;
          event_type?: string;
          actor_id?: string | null;
          payload?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          match_id: string;
          user_id: string | null;
          endpoint: string;
          p256dh: string;
          auth: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          match_id: string;
          user_id?: string | null;
          endpoint: string;
          p256dh: string;
          auth: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          match_id?: string;
          user_id?: string | null;
          endpoint?: string;
          p256dh?: string;
          auth?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      historical_match_batting: {
        Row: {
          id: string;
          match_id: string;
          innings_number: number;
          batting_team_id: string;
          player_id: string | null;
          player_name: string;
          batting_order: number | null;
          is_captain: boolean;
          runs: number;
          balls_faced: number;
          minutes: number | null;
          fours: number;
          sixes: number;
          strike_rate: number | null;
          batting_hand: string | null;
          how_to_out: string | null;
          is_out: boolean;
        };
        Insert: {
          id?: string;
          match_id: string;
          innings_number: number;
          batting_team_id: string;
          player_id?: string | null;
          player_name: string;
          batting_order?: number | null;
          is_captain?: boolean;
          runs?: number;
          balls_faced?: number;
          minutes?: number | null;
          fours?: number;
          sixes?: number;
          strike_rate?: number | null;
          batting_hand?: string | null;
          how_to_out?: string | null;
          is_out?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["historical_match_batting"]["Insert"]>;
        Relationships: [];
      };
      historical_match_bowling: {
        Row: {
          id: string;
          match_id: string;
          innings_number: number;
          bowling_team_id: string;
          player_id: string | null;
          player_name: string;
          bowling_order: number | null;
          overs: number;
          maidens: number;
          runs: number;
          wickets: number;
          dots: number;
          fours_conceded: number;
          sixes_conceded: number;
          wides: number;
          noballs: number;
          economy_rate: number | null;
        };
        Insert: {
          id?: string;
          match_id: string;
          innings_number: number;
          bowling_team_id: string;
          player_id?: string | null;
          player_name: string;
          bowling_order?: number | null;
          overs?: number;
          maidens?: number;
          runs?: number;
          wickets?: number;
          dots?: number;
          fours_conceded?: number;
          sixes_conceded?: number;
          wides?: number;
          noballs?: number;
          economy_rate?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["historical_match_bowling"]["Insert"]>;
        Relationships: [];
      };
      historical_match_fall_of_wickets: {
        Row: {
          id: string;
          match_id: string;
          innings_number: number;
          batting_team_id: string;
          wicket_no: number;
          run_at_fall: number;
          over_at_fall: number | null;
          dismiss_player_id: string | null;
          dismiss_player_name: string | null;
        };
        Insert: {
          id?: string;
          match_id: string;
          innings_number: number;
          batting_team_id: string;
          wicket_no: number;
          run_at_fall: number;
          over_at_fall?: number | null;
          dismiss_player_id?: string | null;
          dismiss_player_name?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["historical_match_fall_of_wickets"]["Insert"]>;
        Relationships: [];
      };
      historical_tournament_mvp: {
        Row: {
          id: string;
          tournament_id: string;
          player_id: string | null;
          player_name: string;
          team_id: string | null;
          rank: number;
          matches: number;
          batting_points: number;
          bowling_points: number;
          fielding_points: number;
          total_points: number;
        };
        Insert: {
          id?: string;
          tournament_id: string;
          player_id?: string | null;
          player_name: string;
          team_id?: string | null;
          rank: number;
          matches?: number;
          batting_points?: number;
          bowling_points?: number;
          fielding_points?: number;
          total_points: number;
        };
        Update: Partial<Database["public"]["Tables"]["historical_tournament_mvp"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      lookup_user_id_by_email: {
        Args: { p_email: string };
        Returns: string | null;
      };
      lookup_email_by_user_id: {
        Args: { p_user_id: string };
        Returns: string | null;
      };
      list_users_for_linking: {
        Args: Record<string, never>;
        Returns: { id: string; email: string; display_name: string }[];
      };
    };
  };
};
