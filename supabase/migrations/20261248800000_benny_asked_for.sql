-- The Benny's log also keeps what people asked for that it couldn't do (no tool for it), so it's clear what to build
-- next. Same log as the bugs, told apart by kind. Additive only.

alter table public.benny_bugs add column if not exists kind text not null default 'bug';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'benny_bugs_kind_ok') then
    alter table public.benny_bugs add constraint benny_bugs_kind_ok check (kind in ('bug', 'request'));
  end if;
end $$;

-- Save a log entry: a bug, or a request the Benny couldn't do.
create or replace function public.benny_log_save(p_center uuid, p_path text, p_kind text, p_title text, p_report jsonb)
returns uuid language plpgsql volatile security definer set search_path to 'public' as $$
declare v uuid;
begin
  perform benny_ok_any(p_center);
  if length(trim(coalesce(p_title, ''))) = 0 then raise exception 'A log entry needs a title'; end if;
  insert into benny_bugs (center_id, path, kind, title, report)
  values (p_center, left(p_path, 300), case when p_kind = 'request' then 'request' else 'bug' end, left(trim(p_title), 200), coalesce(p_report, '{}'))
  returning id into v;
  return v;
end $$;
revoke all on function public.benny_log_save(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.benny_log_save(uuid, text, text, text, jsonb) to authenticated;

-- The log, newest first, with each entry's kind and the open counts by kind.
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
               'path', b.path, 'report', b.report)) order by b.created_at desc), '[]')
               from (select * from benny_bugs x where p_status is null or x.status = p_status order by x.created_at desc limit 400) b));
end $$;

-- CPS numbers people ask for by name: each cart's steps (jobs logged), equiv (EQ), gross and upsells, and the totals
-- for the manager(s) asked about. From the cart's own running stats (kept up to date as jobs are logged).
do $$ declare src text; nsrc text; begin
  select pg_get_functiondef('public.benny_live(uuid,text)'::regprocedure) into src;
  nsrc := replace(src,
    $a$        select jsonb_build_object('cart_id', l.id,$a$,
    $b$        select jsonb_build_object('cart_id', l.id,
                 'steps', coalesce((l.stats->>'stepCount')::numeric, 0), 'equiv', round(coalesce((l.stats->>'totalEQ')::numeric, 0), 2),
                 'gross', round(coalesce((l.stats->>'prodGross')::numeric, 0), 2), 'upsells', coalesce((l.stats->>'upsellCount')::numeric, 0),
                 'upsell_gross', round(coalesce((l.stats->>'upsellGross')::numeric, 0), 2), 'logsheet', l.status,$b$);
  if nsrc = src then raise exception 'benny_live: cart object not found'; end if;
  src := nsrc;
  nsrc := replace(src,
    $a$    'live', true, 'date', v_date,$a$,
    $b$    'live', true, 'date', v_date,
    'totals', (select jsonb_build_object('carts', count(*), 'steps', coalesce(sum((l.stats->>'stepCount')::numeric), 0),
                        'equiv', round(coalesce(sum((l.stats->>'totalEQ')::numeric), 0), 2), 'gross', round(coalesce(sum((l.stats->>'prodGross')::numeric), 0), 2),
                        'upsells', coalesce(sum((l.stats->>'upsellCount')::numeric), 0), 'upsell_gross', round(coalesce(sum((l.stats->>'upsellGross')::numeric), 0), 2))
                 from logsheet_sessions l where l.date = v_date and l.command_center_id = p_center
                  and (v_mgrs is null or (select u.metadata->>'assignedManagerId' from users u where u.user_id = l.worker_id and u.command_center_id = p_center) = any (v_mgrs))),$b$);
  if nsrc = src then raise exception 'benny_live: top of result not found'; end if;
  execute nsrc;
end $$;
