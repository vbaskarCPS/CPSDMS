-- The Benny's bug reports are kept in a log inside the app (Super Admin › Bug log): no GitHub issue, no email.
-- Each report can be marked fixed and reopened. Additive only.

alter table public.benny_bugs add column if not exists status text not null default 'open';
alter table public.benny_bugs add column if not exists resolved_at timestamptz;
alter table public.benny_bugs add column if not exists resolved_by uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'benny_bugs_status_ok') then
    alter table public.benny_bugs add constraint benny_bugs_status_ok check (status in ('open', 'done'));
  end if;
end $$;
create index if not exists benny_bugs_recent on public.benny_bugs (status, created_at desc);

-- Who may read the log: super admins and people who manage users.
create or replace function public.benny_bugs_ok()
returns void language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or not (coalesce(app_is_super_admin(), false) or coalesce(app_has_perm('sa_users'), false)) then
    raise exception 'Not allowed' using errcode = '42501'; end if;
end $$;

-- The log, newest first. p_status: 'open', 'done' or null (all).
create or replace function public.benny_bugs_list(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform benny_bugs_ok();
  return jsonb_build_object(
    'open', (select count(*) from benny_bugs where status = 'open'),
    'done', (select count(*) from benny_bugs where status = 'done'),
    'bugs', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', b.id, 'created_at', b.created_at, 'title', b.title, 'status', b.status, 'resolved_at', b.resolved_at,
               'resolved_by', (select u.full_name from app_users u where u.id = b.resolved_by),
               'by', coalesce((select u.full_name from app_users u where u.id = b.created_by), b.report->>'user'),
               'center', (select c.display_name from command_centers c where c.id = b.center_id),
               'path', b.path, 'report', b.report)) order by b.created_at desc), '[]')
               from (select * from benny_bugs x where p_status is null or x.status = p_status order by x.created_at desc limit 300) b));
end $$;

-- Mark a report fixed, or reopen it.
create or replace function public.benny_bug_resolve(p_id uuid, p_done boolean)
returns void language plpgsql volatile security definer set search_path to 'public' as $$
begin
  perform benny_bugs_ok();
  update benny_bugs set status = case when p_done then 'done' else 'open' end,
         resolved_at = case when p_done then now() else null end,
         resolved_by = case when p_done then auth.uid() else null end
   where id = p_id;
  if not found then raise exception 'No such bug report'; end if;
end $$;

do $g$ declare f text; begin
  foreach f in array array['benny_bugs_ok()', 'benny_bugs_list(text)', 'benny_bug_resolve(uuid,boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $g$;
