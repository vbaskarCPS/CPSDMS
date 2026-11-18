-- Nightly report: each location's top 3 workers (by their sales on the payout) and the bonuses paid
-- (payout_lines.daily_bonus: cart bonuses already split per worker), with who got them.
create or replace function public.report_nightly_data(p_day date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'day', p_day,
    'centers', coalesce(jsonb_agg(x.c order by x.c->>'name'), '[]'::jsonb))
  from (
    select jsonb_build_object(
      'id', cc.id,
      'name', cc.display_name,
      'region', cc.region,
      'state', d.state,
      'closed_at', d.closed_at,
      'booked', (select count(*) from day_roster r where r.day_id = d.id),
      'showed', (select count(*) from day_roster r where r.day_id = d.id and r.attendance = 'showed'),
      'no_shows', (select count(*) from day_roster r where r.day_id = d.id and r.attendance = 'no_show'),
      'gross', coalesce(s.gross, 0),
      'new_sales', coalesce(s.new_sales, 0),
      'prepaid_work', coalesce(s.prepaid_work, 0),
      'jobs', coalesce(s.jobs, 0),
      'addons', coalesce(s.addons, 0),
      'payments', coalesce((
        select jsonb_object_agg(p.method, p.amount order by p.method)
          from (select sp.method, sum(sp.amount) as amount
                  from payout_sales ps cross join lateral report_sale_payments(ps.price, ps.payment_type, ps.payments) sp
                 where ps.center_id = d.center_id and ps.day = d.day
                 group by sp.method) p), '{}'::jsonb),
      'workers', coalesce(l.workers, 0),
      'payout', coalesce(l.payout, 0),
      'bonuses', coalesce(l.bonuses, 0),
      'top', coalesce((
        select jsonb_agg(jsonb_build_object('name', t.name, 'gross', t.gross, 'jobs', t.jobs, 'payout', t.payout, 'bonus', t.bonus)
                         order by t.gross desc, t.jobs desc, t.name)
          from (select coalesce(nullif(trim(concat_ws(' ', pl.first_name, pl.last_name)), ''), pl.cn, 'Worker') as name,
                       coalesce(pl.indiv_gross, 0) as gross, coalesce(pl.steps, 0) as jobs,
                       coalesce(pl.total_payout, 0) as payout, coalesce(pl.daily_bonus, 0) as bonus
                  from payout_lines pl
                 where pl.center_id = d.center_id and pl.day = d.day and coalesce(pl.indiv_gross, 0) > 0
                 order by pl.indiv_gross desc, pl.steps desc nulls last, 1
                 limit 3) t), '[]'::jsonb),
      'bonus_list', coalesce((
        select jsonb_agg(jsonb_build_object('name', b.name, 'amount', b.amount) order by b.amount desc, b.name)
          from (select coalesce(nullif(trim(concat_ws(' ', pl.first_name, pl.last_name)), ''), pl.cn, 'Worker') as name,
                       pl.daily_bonus as amount
                  from payout_lines pl
                 where pl.center_id = d.center_id and pl.day = d.day and coalesce(pl.daily_bonus, 0) <> 0) b), '[]'::jsonb),
      'managers', coalesce((
        select jsonb_agg(jsonb_build_object('name', m.manager, 'workers', m.workers, 'gross', m.gross, 'payout', m.payout)
                         order by m.gross desc, m.manager)
          from (select coalesce(nullif(trim(pl.manager), ''), 'No manager') as manager, count(*) as workers,
                       coalesce(sum(pl.indiv_gross), 0) as gross, coalesce(sum(pl.total_payout), 0) as payout
                  from payout_lines pl
                 where pl.center_id = d.center_id and pl.day = d.day
                 group by 1) m), '[]'::jsonb),
      'month', (
        select jsonb_build_object('days', count(distinct ps.day), 'gross', coalesce(sum(ps.price), 0),
                                  'jobs', count(*) filter (where ps.type in ('Sale', 'Production', 'Upgrade')))
          from payout_sales ps
          join days d2 on d2.center_id = ps.center_id and d2.day = ps.day
         where ps.center_id = d.center_id
           and ps.day between date_trunc('month', p_day)::date and p_day
           and (d2.state = 'closed' or d2.day = p_day))
    ) as c
    from days d
    join command_centers cc on cc.id = d.center_id
    left join lateral (
      select sum(ps.price) as gross,
             sum(ps.price) filter (where ps.type is distinct from 'Production') as new_sales,
             sum(ps.price) filter (where ps.type = 'Production') as prepaid_work,
             count(*) filter (where ps.type in ('Sale', 'Production', 'Upgrade')) as jobs,
             count(*) filter (where ps.type = 'Add-On') as addons
        from payout_sales ps where ps.center_id = d.center_id and ps.day = d.day
    ) s on true
    left join lateral (
      select count(*) as workers, sum(pl.total_payout) as payout, sum(pl.daily_bonus) as bonuses
        from payout_lines pl where pl.center_id = d.center_id and pl.day = d.day
    ) l on true
    where d.day = p_day and d.state in ('live', 'closed') and not coalesce(cc.is_demo, false)
  ) x
$$;
revoke all on function public.report_nightly_data(date) from public, anon, authenticated;
