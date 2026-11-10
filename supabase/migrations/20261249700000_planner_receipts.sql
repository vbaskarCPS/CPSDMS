-- Planner: receipts. Docs of kind 'receipt' (what a receipt says, and the bank or cash row it belongs to) and
-- 'receiptimg' (a small black-and-white copy of each photo) live under the household owner, like the money
-- docs they go with, so Vijay and Rosh see the same receipts. Additive: only the list of shared kinds changes.
create or replace function public.planner_shared_kind(p_kind text)
returns boolean language sql immutable set search_path = public as $$
  select p_kind in ('account', 'txns', 'rule', 'budget', 'moneyprefs', 'event', 'shop', 'shopprefs', 'receipt', 'receiptimg')
$$;
