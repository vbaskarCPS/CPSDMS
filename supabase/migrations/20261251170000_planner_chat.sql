-- The chat for the two of them (src/planner/features/us, supabase/functions/planner-chat).
-- 1. Messages are planner docs of kind 'chat', shared by the household the same way the shopping list is
--    (planner_doc_owner sends a shared kind to the household's owner), so both read the same conversation.
-- 2. Their photos and videos go in a private bucket. It has no policies: only the planner-chat function
--    (service role) writes and reads it, handing each phone short-lived signed links after checking the
--    planner token. Planner users have no Supabase account, so nothing else could reach it anyway.
-- Additive: the kinds already shared are unchanged, and nothing existing is touched.
create or replace function public.planner_shared_kind(p_kind text) returns boolean
language sql immutable set search_path to 'public' as $$
  select p_kind in ('account', 'txns', 'rule', 'budget', 'moneyprefs', 'event', 'shop', 'shopprefs', 'receipt', 'receiptimg', 'chat')
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('planner-chat', 'planner-chat', false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do nothing;
