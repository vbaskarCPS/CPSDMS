-- MainstreetAI › density in small batches (4 blocks a call) so a big city's large blocks never run into the database's
-- 2-minute statement limit (Calgary's 40-block batches did, over and over). Additive only.
create or replace function public.ms_city_jobs_drain()
returns void language plpgsql security definer set search_path = public as $$
declare j ms_city_jobs; t0 timestamptz := clock_timestamp(); v_left int;
begin
  select * into j from ms_city_jobs where stage in ('blocks', 'density', 'adjacency') order by updated_at limit 1 for update skip locked;
  if j.city_id is null then return; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', j.requested_by, 'role', 'authenticated')::text, true);
  begin
    if j.stage = 'blocks' then
      perform ms_city_make_blocks(j.city_id);
      j.stage := 'density';
      update ms_cities set build_note = 'Scoring density' where id = j.city_id;
    end if;
    if j.stage = 'density' then
      loop
        v_left := ms_city_density_step(j.city_id, 4);
        exit when v_left = 0 or clock_timestamp() - t0 > interval '40 seconds';
      end loop;
      if v_left = 0 then j.stage := 'adjacency'; update ms_cities set build_note = 'Joining blocks' where id = j.city_id; end if;
    end if;
    if j.stage = 'adjacency' and clock_timestamp() - t0 < interval '40 seconds' then
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
