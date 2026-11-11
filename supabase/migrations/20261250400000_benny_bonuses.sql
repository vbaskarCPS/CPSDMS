-- The Benny can rank a day's carts for the daily bonus and prepare the bonuses for the person to confirm.
--
-- "Give the top two bonus equiv carts $50 each for first and second" had no tool: the Benny could read payouts but not
-- say who the top two are, and nothing added a bonus. Two things now:
--   * benny_bonus_rank: each paid-out cart with its equiv, its Bonus EQ (equiv ÷ the team-size factor, the payout
--     list's own "Bonus EQ" sort), whether it meets the bonus rule (the payout list's own rule, shown there in red), the
--     bonuses already on it, and the winners: the top carts AMONG THOSE THAT QUALIFY. That is how the bonuses have been
--     given at this center day after day; a cart that doesn't qualify is skipped, and named with the reason.
--   * benny_check_bonus: a check for one or more bonuses, which becomes one card. The Benny never saves it: the app
--     does, with the payout list's own save (the live day: the logsheet's bonuses and pay, as "Add bonus" does; a saved
--     day: the day's carts and pay lines worked out again, as a saved day's "Add bonus" does).
--
-- It adds money to pay, so it is narrow on purpose:
--   * super admins only;
--   * only a cart that is paid out (its equiv is final); a day on a paid payslip is refused;
--   * a place already given that day, or the same bonus twice, is refused;
--   * a cart that doesn't qualify, a place that doesn't match the ranking, a tie, and carts still open are said on the
--     card (the payout list doesn't enforce the rule either, so the person decides);
--   * every bonus is recorded: who, when, how much, what the cart read before and after (benny_bonus_changes).
-- Works for a day in two shapes: the live day (the old app's logsheets) and a saved day (closed, or handed off to a
-- newer day: payout_carts). No phone number, email or card detail is read: only whether a phone and an email are there.
-- Additive only.

create table if not exists public.benny_bonus_changes (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null,
  day date not null,
  source text not null check (source in ('live', 'saved')),
  cart_key text,                     -- live: logsheet_sessions.id; saved: payout_carts.id when the card was made
  cns text[] not null,               -- the cart's workers (a saved day's carts get new ids on every save)
  workers text,
  bonus jsonb not null,              -- { type, placing, amount, label, split }
  before jsonb not null,             -- { bonuses, pay } read here before the save
  after jsonb,                       -- the same, read here once the app had saved
  by_user uuid not null, by_name text,
  state text not null default 'started' check (state in ('started', 'done', 'not_saved')),
  started_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists benny_bonus_changes_day on public.benny_bonus_changes (center_id, day, started_at desc);
alter table public.benny_bonus_changes enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'benny_bonus_changes' and policyname = 'benny_bonus_changes_read') then
    create policy benny_bonus_changes_read on public.benny_bonus_changes for select to authenticated using (coalesce(app_is_super_admin(), false));
  end if;
end $p$;
revoke all on public.benny_bonus_changes from public, anon, authenticated;
grant select on public.benny_bonus_changes to authenticated;

-- 1st, 2nd, 3rd, 11th …
create or replace function public.benny_ordinal(n int)
returns text language sql immutable set search_path to 'public' as $$
  select n::text || case when n % 100 between 11 and 13 then 'th' else (array['th','st','nd','rd','th','th','th','th','th','th'])[n % 10 + 1] end
$$;

-- A bonus in words, the way the payout list writes it: "Performance EQ - 1st Place".
create or replace function public.benny_bonus_label(b jsonb)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when coalesce(nullif(b->>'type', ''), 'Other') = 'Other' then coalesce(nullif(b->>'customDescription', ''), nullif(b->>'label', ''), 'Other')
    when b->>'placing' = 'other' then (b->>'type') || ' - ' || coalesce(nullif(b->>'customDescription', ''), 'other')
    when (b->>'placing') ~ '^[0-9]{1,3}$' then (b->>'type') || ' - ' || benny_ordinal((b->>'placing')::int) || ' Place'
    else b->>'type' end
$$;

