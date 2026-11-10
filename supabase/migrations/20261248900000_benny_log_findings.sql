-- Each log entry can carry what an investigation found (cause, proposed fix, what's needed), shown in the Bug log.
-- A scheduled check reads the open entries that haven't been looked at, investigates, and writes its findings here.
-- Additive only.
alter table public.benny_bugs add column if not exists findings jsonb;
alter table public.benny_bugs add column if not exists investigated_at timestamptz;

create or replace function public.benny_bugs_list(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform benny_bugs_ok();
  return jsonb_build_object(
    'open', (select count(*) from benny_bugs where status = 'open'),
    'done', (select count(*) from benny_bugs where status = 'done'),
    'open_bugs', (select count(*) from benny_bugs where status = 'open' and kind = 'bug'),
    'open_requests', (select count(*) from benny_bugs where status = 'open' and kind = 'request'),
    'bugs', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', b.id, 'created_at', b.created_at, 'kind', b.kind, 'title', b.title, 'status', b.status, 'resolved_at', b.resolved_at,
               'resolved_by', (select u.full_name from app_users u where u.id = b.resolved_by),
               'by', coalesce((select u.full_name from app_users u where u.id = b.created_by), b.report->>'user'),
               'center', (select c.display_name from command_centers c where c.id = b.center_id),
               'path', b.path, 'report', b.report, 'findings', b.findings, 'investigated_at', b.investigated_at)) order by b.created_at desc), '[]')
               from (select * from benny_bugs x where p_status is null or x.status = p_status order by x.created_at desc limit 400) b));
end $$;
