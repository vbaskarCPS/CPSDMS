-- The Benny on MainstreetAI, for MainstreetAI admins (the mainstreet_admin permission): what it can look up and the
-- changes it can check for a card. Nothing here changes a zone: a card's save uses the Zones screen's own functions
-- (ms_assign_rep, ms_set_zone_status), which check the permission again.
--   benny_ms_zones        zones as words: city, businesses, each campaign's rep (search, or only the ones with no rep)
--   benny_ms_reps         the reps, their zones and their visits in the last 7 days
--   benny_ms_map          the zones in a city or touching a box on the map (a box read off a picture), with their
--                         shapes for the chat's map and how much of each lies in the box
--   benny_ms_check_assign who gets which zone: one or many moves, a swap, or "all of Sam's zones to Priya"
--   benny_ms_check_zone   retire a zone, or bring one back

create or replace function public.benny_ms_ok() returns void language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or not coalesce(ms_is_admin(), false) then raise exception 'Not allowed' using errcode = '42501'; end if;
end $$;
revoke all on function public.benny_ms_ok() from public, anon, authenticated;

-- a rep by name (the whole name first, else the start of a first or last name) or by id
create or replace function public.benny_ms_rep_find(p_q text) returns table (id uuid, full_name text, is_active boolean)
language sql stable security definer set search_path to 'public' as $$
  with r as (select u.id, u.full_name, u.is_active from app_users u join user_permissions up on up.user_id = u.id and up.permission = 'mainstreet_rep'),
       x as (select * from r where lower(r.full_name) = lower(trim(p_q)) or r.id::text = lower(trim(p_q)))
  select * from x
  union all
  select * from r where not exists (select 1 from x) and (r.full_name ilike trim(p_q) || '%' or r.full_name ilike '% ' || trim(p_q) || '%')
$$;
revoke all on function public.benny_ms_rep_find(text) from public, anon, authenticated;

create or replace function public.benny_ms_zones(p_q text default null, p_show text default 'active')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare q text := nullif(trim(coalesce(p_q, '')), ''); v_show text := coalesce(nullif(lower(trim(coalesce(p_show, ''))), ''), 'active'); r jsonb;
begin
  perform benny_ms_ok();
  if v_show not in ('active', 'retired', 'all', 'unassigned') then v_show := 'active'; end if;
  with z as (
    select z.name, z.city, z.area, z.status,
      (select count(*)::int from ms_businesses b where b.merged_into is null and st_intersects(b.geom, z.geom)) as businesses,
      coalesce((select jsonb_agg(jsonb_build_object('campaign', c.name, 'rep', u.full_name) order by c.name)
                  from ms_zone_campaigns zc join ms_campaigns c on c.id = zc.campaign_id left join app_users u on u.id = zc.rep_id where zc.zone_id = z.id), '[]'::jsonb) as campaigns,
      (not exists (select 1 from ms_zone_campaigns zc where zc.zone_id = z.id) or exists (select 1 from ms_zone_campaigns zc where zc.zone_id = z.id and zc.rep_id is null)) as open_slot
    from ms_zones z
    where v_show = 'all' or (v_show = 'retired' and z.status = 'retired') or (v_show in ('active', 'unassigned') and z.status = 'active')
  ), f as (
    select * from z where (v_show <> 'unassigned' or open_slot)
      and (q is null or z.name ilike '%' || q || '%' or z.city ilike '%' || q || '%' or z.area ilike '%' || q || '%'
           or exists (select 1 from jsonb_array_elements(z.campaigns) x where x->>'rep' ilike '%' || q || '%' or x->>'campaign' ilike '%' || q || '%'))
  )
  select jsonb_build_object('showing', v_show, 'total', (select count(*) from f), 'with_no_rep', (select count(*) from f where open_slot),
    'zones', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', t.name, 'city', t.city, 'area', t.area, 'status', nullif(t.status, 'active'),
        'businesses', t.businesses, 'campaigns', t.campaigns)) order by t.city nulls last, t.name) from (select * from f order by city nulls last, name limit 80) t), '[]'::jsonb)) into r;
  return r;
