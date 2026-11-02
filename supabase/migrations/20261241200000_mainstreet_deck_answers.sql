-- MainstreetAI › the deck's questions (screen 6) and the proposal they make (screen 7).
-- The rep app saves the owner's answers on the business, per campaign: the latest answers win. They show with the
-- onboarding call (host's email, My calls, Meetings) and on the deal. Two of them (how customers find the business,
-- hours a week on admin) qualify businesses for future MainstreetAI products.
-- Additive only.

create table if not exists public.ms_business_answers (
  business_id uuid not null references public.ms_businesses(id),
  campaign_id uuid not null references public.ms_campaigns(id),
  data jsonb not null,
  find text[] not null default '{}',          -- how customers find the business (walkin, google, social, referrals)
  admin_hours text,                            -- hours a week on admin (u2, 2_5, 5_10, 10)
  expenses text,                               -- monthly expenses band
  updated_by uuid references public.app_users(id),
  updated_at timestamptz not null default now(),
  primary key (business_id, campaign_id)
);
alter table public.ms_business_answers enable row level security;
create index if not exists ms_business_answers_find on public.ms_business_answers using gin (find);

-- the rep (or an admin) saves what the owner tapped in the deck
create or replace function public.ms_save_deck_answers(p_business uuid, p_campaign uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare a jsonb := p_data -> 'answers';
begin
  if not ms_can_book(p_campaign) then raise exception 'Not allowed'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(a) is distinct from 'object' then raise exception 'Those answers aren’t right'; end if;
  if length(p_data::text) > 8000 then raise exception 'Those answers are too long'; end if;
  if not exists (select 1 from ms_businesses where id = p_business) then raise exception 'That business is gone'; end if;
  if a = '{}'::jsonb then return; end if;
  insert into ms_business_answers (business_id, campaign_id, data, find, admin_hours, expenses, updated_by)
  values (p_business, p_campaign, p_data,
          coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(a -> 'find') = 'array' then a -> 'find' else '[]'::jsonb end) x), '{}'),
          a ->> 'admin_hours', a ->> 'expenses', auth.uid())
  on conflict (business_id, campaign_id) do update set data = excluded.data, find = excluded.find, admin_hours = excluded.admin_hours,
    expenses = excluded.expenses, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- a call carries the business's answers
create or replace function public.ms_meeting_json(p_meeting uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'status', m.status, 'starts_at', m.starts_at, 'ends_at', m.ends_at, 'length_min', round(extract(epoch from m.ends_at - m.starts_at) / 60),
    'owner_name', m.owner_name, 'owner_phone', m.owner_phone, 'owner_email', m.owner_email, 'notes', m.notes,
    'outcome_note', m.outcome_note, 'outcome_at', m.outcome_at, 'outcome_by', (select full_name from app_users where id = m.outcome_by),
    'campaign', jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color),
    'business', jsonb_build_object('id', b.id, 'name', b.name, 'address', b.address, 'phone', b.phone),
    'host', jsonb_build_object('id', hu.id, 'name', hu.full_name, 'email', hu.email, 'zoom_url', h.zoom_url, 'timezone', coalesce(h.timezone, 'America/Toronto')),
    'rep', case when ru.id is null then null else jsonb_build_object('id', ru.id, 'name', ru.full_name, 'phone', ru.phone, 'email', ru.email) end,
    'deal_id', m.deal_id, 'deal_status', (select d.status from ms_deals d where d.id = m.deal_id),
    'timezone', (select x.timezone from ms_rules(m.campaign_id) x), 'created_at', m.created_at,
    'answers', (select a.data from ms_business_answers a where a.business_id = m.business_id and a.campaign_id = m.campaign_id))
  from ms_meetings m
  join ms_campaigns c on c.id = m.campaign_id
  join ms_businesses b on b.id = m.business_id
  join app_users hu on hu.id = m.host_id
  left join ms_hosts h on h.user_id = m.host_id
  left join app_users ru on ru.id = m.rep_id
  where m.id = p_meeting
$$;

-- a deal too
create or replace function public.ms_deals_list(p_status text default 'pending')
returns jsonb language plpgsql stable security definer set search_path = public as $function$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if p_status not in ('pending', 'approved', 'rejected') then raise exception 'Pick pending, approved or rejected'; end if;
  return coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', d.id, 'status', d.status, 'at', d.created_at, 'decided_at', d.decided_at, 'decision_note', d.decision_note,
             'decided_by', (select full_name from app_users where id = d.decided_by),
             'business', jsonb_build_object('id', b.id, 'name', b.name, 'address', b.address, 'kind', b.kind, 'phone', b.phone),
             'campaign', c.name, 'color', c.color, 'zone', z.name, 'rep', u.full_name, 'rep_id', u.id,
             'notes', v.notes, 'contact_name', v.contact_name, 'contact_phone', v.contact_phone, 'contact_email', v.contact_email,
             'far', v.far, 'distance_m', v.distance_m,
             'answers', (select a.data from ms_business_answers a where a.business_id = d.business_id and a.campaign_id = d.campaign_id),
             'meeting', (select jsonb_build_object('id', m.id, 'starts_at', m.starts_at, 'status', m.status, 'host', hu.full_name, 'outcome_note', m.outcome_note)
                           from ms_meetings m join app_users hu on hu.id = m.host_id where m.deal_id = d.id order by m.created_at desc limit 1)))
           order by d.created_at desc)
      from ms_deals d
      join ms_visits v on v.id = d.visit_id
      join ms_businesses b on b.id = d.business_id
      join ms_campaigns c on c.id = d.campaign_id
      left join ms_zones z on z.id = d.zone_id
      join app_users u on u.id = d.rep_id
     where d.status = p_status), '[]'::jsonb);
end $function$;

revoke all on function public.ms_save_deck_answers(uuid, uuid, jsonb) from public, anon;
grant execute on function public.ms_save_deck_answers(uuid, uuid, jsonb) to authenticated;
revoke all on function public.ms_meeting_json(uuid) from public, anon, authenticated;