-- The service a day was worked in: the live day's own season, else the season its date falls in, else the center's.
create or replace function public.benny_day_service(p_center uuid, p_date date)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select nullif(d.season_type, '') from daily_sessions d where d.command_center_id = p_center and d.date = p_date and d.is_active limit 1),
    (select s.service from seasons s where s.center_id = p_center and s.starts_on <= p_date and s.ends_on >= p_date order by s.starts_on desc limit 1),
    (select c.services[1] from command_centers c where c.id = p_center))
$$;

-- A day's carts in one shape, whichever way the day is kept.
--   the live day  → the old app's logsheets: paid out = validated, equiv = the equiv it was paid out at
--   a saved day   → payout_carts: paid out = finalized, equiv = the equiv set at payout
-- old_money = prebooks (Production); new_money = sales (Sale, Upgrade, Add-On); details = how many of those sales'
-- phone and email were taken (2 a sale). Names its columns: nothing of the phone or email is read but whether it is there.
create or replace function public.benny_bonus_carts(p_center uuid, p_date date)
returns table (source text, cart_key text, cns text[], names text[], team_size int, paid boolean, equiv numeric,
               old_money int, new_money int, details int, jobs int, bonuses jsonb, pay numeric)
language sql stable security definer set search_path to 'public' as $$
  select 'live'::text, l.id, w.cns,
         (select array_agg(coalesce(u.name, x.cn) order by x.o) from unnest(w.cns) with ordinality x(cn, o)
            left join users u on u.command_center_id = p_center and u.user_id = x.cn),
         cardinality(w.cns), v.ok,
         case when v.ok and jsonb_typeof(l.validation->'actualTotalEQ') = 'number' then (l.validation->'actualTotalEQ')::numeric end,
         q.old_money, q.new_money, q.details, q.jobs,
         case when jsonb_typeof(l.bonuses) = 'array' then l.bonuses else '[]'::jsonb end,
         case when v.ok and jsonb_typeof(l.validation->'finalCommission') = 'number' then (l.validation->'finalCommission')::numeric end
    from logsheet_sessions l
    cross join lateral (select coalesce(nullif(array_remove(l.team_worker_ids, null), '{}'), array[l.worker_id]) cns) w
    cross join lateral (select coalesce(l.validation->>'isValidated', '') = 'true' ok) v
    cross join lateral (
      select (count(*) filter (where t.type = 'Production'))::int old_money,
             (count(*) filter (where t.type in ('Sale', 'Upgrade', 'Add-On')))::int new_money,
             coalesce(sum((case when coalesce(trim(t.customer_phone), '') <> '' then 1 else 0 end) + (case when coalesce(trim(t.customer_email), '') <> '' then 1 else 0 end))
                        filter (where t.type in ('Sale', 'Upgrade', 'Add-On')), 0)::int details,
             count(*)::int jobs
        from transactions t
       where t.command_center_id = p_center and (t.session_id = l.id or (t.session_id is null and t.worker_id = any (w.cns)))) q
   where l.command_center_id = p_center and l.date = p_date and benny_live_date(p_center) = p_date
     and coalesce(trim(w.cns[1]), '') not in ('', 'undefined', 'null')
  union all
  select 'saved'::text, c.id::text, m.cns, m.names, cardinality(m.cns), coalesce(c.finalized, true),
         case when coalesce(c.finalized, true) then coalesce(c.eq_override,
              (select sum(pl.equiv) from payout_lines pl where pl.center_id = p_center and pl.day = p_date and upper(pl.cn) = any (m.cns))) end,
         s.old_money, s.new_money, s.details, s.jobs,
         case when jsonb_typeof(c.bonuses) = 'array' then c.bonuses else '[]'::jsonb end,
         case when coalesce(c.finalized, true) then (select sum(pl.total_payout) from payout_lines pl where pl.center_id = p_center and pl.day = p_date and upper(pl.cn) = any (m.cns)) end
    from payout_carts c
    cross join lateral (
      select array_agg(upper(x->>'cn') order by o) cns,
             array_agg(trim(coalesce(x->>'first_name', '') || ' ' || coalesce(x->>'last_name', '')) order by o) names
        from jsonb_array_elements(case when jsonb_typeof(c.members) = 'array' then c.members else '[]'::jsonb end) with ordinality t(x, o)) m
    cross join lateral (
      select (count(*) filter (where ps.type = 'Production'))::int old_money,
             (count(*) filter (where ps.type in ('Sale', 'Upgrade', 'Add-On')))::int new_money,
             coalesce(sum(least(case when (ps.meta->>'details') ~ '^[0-9]+$' then (ps.meta->>'details')::int else 0 end, 2))
                        filter (where ps.type in ('Sale', 'Upgrade', 'Add-On')), 0)::int details,
             count(*)::int jobs
        from payout_sales ps where ps.cart_id = c.id) s
   where c.center_id = p_center and c.day = p_date and benny_live_date(p_center) is distinct from p_date and m.cns is not null
