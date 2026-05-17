#!/usr/bin/env python3
"""
Scrape HVC tournament data from cricheroes.com Next.js JSON endpoints, then
emit CSVs shaped like our DB schema (db.sql) so they can be imported with a
trivial mapper.

Output layout under data/cricheroes/:
  raw/                          — exact JSON dumps from cricheroes (source of truth)
  csv/                          — schema-shaped CSVs (one per table) + aux files

Schema-shaped (one CSV per table in our DB):
  tournaments.csv     — tournaments
  teams.csv           — teams (per tournament)
  players.csv         — players (global registry)
  team_players.csv    — roster (player ↔ team within a tournament)
  matches.csv         — matches
  match_players.csv   — playing XI per team per match
  innings.csv         — innings summary + extras breakdown

Auxiliary historical aggregates (no direct DB target; we don't have ball-by-ball
from cricheroes, so per-match batting/bowling rows are kept for stat reconstruction):
  historical_batting.csv
  historical_bowling.csv
  fall_of_wickets.csv

Every schema-shaped CSV carries cricheroes source IDs (e.g. `cricheroes_tournament_id`,
`cricheroes_match_id`) so the downstream importer can map them to our UUIDs.

No auth required — the _next/data endpoints are publicly readable.
"""

from __future__ import annotations

import csv
import json
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "cricheroes" / "raw"
CSV_DIR = ROOT / "data" / "cricheroes" / "csv"

TOURNAMENTS = [
    {"season": 1, "id": 236267,  "slug": "hvc-season-1"},
    {"season": 2, "id": 293657,  "slug": "hvc-season-2"},
    {"season": 3, "id": 443660,  "slug": "hvc-season-3"},
    {"season": 4, "id": 577076,  "slug": "hvc-season-4"},
    {"season": 5, "id": 983328,  "slug": "hvc-season-5"},
    {"season": 6, "id": 1462709, "slug": "hvc-season-6"},
]

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
SLEEP_BETWEEN_REQUESTS = 0.4

EXTRA_TYPE_TO_COL = {
    "WD": "extras_wides",
    "NB": "extras_no_balls",
    "B":  "extras_byes",
    "LB": "extras_leg_byes",
    "P":  "extras_penalty",
}

# ---------------------------------------------------------------------------
# HTTP + buildId
# ---------------------------------------------------------------------------

_current_build_id: list[str] = [""]


def http_get(url: str, extra_headers: dict[str, str] | None = None) -> bytes:
    headers = {"User-Agent": UA, "Accept": "*/*"}
    if extra_headers:
        headers.update(extra_headers)
    req = Request(url, headers=headers)
    with urlopen(req, timeout=30) as r:
        return r.read()


# Headers required by api.cricheroes.in. Anonymous, but the API insists on
# non-empty api-key + udid + device-type — the values don't actually have to
# match a real session.
API_HEADERS = {
    "api-key": "cr!CkH3r0s",
    "device-type": "web",
    "udid": "hvc-scraper-stable-id",
}
API_BASE = "https://api.cricheroes.in/api/v1"


def fetch_mvp_leaderboard(tid: int) -> list[dict[str, Any]]:
    """Fetch cricheroes' published MVP leaderboard for a tournament.

    Endpoint returns one row per player who appeared, already ranked, with
    cricheroes' proprietary batting/bowling/fielding/total scores as decimal
    strings (e.g. "33.003"). No pagination — single response.
    """
    url = f"{API_BASE}/mvp/get-tournament-player-mvp/{tid}"
    body = json.loads(http_get(url, extra_headers=API_HEADERS))
    data = body.get("data") or []
    return data if isinstance(data, list) else []


