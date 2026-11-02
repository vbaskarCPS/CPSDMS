-- MainstreetAI › building a city in the background. The app loads the boundary, streets and commercial land
-- (OpenStreetMap, in the browser), then queues the heavy part: cutting the blocks, scoring their density and
-- finding which blocks touch. A big city takes longer than the app's 8-second limit per call, so a job runs it
-- every minute (as the admin who asked) and the app shows its progress until the city is ready.
-- Additive only.

create table if not exists public.ms_city_jobs (
  city_id uuid primary key references public.ms_cities(id),
  requested_by uuid not null references public.app_users(id),
  stage text not null default 'blocks' check (stage in ('blocks', 'density', 'adjacency', 'done', 'failed')),
  note text,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ms_city_jobs enable row level security;

-- the admin queues the rest of the build
create or replace function public.ms_city_queue_build(p_city uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from ms_cities where id = p_city and geom is not null) then raise exception 'Load the boundary first'; end if;
  insert into ms_city_jobs (city_id, requested_by, stage, note) values (p_city, auth.uid(), 'blocks', null)
  on conflict (city_id) do update set requested_by = excluded.requested_by, stage = 'blocks', note = null, requested_at = now(), updated_at = now();
  update ms_cities set status = 'building', build_note = 'Cutting blocks' where id = p_city;
  return ms_city_job(p_city);
end $$;

-- where it's at
create or replace function public.ms_city_job(p_city uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  return (select jsonb_build_object('stage', j.stage, 'note', j.note, 'requested_at', j.requested_at, 'updated_at', j.updated_at,
            'blocks', (select count(*) from ms_blocks where city_id = p_city),
            'scored', (select count(*) from ms_blocks where city_id = p_city and density is not null))
            from ms_city_jobs j where j.city_id = p_city);
end $$;

-- every minute: one city at a time, about 45 seconds of work
create or replace function public.ms_city_jobs_drain()
returns void language plpgsql security definer set search_path = public as $$
declare j ms_city_jobs; t0 timestamptz := clock_timestamp(); v_left int;
begin
  select * into j from ms_city_jobs where stage in ('blocks', 'density', 'adjacency') order by updated_at limit 1 for update skip locked;
  if j.city_id is null then return; end if;
  -- the work runs as the admin who asked
  perform set_config('request.jwt.claims', jsonb_build_object('sub', j.requested_by, 'role', 'authenticated')::text, true);
  begin
    if j.stage = 'blocks' then
      perform ms_city_make_blocks(j.city_id);
      j.stage := 'density';
      update ms_cities set build_note = 'Scoring density' where id = j.city_id;
    end if;
    if j.stage = 'density' then
      loop
        v_left := ms_city_density_step(j.city_id, 40);
        exit when v_left = 0 or clock_timestamp() - t0 > interval '45 seconds';
      end loop;
      if v_left = 0 then j.stage := 'adjacency'; update ms_cities set build_note = 'Joining blocks' where id = j.city_id; end if;
    end if;
    if j.stage = 'adjacency' and clock_timestamp() - t0 < interval '45 seconds' then
      perform ms_city_make_adjacency(j.city_id);
      j.stage := 'done';
      update ms_cities set status = 'built', built_at = now(), build_note = null where id = j.city_id;
    end if;
    update ms_city_jobs set stage = j.stage, note = null, updated_at = now() where city_id = j.city_id;
  exception when others then
    update ms_city_jobs set stage = 'failed', note = sqlerrm, updated_at = now() where city_id = j.city_id;
    update ms_cities set status = 'failed', build_note = sqlerrm where id = j.city_id;
  end;
end $$;

revoke all on function public.ms_city_jobs_drain() from public, anon, authenticated;
revoke all on function public.ms_city_queue_build(uuid), public.ms_city_job(uuid) from public, anon;
grant execute on function public.ms_city_queue_build(uuid), public.ms_city_job(uuid) to authenticated;

select cron.schedule('ms-city-jobs', '* * * * *', 'select public.ms_city_jobs_drain()');
