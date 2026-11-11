-- The Benny's live numbers are counted from the jobs on each logsheet, not read from the logsheet's saved totals.
--
-- logsheet_sessions.stats is only worked out again on some saves (a worker completing a job, an edit) and at payout.
-- A sale added in between is on the logsheet but not in the saved totals, so the Benny said 9 steps and $1,660 gross
-- on a day the map's own header (which counts the jobs every time) said 11 steps and $2,232. Steps, gross, upsells and
-- what was collected by payment type are plain sums over the jobs, so they are now counted here, the way the map's
-- header counts them (sessionService.recalculateStats). Equiv is pay arithmetic (tax, prepaid and billed weights, the
-- product cost %) and stays the app's to work out: it is still read as last saved, and marked when it is behind.
-- Additive only.

-- One cart's counts, from the jobs on its logsheet. Names its columns: no phone, email or card detail.
create or replace function public.benny_cart_counts(p_center uuid, p_cart text, p_cns text[])
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with tx as (
    select t.id, t.type, coalesce(t.price, 0) price, coalesce(t.payment_method, '') method,
           case when jsonb_typeof(t.payment_breakdown) = 'object' then t.payment_breakdown end parts,
           (t.type = 'Production' and coalesce(t.display_price, '') ~ '^[A-Za-z]') flat,
           case when jsonb_typeof(t.asphalt_meta) = 'object' then t.asphalt_meta end am
      from transactions t
     where t.command_center_id = p_center and (t.session_id = p_cart or (t.session_id is null and t.worker_id = any (p_cns)))),
  -- each payment part of each job: its breakdown when it has one, else the whole amount under its payment type
  part as (
    select tx.type, tx.flat, p.method, p.val, p.method ~ '(Prepaid|Billed|Cash|Cheque|E-Transfer|Credit Card)' known
      from tx cross join lateral (
        select e.key method, case when (e.value #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then (e.value #>> '{}')::numeric else 0 end val
          from jsonb_each(coalesce(tx.parts, '{}'::jsonb)) e where tx.parts is not null
        union all
        select tx.method, tx.price where tx.parts is null) p
     where p.method <> 'IOS'),
  n as (
    select count(*) jobs,
           coalesce(sum(case when am is not null then
                             case am->>'role' when 'driveway-seller' then 1
                                              when 'asphalt-executor' then case when coalesce((am->>'did_upsell')::boolean, false) then 1 else 0 end
                                              when 'self-both' then (case when coalesce((am->>'driveway_amount')::numeric, 0) > 0 then 1 else 0 end)
                                                                  + (case when coalesce((am->>'asphalt_amount')::numeric, 0) > 0 then 1 else 0 end)
                                              else 0 end
                             when type in ('Production', 'Sale', 'Upgrade') then 1 else 0 end), 0) steps,
           count(*) filter (where type in ('Upgrade', 'Add-On')) upsells
      from tx),
  m as (
    select coalesce(sum(case when type in ('Production', 'Sale') and (flat or known) then val when type = 'Upgrade' and known then val * 0.2 else 0 end), 0) gross,
           coalesce(sum(case when type = 'Add-On' and known then val when type = 'Upgrade' and known then val * 0.8 else 0 end), 0) upsell_gross,
           coalesce(sum(val) filter (where flat), 0) flats,
           coalesce(sum(val) filter (where method like '%Cash%'), 0) cash, coalesce(sum(val) filter (where method like '%Cheque%'), 0) cheque,
           coalesce(sum(val) filter (where method like '%E-Transfer%'), 0) e_transfer, coalesce(sum(val) filter (where method like '%Credit Card%'), 0) card,
           coalesce(sum(val) filter (where method like '%Prepaid%'), 0) prepaid, coalesce(sum(val) filter (where method like '%Billed%'), 0) billed
      from part)
  select jsonb_build_object('jobs', n.jobs, 'steps', n.steps, 'upsells', n.upsells, 'gross', round(m.gross, 2), 'upsell_gross', round(m.upsell_gross, 2), 'flats', round(m.flats, 2),
           'collected', jsonb_build_object('cash', round(m.cash, 2), 'cheque', round(m.cheque, 2), 'e_transfer', round(m.e_transfer, 2), 'card', round(m.card, 2),
                                           'prepaid', round(m.prepaid, 2), 'billed', round(m.billed, 2)))
    from n, m
$$;
revoke all on function public.benny_cart_counts(uuid, text, text[]) from public, anon, authenticated;

-- Today's live map for a manager's team (or the floater's followed teams): carts and totals counted from the jobs.
create or replace function public.benny_live(p_center uuid, p_manager text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_date date := benny_live_date(p_center); v_mine text[] := benny_my_rm_ids(p_center); v_mgrs text[]; v_reach text[] := benny_my_reach(p_center); v_prob text;
        v_carts jsonb; v_behind int;
begin
  if v_date is null then return jsonb_build_object('live', false); end if;
  if p_manager like 'floater\_%' then
    select t.team, t.problem into v_mgrs, v_prob from benny_pin_manager(p_center, p_manager) t;
    if v_prob is not null then raise exception '%', v_prob using errcode = '42501'; end if;
  else
    v_mgrs := case when p_manager is not null then array[p_manager] else v_mine end;
    if v_reach is not null and p_manager is not null and not (p_manager = any (v_reach)) then raise exception 'That isn’t your team' using errcode = '42501'; end if;
  end if;

  select coalesce(jsonb_agg(z.x order by z.x->>'manager', z.x->>'workers'), '[]'::jsonb) into v_carts from (
    select jsonb_strip_nulls(jsonb_build_object('cart_id', l.id,
             'steps', (k.c->>'steps')::numeric, 'equiv', round(coalesce((l.stats->>'totalEQ')::numeric, 0), 2),
             'gross', (k.c->>'gross')::numeric, 'upsells', (k.c->>'upsells')::numeric, 'upsell_gross', (k.c->>'upsell_gross')::numeric,
             -- the saved equiv was worked out before the last job went on
             'equiv_behind', case when coalesce((l.stats->>'stepCount')::numeric, 0) <> (k.c->>'steps')::numeric
                                    or abs(coalesce((l.stats->>'prodGross')::numeric, 0) - (k.c->>'gross')::numeric) > 0.01 then true end,
             'logsheet', l.status, 'manager', g.mgr,
             'workers', (select jsonb_agg(jsonb_build_object('cn', u.user_id, 'name', u.name) order by u.name) from users u
                          where u.command_center_id = p_center and u.user_id = any (w.cns)),
             'routes', (select jsonb_agg(rt.route_code order by rt.route_code) from routes rt where rt.session_date = v_date and rt.command_center_id = p_center
                          and rt.assigned_worker_ids && w.cns))) x
      from logsheet_sessions l
      cross join lateral (select coalesce(nullif(l.team_worker_ids, '{}'), array[l.worker_id]) cns) w
      cross join lateral (select (select u.metadata->>'assignedManagerId' from users u where u.user_id = l.worker_id and u.command_center_id = p_center) mgr) g
      cross join lateral (select benny_cart_counts(p_center, l.id, w.cns) c) k
     where l.date = v_date and l.command_center_id = p_center and (v_mgrs is null or g.mgr = any (v_mgrs))) z;
  select count(*) into v_behind from jsonb_array_elements(v_carts) x where coalesce((x->>'equiv_behind')::boolean, false);

  return jsonb_strip_nulls(jsonb_build_object(
    'live', true, 'date', v_date,
    'totals', (select jsonb_build_object('carts', count(*), 'steps', coalesce(sum((x->>'steps')::numeric), 0),
                        'equiv', round(coalesce(sum((x->>'equiv')::numeric), 0), 2), 'gross', round(coalesce(sum((x->>'gross')::numeric), 0), 2),
                        'upsells', coalesce(sum((x->>'upsells')::numeric), 0), 'upsell_gross', round(coalesce(sum((x->>'upsell_gross')::numeric), 0), 2))
                 from jsonb_array_elements(v_carts) x),
    'equiv_note', case when v_behind > 0 then 'Steps, gross and upsells are counted from the jobs logged. Equiv is as the app last worked it out: for ' || v_behind
                    || case when v_behind = 1 then ' cart' else ' carts' end || ' (equiv_behind) it doesn’t include every job yet. It is worked out again when a job on the logsheet is saved, and at payout.' end,
    'managers', (select jsonb_agg(jsonb_build_object('id', u.user_id, 'name', u.name) order by u.name) from users u where u.command_center_id = p_center and u.role = 'RouteManager'),
    'carts', nullif(v_carts, '[]'::jsonb),
    'routes', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('route', rt.route_code, 'manager', rt.manager_id,
                    'workers', (select jsonb_agg(u.name) from users u where u.command_center_id = p_center and u.user_id = any (rt.assigned_worker_ids)),
                    'split', exists (select 1 from route_splits s where s.route_code = rt.route_code and s.session_date = v_date and s.command_center_id = p_center::text)))
                  order by rt.route_code)
                 from routes rt where rt.session_date = v_date and rt.command_center_id = p_center and (v_mgrs is null or rt.manager_id = any (v_mgrs)))));
