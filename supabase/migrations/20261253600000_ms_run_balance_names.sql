-- MainstreetAI zone generator: two faults seen when the Benny re-cut Edmonton North 1 in two (Nov 18).
--
-- 1. Evening out. A block may leave an oversized zone only if the zone stays in one piece. The test asked that the
--    WHOLE zone be reachable without the block, so a zone already in several pieces (Edmonton North 1 is, around the
--    river and Downtown) failed it for every block: no block ever moved, and "two halves" came out 64,931 and 16,163.
--    The test is now local: the zone's blocks next to the one leaving must still be joined to each other without it.
--    Same answer for a zone in one piece; a zone in several can now give blocks up (55,451 and 25,643 for that cut).
--
-- 2. Names. Zones were numbered from 1 in each half of the city on every run, so a re-cut proposed names that exist
--    ("Edmonton South 1") and saving turned them into "Edmonton South 1 (2)". A zone's name is its own for good
--    (unique, retired or not), so numbering now takes the first numbers no zone has: "Edmonton North 4".

do $do$
declare d text; n text;
  a1 text := $a$    with recursive walk(id) as (
      (select x.block_id from ms_zone_run_blocks x where x.run_id = p_run and x.zone = mv.dz and x.block_id <> mv.id limit 1)
      union
      select j.b from walk w join ms_block_adj j on j.a = w.id
        join ms_zone_run_blocks x on x.run_id = p_run and x.block_id = j.b and x.zone = mv.dz and x.block_id <> mv.id
    )
    select count(*) into v_reach from walk;
    select blocks - 1 into v_left from gz_tot where zone = mv.dz;$a$;
  b1 text := $b$    -- the block may go when the zone's blocks around it stay joined without it. (This used to ask that the WHOLE
    -- zone be reachable, so a zone already in several pieces could never give up a block and stayed oversized.)
    with recursive nb as (
      select j.b id from ms_block_adj j
        join ms_zone_run_blocks x on x.run_id = p_run and x.block_id = j.b and x.zone = mv.dz
       where j.a = mv.id and j.b <> mv.id
    ), walk(id) as (
      (select id from nb limit 1)
      union
      select j.b from walk w join ms_block_adj j on j.a = w.id
        join ms_zone_run_blocks x on x.run_id = p_run and x.block_id = j.b and x.zone = mv.dz and x.block_id <> mv.id
    )
    select (select count(*) from nb where id in (select id from walk)), (select count(*) from nb) into v_reach, v_left;$b$;
  a2 text := $a$    select z, half, row_number() over (partition by half order by lng) rn from s$a$;
  b2 text := $b$    -- numbered from the first number no zone has (a name is one zone's for good, retired or not)
    select k.z, k.half, f.num rn
      from (select z, half, row_number() over (partition by half order by lng) k from s) k
      join lateral (
        select g num from generate_series(1, 999) g
         where not exists (select 1 from ms_zones zz where lower(zz.name) = lower(c.name || ' ' || k.half || ' ' || g))
         order by g offset k.k - 1 limit 1) f on true$b$;
begin
  d := pg_get_functiondef('public.ms_run_step(uuid)'::regprocedure);
  if position('with recursive nb as' in d) = 0 then
    n := replace(d, a1, b1);
    if n = d then raise exception 'ms_run_step: the balance test was not found'; end if;
    execute n;
  end if;
  d := pg_get_functiondef('public.ms_run_name_zones(uuid)'::regprocedure);
  if position('generate_series(1, 999)' in d) = 0 then
    n := replace(d, a2, b2);
    if n = d then raise exception 'ms_run_name_zones: the numbering was not found'; end if;
    execute n;
  end if;
end $do$;
