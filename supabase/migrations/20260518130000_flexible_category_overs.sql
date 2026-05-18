-- Flexible Cat 1 / Cat 3 over scheduling. Pre-existing rules baked
-- in the assumption that over 1 = Cat 1 and over 2 = Cat 3 (single
-- scalar keys `cat1_over` / `cat3_over`). Real tournaments have:
--   - no Cat 1 in some teams → no over should require Cat 1
--   - no Cat 3 in some teams → no over should require Cat 3
--   - Cat 1 / Cat 3 played in any other over (last, middle, …)
--   - multiple Cat-N overs in one innings
-- Move to arrays: `cat1_overs: number[]`, `cat3_overs: number[]`.
-- Empty array = no overs require that category.
--
-- Per-match deviation lives in a new `matches.rules_override` JSONB
-- column with the same nested shape. The score state loader merges
-- `tournament.rules` + `match.rules_override`.

-- 1. Transform existing tournament rules.
update tournaments
set rules = jsonb_set(
  jsonb_set(
    rules,
    '{categories,cat1_overs}',
    case
      when (rules->'categories'->>'cat1_over') is null then '[]'::jsonb
      when (rules->'categories'->>'cat1_over')::int = 0 then '[]'::jsonb
      else jsonb_build_array((rules->'categories'->>'cat1_over')::int)
    end,
    true
  ),
  '{categories,cat3_overs}',
  case
    when (rules->'categories'->>'cat3_over') is null then '[]'::jsonb
    when (rules->'categories'->>'cat3_over')::int = 0 then '[]'::jsonb
    else jsonb_build_array((rules->'categories'->>'cat3_over')::int)
  end,
  true
)
where rules is not null
  and rules->'categories' is not null;

-- Drop the now-superseded scalar keys.
update tournaments
set rules = rules #- '{categories,cat1_over}' #- '{categories,cat3_over}'
where rules is not null
  and rules->'categories' is not null;

-- 2. Per-match rules override. Nullable; null = inherit fully.
alter table matches add column if not exists rules_override jsonb;

comment on column matches.rules_override is
  'Optional partial RuleSet that overrides the tournament default for this match. Shape mirrors tournament.rules nesting. Today the UI only writes categories.cat1_overs and categories.cat3_overs but the column is general.';