end $$;
revoke all on function public.benny_ms_zones(text, text) from public, anon;
grant execute on function public.benny_ms_zones(text, text) to authenticated;

create or replace function public.benny_ms_reps()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform benny_ms_ok();
  return jsonb_build_object('reps', coalesce((
    select jsonb_agg(jsonb_build_object('name', u.full_name, 'active', u.is_active,
        'zones', coalesce((select jsonb_agg(jsonb_build_object('zone', z.name, 'city', z.city, 'campaign', c.name) order by z.name)
                             from ms_zone_campaigns zc join ms_zones z on z.id = zc.zone_id and z.status = 'active' join ms_campaigns c on c.id = zc.campaign_id where zc.rep_id = u.id), '[]'::jsonb),
        'visits_last_7_days', (select count(*)::int from ms_visits v where v.rep_id = u.id and v.at > now() - interval '7 days'),
        'last_visit', (select max(v.at)::date from ms_visits v where v.rep_id = u.id)) order by u.is_active desc, u.full_name)
      from app_users u join user_permissions up on up.user_id = u.id and up.permission = 'mainstreet_rep'), '[]'::jsonb));
end $$;
revoke all on function public.benny_ms_reps() from public, anon;
grant execute on function public.benny_ms_reps() to authenticated;

create or replace function public.benny_ms_map(p_city text default null, p_s float8 default null, p_w float8 default null, p_n float8 default null, p_e float8 default null, p_title text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_box geometry; v_city text := nullif(trim(coalesce(p_city, '')), ''); zs jsonb; shapes jsonb;
begin
  perform benny_ms_ok();
  if p_s is not null or p_w is not null or p_n is not null or p_e is not null then
    if p_s is null or p_w is null or p_n is null or p_e is null or not (p_s < p_n and p_w < p_e and p_n - p_s < 2 and p_e - p_w < 3 and p_s between 40 and 84 and p_w between -141 and -52) then
      return jsonb_build_object('ok', false, 'problems', jsonb_build_array('That box isn’t a place on the map. Give south, west, north and east in degrees: south below north, west below east (west and east are negative in Canada).'));
    end if;
    v_box := st_makeenvelope(p_w, p_s, p_e, p_n, 4326);
  end if;
  if v_box is null and v_city is null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Which city, or which area on the map?')); end if;

  with z as (
    select z.id, z.name, z.city, z.geom,
      (select count(*)::int from ms_businesses b where b.merged_into is null and st_intersects(b.geom, z.geom)) as businesses,
      case when v_box is not null then (select count(*)::int from ms_businesses b where b.merged_into is null and st_intersects(b.geom, z.geom) and st_intersects(b.geom, v_box)) end as businesses_in_box,
      case when v_box is not null then round((100 * st_area(st_intersection(st_makevalid(z.geom), v_box)) / nullif(st_area(z.geom), 0))::numeric)::int end as pct_of_zone,
      case when v_box is not null then round((100 * st_area(st_intersection(st_makevalid(z.geom), v_box)) / nullif(st_area(v_box), 0))::numeric)::int end as pct_of_box,
      coalesce((select jsonb_agg(jsonb_build_object('campaign', c.name, 'rep', u.full_name) order by c.name)
                  from ms_zone_campaigns zc join ms_campaigns c on c.id = zc.campaign_id left join app_users u on u.id = zc.rep_id where zc.zone_id = z.id), '[]'::jsonb) as campaigns,
      (select string_agg(distinct coalesce(u.full_name, 'no rep'), ', ') from ms_zone_campaigns zc left join app_users u on u.id = zc.rep_id where zc.zone_id = z.id) as who
    from ms_zones z
    where z.status = 'active' and z.geom is not null
      and (v_box is null or st_intersects(z.geom, v_box))
      and (v_city is null or z.city ilike '%' || v_city || '%' or z.name ilike '%' || v_city || '%' or z.city_id in (select c.id from ms_cities c where c.name ilike '%' || v_city || '%'))
  ), t as (select * from z order by pct_of_box desc nulls last, name limit 14)
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', t.name, 'city', t.city, 'businesses', t.businesses, 'businesses_in_box', t.businesses_in_box,
             'percent_of_zone_in_box', t.pct_of_zone, 'percent_of_box_it_covers', t.pct_of_box, 'campaigns', t.campaigns)) order by t.pct_of_box desc nulls last, t.name), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'who', coalesce(t.who, 'no campaign'),
             'polygon', st_asgeojson(st_simplifypreservetopology(t.geom, 0.001), 5)::jsonb) order by t.name), '[]'::jsonb)
    into zs, shapes from t;
  if jsonb_array_length(zs) = 0 then
    return jsonb_build_object('ok', false, 'problems', jsonb_build_array(case when v_box is not null then 'No active zone touches that area.' else 'No active zone in ' || v_city || '.' end));
  end if;
  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'zones', zs,
    'box', case when v_box is not null then jsonb_build_object('s', p_s, 'w', p_w, 'n', p_n, 'e', p_e) end,
    'map', jsonb_strip_nulls(jsonb_build_object('title', coalesce(nullif(trim(coalesce(p_title, '')), ''), case when v_city is not null then 'Zones in ' || initcap(v_city) else 'Zones in that area' end),
      'zones', shapes, 'box', case when v_box is not null then jsonb_build_object('s', p_s, 'w', p_w, 'n', p_n, 'e', p_e) end))));
