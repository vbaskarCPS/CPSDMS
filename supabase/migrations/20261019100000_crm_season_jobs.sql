-- RUN_17 — this season's done jobs live on the customer records. ADDITIVE ONLY.
--
-- One system for past clients (PCLs) and "done this season": every sale of a closed day becomes a
-- job in its customer's history (clients.history), the same place past years' jobs already live.
-- An address with no customer yet gets one. From there the map's PCL lists carry this season's jobs
-- too, so the crew map can show a house as done (and leave it out of PCL Outreach) with no separate
-- "historical" table to load.
--
--   app_crm_sync_day(center, day)   internal. Re-writes that day's jobs on the customers: removes the
--                                   jobs it wrote before for that day, adds one per sale (from the
--                                   day's saved carts), creates customers for new addresses, adds the
--                                   phone / email / name the crew took (from the day's saved copy,
--                                   when there is one), then rebuilds the touched routes' PCL lists.
--   app_crm_resync_day(center, day) the same, for Workerbook users (a manual "redo").
--   triggers                        queue it when a day is closed, and whenever a closed day's carts
--                                   are saved again (payouts edited after closing); it runs once, as
--                                   the save or close finishes.
--   client_pcl_entries              now also passes each job's date, so the map can say "Done Oct 3".
--
-- A job in history: { year, line, service (size code: SS, SSP, Ramp, FO…), product, source (Door sale /
-- Prebooked / Upsell), price (what they paid), payment, payment_detail, paid (paid / owed / to_confirm),
-- contractor (names), crew [{hire_id, cn, name}], date, route, src 'day', center, day }.
-- Card numbers are never stored: payment_detail holds only a masked last 4, a cheque #, an e-transfer
-- email or an invoice #. Sales by H01 (testing) are left out, as on the Accounts tab.

create index if not exists clients_history_gin on public.clients using gin (history jsonb_path_ops);

-- ───────────── "123 Main St" / "4-123 Main St" / "123 Main St Unit 4" → parts ─────────────
create or replace function public.crm_split_address(p text)
returns table (house_no text, street text, unit text)
language sql immutable set search_path = public as $$
  with a as (select regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g') as s),
  m as (
    select coalesce(
      -- unit first: "4-123 Main St"
      (select array[x[2], x[3], x[1]] from regexp_matches((select s from a), '^([A-Za-z0-9]+)\s*-\s*(\d+[A-Za-z]?)\s+(.+)$') x),
      -- unit after: "123 Main St Unit 4" / "#4"
      (select array[x[1], x[2], x[3]] from regexp_matches((select s from a), '^(\d+[A-Za-z]?)\s+(.+?)[\s,]+(?:unit|apt\.?|suite|#)\s*([A-Za-z0-9]+)$', 'i') x),
      (select array[x[1], x[2], null] from regexp_matches((select s from a), '^(\d+[A-Za-z]?)\s+(.+)$') x)
    ) as v
  )
  select upper(v[1]), v[2], v[3] from m where v is not null
$$;

-- ───────────── the season a day belongs to (sealing, aeration…) ─────────────
create or replace function public.crm_day_line(p_center uuid, p_day date)
returns text language sql stable set search_path = public as $$
  select coalesce(
    (select service from seasons where center_id = p_center and p_day between starts_on and coalesce(ends_on, p_day) order by starts_on desc limit 1),
    (select row_data->>'season_type' from archive.session_rows where center_id = p_center and day = p_day and source_table = 'daily_sessions' limit 1),
    (select services[1] from command_centers where id = p_center),
    'sealing')
$$;

-- ───────────── write a closed day's jobs onto the customers (internal) ─────────────
create or replace function public.app_crm_sync_day(p_center uuid, p_day date)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_line text := crm_day_line(p_center, p_day);
  v_tag jsonb := jsonb_build_object('src', 'day', 'center', p_center::text, 'day', p_day::text);
  v_routes text[] := '{}';
  s record;
  a record;
  tx jsonb;
  v_id uuid;
  v_norm text;
  v_first text; v_last text; v_phone text; v_email text;
  v_job jsonb;
  v_lat float8; v_lng float8;
  n int := 0;
begin
  -- the jobs this day wrote before (a re-sync replaces them)
  select coalesce(array_agg(distinct route_code) filter (where route_code is not null), '{}') into v_routes
    from clients where history @> jsonb_build_array(v_tag);
  update clients c set history = (select coalesce(jsonb_agg(h), '[]') from jsonb_array_elements(c.history) h where not (h @> v_tag)),
                       updated_at = now()
   where c.history @> jsonb_build_array(v_tag);

  for s in
    select ps.*, pc.members,
           (select string_agg(trim(concat_ws(' ', m->>'first_name', m->>'last_name')), ', ') from jsonb_array_elements(pc.members) m) as crew_names,
           (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('hire_id', m->>'hire_id', 'cn', m->>'cn',
                     'name', trim(concat_ws(' ', m->>'first_name', m->>'last_name'))))), '[]') from jsonb_array_elements(pc.members) m) as crew
      from payout_sales ps join payout_carts pc on pc.id = ps.cart_id
     where ps.center_id = p_center and ps.day = p_day and coalesce(ps.address, '') <> ''
       and not exists (select 1 from jsonb_array_elements(pc.members) m where upper(coalesce(m->>'cn', '')) = 'H01' or upper(coalesce(m->>'sheet_cn', '')) = 'H01')
     order by pc.sort, ps.sort
  loop
    select * into a from crm_split_address(s.address);
    if a.house_no is null then continue; end if;
    v_norm := norm_street(a.street);
    if v_norm is null then continue; end if;

    -- what the crew took at the door, from the day's saved copy (same route, same address)
    select r.row_data into tx from archive.session_rows r
     where r.center_id = p_center and r.day = p_day and r.source_table = 'transactions'
       and lower(regexp_replace(coalesce(r.row_data->'customer_snapshot'->>'address', r.row_data->>'address', ''), '\s+', ' ', 'g'))
           = lower(regexp_replace(s.address, '\s+', ' ', 'g'))
       and coalesce(r.row_data->'customer_snapshot'->>'routeCode', r.row_data->>'route_code', '') = coalesce(s.route_code, '')
       and not coalesce((r.row_data->'asphalt_meta'->>'is_partner_phantom')::boolean, false)
     order by abs(coalesce((r.row_data->>'price')::numeric, 0) - s.price)
     limit 1;
    v_first := nullif(trim(coalesce(tx->'customer_snapshot'->>'firstName', split_part(coalesce(s.client_name, ''), ' ', 1))), '');
    v_last  := nullif(trim(coalesce(tx->'customer_snapshot'->>'lastName',
                 nullif(regexp_replace(coalesce(s.client_name, ''), '^\S+\s*', ''), ''))), '');
    v_phone := nullif(right(regexp_replace(coalesce(tx->>'customer_phone', ''), '\D', '', 'g'), 10), '');
    if length(v_phone) <> 10 then v_phone := null; end if;
    v_email := nullif(lower(trim(coalesce(tx->>'customer_email', ''))), '');

    -- the customer: this address on this route first, then this address anywhere
    select id into v_id from clients
     where street_norm = v_norm and upper(house_no) = a.house_no and lower(coalesce(unit, '')) = lower(coalesce(a.unit, ''))
     order by (route_code is not distinct from s.route_code) desc, (route_code is not null) desc, created_at
     limit 1;

    if v_id is null then
      select rh.lat, rh.lng into v_lat, v_lng from route_houses rh
       where rh.route_code = s.route_code and rh.street_norm = v_norm and rh.civic_no = nullif(regexp_replace(a.house_no, '\D', '', 'g'), '')::int
       limit 1;
      insert into clients (address_key, house_no, street_name, street_norm, unit, lat, lng, route_code, match_how, people, phones, emails, history)
      values (client_address_key(a.house_no, v_norm, a.unit, null), a.house_no, initcap(a.street), v_norm, a.unit, v_lat, v_lng,
              s.route_code, 'sale',
              case when v_first is not null or v_last is not null
                   then jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('first', coalesce(v_first, ''), 'last', coalesce(v_last, ''), 'phone', v_phone)))
                   else '[]'::jsonb end,
              case when v_phone is not null then array[v_phone] else '{}' end,
              case when v_email is not null then array[v_email] else '{}' end,
              '[]')
      on conflict (address_key) do nothing
      returning id into v_id;
      if v_id is null then
        select id into v_id from clients where address_key = client_address_key(a.house_no, v_norm, a.unit, null);
      end if;
    else
      -- add the person / phone / email the crew took, without disturbing what's there
      update clients c set
        people = case
          when v_first is null and v_last is null then c.people
          when exists (select 1 from jsonb_array_elements(c.people) p
                        where lower(coalesce(p->>'first', '')) = lower(coalesce(v_first, '')) and lower(coalesce(p->>'last', '')) = lower(coalesce(v_last, '')))
            then (select jsonb_agg(case when lower(coalesce(p->>'first', '')) = lower(coalesce(v_first, '')) and lower(coalesce(p->>'last', '')) = lower(coalesce(v_last, ''))
                                          and nullif(p->>'phone', '') is null and v_phone is not null
                                        then p || jsonb_build_object('phone', v_phone) else p end order by o)
                    from jsonb_array_elements(c.people) with ordinality t(p, o))
          else c.people || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('first', coalesce(v_first, ''), 'last', coalesce(v_last, ''), 'phone', v_phone)))
        end,
        phones = case when v_phone is not null and not (v_phone = any(c.phones)) then c.phones || v_phone else c.phones end,
        emails = case when v_email is not null and not (v_email = any(c.emails)) then c.emails || v_email else c.emails end,
        route_code = coalesce(c.route_code, s.route_code),
        updated_at = now()
      where c.id = v_id;
    end if;
    if v_id is null then continue; end if;

    v_job := jsonb_strip_nulls(jsonb_build_object(
      'year', extract(year from p_day)::int,
      'line', v_line,
      'service', coalesce(nullif(s.service, ''), case v_line when 'sealing' then 'SS' else '' end),
      'product', case
        when coalesce(s.service, '') ~* 'ramp|asphalt' then 'Hot asphalt'
        when s.type in ('Upgrade', 'Add-On') then coalesce(nullif(s.notes, ''), s.type)
        when v_line = 'sealing' then 'Sealing' when v_line = 'aeration' then 'Aeration'
        when v_line = 'lawn_rejuv' then 'Lawn rejuvenation' when v_line = 'cleaning' then 'Window cleaning' else initcap(v_line) end,
      'source', case
        when s.type in ('Upgrade', 'Add-On') then 'Upsell'
        when s.type = 'Production' or s.meta->>'client_type' = 'Existing' then 'Prebooked'
        else 'Door sale' end,
      'price', to_char(s.price, 'FM999990.00'),
      'payment', case when jsonb_typeof(s.payments) = 'object' and (select count(*) from jsonb_object_keys(s.payments)) > 1
                      then (select string_agg(k || ': $' || to_char((s.payments->>k)::numeric, 'FM999990.00'), ' / ') from jsonb_object_keys(s.payments) k)
                      else s.payment_type end,
      'payment_detail', nullif(coalesce(tx->>'card_masked', tx->>'cheque_number', tx->>'etransfer_email', tx->>'invoice_number', ''), ''),
      'paid', case when s.payment_type ~* 'bill' then 'owed' when s.payment_type ~* 'e-?transfer' then 'to_confirm' else 'paid' end,
      'contractor', nullif(s.crew_names, ''),
      'crew', s.crew,
      'date', p_day::text,
      'route', s.route_code
    )) || v_tag;
    update clients set history = history || jsonb_build_array(v_job), updated_at = now() where id = v_id;
    if s.route_code is not null then v_routes := v_routes || s.route_code; end if;
    n := n + 1;
  end loop;

  select coalesce(array_agg(distinct r), '{}') into v_routes from unnest(v_routes) r where r is not null;
  if cardinality(v_routes) > 0 then perform client_refresh_map_pcl(v_routes); end if;
  return n;
