-- RUN_21 — a second PCL text per worker, for the other service's past clients (aeration customers
-- in a sealing session, sealing customers in an aeration one). Their own list on the worker map.
-- ADDITIVE ONLY: one new nullable column.
alter table public.worker_pcl_templates add column if not exists other_body_text text;
