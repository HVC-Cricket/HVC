-- Optional umpire names for each match. Free-text rather than a
-- relation to a people table — umpires for HVC are casual / rotating
-- and we don't need stats on them. Either column may be null.

alter table matches add column if not exists umpire_1 text;
alter table matches add column if not exists umpire_2 text;

comment on column matches.umpire_1 is 'Optional free-text name of the on-field umpire 1.';
comment on column matches.umpire_2 is 'Optional free-text name of the on-field umpire 2.';
