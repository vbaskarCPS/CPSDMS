-- The Benny's mic uses the phone's general speech-to-text, which mishears the app's own words: "Jahswill" comes out
-- "Jaz will", "Kevontae" "Kevin Tay". So (1) the names the Benny should expect for a spoken message, and (2) lookups
-- that match a worker or manager by sound when the spelling doesn't. Additive only.

create extension if not exists fuzzystrmatch with schema extensions;

-- How alike two names are, 0..1+: spelling (trigrams) plus a bonus when they sound the same (double metaphone),
-- ignoring case, spaces and punctuation. Internal.
create or replace function public.benny_name_score(p_heard text, p_name text)
returns real language sql immutable set search_path to 'public', 'extensions' as $$
  with x as (select regexp_replace(lower(coalesce(p_heard, '')), '[^a-z0-9]', '', 'g') h, regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]', '', 'g') n)
  select case when h = '' or n = '' then 0::real
              else greatest(extensions.similarity(h, n), 0)
                   + case when length(h) >= 3 and extensions.dmetaphone(h) <> '' and extensions.dmetaphone(h) = extensions.dmetaphone(n) then 0.5 else 0 end end::real
    from x
$$;

-- The best match of what was heard against a person's full name and first name.
create or replace function public.benny_person_score(p_heard text, p_full text)
returns real language sql immutable set search_path to 'public', 'extensions' as $$
  select greatest(benny_name_score(p_heard, p_full), benny_name_score(p_heard, split_part(trim(coalesce(p_full, '')), ' ', 1)),
                  -- "Michael A": first name + the start of the last name
                  case when p_heard ~ '\s' then benny_name_score(split_part(trim(p_heard), ' ', 1), split_part(trim(coalesce(p_full, '')), ' ', 1)) * 0.6
                       + case when lower(split_part(trim(coalesce(p_full, '')), ' ', 2)) like lower(split_part(trim(p_heard), ' ', 2)) || '%' then 0.5 else 0 end else 0 end)::real
$$;

