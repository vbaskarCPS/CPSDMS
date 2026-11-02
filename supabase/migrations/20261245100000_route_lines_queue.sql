-- Saving a route in the map builder timed out ("Failed to save").
--
-- Every insert/update/delete on route_maps rebuilt that route's street lines inside the same request
-- (route_maps_lines_trigger → refresh_route_street_lines), and the new lines then placed every waiting
-- client and booking within 400 m (mb_lines_added). The builder saves with the anon role (3 s limit), so a
-- route in a busy area — or the first route after a whole area was cleared — ran out of time and nothing saved.
--
-- Now the trigger only queues the route code; a cron job a minute later rebuilds the lines and does the
-- placing, with the server's normal time limit. Saving writes the route and nothing else.

create table if not exists public.route_lines_queue (
  route_code   text primary key,
  queued_at    timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.route_lines_queue enable row level security;   -- written only by the definer functions below
create index if not exists route_lines_queue_pending on public.route_lines_queue (queued_at) where processed_at is null;

create or replace function public.route_lines_enqueue(p_code text)
returns void language sql security definer set search_path to 'public' as $$
  insert into route_lines_queue (route_code, queued_at, processed_at)
  select p_code, now(), null where p_code is not null
  on conflict (route_code) do update set queued_at = now(), processed_at = null;
$$;
revoke all on function public.route_lines_enqueue(text) from public, anon, authenticated;

create or replace function public.route_maps_lines_trigger()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform route_lines_enqueue(old.route_code);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform route_lines_enqueue(new.route_code);
  end if;
  return null;
end;
$function$;

-- Rebuild the street lines of queued routes (oldest first). A route queued again while it's being rebuilt
-- keeps its newer queued_at and is picked up next time.
create or replace function public.route_lines_drain(p_max integer default 60)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare r record; n integer := 0;
begin
  for r in
    select route_code, queued_at from route_lines_queue
     where processed_at is null
     order by queued_at
     limit greatest(1, p_max)
  loop
    perform refresh_route_street_lines(r.route_code);
    update route_lines_queue set processed_at = now()
     where route_code = r.route_code and queued_at = r.queued_at;
    n := n + 1;
  end loop;
  return n;
end;
$function$;
revoke all on function public.route_lines_drain(integer) from public, anon, authenticated;

select cron.schedule('route-lines-drain', '* * * * *', 'select public.route_lines_drain()')
 where not exists (select 1 from cron.job where jobname = 'route-lines-drain');
