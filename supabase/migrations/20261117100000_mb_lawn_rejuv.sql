-- Master Bookings knows lawn rejuvenation (RUN_57). ADDITIVE ONLY.
--
-- Until now Master Bookings took only aeration and sealing ("Pick aeration or sealing"), so a lawn
-- rejuvenation centre opened on Sealing and its past clients never showed. Now:
--   - rounds and the default season can be Lawn Rejuv (constraints widened, inputs accepted)
--   - a client's flags gain 16 = rejuvenation before this season, 32 = rejuvenation this season,
--     so past and this-season rejuvenation clients show on the maps (levels 2 and 3 pick them up as
--     they already show every client with any flag)
--   - each map card counts prev / this-season rejuvenation clients
--   - the season picker offers this year's Lawn Rejuv for a centre that does it
-- Knocks aren't tagged by service; a map belongs to one centre, so a round on a rejuve centre's map
-- only ever clears rejuve knocks. Nothing else changes.

alter table public.mb_rounds drop constraint if exists mb_rounds_service_check;
alter table public.mb_rounds add constraint mb_rounds_service_check check (service in ('aeration', 'sealing', 'lawn_rejuv'));
alter table public.mb_settings drop constraint if exists mb_settings_default_service_check;
alter table public.mb_settings add constraint mb_settings_default_service_check check (default_service in ('aeration', 'sealing', 'lawn_rejuv'));

create or replace function public.mb_check_input(p_service text, p_season int)
returns void language plpgsql immutable set search_path = public as $$
begin
  if p_service is null or p_service not in ('aeration', 'sealing', 'lawn_rejuv') then raise exception 'Pick aeration, sealing or lawn rejuv'; end if;
  if p_season is null or p_season not between 2000 and 2100 then raise exception 'Pick a season'; end if;
end $$;

-- a past client's job flags for a season: 1 aeration before, 2 sealing before, 4 aeration this
-- season, 8 sealing this season, 16 rejuvenation before, 32 rejuvenation this season
create or replace function public.mb_client_flags(p_history jsonb, p_season int)
returns int language sql immutable set search_path = public as $$
  select coalesce(bit_or(case
           when h->>'line' = 'aeration' and (h->>'year')::int < p_season then 1
           when h->>'line' = 'sealing' and (h->>'year')::int < p_season then 2
           when h->>'line' = 'aeration' and (h->>'year')::int = p_season then 4
           when h->>'line' = 'sealing' and (h->>'year')::int = p_season then 8
           when h->>'line' = 'lawn_rejuv' and (h->>'year')::int < p_season then 16
           when h->>'line' = 'lawn_rejuv' and (h->>'year')::int = p_season then 32
           else 0 end), 0)
    from jsonb_array_elements(case when jsonb_typeof(p_history) = 'array' then p_history else '[]'::jsonb end) h
   where h->>'year' ~ '^\d{4}$'
$$;

-- settings save and level 1 overview: patched in place (only the lines named change)
do $$
declare src text;
begin
  src := pg_get_functiondef('public.app_mb_save_settings(uuid,text,int,int,int)'::regprocedure);
  if position('p_service not in (''aeration'', ''sealing'') then raise exception ''Pick aeration or sealing''' in src) = 0 then
    raise exception 'app_mb_save_settings is not the expected version';
  end if;
  src := replace(src, 'p_service not in (''aeration'', ''sealing'') then raise exception ''Pick aeration or sealing''',
                      'p_service not in (''aeration'', ''sealing'', ''lawn_rejuv'') then raise exception ''Pick aeration, sealing or lawn rejuv''');
  execute src;

  src := pg_get_functiondef('public.app_mb_overview(uuid,text,int,int)'::regprocedure);
  if position('count(*) filter (where f & 8 > 0)::int seal_now' in src) = 0
     or position('''done_aeration'', coalesce(v_prev.aer_now, 0), ''done_sealing'', coalesce(v_prev.seal_now, 0),' in src) = 0
     or position('sv in (''aeration'', ''sealing'')' in src) = 0 then
    raise exception 'app_mb_overview is not the expected version';
  end if;
  src := replace(src, 'count(*) filter (where f & 8 > 0)::int seal_now',
                      'count(*) filter (where f & 8 > 0)::int seal_now, count(*) filter (where f & 16 > 0)::int rejuv, count(*) filter (where f & 32 > 0)::int rejuv_now');
  src := replace(src, '''done_aeration'', coalesce(v_prev.aer_now, 0), ''done_sealing'', coalesce(v_prev.seal_now, 0),',
                      '''done_aeration'', coalesce(v_prev.aer_now, 0), ''done_sealing'', coalesce(v_prev.seal_now, 0),
      ''prev_rejuv'', coalesce(v_prev.rejuv, 0), ''done_rejuv'', coalesce(v_prev.rejuv_now, 0),');
  src := replace(src, 'sv in (''aeration'', ''sealing'')', 'sv in (''aeration'', ''sealing'', ''lawn_rejuv'')');
  execute src;
end $$;
