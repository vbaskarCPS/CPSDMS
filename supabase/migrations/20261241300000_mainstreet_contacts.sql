-- MainstreetAI › contacts: the people reps talk to at a business (the CRM). The deck's questions screen starts with
-- "Who we're talking to" (name, role, phone, email), filled in by the rep with the owner watching; saving the deck
-- answers adds the person to the business, or fills in what was missing when they're already there (same email,
-- phone or name). A business can have several people (owner, partner, their bookkeeper).
-- Additive only.

create table if not exists public.ms_business_contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.ms_businesses(id),
  campaign_id uuid references public.ms_campaigns(id),
  name text, role text, phone text, email text,
  source text not null default 'deck',
  active boolean not null default true,
  added_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ms_business_contacts enable row level security;
create index if not exists ms_business_contacts_business on public.ms_business_contacts (business_id) where active;

-- the rep (or an admin) saves what the owner tapped in the deck, and the person they're talking to
create or replace function public.ms_save_deck_answers(p_business uuid, p_campaign uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare a jsonb := p_data -> 'answers'; c jsonb := p_data -> 'contact';
  v_name text; v_role text; v_phone text; v_email text; v_digits text; v_id uuid;
begin
  if not (ms_is_admin() or ms_rep_can(p_business, p_campaign)) then raise exception 'Not allowed'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(a) is distinct from 'object' then raise exception 'Those answers aren’t right'; end if;
  if length(p_data::text) > 8000 then raise exception 'Those answers are too long'; end if;
  if not exists (select 1 from ms_businesses where id = p_business) then raise exception 'That business is gone'; end if;
  if a <> '{}'::jsonb then
    insert into ms_business_answers (business_id, campaign_id, data, find, admin_hours, expenses, updated_by)
    values (p_business, p_campaign, p_data,
            coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(a -> 'find') = 'array' then a -> 'find' else '[]'::jsonb end) x), '{}'),
            a ->> 'admin_hours', a ->> 'expenses', auth.uid())
    on conflict (business_id, campaign_id) do update set data = excluded.data, find = excluded.find, admin_hours = excluded.admin_hours,
      expenses = excluded.expenses, updated_by = excluded.updated_by, updated_at = now();
  end if;
  -- the person they're talking to
  if jsonb_typeof(c) = 'object' then
    v_name := left(nullif(trim(coalesce(c ->> 'name', '')), ''), 120);
    v_role := left(nullif(trim(coalesce(c ->> 'role', '')), ''), 40);
    v_phone := left(nullif(trim(coalesce(c ->> 'phone', '')), ''), 40);
    v_email := left(nullif(lower(trim(coalesce(c ->> 'email', ''))), ''), 200);
    v_digits := nullif(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), '');
    if v_name is not null or v_phone is not null or v_email is not null then
      select id into v_id from ms_business_contacts k
       where k.business_id = p_business and k.active
         and ((v_email is not null and lower(k.email) = v_email)
           or (v_digits is not null and length(v_digits) >= 7 and right(regexp_replace(coalesce(k.phone, ''), '[^0-9]', '', 'g'), 10) = right(v_digits, 10))
           or (v_name is not null and lower(k.name) = lower(v_name)))
       order by k.updated_at desc limit 1;
      if v_id is null then
        insert into ms_business_contacts (business_id, campaign_id, name, role, phone, email, added_by)
        values (p_business, p_campaign, v_name, v_role, v_phone, v_email, auth.uid());
      else
        update ms_business_contacts set name = coalesce(v_name, name), role = coalesce(v_role, role), phone = coalesce(v_phone, phone),
               email = coalesce(v_email, email), updated_at = now() where id = v_id;
      end if;
    end if;
  end if;
end $$;

-- the people at a business, newest first
create or replace function public.ms_business_contacts_list(p_business uuid, p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (ms_is_admin() or ms_rep_can(p_business, p_campaign)) then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', k.id, 'name', k.name, 'role', k.role, 'phone', k.phone,
           'email', k.email, 'updated_at', k.updated_at)) order by k.updated_at desc)
      from ms_business_contacts k where k.business_id = p_business and k.active), '[]'::jsonb);
end $$;

revoke all on function public.ms_business_contacts_list(uuid, uuid) from public, anon;
grant execute on function public.ms_business_contacts_list(uuid, uuid) to authenticated;
