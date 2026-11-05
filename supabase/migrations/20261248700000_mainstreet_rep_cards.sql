-- MainstreetAI rep app: digital business cards (like HiHello). ADDITIVE ONLY.
--
-- Each rep has one card per campaign they work, branded with the campaign (name, colour, info link). The rep sets
-- their photo, title, phone, email, a short "about me", up to 4 links and a style. The card is a public page
-- (/card/<slug>) shared by QR code or link; anyone with the link sees it, nothing else of the rep.
-- An owner can send their details back from the card ("Share my info"): it lands in the rep's app as a lead to call
-- or add to the map. That form is open to anyone with the link, so it's limited (20 an hour per card, short fields).

create table if not exists public.ms_rep_cards (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.app_users(id),
  campaign_id uuid not null references public.ms_campaigns(id),
  slug text not null unique,
  title text, phone text, email text, about text,
  photo_path text,                                   -- in the public ms-rep-cards bucket, under the rep's id
  links jsonb not null default '[]',                 -- [{label, url}], up to 4, https only
  style text not null default 'classic' check (style in ('classic', 'bold', 'dark', 'minimal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rep_id, campaign_id)
);
alter table public.ms_rep_cards enable row level security;
revoke all on table public.ms_rep_cards from anon, authenticated;

create table if not exists public.ms_card_leads (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.ms_rep_cards(id),
  rep_id uuid not null,
  campaign_id uuid not null,
  name text not null, business text, address text, phone text, email text, note text,
  status text not null default 'new' check (status in ('new', 'added', 'dismissed')),
  business_id uuid,                                  -- once the rep adds it to the map
  created_at timestamptz not null default now()
);
create index if not exists ms_card_leads_rep on public.ms_card_leads (rep_id, status, created_at desc);
alter table public.ms_card_leads enable row level security;
revoke all on table public.ms_card_leads from anon, authenticated;

-- a short, unguessable-enough code for the link
create or replace function public.ms_card_slug()
returns text language sql volatile as $$
  select string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 8)
$$;

-- links: up to 4, https only, short labels
create or replace function public.ms_card_links(p jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('label', left(trim(coalesce(e->>'label', '')), 40), 'url', left(trim(e->>'url'), 300)) order by o), '[]')
    from (select e, o from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]' end) with ordinality x(e, o)
           where trim(coalesce(e->>'url', '')) ~* '^https://[^\s/]+\.[^\s]+$' limit 4) y
$$;

