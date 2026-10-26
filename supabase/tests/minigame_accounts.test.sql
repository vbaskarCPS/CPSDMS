-- Minigame accounts: PIN set on first sign-in, wrong PINs and the lock, passes, saving progress,
-- and the tables closed to the public key. Run after the migration; everything is rolled back.
\set ON_ERROR_STOP 1
begin;
\i :mig

do $$
declare v uuid; r uuid; s jsonb; tok text; tok2 text; i int;
begin
  select id into v from minigame_players where name = 'Vijay';
  select id into r from minigame_players where name = 'Rosh';
  assert v is not null and r is not null, 'Vijay and Rosh are seeded';
  assert (select count(*) from jsonb_array_elements(minigame_players_list()) e where (e->>'has_pin')::boolean) = 0, 'no PINs yet';

  -- first sign-in sets the PIN; only 4 digits are accepted
  assert minigame_sign_in(v, '12a4')->>'reason' = 'pin_format', 'letters refused';
  assert minigame_sign_in(v, '123')->>'reason' = 'pin_format', 'three digits refused';
  s := minigame_sign_in(v, '1234');
  assert s->>'ok' = 'true' and s->>'new_pin' = 'true' and s->>'name' = 'Vijay', 'first sign-in sets the PIN';
  tok := s->>'token';
  assert (select pin_hash from minigame_players where id = v) not like '%1234%', 'PIN stored hashed';
  assert minigame_me(tok)->>'name' = 'Vijay', 'the pass knows who it is';

  -- the PIN now has to match
  assert minigame_sign_in(v, '9999')->>'reason' = 'wrong', 'wrong PIN';
  s := minigame_sign_in(v, '1234');
  assert s->>'ok' = 'true' and s->>'new_pin' = 'false', 'right PIN, not a new one';
  tok2 := s->>'token';

  -- five wrong tries lock the player, even with the right PIN after
  for i in 1..4 loop perform minigame_sign_in(v, '0000'); end loop;
  assert minigame_sign_in(v, '0000')->>'reason' = 'locked', 'fifth wrong try locks';
  assert minigame_sign_in(v, '1234')->>'reason' = 'locked', 'locked even with the right PIN';
  update minigame_players set pin_locked_until = now() - interval '1 second' where id = v;
  assert minigame_sign_in(v, '1234')->>'ok' = 'true', 'unlocks after the wait';

  -- progress is per player, per game
  assert minigame_progress_all(tok) = '{}'::jsonb, 'nothing saved yet';
  perform minigame_save(tok, 'pour', '{"level": 19, "best": 19}');
  perform minigame_save(tok, 'pour', '{"level": 20, "best": 20}');
  perform minigame_save(tok, 'chess', '{"stage": 1}');
  assert minigame_progress_all(tok2)->'pour'->>'level' = '20', 'the latest save wins, seen from another phone';
  assert (minigame_progress_all(tok) ? 'chess'), 'each game keeps its own row';
  tok2 := minigame_sign_in(r, '5555')->>'token';
  assert minigame_progress_all(tok2) = '{}'::jsonb, 'Rosh sees only his own progress';
  tok2 := minigame_sign_in(v, '1234')->>'token';

  -- bad game names, non-objects and no pass are refused
  begin perform minigame_save(tok, 'Pour Game!', '{}'); assert false, 'bad game name allowed'; exception when check_violation then null; end;
  begin perform minigame_save(tok, 'pour', '[1,2]'); assert false, 'non-object allowed'; exception when check_violation then null; end;
  begin perform minigame_save('nope', 'pour', '{}'); assert false, 'saved without a pass'; exception when sqlstate '28000' then null; end;
  begin perform minigame_progress_all(null); assert false, 'read without a pass'; exception when sqlstate '28000' then null; end;

  -- signing out ends that pass only; an expired pass stops working
  perform minigame_sign_out(tok);
  assert minigame_me(tok) is null, 'signed out';
  assert minigame_me(tok2)->>'name' = 'Vijay', 'the other phone stays signed in';
  update minigame_passes set expires_at = now() - interval '1 second' where player_id = v;
  assert minigame_me(tok2) is null, 'expired pass';

  -- a reset PIN is chosen again on the next sign-in
  update minigame_players set pin_hash = null where id = r;
  assert minigame_sign_in(r, '7777')->>'new_pin' = 'true', 'reset lets Rosh pick a new PIN';
end $$;

-- the public key can't touch the tables or the internal helper, only the functions
set local role anon;
do $$ begin
  begin perform 1 from minigame_players; assert false, 'anon read players'; exception when insufficient_privilege then null; end;
  begin perform 1 from minigame_progress; assert false, 'anon read progress'; exception when insufficient_privilege then null; end;
  begin perform 1 from minigame_passes; assert false, 'anon read passes'; exception when insufficient_privilege then null; end;
  begin perform minigame_player_of('x'); assert false, 'anon ran the helper'; exception when insufficient_privilege then null; end;
  assert jsonb_array_length(minigame_players_list()) = 2, 'anon can list names';
end $$;
reset role;

\echo 'minigame accounts: all checks passed'
rollback;
