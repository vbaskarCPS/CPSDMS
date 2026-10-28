-- RUN_63 — MainstreetAI pitch menu: Kit, Present, Share info.
--
--   Present      each campaign can have a presentation (a page in the app, e.g. /present/taxifi.html) that
--                reps open full-screen at the door; ms_campaigns.present_url, set in Campaigns › Rep kit
--   Share info   more ways to send: WhatsApp and "copied the link" are logged as well as text and email
-- Additive: a column, a wider check, and the kit functions carrying the new field.

alter table public.ms_campaigns add column if not exists present_url text;

alter table public.ms_sends drop constraint if exists ms_sends_channel_check;
alter table public.ms_sends add constraint ms_sends_channel_check check (channel in ('sms', 'email', 'whatsapp', 'link', 'qr'));

create or replace function public.ms_rep_log_send(p_business uuid, p_campaign uuid, p_channel text, p_to text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ms_rep_can(p_business, p_campaign) then raise exception 'Not allowed'; end if;
  if p_channel not in ('sms', 'email', 'whatsapp', 'link', 'qr') then raise exception 'How was it sent?'; end if;
  insert into ms_sends (rep_id, business_id, campaign_id, channel, sent_to) values (auth.uid(), p_business, p_campaign, p_channel, nullif(trim(coalesce(p_to, '')), ''));
end $$;

create or replace function public.ms_save_campaign_kit(p_id uuid, p_kit jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_obj jsonb := coalesce(p_kit->'objections', '[]'::jsonb); v_present text := nullif(trim(coalesce(p_kit->>'present_url', '')), '');
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from ms_campaigns where id = p_id) then raise exception 'No such campaign'; end if;
  if jsonb_typeof(v_obj) <> 'array' then raise exception 'Objections must be a list'; end if;
  if coalesce(p_kit->>'info_url', '') <> '' and p_kit->>'info_url' !~* '^https?://' then raise exception 'The info link must start with http:// or https://'; end if;
  if coalesce(p_kit->>'onepager_url', '') <> '' and p_kit->>'onepager_url' !~* '^https?://' then raise exception 'The one-pager link must start with http:// or https://'; end if;
  if v_present is not null and v_present !~* '^(https://|/)' then raise exception 'The presentation must be a page in the app (/present/…) or start with https://'; end if;
  update ms_campaigns set
    pay_per_deal = nullif(p_kit->>'pay_per_deal', '')::numeric,
    retry_days = coalesce(nullif(p_kit->>'retry_days', '')::int, 90),
    info_url = nullif(trim(coalesce(p_kit->>'info_url', '')), ''),
    info_sms = nullif(trim(coalesce(p_kit->>'info_sms', '')), ''),
    info_email_subject = nullif(trim(coalesce(p_kit->>'info_email_subject', '')), ''),
    info_email_body = nullif(trim(coalesce(p_kit->>'info_email_body', '')), ''),
    pitch = nullif(trim(coalesce(p_kit->>'pitch', '')), ''),
    objections = v_obj,
    onepager_url = nullif(trim(coalesce(p_kit->>'onepager_url', '')), ''),
    present_url = v_present,
    updated_at = now()
   where id = p_id;
end $$;

create or replace function public.ms_rep_kit(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c ms_campaigns;
begin
  if not (ms_rep_has_campaign(p_campaign) or ms_is_admin()) then raise exception 'Not allowed'; end if;
  select * into c from ms_campaigns where id = p_campaign;
  return jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color, 'pitch', c.pitch, 'objections', c.objections,
    'info_url', c.info_url, 'info_sms', c.info_sms, 'info_email_subject', c.info_email_subject, 'info_email_body', c.info_email_body,
    'onepager_url', c.onepager_url, 'present_url', c.present_url, 'pay_per_deal', c.pay_per_deal, 'retry_days', c.retry_days,
    'ref', (select coalesce(rep_code, upper(username)) from app_users where id = auth.uid()));
end $$;

-- Taxifi gets its door deck (and its booking link, when none is set yet)
update public.ms_campaigns set present_url = '/present/taxifi.html' where name ilike 'taxif%' and present_url is null;
update public.ms_campaigns set info_url = 'https://taxifi.ai/talk' where name ilike 'taxif%' and info_url is null;