$$;

-- The day's carts ranked for the bonus, as JSON. Bonus EQ = equiv ÷ (1 + ½ for each extra worker on the cart), the
-- payout list's "Bonus EQ" sort. The bonus rule (the payout list's checkBonusQualification, team seasons): at least as
-- many sales as prebooks, and a phone and an email on at least 80% of what the sales could have.
--   rank  = place by Bonus EQ among the paid-out carts;  place = place among those of them that qualify
create or replace function public.benny_bonus_table(p_center uuid, p_date date)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with c as (
    select b.*, case when b.paid and b.equiv is not null then b.equiv / (1 + (greatest(b.team_size, 1) - 1) * 0.5) end beq,
           (b.new_money > 0 and b.new_money >= b.old_money and b.details >= b.new_money * 2 * 0.8) qual
      from benny_bonus_carts(p_center, p_date) b),
  r as (select c.*, case when c.beq is not null then row_number() over (partition by (c.beq is not null) order by c.beq desc nulls last, c.names[1], c.cart_key) end rk from c),
  q as (select r.*, case when r.beq is not null and r.qual then row_number() over (partition by (r.beq is not null and r.qual) order by r.beq desc nulls last, r.names[1], r.cart_key) end place from r)
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'key', q.cart_key, 'source', q.source, 'workers', to_jsonb(q.names), 'cns', to_jsonb(q.cns), 'team_size', q.team_size, 'paid_out', q.paid,
      'equiv', round(q.equiv, 2), 'bonus_eq', round(q.beq, 2), 'rank', q.rk, 'qualifies', q.qual, 'place', q.place,
      'tie', case when q.place is not null and exists (select 1 from q o where o.place is not null and o.cart_key <> q.cart_key and abs(o.beq - q.beq) < 0.005) then true end,
      'why_not', case when not q.qual then concat_ws('; ',
          case when q.new_money = 0 then 'no sales'
               when q.new_money < q.old_money then q.new_money || case when q.new_money = 1 then ' sale' else ' sales' end || ' to ' || q.old_money || ' prebooks (needs at least as many sales as prebooks)' end,
          case when q.new_money > 0 and q.details < q.new_money * 2 * 0.8 then 'a phone and an email on ' || q.details || ' of ' || q.new_money * 2 || ' (needs 80%)' end) end,
      'sales', q.new_money, 'prebooks', q.old_money, 'details', q.details || ' of ' || q.new_money * 2, 'jobs', q.jobs, 'pay', round(q.pay, 2),
      'bonuses', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('label', benny_bonus_label(x), 'type', x->>'type', 'placing', x->'placing',
                           'amount', case when (x->>'amount') ~ '^-?[0-9]+(\.[0-9]+)?$' then (x->>'amount')::numeric end)))
                    from jsonb_array_elements(q.bonuses) x)
    )) order by q.rk nulls last, q.names[1]), '[]'::jsonb)
    from q
$$;