end $$;
revoke all on function public.benny_ms_map(text, float8, float8, float8, float8, text) from public, anon;
grant execute on function public.benny_ms_map(text, float8, float8, float8, float8, text) to authenticated;

-- p_moves: [{ zone: name or id, rep: name, id or "none", campaign: name (when the zone has more than one) }]
--          or { from_rep: name, rep: name } for every zone a rep has
create or replace function public.benny_ms_check_assign(p_moves jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare m jsonb; e jsonb; v_list jsonb := '[]'::jsonb; v_probs text[] := '{}'; v_out jsonb := '[]'::jsonb;
  q text; v_n int; v_names text; v_rep uuid; v_rep_name text; v_none boolean; v_from uuid;
  zid uuid; zname text; zcity text; cid uuid; cname text; cur uuid; cur_name text; v_stamp text := '';
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  perform benny_ms_ok();
  if jsonb_typeof(p_moves) is distinct from 'array' or jsonb_array_length(p_moves) = 0 then
    return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Which zone goes to which rep?')); end if;
  if jsonb_array_length(p_moves) > 30 then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('That is a lot for one card: thirty moves at most.')); end if;

  -- "all of Sam's zones": one move per zone and campaign Sam has
  for m in select x from jsonb_array_elements(p_moves) x loop
    if coalesce(trim(m->>'zone'), '') = '' and coalesce(trim(m->>'from_rep'), '') <> '' then
      q := trim(m->>'from_rep');
      select count(*), min(r.id::text)::uuid, string_agg(r.full_name, ', ') into v_n, v_from, v_names from benny_ms_rep_find(q) r;
      if v_n = 0 then v_probs := v_probs || ('No rep is called ' || q || '.'); continue; end if;
      if v_n > 1 then v_probs := v_probs || ('Which one: ' || v_names || '?'); continue; end if;
      select coalesce(jsonb_agg(jsonb_build_object('zone', zc.zone_id::text, 'campaign_id', zc.campaign_id::text, 'rep', m->>'rep')), '[]'::jsonb) into e
        from ms_zone_campaigns zc join ms_zones z on z.id = zc.zone_id and z.status = 'active' where zc.rep_id = v_from;
      if jsonb_array_length(e) = 0 then v_probs := v_probs || (v_names || ' has no zones.'); continue; end if;
      v_list := v_list || e;
    else
      v_list := v_list || jsonb_build_array(m);
    end if;
  end loop;

  for m in select x from jsonb_array_elements(v_list) x loop
    -- who it goes to
    q := trim(coalesce(m->>'rep', ''));
    v_none := lower(q) in ('', 'none', 'nobody', 'no one', 'no rep', 'unassigned', 'unassign');
    v_rep := null; v_rep_name := null;
    if not v_none then
      select count(*), min(r.id::text)::uuid, string_agg(r.full_name, ', ') into v_n, v_rep, v_names from benny_ms_rep_find(q) r;
      if v_n = 0 then v_probs := v_probs || ('No rep is called ' || q || '.'); continue; end if;
      if v_n > 1 then v_probs := v_probs || ('Which one: ' || v_names || '?'); continue; end if;
      v_rep_name := v_names;
      if not coalesce((select u.is_active from app_users u where u.id = v_rep), false) then
        v_probs := v_probs || (v_rep_name || ' is switched off, so they can’t take a zone.'); continue; end if;
    end if;
    -- the zone
    q := trim(coalesce(m->>'zone', ''));
    if q = '' then v_probs := v_probs || 'Which zone?'; continue; end if;
    zid := null; zname := null; zcity := null;
    if lower(q) ~ uuid_re then
      select z.id, z.name, z.city into zid, zname, zcity from ms_zones z where z.id = lower(q)::uuid and z.status = 'active';
    else
      select count(*), min(z.id::text)::uuid, string_agg(z.name, ', ') into v_n, zid, v_names from ms_zones z where z.status = 'active' and lower(z.name) = lower(q);
      if v_n = 0 then
        select count(*), min(z.id::text)::uuid, string_agg(z.name, ', ') into v_n, zid, v_names from ms_zones z where z.status = 'active' and z.name ilike '%' || q || '%';
      end if;
      if v_n > 1 then v_probs := v_probs || ('Which zone: ' || v_names || '?'); continue; end if;
      if v_n = 1 then select z.name, z.city into zname, zcity from ms_zones z where z.id = zid; else zid := null; end if;
    end if;
    if zid is null then v_probs := v_probs || ('No active zone is called ' || q || '.'); continue; end if;
    -- the campaign on that zone
    cid := null; cname := null;
    if lower(coalesce(m->>'campaign_id', '')) ~ uuid_re then
      select zc.campaign_id, c.name into cid, cname from ms_zone_campaigns zc join ms_campaigns c on c.id = zc.campaign_id where zc.zone_id = zid and zc.campaign_id = lower(m->>'campaign_id')::uuid;
      if cid is null then v_probs := v_probs || (zname || ' doesn’t have that campaign on it any more.'); continue; end if;
    else
      select count(*), min(zc.campaign_id::text)::uuid, string_agg(c.name, ', ') into v_n, cid, v_names
        from ms_zone_campaigns zc join ms_campaigns c on c.id = zc.campaign_id
       where zc.zone_id = zid and (coalesce(trim(m->>'campaign'), '') = '' or c.name ilike '%' || trim(m->>'campaign') || '%');
      if v_n = 0 then v_probs := v_probs || (zname || ' has no campaign on it' || case when coalesce(trim(m->>'campaign'), '') <> '' then ' called ' || trim(m->>'campaign') else '' end || ': add one on the Zones screen first.'); continue; end if;
      if v_n > 1 then v_probs := v_probs || (zname || ' has ' || v_n || ' campaigns (' || v_names || '): which one?'); continue; end if;
      cname := v_names;
    end if;
    select zc.rep_id, u.full_name into cur, cur_name from ms_zone_campaigns zc left join app_users u on u.id = zc.rep_id where zc.zone_id = zid and zc.campaign_id = cid;
    if cur is not distinct from v_rep then
      v_probs := v_probs || (zname || case when cur is null then ' already has no rep.' else ' is already ' || cur_name || '’s.' end); continue; end if;
    if exists (select 1 from jsonb_array_elements(v_out) o where o->>'zone_id' = zid::text and o->>'campaign_id' = cid::text) then
      v_probs := v_probs || (zname || ' is in the list twice.'); continue; end if;
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('zone_id', zid, 'zone', zname, 'city', zcity, 'campaign_id', cid, 'campaign', cname,
      'from_id', cur, 'from', cur_name, 'to_id', v_rep, 'to', v_rep_name)));
    v_stamp := v_stamp || zid::text || cid::text || coalesce(cur::text, '-');
  end loop;

  if coalesce(array_length(v_probs, 1), 0) > 0 then return jsonb_build_object('ok', false, 'problems', to_jsonb(v_probs)); end if;
  if jsonb_array_length(v_out) = 0 then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Nothing to change.')); end if;
  return jsonb_build_object('ok', true, 'moves', v_out, 'stamp', md5(v_stamp),
    'ask', (select jsonb_agg(jsonb_build_object('zone', o->>'zone_id', 'campaign_id', o->>'campaign_id', 'rep', coalesce(o->>'to_id', 'none'))) from jsonb_array_elements(v_out) o));
