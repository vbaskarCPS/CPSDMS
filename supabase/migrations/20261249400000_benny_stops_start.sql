-- The Benny's drop / pickup / check orders start "from where the manager is". A reported position nowhere near the
-- carts is not where the drive starts: it happened when someone opened a manager's map from another city (that device
-- wrote its own GPS as the manager's; the app no longer does that). Such a start gave an order of "2534 min of
-- driving". Now a start more than 80 km from the nearest stop is left out, the order starts at its first stop, and
-- the check says so (start_far) so the card can.
-- Additive only: patches benny_plan_stops in place.

do $patch$
declare src text := pg_get_functiondef('public.benny_plan_stops(uuid,text,text,text[])'::regprocedure); was text;
begin
  was := src;
  src := replace(src, $a$n_carts int := 0; v_first text;
begin$a$, $a$n_carts int := 0; v_first text;
        v_far boolean := false;
begin$a$);
  if src = was then raise exception 'benny_plan_stops: declare block not found'; end if;
  was := src;
  src := replace(src, $a$  ord := benny_order(v_lat, v_lng, slat, slng);
  plat := slat; plng := slng;$a$, $a$  -- a position nowhere near the carts isn't where the drive starts (the map opened from another city): leave it out
  if slat is not null and (select min(benny_km(slat, slng, v_lat[k], v_lng[k])) from generate_subscripts(v_lat, 1) k) > 80 then
    slat := null; slng := null; v_far := true; end if;
  ord := benny_order(v_lat, v_lng, slat, slng);
  plat := slat; plng := slng;$a$);
  if src = was then raise exception 'benny_plan_stops: start not found'; end if;
  was := src;
  src := replace(src, $a$    'start', case when slat is not null then jsonb_build_object('lat', slat, 'lng', slng) end,
    'stops', v_stops,$a$, $a$    'start', case when slat is not null then jsonb_build_object('lat', slat, 'lng', slng) end, 'start_far', nullif(v_far, false),
    'stops', v_stops,$a$);
  if src = was then raise exception 'benny_plan_stops: result not found'; end if;
  execute src;
end $patch$;
