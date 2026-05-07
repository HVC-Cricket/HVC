// Hand-written stub. Replace with full Supabase-generated types via:
//   pnpm gen:types
// (requires `pnpm supabase login` first, or SUPABASE_ACCESS_TOKEN env var.)
//
// Only the tables Phase 1 + 2 read/write are typed below; the rest will be
// covered when the generator is wired up.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type TournamentFormat = "league" | "knockout" | "group_then_knockout";
type TournamentStatus = "draft" | "active" | "completed" | "archived";
type TournamentAdminRole = "organizer" | "scorer";
type TeamPlayerRole = "captain" | "vice_captain" | "wicket_keeper" | "player";

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
          color: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tournament_id: string;
          name: string;
          short_name: string;
          logo_url?: string | null;
          color?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tournament_id?: string;
          name?: string;
          short_name?: string;
          logo_url?: string | null;
          color?: string | null;
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
          jersey_number: number | null;
          role: TeamPlayerRole;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          player_id: string;
          jersey_number?: number | null;
          role?: TeamPlayerRole;
          created_at?: string;
        };
        Update: {
          id?: string;
          team_id?: string;
          player_id?: string;
          jersey_number?: number | null;
          role?: TeamPlayerRole;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