-- Which day is meant, and how it is kept: the date given, else the live day, else the latest saved day.
create or replace function public.benny_bonus_day(p_center uuid, p_date date, out day date, out source text, out service text, out locked boolean, out problem text)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_live date := benny_live_date(p_center);
begin
  day := coalesce(p_date, v_live, (select max(c.day) from payout_carts c where c.center_id = p_center));
  if day is null then problem := 'No day has payouts yet at this center.'; return; end if;
  source := case when day = v_live then 'live' else 'saved' end;
  if not exists (select 1 from benny_bonus_carts(p_center, day)) then
    problem := 'There are no payouts for ' || day || ' at this center' || case when v_live is not null and v_live <> day then ' (the live day is ' || v_live || ').' else '.' end; return; end if;
  service := benny_day_service(p_center, day);
  if coalesce(service, '') not in ('lawn_rejuv', 'sealing', 'cleaning') then
    problem := 'The Bonus EQ ranking is for the team seasons (lawn rejuv, sealing, cleaning). In ' || coalesce(service, 'this season') || ', add bonuses on the day’s payout list.'; return; end if;
  locked := exists (select 1 from payout_lines l join payslips s on s.id = l.payslip_id where l.center_id = p_center and l.day = benny_bonus_day.day and s.status = 'paid');
end $$;

-- The ranking, for the Benny to read out: who is on top, who qualifies, who was skipped and why, what is already given.
create or replace function public.benny_bonus_rank(p_center uuid, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare d record; t jsonb; v_open jsonb; v_notes text[] := '{}'; v_ties text;
begin
  perform benny_ok(p_center);
  select * into d from benny_bonus_day(p_center, p_date);
  if d.problem is not null then return jsonb_strip_nulls(jsonb_build_object('ok', false, 'date', d.day, 'problems', jsonb_build_array(d.problem))); end if;
  t := benny_bonus_table(p_center, d.day);
  select jsonb_agg(jsonb_build_object('workers', e->'workers', 'jobs', e->'jobs') order by e->'workers'->>0) into v_open
    from jsonb_array_elements(t) e where not (e->>'paid_out')::boolean;
  if exists (select 1 from jsonb_array_elements(coalesce(v_open, '[]')) e where (e->>'jobs')::int > 0) then
    v_notes := v_notes || ((select string_agg(e->'workers'->>0, ', ') from jsonb_array_elements(v_open) e where (e->>'jobs')::int > 0)
      || ' still has jobs not paid out: not ranked yet, and the ranking can change once they are.'); end if;
  select string_agg(x.who || ' (' || x.beq || ')', ' and ' order by x.place) into v_ties
    from (select e->'workers'->>0 who, e->>'bonus_eq' beq, (e->>'place')::int place from jsonb_array_elements(t) e
           where (e->>'tie')::boolean and (e->>'place')::int <= 4) x;
  if v_ties is not null then v_notes := v_notes || ('Tied on Bonus EQ: ' || v_ties || '. Don’t pick between them: ask.'); end if;
  if d.locked then v_notes := v_notes || (d.day || ' is on a paid payslip, so bonuses can no longer be added.'); end if;
  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'date', d.day, 'kept_as', case d.source when 'live' then 'the live day' else 'a saved day' end, 'locked', case when d.locked then true end,
    'rule', 'Bonus EQ = equiv ÷ 1 for a solo cart, 1.5 for two, 2 for three. A cart qualifies with at least as many sales as prebooks and a phone and an email on at least 80% of its sales.',
    'winners', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('place', (e->>'place')::int, 'workers', e->'workers', 'cns', e->'cns', 'bonus_eq', e->'bonus_eq', 'tie', e->'tie', 'bonuses', e->'bonuses')) order by (e->>'place')::int)
                  from jsonb_array_elements(t) e where (e->>'place')::int <= 3),
    'ranked', (select jsonb_agg(e - 'key' - 'source' - 'paid_out' - 'jobs' order by (e->>'rank')::int) from jsonb_array_elements(t) e where e ? 'rank'),
    'not_paid_out', v_open,
    'given', (select jsonb_agg(jsonb_build_object('workers', e->'workers', 'bonus', b->>'label', 'amount', b->'amount')) from jsonb_array_elements(t) e, jsonb_array_elements(e->'bonuses') b),
    'notes', case when cardinality(v_notes) > 0 then to_jsonb(v_notes) end));
end $$;

