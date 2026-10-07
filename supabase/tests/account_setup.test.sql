-- Account setup links: create without a password (needs an email), issue a link (admins only), the
-- setup page sees whose account it is, setting the password uses the link up, a resend cancels the
-- old link, expired links fail, only the hash is stored. In a transaction, rolled back.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000c9', 'admin@login.cpsdms.app'), ('a0000000-0000-0000-0000-0000000000ca', 'nope@login.cpsdms.app');
insert into app_users (id, username, full_name, email) values ('a0000000-0000-0000-0000-0000000000c9', 'admin', 'Admin Person', 'admin@example.com'), ('a0000000-0000-0000-0000-0000000000ca', 'noper', 'No Perm', null);
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000c9', 'sa_users'), ('a0000000-0000-0000-0000-0000000000ca', 'workerbook');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c9', true);
do $$ begin perform app_admin_create_user('Nora Email', null, null, null, array['route_manager'], '{}', null); raise notice 'FAIL created with no password and no email';
  exception when others then raise notice 'ok needs email: %', sqlerrm; end $$;
create temp table made on commit drop as select * from app_admin_create_user('Nora Kelly', null, '416-555-0100', ' nora@example.com ', array['route_manager'], '{}', null);
grant all on made to anon, authenticated;
select 'created' k, username, (select email from app_users where id = made.id) email, (select must_change_password from app_users where id = made.id) must_change from made;
create temp table link on commit drop as select * from app_admin_issue_setup((select id from made));
grant all on link to anon, authenticated;
select 'issued' k, length(code) code_len, email, full_name, username, reply_to, invited_by, expires_at > now() + interval '6 days' week from link;

-- a person without the permission can't issue links, and nobody can read the tokens table
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000ca', true);
do $$ begin perform app_admin_issue_setup((select id from made)); raise notice 'FAIL no-perm issued';
  exception when others then raise notice 'ok no-perm: %', sqlerrm; end $$;
do $$ begin perform count(*) from app_setup_tokens; raise notice 'FAIL tokens readable';
  exception when others then raise notice 'ok tokens hidden: %', sqlerrm; end $$;
select 'no-perm status rows' k, count(*) from app_admin_setup_status();
do $$ begin perform app_setup_record_send('x', 'y', null); raise notice 'FAIL record_send callable';
  exception when others then raise notice 'ok record_send: %', sqlerrm; end $$;
reset role;
select 'stored' k, count(*) rows, bool_and(token_hash <> (select code from link)) hash_only, bool_and(length(token_hash) = 64) sha256 from app_setup_tokens;
select app_setup_record_send((select code from link), 're_123', null);

-- the signed-out setup page
set local role anon;
select 'info' k, * from app_setup_info((select code from link));
select 'bad code' k, count(*) from app_setup_info('nope');
do $$ begin perform app_setup_complete((select code from link), 'short'); raise notice 'FAIL short password';
  exception when others then raise notice 'ok short: %', sqlerrm; end $$;
select 'complete' k, app_setup_complete((select code from link), 'a-good-password') username;
do $$ begin perform app_setup_complete((select code from link), 'another-password'); raise notice 'FAIL used twice';
  exception when others then raise notice 'ok used once: %', sqlerrm; end $$;
reset role;
select 'password set' k, encrypted_password = extensions.crypt('a-good-password', encrypted_password) matches, (select must_change_password from app_users where id = made.id) must_change
  from auth.users, made where auth.users.id = made.id;

-- resend cancels the old link; an expired link fails
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c9', true);
create temp table l2 on commit drop as select * from app_admin_issue_setup((select id from made));
create temp table l3 on commit drop as select * from app_admin_issue_setup((select id from made));
grant all on l2, l3 to anon, authenticated;
select 'status' k, sent_at is not null sent, used_at is not null used, email from app_admin_setup_status() where user_id = (select id from made);
reset role;
set local role anon;
select 'old link after resend' k, count(*) from app_setup_info((select code from l2));
select 'new link' k, count(*) from app_setup_info((select code from l3));
reset role;
update app_setup_tokens set expires_at = now() - interval '1 minute' where used_at is null and cancelled_at is null;
set local role anon;
do $$ begin perform app_setup_complete((select code from l3), 'a-good-password2'); raise notice 'FAIL expired link worked';
  exception when others then raise notice 'ok expired: %', sqlerrm; end $$;
reset role;
-- a disabled account can't get a link
update app_users set is_active = false where id = (select id from made);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c9', true);
do $$ begin perform app_admin_issue_setup((select id from made)); raise notice 'FAIL disabled got a link';
  exception when others then raise notice 'ok disabled: %', sqlerrm; end $$;
-- the old way still works: a starting password, no email
select 'with password' k, username from app_admin_create_user('Pat Nomail', 'start-pass-1', null, null, '{}', '{}', null);
reset role;
rollback;