-- A worker on today's live day by CN or name; when the spelling finds nobody, by sound.
--   found + heard_as: one clear sound-alike was used (say which).  which: several could fit (ask).
create or replace function public.benny_live_worker(p_center uuid, p_q text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare q text := trim(coalesce(p_q, '')); v_date date := benny_live_date(p_center); v jsonb; n int; best real; second real;
begin
  with w as (
    select u.user_id cn, u.name, u.metadata->>'assignedManagerId' manager,
           (select l.id from logsheet_sessions l where l.date = v_date and l.command_center_id = p_center
               and u.user_id = any (coalesce(nullif(l.team_worker_ids, '{}'), array[l.worker_id])) limit 1) cart_id
      from users u where u.command_center_id = p_center and u.role = 'Worker'),
  m as (select * from w where upper(cn) = upper(q)
        union all select * from w where not exists (select 1 from w w2 where upper(w2.cn) = upper(q))
                                    and (name ilike q || '%' or name ilike '% ' || q || '%' or name ilike '%' || q || '%'))
  select jsonb_agg(jsonb_build_object('cn', cn, 'name', name, 'manager', manager, 'cart_id', cart_id) order by name), count(*) into v, n from m;
  if coalesce(n, 0) = 1 then return jsonb_build_object('found', true) || (v->0); end if;
  if coalesce(n, 0) > 1 then
    select jsonb_agg(e) into v from jsonb_array_elements(v) e
     where (e->>'name') ilike split_part(q, ' ', 1) || ' ' || split_part(q, ' ', 2) || '%';
    if jsonb_array_length(coalesce(v, '[]')) = 1 then return jsonb_build_object('found', true) || (v->0); end if;
    if jsonb_array_length(coalesce(v, '[]')) > 1 then
      return jsonb_build_object('found', false, 'q', q, 'which', (select jsonb_agg(e->>'name') from jsonb_array_elements(v) e)); end if;
  end if;
  -- nobody by spelling: by sound
  select jsonb_agg(jsonb_build_object('cn', cn, 'name', name, 'manager', manager, 'cart_id', cart_id, 'score', s) order by s desc, name),
         max(s), (array_agg(s order by s desc))[2]
    into v, best, second
    from (select u.user_id cn, u.name, u.metadata->>'assignedManagerId' manager,
                 (select l.id from logsheet_sessions l where l.date = v_date and l.command_center_id = p_center
                     and u.user_id = any (coalesce(nullif(l.team_worker_ids, '{}'), array[l.worker_id])) limit 1) cart_id,
                 benny_person_score(q, u.name) s
            from users u where u.command_center_id = p_center and u.role = 'Worker') z
   where s >= 0.3;
  if v is null then return jsonb_build_object('found', false, 'q', q); end if;
  if best >= 0.55 and coalesce(second, 0) <= best - 0.15 then
    return jsonb_build_object('found', true, 'heard_as', q) || ((v->0) - 'score'); end if;
  return jsonb_build_object('found', false, 'q', q, 'which', (select jsonb_agg(e->>'name') from (select e from jsonb_array_elements(v) e limit 4) t));
end $$;
revoke all on function public.benny_live_worker(uuid, text) from public, anon, authenticated;
revoke all on function public.benny_name_score(text, text) from public, anon;
revoke all on function public.benny_person_score(text, text) from public, anon;

-- The names to expect in a spoken message: today's workers (a route manager: their own team), the route managers,
-- the region's maps with their route prefixes. Small on purpose: it rides along with every spoken question.
create or replace function public.benny_vocab(p_center uuid, p_date date default null, p_manager text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_role text := benny_ok_any(p_center); v_mine text[] := benny_my_rm_ids(p_center); v_live date := benny_live_date(p_center);
        v_region text; v_mgrs text[];
begin
  select region into v_region from command_centers where id = p_center;
  v_mgrs := case when v_mine is not null then v_mine when p_manager is not null then array[p_manager] else null end;
  return jsonb_strip_nulls(jsonb_build_object(
    'workers', (select jsonb_agg(distinct x) from (
        select u.name x from users u where v_live is not null and u.command_center_id = p_center and u.role = 'Worker'
           and (v_mgrs is null or u.metadata->>'assignedManagerId' = any (v_mgrs))
        union
        select trim(p.first_name || ' ' || coalesce(p.last_name, '')) from day_roster r join days d on d.id = r.day_id join hires h on h.id = r.hire_id join people p on p.id = h.person_id
         where v_role = 'admin' and d.center_id = p_center and d.day between coalesce(p_date, current_date) and coalesce(p_date, current_date) + 1) z),
    'managers', (select jsonb_agg(distinct u.full_name) from app_users u where u.rm_center_id = p_center and u.is_active),
    -- one line per place, not per map: "North Vancouver (NVN) #1-#5" says the maps are NORTH VANCOUVER #1…#5 and routes NVN01…
    'places', (select jsonb_agg(m order by m) from (
        select initcap(regexp_replace(ap.area_name, '\s*#\d+\s*$', '')) || coalesce(' (' || max(ap.prefix) || ')', '')
               || case when count(*) > 1 then ' #1-#' || count(*) else '' end m
          from area_prefixes ap where (v_region is null or ap.region = v_region)
         group by regexp_replace(ap.area_name, '\s*#\d+\s*$', '') order by 1 limit 200) y)));
end $$;
revoke all on function public.benny_vocab(uuid, date, text) from public, anon;
grant execute on function public.benny_vocab(uuid, date, text) to authenticated;

-- People search (super admins): when the spelling finds nobody, the closest-sounding names.
do $$ declare src text; nsrc text; begin
  select pg_get_functiondef('public.benny_find_people(uuid,text)'::regprocedure) into src;
  nsrc := replace(src,
    $a$  return v || coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('kind', 'staff',$a$,
    $b$  if v = '[]'::jsonb and not exists (select 1 from app_users u where u.full_name ilike '%' || q || '%' or u.username ilike '%' || q || '%') then
    -- nobody by spelling: the closest by sound (speech-to-text mishears names)
    return jsonb_build_object('exact', false, 'heard', q, 'closest', (select coalesce(jsonb_agg(x order by (x->>'score')::real desc), '[]') from (
      select jsonb_strip_nulls(jsonb_build_object('kind', 'worker', 'name', trim(p.first_name || ' ' || coalesce(p.last_name, '')), 'cell', p.cell_phone, 'email', p.email,
               'score', benny_person_score(q, trim(p.first_name || ' ' || coalesce(p.last_name, ''))),
               'cn', (select h.cn from hires h where h.person_id = p.id order by h.year desc limit 1))) x
        from people p where benny_person_score(q, trim(p.first_name || ' ' || coalesce(p.last_name, ''))) >= 0.45
       order by benny_person_score(q, trim(p.first_name || ' ' || coalesce(p.last_name, ''))) desc limit 5) z));
  end if;
  return v || coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('kind', 'staff',$b$);
  if nsrc = src then raise exception 'benny_find_people: return line not found'; end if;
  execute nsrc;
end $$;

-- Starting the day: a manager's name that was misheard ("Joe Van" = Jovan) still finds them.
do $$ declare src text; nsrc text; begin
  select pg_get_functiondef('public.benny_plan_day(uuid,date,jsonb,boolean)'::regprocedure) into src;
  nsrc := replace(src,
    $a$             order by (u.id = any (v_avail)) desc, u.full_name limit 1; end if;$a$,
    $b$             order by (u.id = any (v_avail)) desc, u.full_name limit 1;
        if m.id is null then   -- by sound, among the managers available that day
          select * into m from app_users u where u.id = any (v_avail) and benny_person_score(q, u.full_name) >= 0.55
           order by benny_person_score(q, u.full_name) desc limit 1;
        end if; end if;$b$);
  if nsrc = src then raise exception 'benny_plan_day: manager lookup not found'; end if;
  execute nsrc;
end $$;