end $$;
revoke all on function public.app_crm_sync_day(uuid, date) from public, anon, authenticated;

create or replace function public.app_crm_resync_day(p_center uuid, p_day date)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not (app_has_perm('workerbook') and app_can_see_center(p_center)) then raise exception 'Not allowed'; end if;
  if not exists (select 1 from days where center_id = p_center and day = p_day and state = 'closed') then
    raise exception '% isn''t closed yet; its jobs go on the customers when it closes', p_day;
  end if;
  return app_crm_sync_day(p_center, p_day);
end $$;
revoke all on function public.app_crm_resync_day(uuid, date) from public, anon;
grant execute on function public.app_crm_resync_day(uuid, date) to authenticated;

-- ───────────── run it on close, and when a closed day's carts are saved again ─────────────
-- Saving a day's payouts deletes and re-inserts all its carts and sales, one statement per cart, so
-- the day is queued (once) and synced when the save commits, not after every statement.
create table if not exists public.crm_sync_queue (
  center_id uuid not null,
  day date not null,
  primary key (center_id, day)
);
alter table public.crm_sync_queue enable row level security;
revoke all on public.crm_sync_queue from public, anon, authenticated;

create or replace function public.crm_run_queued()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from crm_sync_queue where center_id = new.center_id and day = new.day;
  if exists (select 1 from days where center_id = new.center_id and day = new.day and state = 'closed') then
    perform app_crm_sync_day(new.center_id, new.day);
  end if;
  return null;