def fetch_tournament_matches(tid: int) -> list[dict[str, Any]]:
    """Paginate /match/get-tournament-matches and return every completed match.

    Cricheroes pages by (pageno, datetime) — the `datetime` cursor is minted on
    page 1 and must be passed back on subsequent pages, otherwise the API
    silently re-serves page 1 regardless of `pageno`. The previous scrape
    captured only the first 12 matches per tournament for this reason.
    """
    all_matches: list[dict[str, Any]] = []
    page = 1
    datetime_cursor: str | None = None
    while True:
        qs = urlencode({
            "tournamentid": tid,
            "status": 3,           # completed matches only
            "pagesize": 12,
            "pageno": page,
            **({"datetime": datetime_cursor} if datetime_cursor else {}),
        })
        url = f"{API_BASE}/match/get-tournament-matches/3/-1/-1?{qs}"
        body = json.loads(http_get(url, extra_headers=API_HEADERS))
        chunk = body.get("data") or []
        if not isinstance(chunk, list) or not chunk:
            break
        all_matches.extend(chunk)
        # Mint the datetime cursor from the first page's `next` URL — it's
        # the same value for every subsequent page in this tournament.
        nxt = (body.get("page") or {}).get("next") or ""
        if datetime_cursor is None:
            m = re.search(r"datetime=(\d+)", nxt)
            if not m:
                break  # API didn't give us a cursor — single-page tournament
            datetime_cursor = m.group(1)
        # End condition: API stops returning a next link, or returns a short page.
        if not nxt or len(chunk) < 12:
            break
        page += 1
        time.sleep(SLEEP_BETWEEN_REQUESTS)
    return all_matches


def extract_build_id() -> str:
    html = http_get(
        "https://cricheroes.com/tournament/236267/hvc-premier-league/matches/past-matches"
    ).decode("utf-8", errors="ignore")
    m = re.search(r'"buildId":"([^"]+)"', html)
    if not m:
        sys.exit("Could not find buildId in cricheroes HTML — page structure changed?")
    return m.group(1)


def _tournament_url(build_id: str, tid: int, slug: str) -> str:
    qs = urlencode({
        "tournamentId": tid,
        "tournamentName": slug,
        "tabName": "matches",
        "innerTab": "past-matches",
    })
    return f"https://cricheroes.com/_next/data/{build_id}/tournament/{tid}/{slug}/matches/past-matches.json?{qs}"


def _match_url(build_id: str, mid: int) -> str:
    return f"https://cricheroes.com/_next/data/{build_id}/scorecard/{mid}/x/x-vs-x/scorecard.json"


def _fetch_with_retry(url_fn) -> dict[str, Any] | None:
    try:
        return json.loads(http_get(url_fn(_current_build_id[0])))
    except HTTPError as e:
        if e.code != 404:
            raise
        new_id = extract_build_id()
        if new_id != _current_build_id[0]:
            print(f"  (buildId rotated: {_current_build_id[0]} -> {new_id}; retrying)")
            _current_build_id[0] = new_id
            try:
                return json.loads(http_get(url_fn(_current_build_id[0])))
            except HTTPError as e2:
                if e2.code == 404:
                    return None
                raise
        return None


def fetch_tournament(tid: int, slug: str) -> dict[str, Any] | None:
    return _fetch_with_retry(lambda b: _tournament_url(b, tid, slug))


def fetch_match(mid: int) -> dict[str, Any] | None:
    return _fetch_with_retry(lambda b: _match_url(b, mid))


# ---------------------------------------------------------------------------
# Field parsers / mappers
# ---------------------------------------------------------------------------

def safe(d: Any, *keys, default=""):
    cur: Any = d
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
        if cur is None:
            return default
    return cur if cur is not None else default


def overs_to_legal_balls(overs_played: str | None) -> int:
    """'5.5' -> 35 (5 overs + 5 balls).  '6.0' -> 36."""
    if not overs_played:
        return 0
    s = str(overs_played)
    try:
        if "." in s:
            full, partial = s.split(".", 1)
            return int(full) * 6 + int(partial)
        return int(s) * 6
    except ValueError:
        return 0


