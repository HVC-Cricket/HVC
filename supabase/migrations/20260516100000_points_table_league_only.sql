-- v_points_table previously counted every completed match toward W/L/points,
-- which inflated standings once knockout rounds were added (qualifier, semi,
-- final). Cricheroes — and every league-style points table — counts only the
-- round-robin phase, then renders knockout results elsewhere.
--
-- Restrict the view to `stage = 'group'` so the Standings card reflects the
-- league phase only. NRR calc in the app already operates on this view's
-- output, so it inherits the same filter implicitly.

create or replace view v_points_table as
with results as (
  select m.tournament_id, m.team_a_id as team_id,
    case
      when m.winner_id = m.team_a_id then 'W'
      when m.winner_id = m.team_b_id then 'L'
      when m.result_type = 'tie' then 'T'
      when m.result_type in ('no_result','abandoned') then 'NR'
    end as result
  from matches m
  where m.status = 'completed' and m.stage = 'group'
  union all
  select m.tournament_id, m.team_b_id as team_id,
    case
      when m.winner_id = m.team_b_id then 'W'
      when m.winner_id = m.team_a_id then 'L'
      when m.result_type = 'tie' then 'T'
      when m.result_type in ('no_result','abandoned') then 'NR'
    end as result
  from matches m
  where m.status = 'completed' and m.stage = 'group'
)
select
  tournament_id,
  team_id,
  count(*)                                  as played,
  count(*) filter (where result = 'W')      as won,
  count(*) filter (where result = 'L')      as lost,
  count(*) filter (where result = 'T')      as tied,
  count(*) filter (where result = 'NR')     as no_results,
  count(*) filter (where result = 'W') * 2
    + count(*) filter (where result in ('T','NR')) as points
from results
group by tournament_id, team_id;
