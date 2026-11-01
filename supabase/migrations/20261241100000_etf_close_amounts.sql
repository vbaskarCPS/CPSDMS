-- The e-transfer is often not the recorded amount (tax, rounding, a tip, part now and the rest later).
-- Candidates for a receipt now include sales within $30 or 15% of what was sent, flagged close_amount,
-- so the matcher (supabase/functions/_shared/etfMatch.ts) can suggest them and say how far off they are.
create or replace function public.etf_candidates(p_amount numeric, p_on date, p_name text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'day' desc), '[]'::jsonb) from (
    select jsonb_build_object('key', s.sale_key, 'day', s.day, 'center', s.center, 'client', s.client, 'address', s.address,
             'route_code', s.route_code, 'amount', s.amount, 'cart', s.cart,
             'same_amount', abs(s.amount - coalesce(p_amount, -1)) < 0.005,
             'close_amount', p_amount is not null and abs(s.amount - p_amount) >= 0.005 and abs(s.amount - p_amount) <= greatest(30, s.amount * 0.15),
             'suggested', exists (select 1 from etf_matches m where m.sale_key = s.sale_key and m.active)) x
    from etf_sales(null, coalesce(p_on, current_date) - 21, coalesce(p_on, current_date) + 2) s
    where not exists (select 1 from etf_matches m where m.sale_key = s.sale_key and m.active and m.confirmed)
      and (abs(s.amount - coalesce(p_amount, -1)) < 0.005
           or (p_amount is not null and abs(s.amount - p_amount) <= greatest(30, s.amount * 0.15))
           or (coalesce(p_name, '') <> '' and exists (
                 select 1 from regexp_split_to_table(lower(p_name), '[^a-z]+') w
                 where length(w) >= 3 and lower(coalesce(s.client, '')) ~ ('\m' || w || '\M'))))
    limit 60) q
$$;
