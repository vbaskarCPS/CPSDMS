-- RUN_26 — Master Bookings: rounds, settings and the three levels' reads.
--
-- A round is one time through a master map (area) for one service in one season (a year):
-- Sealing 2026 · Round 1, Round 2 … It stays open across as many days as the map is worked,
-- until someone starts the next round. Starting the next round clears the knocks off the
-- workers' maps (a copy is kept, and every knock stays in the door-visit history under its round),
-- and an address marked invalid in each of the last two rounds stays invalid.
--
-- A knock belongs to a round when it was logged between the round's start and the next round's
-- start (or the end of the season). A route is "done" for a round when the center's threshold of
-- its doors (50% unless changed in Master Bookings settings) has a knock. Knocks tapped less than
-- 3 seconds after the worker's previous one don't count (bulk tapping), and routes where most
-- knocks were tapped that way are flagged.
--
-- Adds only: three tables, read functions, one write function (start the next round), a settings
-- save, and records every map already knocked as Sealing 2026 · Round 1 from its first knock day.
-- Master Bookings permission ("bookings") or Super Admin, for maps the person can see.

-- ───────────── tables ─────────────
create table if not exists public.mb_rounds (
  id bigint generated always as identity primary key,
  area_name text not null,
  service text not null check (service in ('aeration', 'sealing')),
  season int not null check (season between 2000 and 2100),
  round_no int not null check (round_no >= 1),
  started_at timestamptz not null,
  ended_at timestamptz,
  started_by uuid,
  note text,
  created_at timestamptz not null default now(),
  unique (area_name, service, season, round_no)
);
create unique index if not exists mb_rounds_one_open on public.mb_rounds (area_name, service, season) where ended_at is null;
create index if not exists mb_rounds_area on public.mb_rounds (area_name, season);

create table if not exists public.mb_settings (
  center_id uuid primary key references public.command_centers(id) on delete cascade,
  default_service text check (default_service in ('aeration', 'sealing')),
  default_season int check (default_season between 2000 and 2100),
  default_round int check (default_round >= 1),          -- null: each map's current round
  done_pct int not null default 50 check (done_pct between 1 and 100),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- the knocks cleared off the workers' maps when a round started (one row per knock, as it was)
create table if not exists public.mb_cleared_knocks (
  id bigint generated always as identity primary key,
  round_id bigint not null references public.mb_rounds(id),
  knock jsonb not null,
  cleared_at timestamptz not null default now()
);
create index if not exists mb_cleared_knocks_round on public.mb_cleared_knocks (round_id);

-- addresses that stayed invalid into a round (invalid in each of the two rounds before it)
create table if not exists public.mb_carried_invalids (
  round_id bigint not null references public.mb_rounds(id),
  route_code text not null,
  house_key text not null,
  primary key (round_id, route_code, house_key)
);

alter table public.mb_rounds enable row level security;
alter table public.mb_settings enable row level security;
alter table public.mb_cleared_knocks enable row level security;
alter table public.mb_carried_invalids enable row level security;
revoke all on public.mb_rounds, public.mb_settings, public.mb_cleared_knocks, public.mb_carried_invalids from anon, authenticated;

-- ───────────── who can use it ─────────────
create or replace function public.mb_can_use()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_has_perm('bookings'), false) or coalesce(app_is_super_admin(), false)
$$;
revoke all on function public.mb_can_use() from public, anon, authenticated;