end $$;
revoke all on function public.benny_ms_check_assign(jsonb) from public, anon;
grant execute on function public.benny_ms_check_assign(jsonb) to authenticated;

create or replace function public.benny_ms_check_zone(p_zone text, p_status text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare q text := trim(coalesce(p_zone, '')); v_to text := lower(trim(coalesce(p_status, ''))); v_from text; v_n int; zid uuid; v_names text; z ms_zones; v_reps text;
begin
  perform benny_ms_ok();
  if v_to in ('retire', 'retired') then v_to := 'retired'; elsif v_to in ('active', 'bring back', 'restore') then v_to := 'active';
  else return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Retire it, or bring it back?')); end if;
  v_from := case when v_to = 'retired' then 'active' else 'retired' end;
  if q = '' then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Which zone?')); end if;
  if lower(q) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select count(*), min(x.id::text)::uuid into v_n, zid from ms_zones x where x.id = lower(q)::uuid and x.status = v_from;
  else
    select count(*), min(x.id::text)::uuid, string_agg(x.name, ', ') into v_n, zid, v_names from ms_zones x where x.status = v_from and lower(x.name) = lower(q);
    if v_n = 0 then select count(*), min(x.id::text)::uuid, string_agg(x.name, ', ') into v_n, zid, v_names from ms_zones x where x.status = v_from and x.name ilike '%' || q || '%'; end if;
  end if;
  if v_n > 1 then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Which zone: ' || v_names || '?')); end if;
  if v_n = 0 then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('No ' || v_from || ' zone is called ' || q || '.')); end if;
  select * into z from ms_zones x where x.id = zid;
  select string_agg(u.full_name || ' (' || c.name || ')', ', ') into v_reps from ms_zone_campaigns zc join app_users u on u.id = zc.rep_id join ms_campaigns c on c.id = zc.campaign_id where zc.zone_id = zid;
  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'zone', jsonb_build_object('id', z.id, 'name', z.name, 'city', z.city), 'from', v_from, 'to', v_to,
    'reps', v_reps, 'businesses', (select count(*)::int from ms_businesses b where b.merged_into is null and st_intersects(b.geom, z.geom)), 'stamp', md5(z.id::text || z.status || z.updated_at::text)));