def parse_toss(toss_details: str, team_a_name: str, team_b_name: str,
               team_a_id: int | str, team_b_id: int | str):
    """Parse 'Toss: <Team> opt to (bat|bowl|field)'. Returns (toss_winner_id, decision)."""
    if not toss_details:
        return "", ""
    m = re.match(r"Toss:\s*(.+?)\s+opt(?:ed)?\s+to\s+(bat|bowl|field)", toss_details, flags=re.IGNORECASE)
    if not m:
        return "", ""
    team_name = m.group(1).strip()
    decision = m.group(2).lower()
    if decision == "field":
        decision = "bowl"
    norm = lambda x: x.strip().lower()
    if norm(team_name) == norm(team_a_name):
        return team_a_id, decision
    if norm(team_name) == norm(team_b_name):
        return team_b_id, decision
    return "", decision  # team_name didn't match either side


def map_stage(round_name: str | None) -> str:
    if not round_name:
        return "group"
    n = round_name.strip().lower()
    if "semi" in n:
        return "semi"
    if "quarter" in n:
        return "quarter"
    if "final" in n:
        return "final"
    if "qualifier" in n or "eliminator" in n:
        return "qualifier"
    if "exhibition" in n:
        return "exhibition"
    return "group"


def map_result_type(match_result: str | None, is_super_over: int | None) -> str:
    if is_super_over:
        return "super_over"
    r = (match_result or "").strip().lower()
    if r == "tie":
        return "tie"
    if "no result" in r:
        return "no_result"
    if "abandon" in r:
        return "abandoned"
    return "normal"


def map_batting_style(hand: str | None) -> str:
    h = (hand or "").upper().strip()
    if h == "RHB":
        return "right_hand"
    if h == "LHB":
        return "left_hand"
    return ""


CAPTAIN_SUFFIX_RE = re.compile(r"\s*\(c\)\s*$", flags=re.IGNORECASE)


def strip_captain_marker(name: str) -> tuple[str, bool]:
    name = (name or "").strip()
    if CAPTAIN_SUFFIX_RE.search(name):
        return CAPTAIN_SUFFIX_RE.sub("", name).strip(), True
    return name, False


KEEPER_DISMISSAL_RE = re.compile(r"†\s*(.+?)\s+b\s+", flags=re.IGNORECASE)


def derive_short_name(name: str, used: set[str]) -> str:
    """3–4 letter abbrev, unique within a tournament. Skips leading 'Team'/'The'."""
    cleaned = re.sub(r"^(team|the)\s+", "", (name or "").strip(), flags=re.IGNORECASE).strip()
    base_word = (cleaned.split()[0] if cleaned else name or "TEAM")
    for length in (3, 4, 5):
        cand = re.sub(r"[^A-Za-z]", "", base_word)[:length].upper()
        if cand and cand not in used:
            used.add(cand)
            return cand
    # initials fallback
    words = re.split(r"\s+", cleaned) if cleaned else [name or "TEAM"]
    cand = "".join(w[:1] for w in words if w).upper()[:5]
    if cand and cand not in used:
        used.add(cand)
        return cand
    # numeric suffix fallback
    i = 1
    while True:
        cand = f"{base_word[:2].upper()}{i}"
        if cand not in used:
            used.add(cand)
            return cand
        i += 1


