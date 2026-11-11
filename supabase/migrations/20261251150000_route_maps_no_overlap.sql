-- One street, one route. A street drawn into two routes splits its past clients, bookings and houses between them,
-- and each route's crew sees half (North Surrey #3/#4, North Delta, and 645 km across the West, fixed 2026-11-11).
-- From now on a route that is saved approved can't take a street piece another map's approved route already has:
-- the piece is left out of the route being saved, and route_overlap_trims says what was left out and which routes
-- have it (Map Builder shows that after Save). A route keeps every piece it already had, so saving a map again
-- changes nothing; only newly added pieces are checked. Routes of the same map are checked in Map Builder itself
-- (the tab holds the whole map, and Save refuses while a road is on two of its routes), not here: while a map is
-- being saved, its own routes' street lines are a minute behind.
-- Additive: a table, three functions, one trigger.

create table if not exists public.route_overlap_trims (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  by_user uuid default auth.uid(),
  area_name text,
  route_code text,
  route_number integer,
  seg_key text,
  osm_id text,
  street text,
  meters integer,
  kept_by text[]
);
alter table public.route_overlap_trims enable row level security;
revoke all on public.route_overlap_trims from anon, authenticated;
create index if not exists route_overlap_trims_area_at on public.route_overlap_trims (area_name, at);

/** A saved street piece's key: its OpenStreetMap id, first and last point, and point count (Map Builder's segKey). */
create or replace function public.route_seg_key(p_seg jsonb)
returns text language sql immutable set search_path = public as $$
  select coalesce(p_seg->>'osmId', '') || '|'
      || coalesce(p_seg->'coordinates'->0->>0, '') || ',' || coalesce(p_seg->'coordinates'->0->>1, '') || '|'
      || coalesce(p_seg->'coordinates'->-1->>0, '') || ',' || coalesce(p_seg->'coordinates'->-1->>1, '') || '|'
      || coalesce(jsonb_array_length(p_seg->'coordinates'), 0)
$$;

/** A saved street piece as a line (longitude, latitude). */
create or replace function public.route_seg_line(p_seg jsonb)
returns geometry language sql immutable set search_path = public as $$
  select ST_MakeLine(array(select ST_SetSRID(ST_MakePoint((c->>0)::float8, (c->>1)::float8), 4326)
                             from jsonb_array_elements(p_seg->'coordinates') with ordinality t(c, o) order by o))
$$;

create or replace function public.route_maps_no_overlap()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_before text[]; v_keep jsonb := '[]'::jsonb; s jsonb; g geometry; v_len float8; v_cov float8; v_by text[]; v_left int := 0;
begin
  if new.status is distinct from 'approved' then return new; end if;
  -- an admin putting routes back from a backup can say so for its own transaction
  if coalesce(current_setting('app.route_overlap_ok', true), '') = 'on' then return new; end if;
  -- what this route already had (an upsert arrives as an insert first: the saved row is looked up by map and number)
  select array_agg(route_seg_key(e)) into v_before
    from route_maps rm, jsonb_array_elements(rm.segments) e
   where rm.area_name = new.area_name and rm.route_number = new.route_number and rm.status = 'approved';
  for s in select e from jsonb_array_elements(coalesce(new.segments, '[]'::jsonb)) e loop
    if jsonb_array_length(coalesce(s->'coordinates', '[]'::jsonb)) < 2 or route_seg_key(s) = any(coalesce(v_before, '{}')) then
      v_keep := v_keep || jsonb_build_array(s); continue;
    end if;
    g := route_seg_line(s);
    v_len := ST_Length(g::geography);
    -- the approved routes of the other maps that have this street here
    select coalesce(ST_Length(ST_Intersection(g, ST_Union(ST_Buffer(l.line, 6)::geometry))::geography), 0),
           array_agg(distinct l.route_code)
      into v_cov, v_by
      from route_street_lines l
      join route_maps o on o.route_code = l.route_code and o.status = 'approved' and o.area_name is distinct from new.area_name
     where ST_DWithin(l.line, g::geography, 6);
    if v_len > 0 and coalesce(v_cov, 0) >= 15 and v_cov >= 0.5 * v_len then
      insert into route_overlap_trims (area_name, route_code, route_number, seg_key, osm_id, street, meters, kept_by)
      values (new.area_name, new.route_code, new.route_number, route_seg_key(s), s->>'osmId', s->>'name', round(v_len)::int, v_by);
      v_left := v_left + 1;
    else
      v_keep := v_keep || jsonb_build_array(s);
    end if;
  end loop;
  if v_left > 0 then new.segments := v_keep; end if;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'route_maps_no_overlap' and tgrelid = 'public.route_maps'::regclass) then
    create trigger route_maps_no_overlap before insert or update of segments, status on public.route_maps
      for each row execute function public.route_maps_no_overlap();
  end if;
end $$;

/** Which routes have the pieces just left out of a map's routes (Map Builder, after Save: it sends the keys of the
 *  pieces that didn't come back). The latest record of each. Map builders only. */
create or replace function public.route_overlap_who(p_area text, p_keys text[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not app_has_perm('sa_territory') then raise exception 'not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('route_number', x.route_number, 'seg_key', x.seg_key, 'street', x.street, 'meters', x.meters, 'kept_by', x.kept_by))
      from (select distinct on (t.route_number, t.seg_key) t.* from route_overlap_trims t
             where t.area_name = p_area and t.seg_key = any(coalesce(p_keys, '{}'))
             order by t.route_number, t.seg_key, t.id desc) x), '[]'::jsonb);
end $$;
revoke all on function public.route_overlap_who(text, text[]) from public, anon;
grant execute on function public.route_overlap_who(text, text[]) to authenticated;
revoke all on function public.route_maps_no_overlap() from public, anon, authenticated;