-- the rep's card for a campaign (made on first look, from their profile)
create or replace function public.ms_card_mine(p_campaign uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c ms_rep_cards; u app_users;
begin
  if not ms_rep_has_campaign(p_campaign) then raise exception 'Not allowed'; end if;
  select * into c from ms_rep_cards where rep_id = auth.uid() and campaign_id = p_campaign;
  if c.id is null then
    select * into u from app_users where id = auth.uid();
    loop
      begin
        insert into ms_rep_cards (rep_id, campaign_id, slug, title, phone, email)
        values (auth.uid(), p_campaign, ms_card_slug(), 'Business Advisor', u.phone, u.email) returning * into c;
        exit;
      exception when unique_violation then
        select * into c from ms_rep_cards where rep_id = auth.uid() and campaign_id = p_campaign;
        exit when c.id is not null;
      end;
    end loop;
  end if;
  return ms_card_json(c.slug) || jsonb_build_object('campaign_id', c.campaign_id);
end $$;

create or replace function public.ms_card_save(p_campaign uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_photo text := nullif(trim(coalesce(p->>'photo_path', '')), '');
begin
  if not ms_rep_has_campaign(p_campaign) then raise exception 'Not allowed'; end if;
  perform ms_card_mine(p_campaign);
  if v_photo is not null and v_photo not like auth.uid()::text || '/%' then raise exception 'That photo isn’t yours'; end if;
  if nullif(trim(coalesce(p->>'email', '')), '') is not null and trim(p->>'email') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Check the email'; end if;
  update ms_rep_cards set
    title = left(nullif(trim(coalesce(p->>'title', '')), ''), 60),
    phone = left(nullif(trim(coalesce(p->>'phone', '')), ''), 30),
    email = left(nullif(trim(coalesce(p->>'email', '')), ''), 120),
    about = left(nullif(trim(coalesce(p->>'about', '')), ''), 240),
    photo_path = v_photo,
    links = ms_card_links(p->'links'),
    style = case when p->>'style' in ('classic', 'bold', 'dark', 'minimal') then p->>'style' else style end,
    updated_at = now()
   where rep_id = auth.uid() and campaign_id = p_campaign;
  return ms_card_mine(p_campaign);
end $$;

-- what the public card shows (anyone with the link)
create or replace function public.ms_card_json(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('slug', c.slug, 'name', u.full_name, 'title', c.title, 'phone', c.phone, 'email', c.email,
           'about', c.about, 'photo_path', c.photo_path, 'links', c.links, 'style', c.style,
           'campaign', jsonb_build_object('name', m.name, 'color', m.color, 'info_url', m.info_url))
    from ms_rep_cards c join app_users u on u.id = c.rep_id and u.is_active
    join ms_campaigns m on m.id = c.campaign_id and m.is_active
   where c.slug = lower(trim(p_slug))
$$;

-- an owner sends their details from the card
create or replace function public.ms_card_exchange(p_slug text, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c ms_rep_cards; v_name text := left(trim(coalesce(p->>'name', '')), 80);
        v_phone text := left(nullif(trim(coalesce(p->>'phone', '')), ''), 30); v_email text := left(nullif(trim(coalesce(p->>'email', '')), ''), 120);
begin
  if coalesce(p->>'website', '') <> '' then return jsonb_build_object('ok', true); end if;   -- a bot filled the hidden field
  select * into c from ms_rep_cards where slug = lower(trim(p_slug));
  if c.id is null then raise exception 'That card doesn’t exist'; end if;
  if v_name = '' then raise exception 'Add your name'; end if;
  if v_phone is null and v_email is null then raise exception 'Add a phone number or an email'; end if;
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Check the email'; end if;
  if (select count(*) from ms_card_leads where card_id = c.id and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many just now. Try again in a little while.';
  end if;
  insert into ms_card_leads (card_id, rep_id, campaign_id, name, business, address, phone, email, note)
  values (c.id, c.rep_id, c.campaign_id, v_name, left(nullif(trim(coalesce(p->>'business', '')), ''), 120),
          left(nullif(trim(coalesce(p->>'address', '')), ''), 200), v_phone, v_email, left(nullif(trim(coalesce(p->>'note', '')), ''), 500));
  return jsonb_build_object('ok', true);
end $$;

-- the rep's leads from their cards, and marking them
create or replace function public.ms_card_leads_mine()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'business', l.business, 'address', l.address,
           'phone', l.phone, 'email', l.email, 'note', l.note, 'campaign_id', l.campaign_id, 'campaign', m.name, 'created_at', l.created_at)
           order by l.created_at desc), '[]'::jsonb)
    from ms_card_leads l join ms_campaigns m on m.id = l.campaign_id
   where l.rep_id = auth.uid() and l.status = 'new' and ms_is_rep()
$$;

create or replace function public.ms_card_lead_mark(p_id uuid, p_status text, p_business uuid default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if p_status not in ('added', 'dismissed') then raise exception 'Unknown status'; end if;
  update ms_card_leads set status = p_status, business_id = coalesce(p_business, business_id) where id = p_id and rep_id = auth.uid();
  if not found then raise exception 'Not allowed'; end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['ms_card_slug()', 'ms_card_links(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['ms_card_mine(uuid)', 'ms_card_save(uuid, jsonb)', 'ms_card_leads_mine()', 'ms_card_lead_mark(uuid, text, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['ms_card_json(text)', 'ms_card_exchange(text, jsonb)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- card photos: public to read (the card is public), each rep writes only under their own id
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ms-rep-cards', 'ms-rep-cards', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'ms rep cards: own upload') then
    create policy "ms rep cards: own upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'ms-rep-cards' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'ms rep cards: own update') then
    create policy "ms rep cards: own update" on storage.objects for update to authenticated
      using (bucket_id = 'ms-rep-cards' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;

-- the campaigns a rep can have a card for
create or replace function public.ms_card_campaigns()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color) order by c.created_at, c.name), '[]'::jsonb)
    from ms_campaigns c where c.is_active and ms_rep_has_campaign(c.id)
$$;
revoke all on function public.ms_card_campaigns() from public, anon;
grant execute on function public.ms_card_campaigns() to authenticated;
