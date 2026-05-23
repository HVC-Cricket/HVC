-- Optional scorer name per match. Free-text like umpires (same
-- justification: spectators see who scored; we don't need a stats
-- relation). The edit form's picker is populated from the
-- tournament's `tournament_admins` rows with role='scorer', but the
-- column itself stores a plain string so an ad-hoc guest scorer
-- (not in the admin list) can also be assigned.

alter table matches add column if not exists scorer text;

comment on column matches.scorer is 'Optional free-text name of the scorer assigned to record this match.';
