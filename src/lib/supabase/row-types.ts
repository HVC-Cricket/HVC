import type { Database } from "./database.types";

/**
 * Short aliases for the `Database["public"]["Tables"][N]["Row"]` shape so
 * server components and Server Actions don't keep redeclaring the same
 * type expression inline. Add new ones as we need them.
 */

export type BallRow = Database["public"]["Tables"]["balls"]["Row"];
export type MatchRow = Database["public"]["Tables"]["matches"]["Row"];
export type InningsRow = Database["public"]["Tables"]["innings"]["Row"];
export type PlayerRow = Database["public"]["Tables"]["players"]["Row"];
export type MatchPlayerRow = Database["public"]["Tables"]["match_players"]["Row"];
