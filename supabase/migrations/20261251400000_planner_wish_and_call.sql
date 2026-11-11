-- Wish lists (src/planner/features/shop) and video calls between the two of them (src/planner/features/us).
-- 1. A wish and its pictures are planner docs of kind 'wish' and 'wishimg'.
-- 2. A call being set up is a planner doc of kind 'call' (the two phones leave each other the connection details there).
-- All three are shared by the household the same way the shopping list and the chat are (planner_doc_owner sends a
-- shared kind to the household's owner), so each of them reads what the other wrote.
-- Additive: the kinds already shared are unchanged, and nothing existing is touched.
create or replace function public.planner_shared_kind(p_kind text) returns boolean
language sql immutable set search_path to 'public' as $$
  select p_kind in ('account', 'txns', 'rule', 'budget', 'moneyprefs', 'event', 'shop', 'shopprefs', 'receipt', 'receiptimg', 'chat', 'wish', 'wishimg', 'call')
$$;