def slugify_season(season: int) -> str:
    return f"hvc-season-{season}"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    CSV_DIR.mkdir(parents=True, exist_ok=True)

    _current_build_id[0] = extract_build_id()
    print(f"buildId = {_current_build_id[0]}")

    # ------- schema-shaped row buckets -------
    tournaments_rows: list[dict] = []
    teams_rows: list[dict] = []          # one row per (tournament, team)
    players_rows: dict[int, dict] = {}   # keyed by cricheroes_player_id
    team_players_rows: dict[tuple, dict] = {}  # keyed by (team_id, player_id) — dedupes across matches
    matches_rows: list[dict] = []
    match_players_rows: dict[tuple, dict] = {}  # keyed by (match_id, player_id)
    innings_rows: list[dict] = []

    # ------- auxiliary historical stats -------
    historical_batting_rows: list[dict] = []
    historical_bowling_rows: list[dict] = []
    fow_rows: list[dict] = []
    tournament_mvp_rows: list[dict] = []

    missing_matches: list[int] = []

    # Track short_name allocation per tournament
    short_names_by_tournament: dict[int, set[str]] = {}
    # Track tournament-level captain/keeper sightings for team_players role
    captains_per_team: dict[int, set[int]] = {}   # team_id -> set of player_ids
    keepers_per_team:  dict[int, set[int]] = {}

    for t in TOURNAMENTS:
        season, tid, season_slug = t["season"], t["id"], t["slug"]
        print(f"\n=== Season {season} — tournament {tid} ===")
        tour = fetch_tournament(tid, season_slug)
        if tour is None:
            print(f"  ! tournament {tid} returned 404 — skipping season")
            continue
        (RAW_DIR / f"tournament_{tid}.json").write_text(json.dumps(tour, indent=2))
        time.sleep(SLEEP_BETWEEN_REQUESTS)

        # MVP leaderboard — cricheroes' proprietary scoring; we mirror their
        # published rows verbatim so historical seasons match what users
        # already saw on cricheroes.com.
        try:
            mvp_rows = fetch_mvp_leaderboard(tid)
            (RAW_DIR / f"mvp_{tid}.json").write_text(json.dumps(mvp_rows, indent=2))
            for r in mvp_rows:
                pid = r.get("player_id")
                team_id = r.get("team_id")
                if not pid or not team_id:
                    continue
                tournament_mvp_rows.append({
                    "cricheroes_tournament_id": tid,
                    "cricheroes_team_id": team_id,
                    "cricheroes_player_id": pid,
                    "name": (r.get("name") or "").strip(),
                    "rank": r.get("rank") or 0,
                    "matches": r.get("matches") or 0,
                    "batting": r.get("batting") or "0",
                    "bowling": r.get("bowling") or "0",
                    "fielding": r.get("fielding") or "0",
                    "total": r.get("total") or "0",
                })
            print(f"  MVP rows: {len(mvp_rows)}")
            time.sleep(SLEEP_BETWEEN_REQUESTS)
        except HTTPError as e:
            print(f"  ! MVP leaderboard fetch failed ({e.code}) — skipping season")

        pp = tour["pageProps"]
        td = safe(pp, "tournamentDetails", "data", default={})
        # Don't trust matchResponse.data — it's only page 1 (12 matches).
        # Paginate the underlying API directly to get every completed match.
        matches = fetch_tournament_matches(tid)

        # Default overs from the first match (HVC is 6 for all seasons)
        default_overs = matches[0].get("overs", 6) if matches else 6
        # We don't have explicit players_per_side; box-cricket default is 6.
        # We can sanity-check later by counting XIs.

        from_date = (td.get("from_date") or "")[:10]
        to_date   = (td.get("to_date") or "")[:10]
        venue_parts = [td.get("city_name", "")]
        venue = ", ".join(p for p in venue_parts if p)

        tournaments_rows.append({
            "cricheroes_tournament_id": tid,
            "season": season,
            "name": td.get("name", f"HVC Season {season}"),
            "slug": slugify_season(season),
            "description": td.get("about_us", "") or "",
            "format": "group_then_knockout",
            "default_overs_per_innings": int(default_overs) if default_overs else 6,
            "default_players_per_side": 6,
            "start_date": from_date,
            "end_date": to_date,
            "venue": venue,
            "logo_url": td.get("tournament_logo", "") or td.get("logo", ""),
            "status": "completed",
            # source-only fields (handy for the importer or eyeballing)
            "cricheroes_organizer_name": td.get("organizer_name", ""),
            "cricheroes_ball_type": td.get("ball_type", ""),
            "cricheroes_city": td.get("city_name", ""),
        })

        short_names_by_tournament.setdefault(tid, set())
        # Pre-collect teams from match list so we can compute short_name deterministically
        team_meta: dict[int, dict] = {}  # team_id -> {name, logo}
        for m in matches:
            for side in ("a", "b"):
                tm_id = m.get(f"team_{side}_id")
                if not tm_id:
                    continue
                if tm_id not in team_meta:
                    team_meta[tm_id] = {
                        "name": m.get(f"team_{side}", "") or "",
                        "logo": m.get(f"team_{side}_logo", "") or "",
                    }

        # Assign short_names in alphabetical order (deterministic across runs)
        for team_id, meta in sorted(team_meta.items(), key=lambda kv: kv[1]["name"]):
            short = derive_short_name(meta["name"], short_names_by_tournament[tid])
            teams_rows.append({
                "cricheroes_team_id": team_id,
                "cricheroes_tournament_id": tid,
                "season": season,
                "name": meta["name"],
                "short_name": short,
                "logo_url": meta["logo"],
            })

        print(f"  tournament: {td.get('name')}  matches={len(matches)}  teams={len(team_meta)}")

        for m_idx, m in enumerate(sorted(matches, key=lambda r: (r.get("match_start_time") or ""))):
            mid = m.get("match_id")
            if not mid:
                continue

            sc = fetch_match(mid)
            if sc is None:
                print(f"    ! match {mid}: 404 — skipping (private or deleted)")
                missing_matches.append(mid)
                continue
            (RAW_DIR / f"match_{mid}.json").write_text(json.dumps(sc, indent=2))
            time.sleep(SLEEP_BETWEEN_REQUESTS)

            sd = safe(sc, "pageProps", "summaryData", "data", default={})
            innings_list = safe(sc, "pageProps", "scorecard", default=[]) or []

            team_a_id = m.get("team_a_id")
            team_b_id = m.get("team_b_id")
            team_a    = m.get("team_a", "") or ""
            team_b    = m.get("team_b", "") or ""

            toss_winner_id, toss_decision = parse_toss(
                safe(sd, "toss_details", default=""),
                team_a, team_b, team_a_id or "", team_b_id or ""
            )

            pom = safe(sd, "player_of_the_match", default={})
            pom_player_id = pom.get("player_id", "") if isinstance(pom, dict) else ""

            result_type = map_result_type(m.get("match_result"), m.get("is_super_over"))
            stage = map_stage(safe(sd, "tournament_round_name", default="") or m.get("match_event", ""))

            matches_rows.append({
                "cricheroes_match_id": mid,
                "cricheroes_tournament_id": tid,
                "season": season,
                "match_number": m_idx + 1,
                "stage": stage,
                "cricheroes_team_a_id": team_a_id,
                "cricheroes_team_b_id": team_b_id,
                "team_a_name": team_a,
                "team_b_name": team_b,
                "scheduled_at": m.get("match_start_time", ""),
                "started_at": m.get("match_start_time", ""),
                "ended_at": m.get("match_end_time", ""),
                "venue": m.get("ground_name", "") or "",
                "overs_per_innings": int(m.get("overs") or 6),
                "players_per_side": 6,
                "cricheroes_toss_winner_id": toss_winner_id,
                "toss_decision": toss_decision,
                "status": "completed",
                "result_type": result_type,
                "cricheroes_winner_id": m.get("winning_team_id", "") or "",
                "winner_name": m.get("winning_team", "") or "",
                "win_margin": m.get("win_by", "") or "",
                "cricheroes_pom_player_id": pom_player_id,
                "pom_player_name": pom.get("player_name", "") if isinstance(pom, dict) else "",
                # source-only context
                "cricheroes_round_name": safe(sd, "tournament_round_name", default=""),
                "match_result": m.get("match_result", "") or "",
                "is_super_over": m.get("is_super_over", 0),
                "ground_name": m.get("ground_name", "") or "",
                "city_name": m.get("city_name", "") or "",
            })

            for ing in innings_list:
                if not isinstance(ing, dict):
                    continue
                inn = safe(ing, "inning", default={})
                innings_number = inn.get("inning") or 0
                batting_team_id = inn.get("team_id") or ing.get("team_id")
                bowling_team_id = team_b_id if batting_team_id == team_a_id else team_a_id

                # extras breakdown
                ex_breakdown = {k: 0 for k in EXTRA_TYPE_TO_COL.values()}
                for ex in (safe(ing, "extras", "data", default=[]) or []):
                    tc = (ex.get("type_code") or "").upper().strip()
                    col = EXTRA_TYPE_TO_COL.get(tc)
                    if col:
                        ex_breakdown[col] += int(ex.get("extra_type_run", 0) or 0)

                innings_rows.append({
                    "cricheroes_match_id": mid,
                    "innings_number": innings_number,
                    "cricheroes_batting_team_id": batting_team_id,
                    "cricheroes_bowling_team_id": bowling_team_id,
                    "total_runs": inn.get("total_run", 0),
                    "total_wickets": inn.get("total_wicket", 0),
                    "total_legal_balls": overs_to_legal_balls(inn.get("overs_played")),
                    "overs_played": inn.get("overs_played", ""),
                    **ex_breakdown,
                    "total_extras": inn.get("total_extra", 0),
                    "target": "",  # filled below for innings 2
                    "is_complete": 1,
                    "started_at": inn.get("inning_start_time", ""),
                    "ended_at": inn.get("inning_end_time", ""),
                    "is_allout": inn.get("is_allout", 0),
                    "is_forfeited": inn.get("is_forfeited", 0),
                    "is_declared": inn.get("is_declare", 0),
                })

                # batters → match_players + historical_batting
                wk_names_in_innings: set[str] = set()
                for idx, b in enumerate(ing.get("batting", []) or []):
                    pid = b.get("player_id")
                    if not pid:
                        continue
                    raw_name = b.get("name", "") or ""
                    clean_name, is_captain = strip_captain_marker(raw_name)

                    # accumulate keepers from this batter's dismissal text
                    how = b.get("how_to_out", "") or ""
                    for k_m in KEEPER_DISMISSAL_RE.finditer(how):
                        wk_names_in_innings.add(k_m.group(1).strip())

                    # players (global)
                    if pid not in players_rows:
                        players_rows[pid] = {
                            "cricheroes_player_id": pid,
                            "display_name": clean_name,
                            "batting_style": map_batting_style(b.get("batting_hand")),
                            "bowling_style": "",
                            "category": "",
                            "phone": "",
                        }
                    else:
                        if not players_rows[pid].get("batting_style"):
                            players_rows[pid]["batting_style"] = map_batting_style(b.get("batting_hand"))

                    # match_players: this batter belongs to batting_team_id in this match
                    key = (mid, pid)
                    if key not in match_players_rows:
                        match_players_rows[key] = {
                            "cricheroes_match_id": mid,
                            "cricheroes_team_id": batting_team_id,
                            "cricheroes_player_id": pid,
                            "batting_order": idx + 1,
                            "is_captain": 1 if is_captain else 0,
                            "is_keeper": 0,   # filled after we resolve keeper names
                            "is_substitute": 0,
                        }
                    else:
                        if is_captain:
                            match_players_rows[key]["is_captain"] = 1
                        if match_players_rows[key]["batting_order"] is None or match_players_rows[key]["batting_order"] > idx + 1:
                            match_players_rows[key]["batting_order"] = idx + 1

                    if is_captain:
                        captains_per_team.setdefault(batting_team_id, set()).add(pid)

                    historical_batting_rows.append({
                        "cricheroes_match_id": mid,
                        "innings_number": innings_number,
                        "cricheroes_team_id": batting_team_id,
                        "batting_order": idx + 1,
                        "cricheroes_player_id": pid,
                        "name": clean_name,
                        "is_captain": 1 if is_captain else 0,
                        "runs": b.get("runs", 0),
                        "balls": b.get("balls", 0),
                        "minutes": b.get("minutes", 0),
                        "fours": b.get("4s", 0),
                        "sixes": b.get("6s", 0),
                        "strike_rate": b.get("SR", ""),
                        "batting_hand": b.get("batting_hand", ""),
                        "how_to_out": how,
                        "is_out": 0 if how.strip().lower() in ("not out", "") else 1,
                    })

                # Resolve keepers for this innings: any batter (in the OTHER team's batting list,
                # i.e. the bowling side of THIS innings) whose name matches a wk_name_in_innings
                # collected here. But it's simpler: we'll resolve all keepers globally at the end.
                # For now stash wk names alongside the innings number for the match.
                # We'll keep them in a per-match dict.
                _wk_acc.setdefault(mid, set()).update(wk_names_in_innings)

                # bowlers → match_players (opposite team) + historical_bowling
                for idx, bw in enumerate(ing.get("bowling", []) or []):
                    pid = bw.get("player_id")
                    if not pid:
                        continue
                    name = bw.get("name", "") or ""

                    if pid not in players_rows:
                        players_rows[pid] = {
                            "cricheroes_player_id": pid,
                            "display_name": name.strip(),
                            "batting_style": "",
                            "bowling_style": "",
                            "category": "",
                            "phone": "",
                        }

                    key = (mid, pid)
                    if key not in match_players_rows:
                        match_players_rows[key] = {
                            "cricheroes_match_id": mid,
                            "cricheroes_team_id": bowling_team_id,
                            "cricheroes_player_id": pid,
                            "batting_order": None,
                            "is_captain": 0,
                            "is_keeper": 0,
                            "is_substitute": 0,
                        }

                    historical_bowling_rows.append({
                        "cricheroes_match_id": mid,
                        "innings_number": innings_number,
                        "cricheroes_team_id": bowling_team_id,
                        "bowling_order": idx + 1,
                        "cricheroes_player_id": pid,
                        "name": name.strip(),
                        "overs": bw.get("overs", ""),
                        "maidens": bw.get("maidens", 0),
                        "runs": bw.get("runs", 0),
                        "wickets": bw.get("wickets", 0),
                        "dots": bw.get("0s", 0),
                        "fours_conceded": bw.get("4s", 0),
                        "sixes_conceded": bw.get("6s", 0),
                        "wides": bw.get("wide", 0),
                        "noballs": bw.get("noball", 0),
                        "economy_rate": bw.get("economy_rate", ""),
                    })

                for fw in (safe(ing, "fall_of_wicket", "data", default=[]) or []):
                    fow_rows.append({
                        "cricheroes_match_id": mid,
                        "innings_number": innings_number,
                        "cricheroes_batting_team_id": batting_team_id,
                        "wicket_no": fw.get("wicket", ""),
                        "run_at_fall": fw.get("run", ""),
                        "over_at_fall": fw.get("over", ""),
                        "cricheroes_dismiss_player_id": fw.get("dismiss_player_id", ""),
                        "dismiss_player_name": fw.get("dismiss_player_name", ""),
                    })

            # innings-2 target = innings-1 total + 1
            this_match_innings = [r for r in innings_rows if r["cricheroes_match_id"] == mid]
            ing1 = next((r for r in this_match_innings if r["innings_number"] == 1), None)
            ing2 = next((r for r in this_match_innings if r["innings_number"] == 2), None)
            if ing1 and ing2:
                ing2["target"] = (ing1["total_runs"] or 0) + 1

            print(f"    [{m_idx+1:>2}] {stage:<10} {team_a} vs {team_b}  →  {m.get('win_by') or m.get('match_result')}")

    # -----------------------------------------------------------------------
    # Post-processing: resolve keepers, build team_players roster
    # -----------------------------------------------------------------------
    # 1) Resolve is_keeper on match_players using wk-name accumulator + that match's roster.
    #    A keeper name appears in the same match's batters (could be either innings).
    by_match_players: dict[int, list[dict]] = {}
    for row in match_players_rows.values():
        by_match_players.setdefault(row["cricheroes_match_id"], []).append(row)

    # For lookups, build pid -> display_name
    pid_to_name = {pid: r["display_name"] for pid, r in players_rows.items()}

    for mid, wk_names in _wk_acc.items():
        if not wk_names:
            continue
        norm_wks = {w.strip().lower() for w in wk_names if w and w.strip()}
        for row in by_match_players.get(mid, []):
            name = pid_to_name.get(row["cricheroes_player_id"], "")
            if name and name.strip().lower() in norm_wks:
                row["is_keeper"] = 1
                keepers_per_team.setdefault(row["cricheroes_team_id"], set()).add(row["cricheroes_player_id"])

    # 2) Build team_players from match_players: a player belongs to the team they
    #    appeared for in any match within the same tournament.
    #    Role: 'captain' > 'wicket_keeper' > 'player' (precedence).
    #    Note: the same person could legitimately appear on different teams across
    #    *seasons*; team_players is tournament-scoped, so we key on (team_id, player_id).
    for row in match_players_rows.values():
        key = (row["cricheroes_team_id"], row["cricheroes_player_id"])
        tp = team_players_rows.get(key)
        role = "player"
        if row["cricheroes_player_id"] in captains_per_team.get(row["cricheroes_team_id"], set()):
            role = "captain"
        elif row["cricheroes_player_id"] in keepers_per_team.get(row["cricheroes_team_id"], set()):
            role = "wicket_keeper"
        if tp is None:
            team_players_rows[key] = {
                "cricheroes_team_id": row["cricheroes_team_id"],
                "cricheroes_player_id": row["cricheroes_player_id"],
                "role": role,
            }
        else:
            # upgrade role if a stronger one applies
            if role == "captain" or (role == "wicket_keeper" and tp["role"] == "player"):
                tp["role"] = role

    # -----------------------------------------------------------------------
    # Write CSVs
    # -----------------------------------------------------------------------
    write_csv(CSV_DIR / "tournaments.csv",       tournaments_rows)
    write_csv(CSV_DIR / "teams.csv",             teams_rows)
    write_csv(CSV_DIR / "players.csv",           list(players_rows.values()))
    write_csv(CSV_DIR / "team_players.csv",      list(team_players_rows.values()))
    write_csv(CSV_DIR / "matches.csv",           matches_rows)
    write_csv(CSV_DIR / "match_players.csv",     list(match_players_rows.values()))
    write_csv(CSV_DIR / "innings.csv",           innings_rows)
    write_csv(CSV_DIR / "historical_batting.csv", historical_batting_rows)
    write_csv(CSV_DIR / "historical_bowling.csv", historical_bowling_rows)
    write_csv(CSV_DIR / "fall_of_wickets.csv",    fow_rows)
    write_csv(CSV_DIR / "tournament_mvp.csv",     tournament_mvp_rows)

    print("\nDONE")
    print(f"  tournaments:        {len(tournaments_rows)}")
    print(f"  teams:              {len(teams_rows)}")
    print(f"  players:            {len(players_rows)}")
    print(f"  team_players:       {len(team_players_rows)}")
    print(f"  matches:            {len(matches_rows)}")
    print(f"  match_players:      {len(match_players_rows)}")
    print(f"  innings:            {len(innings_rows)}")
    print(f"  historical_batting: {len(historical_batting_rows)}")
    print(f"  historical_bowling: {len(historical_bowling_rows)}")
    print(f"  fall_of_wickets:    {len(fow_rows)}")
    print(f"  tournament_mvp:     {len(tournament_mvp_rows)}")
    print(f"  CSVs at:            {CSV_DIR}")
    if missing_matches:
        print(f"  ! {len(missing_matches)} match(es) 404'd on cricheroes: {missing_matches}")


_wk_acc: dict[int, set[str]] = {}  # match_id -> set of wicketkeeper names seen in any dismissal


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        path.write_text("")
        return
    cols: list[str] = []
    for r in rows:
        for k in r.keys():
            if k not in cols:
                cols.append(k)
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)


if __name__ == "__main__":
    main()