create or replace function public.mb_check_center(p_center uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not mb_can_use() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_center is null or not (coalesce(app_is_super_admin(), false) or coalesce(app_can_see_center(p_center), false)) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
end $$;
revoke all on function public.mb_check_center(uuid) from public, anon, authenticated;

create or replace function public.mb_check_area(p_area text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not mb_can_use() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if not (coalesce(app_is_super_admin(), false)
          or exists (select 1 from map_area_centers mac where mac.area_name = p_area and app_can_see_center(mac.center_id))) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
end $$;
revoke all on function public.mb_check_area(text) from public, anon, authenticated;

create or replace function public.mb_check_input(p_service text, p_season int)
returns void language plpgsql immutable set search_path = public as $$
begin
  if p_service is null or p_service not in ('aeration', 'sealing') then raise exception 'Pick aeration or sealing'; end if;
  if p_season is null or p_season not between 2000 and 2100 then raise exception 'Pick a season'; end if;
end $$;

-- ───────────── time ─────────────
create or replace function public.mb_season_start(p_season int)
returns timestamptz language sql immutable set search_path = public as $$
  select make_timestamptz(p_season, 1, 1, 0, 0, 0, 'America/Toronto')
$$;
create or replace function public.mb_season_end(p_season int)
returns timestamptz language sql immutable set search_path = public as $$
  select make_timestamptz(p_season + 1, 1, 1, 0, 0, 0, 'America/Toronto')
$$;

-- The round a screen shows for a map: the picked round number, or (no number) the open round,
-- or the last one when none is open. Null when the map has no such round.
create or replace function public.mb_round_for(p_area text, p_service text, p_season int, p_round int)
returns public.mb_rounds language sql stable security definer set search_path = public as $$
  select r.* from mb_rounds r
   where r.area_name = p_area and r.service = p_service and r.season = p_season
     and (p_round is null or r.round_no = p_round)
   order by (r.ended_at is null) desc, r.round_no desc
   limit 1
$$;
revoke all on function public.mb_round_for(text, text, int, int) from public, anon, authenticated;

-- ───────────── knocks in a round ─────────────
-- The door visits on these routes between two times, each with whether it was tapped less than
-- 3 seconds after the same worker's previous knock that day (bulk tapping).
create or replace function public.mb_visits(p_codes text[], p_from timestamptz, p_to timestamptz)
returns table (route_code text, house_key text, day date, at timestamptz, status text, worker_id text, fast boolean)
language sql stable security definer set search_path = public as $$
  with v as (
    select v.route_code, v.house_key, v.day, coalesce(v.at, v.day::timestamp at time zone 'America/Toronto') as at, v.status, v.worker_id
      from client_visits v
     where v.route_code = any(p_codes)
       and coalesce(v.at, v.day::timestamp at time zone 'America/Toronto') >= p_from
       and coalesce(v.at, v.day::timestamp at time zone 'America/Toronto') < p_to
  )
  select v.route_code, v.house_key, v.day, v.at, v.status, v.worker_id,
         coalesce(extract(epoch from v.at - lag(v.at) over (partition by coalesce(v.worker_id, v.route_code), v.day order by v.at)) < 3, false)
    from v
$$;
revoke all on function public.mb_visits(text[], timestamptz, timestamptz) from public, anon, authenticated;

-- Per route for a round: doors (houses on the route, less addresses carried in as invalid),
-- doors knocked (not counting bulk taps), knocks, bulk taps, and the days it was worked.
create or replace function public.mb_route_stats(p_codes text[], p_from timestamptz, p_to timestamptz, p_round_id bigint)
returns table (route_code text, doors int, knocked int, knocks int, fast int, days date[])
language sql stable security definer set search_path = public as $$
  with h as (select rh.route_code, count(*)::int n from route_houses rh where rh.route_code = any(p_codes) group by 1),
       c as (select ci.route_code, count(*)::int n from mb_carried_invalids ci where ci.round_id = p_round_id group by 1),
       v as (select * from mb_visits(p_codes, p_from, p_to)),
       k as (select v.route_code,
                    count(distinct v.house_key) filter (where not v.fast and rh.house_key is not null)::int knocked,
                    count(*)::int knocks, count(*) filter (where v.fast)::int fast,
                    array_agg(distinct v.day order by v.day) days
               from v left join route_houses rh on rh.route_code = v.route_code and rh.house_key = v.house_key
              group by 1)
  select code, greatest(coalesce(h.n, 0) - coalesce(c.n, 0), 0), coalesce(k.knocked, 0), coalesce(k.knocks, 0), coalesce(k.fast, 0), coalesce(k.days, '{}')
    from unnest(p_codes) code
    left join h on h.route_code = code left join c on c.route_code = code left join k on k.route_code = code
$$;
revoke all on function public.mb_route_stats(text[], timestamptz, timestamptz, bigint) from public, anon, authenticated;

-- a route's bulk-tapping flag: most of a real day's knocks tapped faster than a walk to a door
create or replace function public.mb_flagged(p_knocks int, p_fast int)
returns boolean language sql immutable set search_path = public as $$
  select p_fast >= 10 and p_fast * 2 >= p_knocks
$$;

-- a past client's job flags for a season: 1 aeration before, 2 sealing before,
-- 4 aeration this season, 8 sealing this season
create or replace function public.mb_client_flags(p_history jsonb, p_season int)
returns int language sql immutable set search_path = public as $$
  select coalesce(bit_or(case
           when h->>'line' = 'aeration' and (h->>'year')::int < p_season then 1
           when h->>'line' = 'sealing' and (h->>'year')::int < p_season then 2
           when h->>'line' = 'aeration' and (h->>'year')::int = p_season then 4
           when h->>'line' = 'sealing' and (h->>'year')::int = p_season then 8
           else 0 end), 0)
    from jsonb_array_elements(case when jsonb_typeof(p_history) = 'array' then p_history else '[]'::jsonb end) h
   where h->>'year' ~ '^\d{4}$'
$$;

-- a worker's name from their number (hires first, then the old contractors list)
create or replace function public.mb_worker_name(p_cn text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') from hires h join people p on p.id = h.person_id
      where h.cn = p_cn order by h.year desc limit 1),
    (select nullif(trim(concat_ws(' ', k.first_name, k.last_name)), '') from contractors k where k.contractor_id = p_cn limit 1))
$$;
revoke all on function public.mb_worker_name(text) from public, anon, authenticated;

-- ───────────── settings ─────────────
create or replace function public.app_mb_settings(p_center uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s mb_settings;
begin
  perform mb_check_center(p_center);
  select * into s from mb_settings where center_id = p_center;
  return jsonb_build_object('service', s.default_service, 'season', s.default_season, 'round', s.default_round,
                            'done_pct', coalesce(s.done_pct, 50), 'updated_at', s.updated_at);
end $$;

create or replace function public.app_mb_save_settings(p_center uuid, p_service text, p_season int, p_round int, p_done_pct int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform mb_check_center(p_center);
  if p_service is not null and p_service not in ('aeration', 'sealing') then raise exception 'Pick aeration or sealing'; end if;
  if p_season is not null and p_season not between 2000 and 2100 then raise exception 'Pick a season'; end if;
  if p_round is not null and p_round < 1 then raise exception 'Pick a round'; end if;
  if p_done_pct is null or p_done_pct not between 1 and 100 then raise exception 'The threshold is a percentage from 1 to 100'; end if;
  insert into mb_settings (center_id, default_service, default_season, default_round, done_pct, updated_at, updated_by)
  values (p_center, p_service, p_season, p_round, p_done_pct, now(), auth.uid())
  on conflict (center_id) do update set default_service = excluded.default_service, default_season = excluded.default_season,
    default_round = excluded.default_round, done_pct = excluded.done_pct, updated_at = now(), updated_by = auth.uid();
  insert into audit_log (actor, entity, entity_id, action, after)
  values (auth.uid(), 'mb_settings', p_center::text, 'save',
          jsonb_build_object('service', p_service, 'season', p_season, 'round', p_round, 'done_pct', p_done_pct));
  return app_mb_settings(p_center);
end $$;

-- ───────────── level 1: the center's master maps ─────────────
-- Each map: its routes, past customers per service, pending bookings, and every round of the
-- picked season with its days and how many routes are done; the round on screen; whether a new
-- round is due (14 days since the map was last worked); knocks that aren't in any round yet.
create or replace function public.app_mb_overview(p_center uuid, p_service text, p_season int, p_round int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_pct int; v_end timestamptz := mb_season_end(p_season); v_start timestamptz := mb_season_start(p_season);
  v_today date := (now() at time zone 'America/Toronto')::date;
  a record; rd mb_rounds; v_codes text[]; v_rounds jsonb; v_r jsonb; v_maps jsonb := '[]'::jsonb;
  v_shown mb_rounds; v_open mb_rounds; v_last date; v_loose record; v_prev record; v_book int; v_seasons jsonb;
begin
  perform mb_check_center(p_center);
  perform mb_check_input(p_service, p_season);
  v_pct := coalesce((select done_pct from mb_settings where center_id = p_center), 50);

  for a in
    select ap.area_name, ap.prefix, ap.route_start, ap.route_count, ap.city, ap.region
      from map_area_centers mac join area_prefixes ap on ap.area_name = mac.area_name
     where mac.center_id = p_center
     order by ap.city nulls last, ap.prefix, ap.route_start
  loop
    v_codes := array(select rm.route_code from route_maps rm where rm.area_name = a.area_name and rm.status = 'approved' order by rm.route_number);
    v_rounds := '[]'::jsonb;
    for rd in select * from mb_rounds r where r.area_name = a.area_name and r.service = p_service and r.season = p_season order by r.round_no loop
      with s as (select * from mb_route_stats(v_codes, rd.started_at, coalesce(rd.ended_at, v_end), rd.id))
      select jsonb_build_object(
               'no', rd.round_no, 'started', rd.started_at, 'ended', rd.ended_at, 'open', rd.ended_at is null,
               'routes', count(*), 'done', count(*) filter (where s.doors > 0 and s.knocked * 100 >= v_pct * s.doors),
               'started_routes', count(*) filter (where s.knocked > 0),
               'flagged', count(*) filter (where mb_flagged(s.knocks, s.fast)),
               'doors', coalesce(sum(s.doors), 0), 'knocked', coalesce(sum(s.knocked), 0),
               'days', coalesce((select jsonb_agg(x.d order by x.d) from (select distinct unnest(s2.days) d from s s2) x), '[]'::jsonb))
        into v_r
        from s;
      v_rounds := v_rounds || v_r;
    end loop;

    v_shown := mb_round_for(a.area_name, p_service, p_season, p_round);
    select * into v_open from mb_rounds r where r.area_name = a.area_name and r.service = p_service and r.season = p_season and r.ended_at is null;
    v_last := null;
    if v_open.id is not null then
      select max(v.day) into v_last from client_visits v
       where v.route_code = any(v_codes) and v.at >= v_open.started_at and v.at < v_end;
    end if;

    -- knocks this season that aren't inside any round (either service) on this map
    select count(*)::int n, min(v.day) first_day into v_loose
      from client_visits v
     where v.route_code = any(v_codes) and v.at >= v_start and v.at < v_end
       and not exists (select 1 from mb_rounds x where x.area_name = a.area_name and x.season = p_season
                        and v.at >= x.started_at and v.at < coalesce(x.ended_at, v_end));

    select count(*) filter (where f & 1 > 0)::int aer, count(*) filter (where f & 2 > 0)::int seal,
           count(*) filter (where f & 4 > 0)::int aer_now, count(*) filter (where f & 8 > 0)::int seal_now
      into v_prev
      from (select mb_client_flags(c.history, p_season) f from clients c where c.route_code = any(v_codes)) x;

    select count(*)::int into v_book from bookings b where b.route_number = any(v_codes) and coalesce(b.status, 'pending') = 'pending';

    v_maps := v_maps || jsonb_build_object(
      'area', a.area_name, 'prefix', a.prefix, 'start', a.route_start, 'count', a.route_count, 'city', a.city, 'region', a.region,
      'routes', cardinality(v_codes), 'first', v_codes[1], 'last', v_codes[cardinality(v_codes)],
      'prev_aeration', coalesce(v_prev.aer, 0), 'prev_sealing', coalesce(v_prev.seal, 0),
      'done_aeration', coalesce(v_prev.aer_now, 0), 'done_sealing', coalesce(v_prev.seal_now, 0),
      'bookings', v_book, 'rounds', v_rounds,
      'shown', v_shown.round_no, 'current', v_open.round_no,
      'last_day', v_last,
      'suggest_new', v_open.id is not null and v_last is not null and v_last <= v_today - 14,
      'loose', coalesce(v_loose.n, 0), 'loose_from', v_loose.first_day);
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('service', s.service, 'season', s.season) order by s.season desc, s.service), '[]'::jsonb)
    into v_seasons
    from (select distinct r.service, r.season from mb_rounds r join map_area_centers mac on mac.area_name = r.area_name and mac.center_id = p_center
          union
          select sv, extract(year from now() at time zone 'America/Toronto')::int
            from command_centers cc, unnest(cc.services) sv where cc.id = p_center and sv in ('aeration', 'sealing')) s;

  return jsonb_build_object('maps', v_maps, 'seasons', v_seasons, 'done_pct', v_pct, 'today', v_today);
end $$;

-- the outline of each of the center's maps (a hull around its streets), for the level 1 map
create or replace function public.app_mb_outlines(p_center uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform mb_check_center(p_center);
  with g as (
    select mac.area_name,
           coalesce((select ST_Collect(l.line::geometry) from route_maps rm join route_street_lines l on l.route_code = rm.route_code
                      where rm.area_name = mac.area_name and rm.status = 'approved'),
                    (select ST_Collect(ST_SetSRID(ST_MakePoint(rh.lng, rh.lat), 4326)) from route_maps rm join route_houses rh on rh.route_code = rm.route_code
                      where rm.area_name = mac.area_name and rm.status = 'approved' and rh.lat is not null)) geom
      from map_area_centers mac where mac.center_id = p_center
  )
  select coalesce(jsonb_object_agg(area_name, ST_AsGeoJSON(ST_Simplify(ST_ConcaveHull(geom, 0.4), 0.0002), 5)::jsonb), '{}'::jsonb)
    into v from g where geom is not null;
  return v;
end $$;

-- ───────────── level 2: the picked maps ─────────────
-- For each map, the round on screen; per route, doors and doors knocked; per street, doors and
-- doors knocked (the heat map); the knocks of the round (latest per house); past clients and this
-- season's jobs with their service flags; pending bookings.
create or replace function public.app_mb_area_view(p_areas text[], p_service text, p_season int, p_round int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_area text; v_pct int; v_end timestamptz := mb_season_end(p_season); rd mb_rounds; v_codes text[]; v_all text[] := '{}';
  v_maps jsonb := '[]'::jsonb; v_routes jsonb := '[]'::jsonb; v_streets jsonb := '[]'::jsonb; v_knocks jsonb := '[]'::jsonb; v_x jsonb;
  v_center uuid;
begin
  if p_areas is null or cardinality(p_areas) = 0 then raise exception 'Pick a map'; end if;
  if cardinality(p_areas) > 12 then raise exception 'Pick up to 12 maps at a time'; end if;
  perform mb_check_input(p_service, p_season);
  foreach v_area in array p_areas loop perform mb_check_area(v_area); end loop;
  select mac.center_id into v_center from map_area_centers mac where mac.area_name = p_areas[1] limit 1;
  v_pct := coalesce((select done_pct from mb_settings where center_id = v_center), 50);

  foreach v_area in array p_areas loop
    v_codes := array(select rm.route_code from route_maps rm where rm.area_name = v_area and rm.status = 'approved' order by rm.route_number);
    v_all := v_all || v_codes;
    rd := mb_round_for(v_area, p_service, p_season, p_round);
    v_maps := v_maps || jsonb_build_object('area', v_area, 'round', rd.round_no, 'open', rd.id is not null and rd.ended_at is null,
                                           'started', rd.started_at, 'ended', rd.ended_at);

    -- routes
    if rd.id is not null then
      select coalesce(jsonb_agg(jsonb_build_object('code', s.route_code, 'area', v_area, 'doors', s.doors, 'knocked', s.knocked,
                                                   'pct', case when s.doors > 0 then round(100.0 * s.knocked / s.doors) else 0 end,
                                                   'done', s.doors > 0 and s.knocked * 100 >= v_pct * s.doors,
                                                   'flagged', mb_flagged(s.knocks, s.fast), 'days', to_jsonb(s.days))
                                order by s.route_code), '[]'::jsonb)
        into v_x from mb_route_stats(v_codes, rd.started_at, coalesce(rd.ended_at, v_end), rd.id) s;
    else
      select coalesce(jsonb_agg(jsonb_build_object('code', s.route_code, 'area', v_area, 'doors', s.doors, 'knocked', 0, 'pct', 0, 'done', false,
                                                   'flagged', false, 'days', '[]'::jsonb) order by s.route_code), '[]'::jsonb)
        into v_x from mb_route_stats(v_codes, 'infinity'::timestamptz, 'infinity'::timestamptz, null) s;
    end if;
    v_routes := v_routes || v_x;

    -- streets (heat): doors per street and doors knocked in the round (bulk taps don't count)
    with kv as (select distinct v.route_code, v.house_key
                  from mb_visits(v_codes, coalesce(rd.started_at, 'infinity'::timestamptz), coalesce(rd.ended_at, v_end)) v where not v.fast),
         hs as (select rh.route_code, rh.street_norm, count(*)::int doors, count(kv.house_key)::int knocked, count(ci.house_key)::int carried
                  from route_houses rh
                  left join kv on kv.route_code = rh.route_code and kv.house_key = rh.house_key
                  left join mb_carried_invalids ci on ci.round_id = rd.id and ci.route_code = rh.route_code and ci.house_key = rh.house_key
                 where rh.route_code = any(v_codes) group by 1, 2),
         ln as (select l.route_code, l.street_norm, ST_Simplify(ST_LineMerge(ST_Collect(l.line::geometry)), 0.00002) g
                  from route_street_lines l where l.route_code = any(v_codes) group by 1, 2)
    select coalesce(jsonb_agg(jsonb_build_array(ln.route_code, ln.street_norm, greatest(coalesce(hs.doors, 0) - coalesce(hs.carried, 0), 0),
                                                coalesce(hs.knocked, 0), ST_AsGeoJSON(ln.g, 6)::jsonb)), '[]'::jsonb)
      into v_x from ln left join hs on hs.route_code = ln.route_code and hs.street_norm = ln.street_norm;
    v_streets := v_streets || v_x;

    -- the round's knocks: the latest per house
    if rd.id is not null then
      select coalesce(jsonb_agg(jsonb_build_array(round(rh.lat::numeric, 6), round(rh.lng::numeric, 6), k.status, k.route_code, k.fast)), '[]'::jsonb)
        into v_x
        from (select distinct on (v.route_code, v.house_key) v.route_code, v.house_key, v.status, v.fast
                from mb_visits(v_codes, rd.started_at, coalesce(rd.ended_at, v_end)) v order by v.route_code, v.house_key, v.at desc) k
        join route_houses rh on rh.route_code = k.route_code and rh.house_key = k.house_key
       where rh.lat is not null;
      v_knocks := v_knocks || v_x;
    end if;
  end loop;

  return jsonb_build_object(
    'maps', v_maps, 'routes', v_routes, 'streets', v_streets, 'knocks', v_knocks, 'done_pct', v_pct,
    'clients', coalesce((select jsonb_agg(jsonb_build_array(c.id, round(c.lat::numeric, 6), round(c.lng::numeric, 6), c.route_code,
                                                            mb_client_flags(c.history, p_season), trim(concat_ws(' ', c.house_no, c.street_name)),
                                                            nullif(trim(concat_ws(' ', c.people->0->>'first', c.people->0->>'last')), '')))
                           from clients c where c.route_code = any(v_all) and c.lat is not null and mb_client_flags(c.history, p_season) > 0), '[]'::jsonb),
    'bookings', (select count(*) from bookings b where b.route_number = any(v_all) and coalesce(b.status, 'pending') = 'pending'));
end $$;

-- ───────────── level 3: one route ─────────────
-- Every house on the route with its knock in the round on screen (bulk taps marked), whether it
-- stayed invalid from earlier rounds, and the past client at it; the route's streets (heat) and
-- its stats for the round.
create or replace function public.app_mb_route(p_route text, p_service text, p_season int, p_round int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_area text; rd mb_rounds; v_end timestamptz := mb_season_end(p_season); v_pct int; v_center uuid; s record;
begin
  perform mb_check_input(p_service, p_season);
  select rm.area_name into v_area from route_maps rm where rm.route_code = p_route and rm.status = 'approved' limit 1;
  if v_area is null then raise exception 'That route isn''t on a map'; end if;
  perform mb_check_area(v_area);
  select mac.center_id into v_center from map_area_centers mac where mac.area_name = v_area limit 1;
  v_pct := coalesce((select done_pct from mb_settings where center_id = v_center), 50);
  rd := mb_round_for(v_area, p_service, p_season, p_round);
  select * into s from mb_route_stats(array[p_route], coalesce(rd.started_at, 'infinity'::timestamptz), coalesce(rd.ended_at, v_end), rd.id);

  return jsonb_build_object(
    'route', p_route, 'area', v_area, 'round', rd.round_no, 'open', rd.id is not null and rd.ended_at is null,
    'started', rd.started_at, 'ended', rd.ended_at, 'done_pct', v_pct,
    'doors', s.doors, 'knocked', s.knocked, 'flagged', mb_flagged(s.knocks, s.fast), 'days', to_jsonb(s.days),
    'done', s.doors > 0 and s.knocked * 100 >= v_pct * s.doors,
    'line', (select rm.segments from route_maps rm where rm.route_code = p_route and rm.status = 'approved' limit 1),
    'houses', coalesce((
      with k as (select distinct on (v.house_key) v.house_key, v.status, v.fast, v.day
                   from mb_visits(array[p_route], coalesce(rd.started_at, 'infinity'::timestamptz), coalesce(rd.ended_at, v_end)) v
                  order by v.house_key, v.at desc)
      select jsonb_agg(jsonb_build_object(
               'k', rh.house_key, 'lat', round(rh.lat::numeric, 6), 'lng', round(rh.lng::numeric, 6),
               'a', trim(concat_ws(' ', rh.civic_no::text || coalesce(rh.civic_suffix, ''), rh.street_name)) || coalesce(' #' || nullif(rh.unit, ''), ''),
               's', rh.street_norm, 'st', k.status, 'fast', coalesce(k.fast, false), 'day', k.day,
               'carried', exists (select 1 from mb_carried_invalids ci where ci.round_id = rd.id and ci.route_code = p_route and ci.house_key = rh.house_key),
               'c', cl.id, 'n', cl.name, 'f', coalesce(cl.f, 0)) order by rh.street_norm, rh.civic_no)
        from route_houses rh
        left join k on k.house_key = rh.house_key
        left join lateral (select c.id, nullif(trim(concat_ws(' ', c.people->0->>'first', c.people->0->>'last')), '') name, mb_client_flags(c.history, p_season) f
                             from clients c where c.route_code = p_route and crm_house_key(c.house_no, c.street_norm) = rh.house_key
                            order by jsonb_array_length(c.history) desc limit 1) cl on true
       where rh.route_code = p_route and rh.lat is not null), '[]'::jsonb),
    'streets', coalesce((
      with kv as (select distinct v.house_key
                    from mb_visits(array[p_route], coalesce(rd.started_at, 'infinity'::timestamptz), coalesce(rd.ended_at, v_end)) v where not v.fast),
           hs as (select rh.street_norm, count(*)::int - count(ci.house_key)::int doors, count(kv.house_key)::int knocked
                    from route_houses rh
                    left join kv on kv.house_key = rh.house_key
                    left join mb_carried_invalids ci on ci.round_id = rd.id and ci.route_code = p_route and ci.house_key = rh.house_key
                   where rh.route_code = p_route group by 1),
           ln as (select l.street_norm, ST_Simplify(ST_LineMerge(ST_Collect(l.line::geometry)), 0.00002) g
                    from route_street_lines l where l.route_code = p_route group by 1)
      select jsonb_agg(jsonb_build_array(p_route, ln.street_norm, coalesce(hs.doors, 0), coalesce(hs.knocked, 0), ST_AsGeoJSON(ln.g, 6)::jsonb))
        from ln left join hs on hs.street_norm = ln.street_norm), '[]'::jsonb));
end $$;

-- One house: every knock ever logged there (who, when, what, which round), the past client at it
-- with their jobs.
create or replace function public.app_mb_house(p_route text, p_house_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_area text; h route_houses; c clients;
begin
  select rm.area_name into v_area from route_maps rm where rm.route_code = p_route and rm.status = 'approved' limit 1;
  if v_area is null then raise exception 'That route isn''t on a map'; end if;
  perform mb_check_area(v_area);
  select * into h from route_houses rh where rh.route_code = p_route and rh.house_key = p_house_key limit 1;
  select * into c from clients cl where cl.route_code = p_route and crm_house_key(cl.house_no, cl.street_norm) = p_house_key
   order by jsonb_array_length(cl.history) desc limit 1;
  return jsonb_build_object(
    'route', p_route, 'area', v_area, 'key', p_house_key,
    'address', case when h.house_key is not null
                    then trim(concat_ws(' ', h.civic_no::text || coalesce(h.civic_suffix, ''), h.street_name)) || coalesce(' #' || nullif(h.unit, ''), '') end,
    'visits', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'day', v.day, 'at', v.at, 'status', v.status, 'note', v.note, 'first_name', v.first_name, 'worker_id', v.worker_id,
                 'worker', mb_worker_name(v.worker_id),
                 'rounds', (select jsonb_agg(jsonb_build_object('service', r.service, 'season', r.season, 'no', r.round_no) order by r.service)
                              from mb_rounds r where r.area_name = v_area
                               and coalesce(v.at, v.day::timestamp at time zone 'America/Toronto') >= r.started_at
                               and coalesce(v.at, v.day::timestamp at time zone 'America/Toronto') < coalesce(r.ended_at, mb_season_end(r.season)))))
               order by v.day desc, v.at desc)
               from client_visits v where v.route_code = p_route and v.house_key = p_house_key), '[]'::jsonb),
    'carried', coalesce((select jsonb_agg(jsonb_build_object('service', r.service, 'season', r.season, 'no', r.round_no) order by r.season, r.round_no)
                           from mb_carried_invalids ci join mb_rounds r on r.id = ci.round_id
                          where ci.route_code = p_route and ci.house_key = p_house_key), '[]'::jsonb),
    'client', case when c.id is null then null else jsonb_build_object(
                'id', c.id, 'name', nullif(trim(concat_ws(' ', c.people->0->>'first', c.people->0->>'last')), ''),
                'services', to_jsonb(c.services), 'jobs', coalesce(c.history, '[]'::jsonb),
                'call_first', c.call_first, 'notes', c.notes) end);
end $$;

-- ───────────── start the next round ─────────────
-- No round yet this season: Round 1 starts from the first knock this season that isn't in a round
-- (nothing is cleared). Otherwise the open round ends now and the next one starts: the map's knocks
-- are copied to mb_cleared_knocks and cleared off the workers' maps, and addresses invalid in each
-- of the last two rounds go back on as invalid. The door-visit history isn't touched.
create or replace function public.app_mb_start_round(p_area text, p_service text, p_season int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_year int := extract(year from now() at time zone 'America/Toronto')::int;
  v_codes text[]; v_open mb_rounds; v_prev mb_rounds; v_new mb_rounds; v_first date; v_start timestamptz;
  v_cleared int := 0; v_carried int := 0; v_center uuid; v_has_visits boolean := to_regclass('public.client_visits') is not null;
begin
  perform mb_check_area(p_area);
  perform mb_check_input(p_service, p_season);
  if p_season <> v_year then raise exception 'Rounds can only be started in this year''s season (%)', v_year; end if;
  perform pg_advisory_xact_lock(hashtext('mb_round:' || p_area));
  v_codes := array(select rm.route_code from route_maps rm where rm.area_name = p_area and rm.status = 'approved');
  select mac.center_id into v_center from map_area_centers mac where mac.area_name = p_area limit 1;
  select * into v_open from mb_rounds r where r.area_name = p_area and r.service = p_service and r.season = p_season and r.ended_at is null;

  if not exists (select 1 from mb_rounds r where r.area_name = p_area and r.service = p_service and r.season = p_season) then
    -- Round 1: from the first knock this season that isn't in another round, else now
    select min(v.day) into v_first from client_visits v
     where v.route_code = any(v_codes) and v.at >= mb_season_start(p_season) and v.at < mb_season_end(p_season)
       and not exists (select 1 from mb_rounds x where x.area_name = p_area and x.season = p_season
                        and v.at >= x.started_at and v.at < coalesce(x.ended_at, mb_season_end(p_season)));
    v_start := coalesce(v_first::timestamp at time zone 'America/Toronto', now());
    insert into mb_rounds (area_name, service, season, round_no, started_at, started_by)
    values (p_area, p_service, p_season, 1, v_start, auth.uid()) returning * into v_new;
  else
    if v_open.id is null then raise exception 'This season''s rounds on % are closed', p_area; end if;
    update mb_rounds set ended_at = now() where id = v_open.id;
    insert into mb_rounds (area_name, service, season, round_no, started_at, started_by)
    values (p_area, p_service, p_season, v_open.round_no + 1, now(), auth.uid()) returning * into v_new;
    select * into v_prev from mb_rounds r where r.area_name = p_area and r.service = p_service and r.season = p_season and r.round_no = v_open.round_no - 1;

    -- a copy of the knocks, then clear them off the workers' maps (the door visits stay as they are)
    insert into mb_cleared_knocks (round_id, knock)
    select v_new.id, to_jsonb(d) from house_dispositions d where d.route_code = any(v_codes);
    get diagnostics v_cleared = row_count;
    if v_has_visits then alter table house_dispositions disable trigger crm_keep_visit; end if;
    delete from house_dispositions d where d.route_code = any(v_codes);

    -- invalid in the round just ended and the one before it: stays invalid
    if v_prev.id is not null then
      insert into mb_carried_invalids (round_id, route_code, house_key)
      select v_new.id, a.route_code, a.house_key
        from (select distinct v.route_code, v.house_key from mb_visits(v_codes, v_open.started_at, now()) v where v.status = 'invalid') a
        join (select distinct v.route_code, v.house_key from mb_visits(v_codes, v_prev.started_at, v_prev.ended_at) v where v.status = 'invalid') b
          on b.route_code = a.route_code and b.house_key = a.house_key
      on conflict do nothing;
      get diagnostics v_carried = row_count;
      insert into house_dispositions (route_code, house_key, status, note, command_center_id)
      select ci.route_code, ci.house_key, 'invalid', 'Invalid two rounds in a row', v_center::text
        from mb_carried_invalids ci where ci.round_id = v_new.id;
    end if;
    if v_has_visits then alter table house_dispositions enable trigger crm_keep_visit; end if;
  end if;

  insert into audit_log (actor, entity, entity_id, action, after)
  values (auth.uid(), 'mb_rounds', v_new.id::text, 'start_round',
          jsonb_build_object('area', p_area, 'service', p_service, 'season', p_season, 'round', v_new.round_no,
                             'started', v_new.started_at, 'cleared', v_cleared, 'carried', v_carried));
  return jsonb_build_object('ok', true, 'round', v_new.round_no, 'started', v_new.started_at, 'cleared', v_cleared, 'carried', v_carried);
end $$;

-- ───────────── access ─────────────
revoke all on function public.app_mb_settings(uuid) from public, anon;
revoke all on function public.app_mb_save_settings(uuid, text, int, int, int) from public, anon;
revoke all on function public.app_mb_overview(uuid, text, int, int) from public, anon;
revoke all on function public.app_mb_outlines(uuid) from public, anon;
revoke all on function public.app_mb_area_view(text[], text, int, int) from public, anon;
revoke all on function public.app_mb_route(text, text, int, int) from public, anon;
revoke all on function public.app_mb_house(text, text) from public, anon;
revoke all on function public.app_mb_start_round(text, text, int) from public, anon;
grant execute on function public.app_mb_settings(uuid) to authenticated;
grant execute on function public.app_mb_save_settings(uuid, text, int, int, int) to authenticated;
grant execute on function public.app_mb_overview(uuid, text, int, int) to authenticated;
grant execute on function public.app_mb_outlines(uuid) to authenticated;
grant execute on function public.app_mb_area_view(text[], text, int, int) to authenticated;
grant execute on function public.app_mb_route(text, text, int, int) to authenticated;
grant execute on function public.app_mb_house(text, text) to authenticated;
grant execute on function public.app_mb_start_round(text, text, int) to authenticated;

-- ───────────── every map knocked so far: Sealing 2026 · Round 1, from its first knock day ─────────────
do $$
begin
  if to_regclass('public.client_visits') is null then return; end if;
  insert into mb_rounds (area_name, service, season, round_no, started_at, note)
  select rm.area_name, 'sealing', 2026, 1, min(v.day)::timestamp at time zone 'America/Toronto', 'Knocks logged before rounds existed'
    from client_visits v join route_maps rm on rm.route_code = v.route_code and rm.status = 'approved'
   where v.day >= date '2026-01-01' and v.day < date '2027-01-01'
   group by rm.area_name
  on conflict (area_name, service, season, round_no) do nothing;
end $$;