-- One or more bonuses, checked: p_bonuses = [{ worker, place, amount, type?, note? }]. Changes nothing.
--   worker = anyone on the cart (CN or name); place = 1, 2 … (not for type Other); amount = dollars for the cart (a team
--   splits it evenly, the payout list's own default); type = Performance EQ (default), Total Upsell, Rookie or Other.
create or replace function public.benny_check_bonus(p_center uuid, p_date date, p_bonuses jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare d record; t jsonb; b jsonb; e jsonb; x jsonb; i int := 0; n int;
        v_probs text[] := '{}'; v_cautions text[] := '{}'; v_out jsonb := '[]'::jsonb; v_ask jsonb := '[]'::jsonb; v_keys text[] := '{}'; v_slots text[] := '{}';
        q text; v_who text; v_type text; v_place int; v_amount numeric; v_note text; v_label text; v_slot text; v_n int; v_best real; v_second real; v_which text;
        v_shares jsonb; v_split jsonb; v_pct int; v_rem int; fmt constant text := 'FM999999990.00';
begin
  perform benny_ok(p_center);
  select * into d from benny_bonus_day(p_center, p_date);
  if d.problem is not null then return jsonb_strip_nulls(jsonb_build_object('ok', false, 'date', d.day, 'problems', jsonb_build_array(d.problem))); end if;
  if d.locked then return jsonb_build_object('ok', false, 'date', d.day, 'problems', jsonb_build_array(d.day || ' is on a paid payslip, so it’s locked: bonuses can no longer be added.')); end if;
  if jsonb_typeof(p_bonuses) is distinct from 'array' or jsonb_array_length(p_bonuses) = 0 then
    return jsonb_build_object('ok', false, 'date', d.day, 'problems', jsonb_build_array('Which cart gets a bonus, and how much?')); end if;
  if jsonb_array_length(p_bonuses) > 6 then
    return jsonb_build_object('ok', false, 'date', d.day, 'problems', jsonb_build_array('That is a lot of bonuses for one card: six at most.')); end if;
  t := benny_bonus_table(p_center, d.day);

  for b in select * from jsonb_array_elements(p_bonuses) loop
    i := i + 1; e := null; v_which := null;
    q := trim(coalesce(b->>'worker', ''));
    if q = '' then v_probs := v_probs || 'Which cart gets the bonus? Name a worker on it.'; continue; end if;
    -- the cart: by a worker's CN, else by name, else by sound
    select y into e from jsonb_array_elements(t) y where exists (select 1 from jsonb_array_elements_text(y->'cns') c where upper(c) = upper(q)) limit 1;
    if e is null then
      select count(*), min(y::text)::jsonb, string_agg(m.w, ', ') into v_n, e, v_which
        from jsonb_array_elements(t) y cross join lateral (select w from jsonb_array_elements_text(y->'workers') w where w ilike q || '%' or w ilike '% ' || q || '%' limit 1) m;
      if v_n > 1 then e := null; v_probs := v_probs || ('Which one: ' || v_which || '?'); continue; end if;
    end if;
    if e is null then
      select max(z.s), (array_agg(z.s order by z.s desc))[2], (array_agg(z.y order by z.s desc))[1], string_agg(z.w, ', ' order by z.s desc) into v_best, v_second, e, v_which
        from (select y, m.w, m.s from jsonb_array_elements(t) y
                cross join lateral (select w, benny_person_score(q, w) s from jsonb_array_elements_text(y->'workers') w order by 2 desc limit 1) m where m.s >= 0.3) z;
      if e is null then v_probs := v_probs || ('No cart with “' || q || '” on ' || d.day || '.'); continue; end if;
      if not (v_best >= 0.55 and coalesce(v_second, 0) <= v_best - 0.15) then e := null; v_probs := v_probs || ('Which one: ' || v_which || '?'); continue; end if;
    end if;
    v_who := (select string_agg(w, ' + ') from jsonb_array_elements_text(e->'workers') w);

    -- what it is
    v_type := coalesce(nullif(trim(b->>'type'), ''), 'Performance EQ');
    if v_type not in ('Performance EQ', 'Total Upsell', 'Rookie', 'Other') then v_probs := v_probs || ('“' || v_type || '” isn’t a bonus type: Performance EQ, Total Upsell, Rookie or Other.'); continue; end if;
    v_note := nullif(trim(coalesce(b->>'note', '')), '');
    v_place := case when (b->>'place') ~ '^[0-9]{1,2}$' then (b->>'place')::int end;
    if v_type = 'Other' then
      v_place := null;
      if v_note is null then v_probs := v_probs || ('What is ' || v_who || '’s bonus for?'); continue; end if;
    elsif v_place is null or v_place not between 1 and 10 then
      v_probs := v_probs || ('Which place is ' || v_who || '’s ' || v_type || ' bonus: 1st, 2nd …?'); continue;
    end if;
    if not coalesce(b->>'amount', '') ~ '^[0-9]+(\.[0-9]+)?$' then v_probs := v_probs || ('How much is ' || v_who || '’s bonus?'); continue; end if;
    v_amount := round((b->>'amount')::numeric, 2);
    if v_amount <= 0 or v_amount > 500 then v_probs := v_probs || ('A bonus is between $1 and $500; ' || to_char(v_amount, fmt) || ' isn’t.'); continue; end if;
    v_label := benny_bonus_label(jsonb_strip_nulls(jsonb_build_object('type', v_type, 'placing', v_place, 'customDescription', case when v_type = 'Other' then v_note end)));
    v_slot := v_type || '#' || coalesce(v_place::text, lower(v_note));

    -- what stops it
    if not (e->>'paid_out')::boolean then
      v_probs := v_probs || (v_who || '’s cart isn’t paid out yet, so its equiv isn’t final. Finish its payout first, then add the bonus.'); continue; end if;
    if (e->>'key') = any (v_keys) and v_slot = any (v_slots) then v_probs := v_probs || (v_who || ' is in this twice for ' || v_label || '.'); continue; end if;
    if v_place is not null and v_slot = any (v_slots) then v_probs := v_probs || (v_label || ' can go to one cart only.'); continue; end if;
    if exists (select 1 from jsonb_array_elements(coalesce(e->'bonuses', '[]')) o where o->>'label' = v_label) then
      v_probs := v_probs || (v_who || ' already has ' || v_label || coalesce(' ($' || to_char((select (o->>'amount')::numeric from jsonb_array_elements(e->'bonuses') o where o->>'label' = v_label limit 1), fmt) || ')', '') || '.'); continue; end if;
    if v_place is not null then
      select y into x from jsonb_array_elements(t) y where y->>'key' <> e->>'key' and exists (select 1 from jsonb_array_elements(coalesce(y->'bonuses', '[]')) o where o->>'label' = v_label) limit 1;
      if x is not null then
        v_probs := v_probs || (v_label || ' already went to ' || (select string_agg(w, ' + ') from jsonb_array_elements_text(x->'workers') w) || ' that day.'); continue; end if;
    end if;

    -- what to know before tapping
    if not (e->>'qualifies')::boolean then v_cautions := v_cautions || (v_who || ' doesn’t meet the bonus rule: ' || coalesce(e->>'why_not', 'not enough sales') || '.'); end if;
    if v_type = 'Performance EQ' and v_place is not null then
      select y into x from jsonb_array_elements(t) y where (y->>'place')::int = v_place limit 1;
      if x is not null and x->>'key' <> e->>'key' and not ((e->>'tie')::boolean is true and (x->>'tie')::boolean is true and x->>'bonus_eq' = e->>'bonus_eq') then
        v_cautions := v_cautions || ('By Bonus EQ among the carts that qualify, ' || benny_ordinal(v_place) || ' place is '
          || (select string_agg(w, ' + ') from jsonb_array_elements_text(x->'workers') w) || ' (' || (x->>'bonus_eq') || '), not ' || v_who || ' (' || coalesce(e->>'bonus_eq', '?') || ').'); end if;
      if (e->>'tie')::boolean is true then
        v_cautions := v_cautions || (v_who || ' is tied at ' || (e->>'bonus_eq') || ' Bonus EQ with '
          || coalesce((select string_agg(y->'workers'->>0, ', ') from jsonb_array_elements(t) y where (y->>'tie')::boolean is true and y->>'key' <> e->>'key' and y->>'bonus_eq' = e->>'bonus_eq'), 'another cart') || '.'); end if;
    end if;

    -- who gets how much: a team splits it evenly (whole percents, the odd one to the first), as the payout list starts it
    n := jsonb_array_length(e->'cns'); v_pct := 100 / n; v_rem := 100 - v_pct * n;
    select jsonb_agg(jsonb_build_object('cn', c.cn, 'name', e->'workers'->>(c.o::int - 1), 'percent', v_pct + case when c.o = 1 then v_rem else 0 end,
                                        'amount', round(v_amount * (v_pct + case when c.o = 1 then v_rem else 0 end) / 100.0, 2)) order by c.o),
           case when n > 1 then jsonb_object_agg(c.cn, v_pct + case when c.o = 1 then v_rem else 0 end) end
      into v_shares, v_split
      from jsonb_array_elements_text(e->'cns') with ordinality c(cn, o);

    v_keys := v_keys || (e->>'key'); v_slots := v_slots || v_slot;
    v_out := v_out || jsonb_strip_nulls(jsonb_build_object('key', e->>'key', 'cns', e->'cns', 'workers', e->'workers', 'team_size', n,
      'type', v_type, 'placing', v_place, 'note', case when v_type = 'Other' then v_note end, 'label', v_label, 'amount', v_amount, 'shares', v_shares, 'split', v_split,
      'bonus_eq', e->'bonus_eq', 'rank', e->'rank', 'qualifies', e->'qualifies', 'pay_now', e->'pay', 'pay_after', case when e ? 'pay' then round((e->>'pay')::numeric + v_amount, 2) end,
      'has', e->'bonuses'));
    v_ask := v_ask || jsonb_strip_nulls(jsonb_build_object('worker', e->'cns'->>0, 'place', v_place, 'amount', v_amount, 'type', v_type, 'note', case when v_type = 'Other' then v_note end));
  end loop;

  if cardinality(v_probs) = 0 and exists (select 1 from jsonb_array_elements(t) y where not (y->>'paid_out')::boolean and (y->>'jobs')::int > 0) then
    v_cautions := v_cautions || ((select string_agg(y->'workers'->>0, ', ') from jsonb_array_elements(t) y where not (y->>'paid_out')::boolean and (y->>'jobs')::int > 0)
      || ' still has jobs not paid out: the ranking can change once they are.'); end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', cardinality(v_probs) = 0, 'problems', to_jsonb(v_probs), 'date', d.day, 'source', d.source,
    'bonuses', case when cardinality(v_probs) = 0 then v_out end, 'ask', case when cardinality(v_probs) = 0 then v_ask end,
    'total', case when cardinality(v_probs) = 0 then (select sum((o->>'amount')::numeric) from jsonb_array_elements(v_out) o) end,
    'cautions', case when cardinality(v_probs) = 0 and cardinality(v_cautions) > 0 then to_jsonb(v_cautions) end,
    -- what the carts read now: a card made before something moved is refused when it is tapped
    'stamp', case when cardinality(v_probs) = 0 then md5(d.day::text || d.source || (select string_agg(concat_ws('|', o->>'key', o->'cns', o->'bonus_eq', o->'pay_now', o->'has'), '~' order by o->>'key') from jsonb_array_elements(v_out) o)) end));