end $$;
revoke all on function public.benny_ms_check_zone(text, text) from public, anon;
grant execute on function public.benny_ms_check_zone(text, text) to authenticated;

-- A MainstreetAI admin's questions and log entries are kept too (there is no center on MainstreetAI): the log's two
-- saves let them in when no center is given. Everyone else is checked as before.
do $$ declare d text; n text;
begin
  select pg_get_functiondef('public.benny_log_save(uuid,text,text,text,jsonb)'::regprocedure) into d;
  if position('ms_is_admin' in d) = 0 then
    n := replace(d, 'perform benny_ok_any(p_center);', 'if p_center is not null or not coalesce(ms_is_admin(), false) then perform benny_ok_any(p_center); end if;');
    if n = d then raise exception 'benny_log_save: anchor not found'; end if;
    execute n;
  end if;
  select pg_get_functiondef('public.benny_ai_log_save(jsonb)'::regprocedure) into d;
  if position('ms_is_admin' in d) = 0 then
    n := replace(d, 'if coalesce(benny_ok_any(v_center), '''') not in (''admin'', ''rm'') then raise exception ''not allowed''; end if;',
      'if not (v_center is null and coalesce(ms_is_admin(), false)) and coalesce(benny_ok_any(v_center), '''') not in (''admin'', ''rm'') then raise exception ''not allowed''; end if;');
    if n = d then raise exception 'benny_ai_log_save: anchor not found'; end if;
    execute n;
  end if;
