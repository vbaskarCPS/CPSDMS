-- RUN_29: a person reads and writes only their own Master Bookings filters.
\set ON_ERROR_STOP 1
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000f7'), ('a0000000-0000-0000-0000-0000000000f8');
insert into mb_user_filters (user_id, filters) values ('a0000000-0000-0000-0000-0000000000f8', '{"heat":false}');
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f7', true);
set local role authenticated;
insert into mb_user_filters (user_id, filters) values ('a0000000-0000-0000-0000-0000000000f7', '{"heat":true}')
  on conflict (user_id) do update set filters = excluded.filters, updated_at = now();
insert into mb_user_filters (user_id, filters) values ('a0000000-0000-0000-0000-0000000000f7', '{"heat":false}')
  on conflict (user_id) do update set filters = excluded.filters, updated_at = now();
do $$ begin
  if (select count(*) from mb_user_filters) <> 1 then raise exception 'sees someone else''s row'; end if;
  if (select filters->>'heat' from mb_user_filters) <> 'false' then raise exception 'own row not saved'; end if;
  begin
    insert into mb_user_filters (user_id, filters) values ('a0000000-0000-0000-0000-0000000000f8', '{}');
    raise exception 'wrote someone else''s row';
  exception when insufficient_privilege or unique_violation then null; end;
  update mb_user_filters set filters = '{"x":1}' where user_id = 'a0000000-0000-0000-0000-0000000000f8';
end $$;
reset role;
do $$ begin if (select filters->>'heat' from mb_user_filters where user_id = 'a0000000-0000-0000-0000-0000000000f8') <> 'false' then raise exception 'changed someone else''s row'; end if; end $$;
select 'ALL OK' k;
