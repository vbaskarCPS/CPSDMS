-- A cart with no jobs has no cash and no cheque to count either, so it is lined up with the other payouts that have
-- nothing to count by hand (it was left out and only named). The carts with jobs come first, the carts with none after.
-- As before nothing here pays anyone: each payout is finalized by hand on the payout screen, which shows the pay
-- (machine rental included) before Finalize is pressed.
-- Additive only: the two functions are replaced in place.

create or replace function public.benny_payouts(p_center uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_date date; v_carts jsonb;
begin
  perform benny_ok(p_center);
  v_date := benny_live_date(p_center);
  if v_date is null then return jsonb_build_object('live', false, 'problems', jsonb_build_array('No day is live, so there are no payouts yet.')); end if;
  select coalesce(jsonb_agg(z.x order by z.x->'workers'->>0), '[]'::jsonb) into v_carts from (
    select jsonb_strip_nulls(jsonb_build_object(
             'cart_id', l.id, 'cn', l.worker_id,
             'workers', (select jsonb_agg(u.name order by u.name) from users u where u.command_center_id = p_center and u.user_id = any (w.cns)),
             'manager', (select m.name from users m where m.command_center_id = p_center
                          and m.user_id = (select u.metadata->>'assignedManagerId' from users u where u.user_id = l.worker_id and u.command_center_id = p_center) limit 1),
             'paid_out', s.paid,
             -- what the payout screen saved as the cart's final pay when it was closed
             'pay', case when s.paid and (l.validation->>'finalCommission') ~ '^-?[0-9]+(\.[0-9]+)?$' then round((l.validation->>'finalCommission')::numeric, 2) end,
             'jobs', (k.c->>'jobs')::int, 'steps', (k.c->>'steps')::numeric, 'gross', (k.c->>'gross')::numeric, 'upsell_gross', (k.c->>'upsell_gross')::numeric,
             'collected', k.c->'collected',
             'to_count', case when (k.c->'collected'->>'cash')::numeric > 0 or (k.c->'collected'->>'cheque')::numeric > 0 then true end)) x
      from logsheet_sessions l
      cross join lateral (select coalesce(nullif(l.team_worker_ids, '{}'), array[l.worker_id]) cns) w
      cross join lateral (select upper(coalesce(l.status, 'OPEN')) = 'PAID' paid) s
      cross join lateral (select benny_cart_counts(p_center, l.id, w.cns) c) k
     where l.date = v_date and l.command_center_id = p_center) z;
  return jsonb_build_object('live', true, 'date', v_date, 'carts', v_carts,
    'summary', (select jsonb_build_object(
        'paid_out', count(*) filter (where (x->>'paid_out')::boolean),
        'open', count(*) filter (where not (x->>'paid_out')::boolean),
        'open_nothing_to_count', count(*) filter (where not (x->>'paid_out')::boolean and not coalesce((x->>'to_count')::boolean, false)),
        'open_cash_or_cheque', count(*) filter (where not (x->>'paid_out')::boolean and coalesce((x->>'to_count')::boolean, false)),
        'open_no_jobs', count(*) filter (where not (x->>'paid_out')::boolean and (x->>'jobs')::int = 0))
      from jsonb_array_elements(v_carts) x));
end $$;

-- The open payouts with nothing to count by hand, in the order to go through them: the carts with jobs first, then
-- the carts with none. Changes nothing.
create or replace function public.benny_check_payouts(p_center uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare p jsonb := benny_payouts(p_center); v_ready jsonb; v_count jsonb; n_paid int; v_probs text[] := '{}';
        fmt constant text := 'FM999999990.00';
begin
  if not coalesce((p->>'live')::boolean, false) then return jsonb_build_object('ok', false, 'problems', p->'problems'); end if;
  select coalesce(jsonb_agg(x - 'paid_out' - 'manager' - 'steps' order by ((x->>'jobs')::int = 0), x->'workers'->>0), '[]'::jsonb) into v_ready from jsonb_array_elements(p->'carts') x
   where not (x->>'paid_out')::boolean and not coalesce((x->>'to_count')::boolean, false);
  select coalesce(jsonb_agg(jsonb_build_object('workers', x->'workers', 'cash', x->'collected'->'cash', 'cheque', x->'collected'->'cheque') order by x->'workers'->>0), '[]'::jsonb) into v_count
    from jsonb_array_elements(p->'carts') x where not (x->>'paid_out')::boolean and coalesce((x->>'to_count')::boolean, false);
  n_paid := (p->'summary'->>'paid_out')::int;
  if jsonb_array_length(v_ready) = 0 then
    v_probs := v_probs || (case when jsonb_array_length(p->'carts') = 0 then 'There are no carts on today’s map yet.'
      else 'No open payout is free of cash and cheque'
        || case when n_paid > 0 then ': ' || n_paid || case when n_paid = 1 then ' is' else ' are' end || ' already paid out' else '' end
        || case when jsonb_array_length(v_count) > 0 then (case when n_paid > 0 then ', ' else ': ' end) || (select string_agg(
              (select string_agg(split_part(nm, ' ', 1), ' + ') from jsonb_array_elements_text(c->'workers') nm) || ' has '
              || concat_ws(' and ', case when (c->>'cash')::numeric > 0 then '$' || to_char((c->>'cash')::numeric, fmt) || ' cash' end,
                                    case when (c->>'cheque')::numeric > 0 then '$' || to_char((c->>'cheque')::numeric, fmt) || ' in cheques' end) || ' to count', '; ')
              from jsonb_array_elements(v_count) c) else '' end
        || '.' end);
  end if;
  return jsonb_strip_nulls(jsonb_build_object('ok', cardinality(v_probs) = 0, 'problems', to_jsonb(v_probs), 'date', p->'date',
    'carts', v_ready, 'to_count', nullif(v_count, '[]'::jsonb), 'paid_out', n_paid));
end $$;