end $$;

-- One worker's logsheet: the totals are counted from its jobs too.
create or replace function public.benny_live_jobs(p_center uuid, p_worker text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_role text := benny_ok_any(p_center); c record; k jsonb; v_behind boolean;
begin
  select * into c from benny_job_cart(p_center, p_worker);
  if c.problem is not null then return jsonb_strip_nulls(jsonb_build_object('ok', false, 'problems', jsonb_build_array(c.problem), 'worker', c.worker)); end if;
  k := benny_cart_counts(p_center, c.cart_id, c.cns);
  v_behind := coalesce((c.stats->>'stepCount')::numeric, 0) <> (k->>'steps')::numeric or abs(coalesce((c.stats->>'prodGross')::numeric, 0) - (k->>'gross')::numeric) > 0.01;
  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true, 'date', c.day, 'worker', c.worker,
    'cart', jsonb_build_object('id', c.cart_id, 'workers', to_jsonb(c.names), 'paid_out', c.status = 'PAID',
      'totals', (k - 'jobs') || jsonb_build_object('equiv', round(coalesce((c.stats->>'totalEQ')::numeric, 0), 2)),
      'equiv_note', case when v_behind then 'Equiv is as the app last worked it out and doesn’t include every job on this logsheet yet. It is worked out again when a job on it is saved, and at payout. Steps, gross and what was collected are counted from the jobs.' end),
    'jobs', benny_cart_jobs(p_center, c.cart_id, c.cns)));
end $$;