end $$;
revoke all on function public.crm_run_queued() from public, anon, authenticated;
drop trigger if exists crm_sync_run on public.crm_sync_queue;
create constraint trigger crm_sync_run after insert on public.crm_sync_queue
  deferrable initially deferred for each row execute function public.crm_run_queued();

create or replace function public.crm_on_day_closed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into crm_sync_queue (center_id, day) values (new.center_id, new.day) on conflict do nothing;
  return null;
end $$;
revoke all on function public.crm_on_day_closed() from public, anon, authenticated;
drop trigger if exists crm_sync on public.days;
create trigger crm_sync after update of state on public.days
  for each row when (new.state = 'closed' and old.state is distinct from 'closed')
  execute function public.crm_on_day_closed();

create or replace function public.crm_on_sales_saved()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into crm_sync_queue (center_id, day)
  select distinct x.center_id, x.day from changed x
    join days d on d.center_id = x.center_id and d.day = x.day and d.state = 'closed'
  on conflict do nothing;
  return null;
end $$;
revoke all on function public.crm_on_sales_saved() from public, anon, authenticated;
drop trigger if exists crm_sync_ins on public.payout_sales;
create trigger crm_sync_ins after insert on public.payout_sales
  referencing new table as changed for each statement execute function public.crm_on_sales_saved();
