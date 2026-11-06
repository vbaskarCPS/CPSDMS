-- MainstreetAI › generate and accept a city's zones from the server (the same steps as Zones › Generate), a few
-- seconds of work per call: call again with the returned run until it says accepted. Service role only. Additive only.
create or replace function public.ms_zone_autorun(p_city uuid, p_campaign uuid, p_target int, p_admin uuid, p_run uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_run uuid := p_run; s jsonb; t0 timestamptz := clock_timestamp(); n int;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_admin, 'role', 'authenticated')::text, true);
  if v_run is null then v_run := ms_generate_zones(p_city, p_campaign, p_target); end if;
  loop
    s := ms_run_step(v_run);
    exit when s->>'stage' = 'ready' or clock_timestamp() - t0 > interval '40 seconds';
  end loop;
  if s->>'stage' <> 'ready' then return jsonb_build_object('run', v_run, 'stage', s->>'stage'); end if;
  n := ms_run_accept(v_run);
  return jsonb_build_object('run', v_run, 'stage', 'accepted', 'zones', n);
end $$;
revoke all on function public.ms_zone_autorun(uuid, uuid, int, uuid, uuid) from public, anon, authenticated;