end $$;

-- The app is about to save the bonuses the person confirmed: check them once more (nothing may have moved since the
-- card was made) and start their records. For the live day it also hands over each logsheet's bonuses and payout as
-- they read now, for the payout list's own save (which writes both).
create or replace function public.benny_bonus_begin(p_center uuid, p_date date, p_bonuses jsonb, p_stamp text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare k jsonb := benny_check_bonus(p_center, p_date, p_bonuses); o jsonb; v_id uuid; v_ids uuid[] := '{}'; v_now jsonb := '{}'::jsonb;
begin
  if not coalesce((k->>'ok')::boolean, false) then return k; end if;
  if (k->>'stamp') is distinct from p_stamp then
    return k || jsonb_build_object('ok', false, 'problems', jsonb_build_array('The payouts changed since I checked. Ask me again.')); end if;
  for o in select * from jsonb_array_elements(k->'bonuses') loop
    insert into benny_bonus_changes (center_id, day, source, cart_key, cns, workers, bonus, before, by_user, by_name)
    values (p_center, (k->>'date')::date, k->>'source', o->>'key', array(select jsonb_array_elements_text(o->'cns')),
            (select string_agg(w, ' + ') from jsonb_array_elements_text(o->'workers') w),
            jsonb_strip_nulls(jsonb_build_object('type', o->>'type', 'placing', o->'placing', 'note', o->>'note', 'label', o->>'label', 'amount', o->'amount', 'split', o->'split')),
            jsonb_strip_nulls(jsonb_build_object('bonuses', coalesce(o->'has', '[]'::jsonb), 'pay', o->'pay_now')),
            auth.uid(), (select u.full_name from app_users u where u.id = auth.uid()))
    returning id into v_id;
    v_ids := v_ids || v_id;
    if k->>'source' = 'live' then
      v_now := v_now || coalesce((select jsonb_build_object(l.id, jsonb_build_object('bonuses', case when jsonb_typeof(l.bonuses) = 'array' then l.bonuses else '[]'::jsonb end, 'validation', l.validation))
                                    from logsheet_sessions l where l.id = o->>'key' and l.command_center_id = p_center), '{}'::jsonb);
    end if;
  end loop;
  return k || jsonb_build_object('change_ids', to_jsonb(v_ids)) || case when k->>'source' = 'live' then jsonb_build_object('now', v_now) else '{}'::jsonb end;
end $$;

-- The app has saved (or failed to): read each cart as it stands now and close the records. A bonus counts as saved
-- when the cart has one more bonus of that name and amount than it had before.
create or replace function public.benny_bonus_done(p_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare r benny_bonus_changes; t jsonb; e jsonb; v_state text; v_after jsonb; v_out jsonb := '[]'::jsonb; v_had int; v_has int;
begin
  for r in select * from benny_bonus_changes where id = any (p_ids) and by_user = auth.uid() and state = 'started' and started_at > now() - interval '1 hour' order by started_at, id loop
    perform benny_ok(r.center_id);
    t := benny_bonus_table(r.center_id, r.day);
    select y into e from jsonb_array_elements(t) y
     where (select array_agg(upper(c) order by upper(c)) from jsonb_array_elements_text(y->'cns') c) = (select array_agg(upper(c) order by upper(c)) from unnest(r.cns) c) limit 1;
    select count(*) into v_had from jsonb_array_elements(coalesce(r.before->'bonuses', '[]')) o where o->>'label' = r.bonus->>'label' and (o->>'amount')::numeric = (r.bonus->>'amount')::numeric;
    select count(*) into v_has from jsonb_array_elements(coalesce(e->'bonuses', '[]')) o where o->>'label' = r.bonus->>'label' and (o->>'amount')::numeric = (r.bonus->>'amount')::numeric;
    v_state := case when e is not null and v_has > v_had then 'done' else 'not_saved' end;
    v_after := jsonb_strip_nulls(jsonb_build_object('bonuses', coalesce(e->'bonuses', '[]'::jsonb), 'pay', e->'pay'));
    update benny_bonus_changes set after = v_after, state = v_state, done_at = now() where id = r.id;
    v_out := v_out || jsonb_strip_nulls(jsonb_build_object('id', r.id, 'state', v_state, 'workers', r.workers, 'label', r.bonus->>'label', 'amount', r.bonus->'amount', 'pay', e->'pay'));
  end loop;
  return jsonb_build_object('bonuses', v_out,
    'state', case when jsonb_array_length(v_out) = 0 then 'unknown'
                  when not exists (select 1 from jsonb_array_elements(v_out) o where o->>'state' <> 'done') then 'done'
                  when not exists (select 1 from jsonb_array_elements(v_out) o where o->>'state' = 'done') then 'not_saved' else 'partly' end);
end $$;

do $g$ declare f text; begin
  foreach f in array array['benny_bonus_carts(uuid,date)', 'benny_bonus_table(uuid,date)', 'benny_bonus_day(uuid,date)', 'benny_day_service(uuid,date)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['benny_ordinal(int)', 'benny_bonus_label(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
  end loop;
  foreach f in array array['benny_bonus_rank(uuid,date)', 'benny_check_bonus(uuid,date,jsonb)', 'benny_bonus_begin(uuid,date,jsonb,text)', 'benny_bonus_done(uuid[])'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $g$;
