-- The Benny's live crew draft. Managers going out on separate teams pick their crews in turns, on their own phones: a
-- coin toss says who picks first, then snake order (A, B, B, A, A, B…). The team whose turn it is gets a notification
-- ("your pick"); everyone in the draft sees it live. When everyone is picked, the person who started it makes the
-- Start the day card from the crews. Changes nothing else. Additive only.

create table if not exists public.benny_drafts (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.command_centers(id) on delete cascade,
  day date not null,
  created_by uuid not null references public.app_users(id),
  teams jsonb not null,                 -- [{ key, managers: [{ id, name }] }]
  pool jsonb not null,                  -- [{ hire_id, cn, name, days, avg }]
  picks jsonb not null default '[]',    -- [{ team, hire_id, by, at }]
  first_team text not null,
  rules text,
  state text not null default 'open' check (state in ('open', 'done', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.benny_drafts enable row level security;
revoke all on table public.benny_drafts from anon, authenticated;
create index if not exists benny_drafts_open on public.benny_drafts (center_id, day) where state = 'open';

insert into public.notify_catalog (key, grp, grp_label, label, help, scopes, default_on, default_scope, minutes, sort, many) values
  ('rm.draft_turn', 'rm', 'Route managing', 'It’s my pick in a crew draft', 'When the managers pick their crews in turns.', array['mine'], true, 'mine', false, 15, 'picks waiting')
on conflict (key) do update set grp = excluded.grp, grp_label = excluded.grp_label, label = excluded.label, help = excluded.help,
  scopes = excluded.scopes, default_on = excluded.default_on, default_scope = excluded.default_scope, sort = excluded.sort, many = excluded.many;

-- whose turn after k picks: the teams in order from the coin toss's winner, snaking back and forth
create or replace function public.benny_draft_turn(p_teams jsonb, p_first text, p_k int)
returns text language plpgsql immutable set search_path to 'public' as $$
declare keys text[]; n int; f int; ord text[]; r int; pos int;
begin
  select array_agg(t->>'key' order by o) into keys from jsonb_array_elements(p_teams) with ordinality x(t, o);
  n := coalesce(array_length(keys, 1), 0);
  if n = 0 then return null; end if;
  f := coalesce(array_position(keys, p_first), 1);
  ord := keys[f:n] || keys[1:f - 1];
  r := p_k / n; pos := p_k % n;
  return ord[case when r % 2 = 0 then pos + 1 else n - pos end];
end $$;

create or replace function public.benny_draft_in(p_teams jsonb, p_user uuid)
returns text language sql immutable set search_path to 'public' as $$
  select t->>'key' from jsonb_array_elements(p_teams) t, jsonb_array_elements(t->'managers') m where (m->>'id')::uuid = p_user limit 1
$$;

-- tell a team's managers it's their pick (not the person who just picked)
create or replace function public.benny_draft_tell(d public.benny_drafts, p_actor uuid)
returns void language plpgsql volatile security definer set search_path to 'public' as $$
declare v_turn text := benny_draft_turn(d.teams, d.first_team, jsonb_array_length(d.picks)); m jsonb; v_left int;
begin
  if d.state <> 'open' or v_turn is null then return; end if;
  v_left := jsonb_array_length(d.pool) - jsonb_array_length(d.picks);
  for m in select x from jsonb_array_elements(d.teams) t, jsonb_array_elements(t->'managers') x where t->>'key' = v_turn loop
    if (m->>'id')::uuid is distinct from p_actor then
      perform notify_emit('rm.draft_turn', d.center_id, null, (m->>'id')::uuid, 'Crew draft: your pick',
        v_left || ' left to pick for ' || to_char(d.day, 'Dy Mon FMDD') || '.', '/app/draft/' || d.id,
        'draft:' || d.id || ':' || jsonb_array_length(d.picks) || ':' || (m->>'id'), null, p_actor);
    end if;
  end loop;
end $$;

-- what everyone in the draft sees
create or replace function public.benny_draft_view(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare u uuid := auth.uid(); d benny_drafts; v_mine text; v_turn text; v_owner boolean;
begin
  select * into d from benny_drafts where id = p_id;
  if d.id is null then raise exception 'That draft is gone.'; end if;
  v_mine := benny_draft_in(d.teams, u);
  v_owner := d.created_by = u or app_is_super_admin();
  if v_mine is null and not v_owner then raise exception 'Not allowed' using errcode = '42501'; end if;
  v_turn := case when d.state = 'open' then benny_draft_turn(d.teams, d.first_team, jsonb_array_length(d.picks)) end;
  return jsonb_build_object(
    'id', d.id, 'center_id', d.center_id, 'day', d.day, 'state', d.state, 'rules', d.rules, 'first_team', d.first_team,
    'owner', (select full_name from app_users where id = d.created_by), 'is_owner', v_owner, 'mine', v_mine, 'turn', v_turn,
    'can_pick', d.state = 'open' and (v_mine = v_turn or v_owner),
    'teams', (select jsonb_agg(t || jsonb_build_object('picks', coalesce((select jsonb_agg(p.x->'hire_id' order by p.o) from jsonb_array_elements(d.picks) with ordinality p(x, o)
                                                                           where p.x->>'team' = t->>'key'), '[]'::jsonb)) order by o)
                from jsonb_array_elements(d.teams) with ordinality x(t, o)),
    'pool', d.pool, 'picks', d.picks, 'updated_at', d.updated_at);
end $$;

-- start one: the teams (each a list of manager ids), the day's crew who are working, a coin toss
create or replace function public.benny_draft_start(p_center uuid, p_day date, p_teams jsonb, p_rules text default null)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare u uuid := auth.uid(); v_day uuid; v_road boolean; v_teams jsonb := '[]'::jsonb; g jsonb; v_mgrs jsonb; v_pool jsonb; d benny_drafts; v_n int;
begin
  if u is null or not ((app_has_perm('workerbook') or app_is_super_admin()) and app_can_see_center(p_center)) then
    raise exception 'Not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_teams) <> 'array' or jsonb_array_length(p_teams) < 2 then raise exception 'A draft needs two teams or more.'; end if;
  for g in select x from jsonb_array_elements(p_teams) x loop
    select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.full_name) order by a.full_name) into v_mgrs
      from app_users a where a.is_active and a.id::text in (select jsonb_array_elements_text(g));
    if v_mgrs is null or jsonb_array_length(v_mgrs) <> jsonb_array_length(g) then raise exception 'A manager in the draft isn’t an active user.'; end if;
    v_teams := v_teams || jsonb_build_array(jsonb_build_object('key', (select string_agg(x, '+') from jsonb_array_elements_text(g) x), 'managers', v_mgrs));
  end loop;
  select id into v_day from days where center_id = p_center and day = p_day;
  if v_day is null then raise exception 'Nobody is booked on that day.'; end if;
  if exists (select 1 from sessions where day_id = v_day) then raise exception 'That day has already started.'; end if;
  v_road := (select center_type from command_centers where id = p_center) = 'road_trip';
  select coalesce(jsonb_agg(jsonb_build_object('hire_id', r.hire_id, 'cn', h.cn, 'name', trim(p.first_name || ' ' || coalesce(p.last_name, '')),
                    'days', coalesce(s.days, 0), 'avg', case when s.days > 0 then round(s.equiv / s.days, 2) end)
                  order by (case when s.days > 0 then s.equiv / s.days end) desc nulls last, p.first_name), '[]'::jsonb)
    into v_pool
    from day_roster r join hires h on h.id = r.hire_id join people p on p.id = h.person_id
    left join lateral (select count(distinct l.day) days, coalesce(sum(l.equiv), 0) equiv from payout_lines l where l.hire_id = r.hire_id and l.center_id = p_center) s on true
   where r.day_id = v_day and case when v_road then r.confirmed_at is not null else coalesce(r.attendance, 'showed') = 'showed' end;
  v_n := jsonb_array_length(v_pool);
  if v_n = 0 then raise exception 'Nobody on that day’s crew is marked as working.'; end if;
  update benny_drafts set state = 'cancelled', updated_at = now() where center_id = p_center and day = p_day and state = 'open';
  insert into benny_drafts (center_id, day, created_by, teams, pool, first_team, rules)
  values (p_center, p_day, u, v_teams, v_pool, v_teams->(floor(random() * jsonb_array_length(v_teams)))::int->>'key', nullif(trim(coalesce(p_rules, '')), ''))
  returning * into d;
  perform benny_draft_tell(d, u);
  return benny_draft_view(d.id);
end $$;

create or replace function public.benny_draft_pick(p_id uuid, p_hire uuid)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare u uuid := auth.uid(); d benny_drafts; v_turn text; v_mine text;
begin
  select * into d from benny_drafts where id = p_id for update;
  if d.id is null then raise exception 'That draft is gone.'; end if;
  if d.state <> 'open' then raise exception 'The draft is over.'; end if;
  v_turn := benny_draft_turn(d.teams, d.first_team, jsonb_array_length(d.picks));
  v_mine := benny_draft_in(d.teams, u);
  if not (v_mine = v_turn or d.created_by = u or app_is_super_admin()) then raise exception 'It isn’t your pick.'; end if;
  if not exists (select 1 from jsonb_array_elements(d.pool) x where (x->>'hire_id')::uuid = p_hire) then raise exception 'They aren’t in this draft.'; end if;
  if exists (select 1 from jsonb_array_elements(d.picks) x where (x->>'hire_id')::uuid = p_hire) then raise exception 'Already picked.'; end if;
  update benny_drafts set picks = picks || jsonb_build_array(jsonb_build_object('team', v_turn, 'hire_id', p_hire, 'by', u, 'at', now())),
         state = case when jsonb_array_length(picks) + 1 >= jsonb_array_length(pool) then 'done' else 'open' end, updated_at = now()
   where id = p_id returning * into d;
  perform benny_draft_tell(d, u);
  return benny_draft_view(d.id);
end $$;

-- the person who started it: take back the last pick, or call it off
create or replace function public.benny_draft_undo(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare d benny_drafts;
begin
  select * into d from benny_drafts where id = p_id for update;
  if d.id is null or not (d.created_by = auth.uid() or app_is_super_admin()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if d.state = 'cancelled' or jsonb_array_length(d.picks) = 0 then return benny_draft_view(p_id); end if;
  update benny_drafts set picks = picks - (jsonb_array_length(picks) - 1), state = 'open', updated_at = now() where id = p_id;
  return benny_draft_view(p_id);
end $$;
create or replace function public.benny_draft_cancel(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
begin
  update benny_drafts set state = 'cancelled', updated_at = now() where id = p_id and (created_by = auth.uid() or app_is_super_admin());
  if not found then raise exception 'Not allowed' using errcode = '42501'; end if;
  return benny_draft_view(p_id);
end $$;

revoke all on function public.benny_draft_turn(jsonb, text, int) from public, anon, authenticated;
revoke all on function public.benny_draft_in(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.benny_draft_tell(public.benny_drafts, uuid) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['benny_draft_view(uuid)', 'benny_draft_start(uuid, date, jsonb, text)', 'benny_draft_pick(uuid, uuid)', 'benny_draft_undo(uuid)', 'benny_draft_cancel(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
