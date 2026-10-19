-- Finishing a client import: marks it done and keeps its routes; the maps are refreshed in batches after.
\set ON_ERROR_STOP 1
\i :mig

insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000f8');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000f8', 'tiqad', 'TIQ Admin');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000f8', 'sa_territory');
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f8', true);

insert into client_imports (id, file_name, source, status) values ('b0000000-0000-0000-0000-000000000001', 'tiq.xlsx', 'file', 'running');
insert into clients (id, address_key, house_no, street_name, street_norm, route_code)
select ('c0000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, 'tiq' || g, g::text, 'Tiq St', 'tiq st', 'TIQ' || lpad(g::text, 2, '0') from generate_series(1, 45) g;
insert into client_import_changes (import_id, client_id, action)
select 'b0000000-0000-0000-0000-000000000001', ('c0000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, 'insert' from generate_series(1, 45) g;

do $$
declare v jsonb; r jsonb;
begin
  v := app_client_import_complete('b0000000-0000-0000-0000-000000000001', '{"x":1}');
  if (v->>'routes_to_refresh')::int <> 45 then raise exception 'routes to refresh: %', v; end if;
  if (select status from client_imports where id = 'b0000000-0000-0000-0000-000000000001') <> 'done' then raise exception 'not done'; end if;
  if (select cardinality(refresh_routes) from client_imports where id = 'b0000000-0000-0000-0000-000000000001') <> 45 then raise exception 'routes not kept'; end if;
  r := app_client_import_refresh('b0000000-0000-0000-0000-000000000001', 20);
  if r <> '{"done": 20, "remaining": 25}' then raise exception 'batch 1: %', r; end if;
  r := app_client_import_refresh('b0000000-0000-0000-0000-000000000001', 20);
  if r <> '{"done": 20, "remaining": 5}' then raise exception 'batch 2: %', r; end if;
  r := app_client_import_refresh('b0000000-0000-0000-0000-000000000001', 20);
  if r <> '{"done": 5, "remaining": 0}' then raise exception 'batch 3: %', r; end if;
  r := app_client_import_refresh('b0000000-0000-0000-0000-000000000001', 20);
  if r <> '{"done": 0, "remaining": 0}' then raise exception 'after: %', r; end if;
  if (select cardinality(refresh_routes) from client_imports where id = 'b0000000-0000-0000-0000-000000000001') <> 0 then raise exception 'routes left over'; end if;
  raise notice 'import refresh in batches: ok';
end $$;

-- without Territory: refused
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  perform app_client_import_refresh('b0000000-0000-0000-0000-000000000001', 20);
  raise exception 'refresh allowed without Territory';
exception when others then if sqlerrm <> 'Not allowed' then raise; end if; end $$;
rollback;