end $$;

-- Where things in a picture are: the street names (and, failing that, business names) read off a map picture.
-- Each road with the box it runs through, and where two of them cross: the Benny places the area asked about from those.
create or replace function public.benny_ms_locate(p_city text, p_names text[])
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_city text := nullif(trim(coalesce(p_city, '')), ''); cids uuid[]; city jsonb; roads jsonb; crossings jsonb; places jsonb;
begin
  perform benny_ms_ok();
  if v_city is null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Which city is the picture of?')); end if;
  select array_agg(c.id) into cids from ms_cities c where c.name ilike '%' || v_city || '%';
  if cids is null then
    return jsonb_build_object('ok', false, 'problems', jsonb_build_array('No city called ' || v_city || ' is loaded.'),
      'cities', (select coalesce(jsonb_agg(c.name order by c.name), '[]'::jsonb) from ms_cities c));
  end if;
  select jsonb_build_object('name', string_agg(distinct c.name, ', '), 'south', round(min(st_ymin(c.geom))::numeric, 4), 'west', round(min(st_xmin(c.geom))::numeric, 4),
           'north', round(max(st_ymax(c.geom))::numeric, 4), 'east', round(max(st_xmax(c.geom))::numeric, 4))
    into city from ms_cities c where c.id = any (cids) and c.geom is not null;

  with bl as materialized (
    select q.ord, q.name as asked, count(l.id)::int as n, st_collect(l.geom) as g,
           (array_agg(distinct l.name))[1:4] as named, (array_agg(distinct l.kind))[1:3] as kinds
    from (select trim(n) as name, ord from unnest(coalesce(p_names, '{}'::text[])) with ordinality as u(n, ord) where length(trim(coalesce(n, ''))) >= 3 limit 12) q
    left join ms_city_lines l on l.city_id = any (cids) and l.name ilike '%' || q.name || '%'
    group by q.ord, q.name
  )
  select
    (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('asked', b.asked, 'found', b.n > 0, 'named', case when b.n > 0 then to_jsonb(b.named) end, 'kind', case when b.n > 0 then to_jsonb(b.kinds) end,
            'south', round(st_ymin(b.g)::numeric, 4), 'north', round(st_ymax(b.g)::numeric, 4), 'west', round(st_xmin(b.g)::numeric, 4), 'east', round(st_xmax(b.g)::numeric, 4))) order by b.ord), '[]'::jsonb) from bl b),
    (select coalesce(jsonb_agg(jsonb_build_object('of', a.asked || ' and ' || b.asked, 'lat', round(st_y(st_closestpoint(a.g, b.g))::numeric, 4), 'lng', round(st_x(st_closestpoint(a.g, b.g))::numeric, 4)) order by a.ord, b.ord), '[]'::jsonb)
       from bl a join bl b on a.ord < b.ord and a.n > 0 and b.n > 0 and st_dwithin(a.g, b.g, 0.0004)),
    -- a name that is no road: a business called that
    (select coalesce(jsonb_agg(jsonb_build_object('asked', b.asked, 'name', s.name, 'address', s.address, 'lat', round(s.lat::numeric, 4), 'lng', round(s.lng::numeric, 4))), '[]'::jsonb)
       from bl b cross join lateral (select m.name, m.address, m.lat, m.lng from ms_businesses m
                                      where m.city_id = any (cids) and m.merged_into is null and m.name ilike '%' || b.asked || '%' order by length(m.name) limit 2) s
      where b.n = 0)
    into roads, crossings, places;
  return jsonb_build_object('ok', true, 'city', city, 'roads', roads, 'crossings', crossings, 'places', places,
    'note', 'A road runs right through its box, so one road gives you one edge at most. Crossings are exact points: place the area from the crossings at its corners or edges.');
end $$;
revoke all on function public.benny_ms_locate(text, text[]) from public, anon;
grant execute on function public.benny_ms_locate(text, text[]) to authenticated;