drop trigger if exists crm_sync_del on public.payout_sales;
create trigger crm_sync_del after delete on public.payout_sales
  referencing old table as changed for each statement execute function public.crm_on_sales_saved();

-- ───────────── PCL entries carry each job's date ─────────────
create or replace function public.client_pcl_entries(p_route text, p_line text)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'firstName', k.first,
           'lastName', k.last,
           'nameUnsure', case when k.unsure then true end,
           'houseNum', c.house_no,
           'streetName', c.street_name,
           'phone', coalesce(k.phone, ''),
           'city', c.city, 'lat', c.lat, 'lng', c.lng,
           'history', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                          'year', coalesce((h->>'year')::int, 0),
                          'price', coalesce(case when (h->>'price') ~ '^\d+(\.\d+)?$' then '$' || to_char((h->>'price')::numeric, 'FM999990.00') else h->>'price' end, ''),
                          'serviceType', coalesce(h->>'service', ''),
                          'contractor', coalesce(h->>'contractor', ''),
                          'date', h->>'date'))
                        order by coalesce((h->>'year')::int, 0) desc, coalesce(h->>'date', '') desc), '[]')
                       from jsonb_array_elements(c.history) h where h->>'line' = p_line),
           'src', 'crm', 'cid', c.id)) order by c.street_norm, c.house_no), '[]')
    from clients c
    cross join lateral client_contact(c.people, c.phones) k
   where c.route_code = p_route and p_line = any(c.services)
$$;
revoke all on function public.client_pcl_entries(text, text) from public, anon, authenticated;

-- ───────────── backfill: every day closed so far ─────────────
select d.day, app_crm_sync_day(d.center_id, d.day) as jobs
  from days d where d.state = 'closed' order by d.day;
