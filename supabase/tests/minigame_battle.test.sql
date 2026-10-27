-- Minigame Battleship: create / join, fleet checks, placing (both ready → battle), the other fleet kept
-- secret, firing (hit = again, miss = turn passes), sinking, the 30-second turn limit, winning, leave,
-- rematch, history, and the table closed to the public key. Run after the accounts migration and this
-- one (psql -v mig=... -v mig4=...); everything is rolled back.
\set ON_ERROR_STOP 1
begin;
\i :mig
\i :mig4

do $$
declare v uuid; r uuid; tv text; tr text; s jsonb; mid uuid; code text; first text; t text; other text; i int; c int; nid uuid;
  -- rows 0-4, ships from column 0 (Carrier 0-4, Battleship 10-13, Cruiser 20-22, Sub 30-32, Destroyer 40-41)
  fleet_a jsonb := '[[0,1,2,3,4],[10,11,12,13],[20,21,22],[30,31,32],[40,41]]';
  -- down the columns
  fleet_b jsonb := '[[9,19,29,39,49],[8,18,28,38],[7,17,27],[6,16,26],[5,15]]';
begin
  select id into v from minigame_players where name = 'Vijay';
  select id into r from minigame_players where name = 'Rosh';
  tv := minigame_sign_in(v, '1234')->>'token';
  tr := minigame_sign_in(r, '5678')->>'token';

  -- fleet rules
  assert minigame_battle_fleet_ok(fleet_a) and minigame_battle_fleet_ok(fleet_b), 'good fleets';
  assert not minigame_battle_fleet_ok('[[0,1,2,3,4],[10,11,12,13],[20,21,22],[30,31,32]]'), 'four ships';
  assert not minigame_battle_fleet_ok('[[0,1,2,3,4],[1,11,21,31],[20,21,22],[30,31,32],[40,41]]'), 'overlap';
  assert not minigame_battle_fleet_ok('[[8,9,10,11,12],[20,21,22,23],[40,41,42],[60,61,62],[80,81]]'), 'wraps a row';
  assert not minigame_battle_fleet_ok('[[0,2,4,6,8],[10,11,12,13],[20,21,22],[30,31,32],[40,41]]'), 'gaps';
  assert not minigame_battle_fleet_ok('[[0,11,22,33,44],[50,51,52,53],[60,61,62],[70,71,72],[80,81]]'), 'diagonal';
  assert not minigame_battle_fleet_ok('[[96,97,98,99,100],[10,11,12,13],[20,21,22],[30,31,32],[40,41]]'), 'off the board';
  assert not minigame_battle_fleet_ok('[[0,1,2,3],[10,11,12,13,14],[20,21,22],[30,31,32],[40,41]]'), 'wrong lengths';
  assert minigame_battle_fleet_ok('[[4,3,2,1,0],[13,12,11,10],[22,21,20],[32,31,30],[41,40]]'), 'any order of cells';

  s := minigame_battle_create(tv); mid := (s->>'id')::uuid; code := s->>'code';
  assert s->>'status' = 'waiting' and code ~ '^[A-Z]{4}$', 'waiting';
  assert minigame_battle_join(tv, code)->>'reason' = 'own_match', 'own code';
  s := minigame_battle_join(tr, code);
  assert s->>'ok' = 'true' and s->'match'->>'status' = 'placing', 'placing';

  -- placing
  assert minigame_battle_place(tv, mid, '[[0,1]]')->>'reason' = 'bad_fleet', 'bad fleet refused';
  s := minigame_battle_place(tv, mid, fleet_a);
  assert s->>'ok' = 'true' and s->'match'->>'status' = 'placing' and s->'match'->'my_ships' = fleet_a, 'Vijay placed, waiting for Rosh';
  assert minigame_battle_place(tv, mid, fleet_b)->>'reason' = 'already_placed', 'no moving ships after Ready';
  s := minigame_battle_state(tr, mid);
  assert s->>'them_ready' = 'true' and s->>'me_ready' = 'false' and s->'my_ships' = 'null'::jsonb, 'Rosh sees Vijay is ready, not where';
  assert not (s::text like '%[0, 1, 2, 3, 4]%'), 'Vijay''s fleet is not in Rosh''s view';
  s := minigame_battle_place(tr, mid, fleet_b);
  s := s->'match';
  assert s->>'status' = 'playing' and s->>'turn' in (v::text, r::text), 'battle on, someone fires first';

  -- make Vijay first, for the test
  update minigame_battle set turn = v where id = mid;
  assert minigame_battle_fire(tr, mid, 0)->'their_shots' = '[]'::jsonb, 'not Rosh''s turn';
  -- Vijay: hit (9 is Rosh's Carrier) → goes again; repeat cell does nothing; miss → Rosh's turn
  s := minigame_battle_fire(tv, mid, 9);
  assert s->'my_shots'->0 = '{"c": 9, "hit": true}'::jsonb and s->>'turn' = v::text and s->'last'->>'hit' = 'true', 'hit, again';
  s := minigame_battle_fire(tv, mid, 9);
  assert jsonb_array_length(s->'my_shots') = 1, 'same cell twice does nothing';
  s := minigame_battle_fire(tv, mid, 0);
  assert s->'my_shots'->1 = '{"c": 0, "hit": false}'::jsonb and s->>'turn' = r::text, 'miss, Rosh''s turn';
  s := minigame_battle_state(tr, mid);
  assert s->'their_shots' = '[{"c": 9, "hit": true}, {"c": 0, "hit": false}]'::jsonb, 'Rosh sees Vijay''s shots on his board';
  -- Rosh sinks Vijay's Destroyer (40, 41)
  s := minigame_battle_fire(tr, mid, 40);
  s := minigame_battle_fire(tr, mid, 41);
  assert s->'their_sunk' = '[{"i": 4, "cells": [40, 41]}]'::jsonb and s->'last'->'sunk'->>'i' = '4', 'Destroyer sunk; Rosh sees where it was';
  assert s->>'turn' = r::text, 'still Rosh';
  s := minigame_battle_state(tv, mid);
  assert s->'my_sunk' = '[{"i": 4, "cells": [40, 41]}]'::jsonb, 'Vijay sees he lost the Destroyer';
  assert s->'their_sunk' = '[]'::jsonb and s->'their_ships' = 'null'::jsonb, 'Vijay still can''t see Rosh''s fleet';

  -- too slow: the turn passes
  update minigame_battle set turn_deadline = now() - interval '1 ms' where id = mid;
  s := minigame_battle_state(tv, mid);
  assert s->>'turn' = v::text and s->'last'->>'timeout' = 'true', 'Rosh ran out of time';

  -- Vijay sinks everything (hits keep his turn)
  for c in select (x::text)::int from jsonb_array_elements(fleet_b) sh, jsonb_array_elements(sh) x loop
    s := minigame_battle_fire(tv, mid, c);
  end loop;
  assert s->>'status' = 'done' and s->>'winner' = v::text and s->>'turn' is null, 'Vijay wins';
  assert jsonb_array_length(s->'their_sunk') = 5, 'all five sunk';
  s := minigame_battle_state(tr, mid);
  assert s->'their_ships' = fleet_a, 'at the end Rosh sees Vijay''s whole fleet';
  assert minigame_battle_fire(tv, mid, 55)->'my_shots'->-1->>'c' <> '55', 'no shots after the end';

  -- history, rematch, leave
  assert minigame_battle_history(tr)->0->>'winner' = v::text, 'in history';
  s := minigame_battle_rematch(tr, mid); nid := (s->'match'->>'id')::uuid;
  assert s->'match'->>'status' = 'waiting', 'rematch waits';
  s := minigame_battle_rematch(tv, mid);
  assert s->'match'->>'id' = nid::text and s->'match'->>'status' = 'placing', 'rematch: placing';
  perform minigame_battle_leave(tv, nid);
  assert minigame_battle_state(tr, nid)->>'status' = 'left', 'left';

  -- an unplaced fleet expires after 30 minutes
  s := minigame_battle_create(tv); mid := (s->>'id')::uuid; perform minigame_battle_join(tr, s->>'code');
  update minigame_battle set started_at = now() - interval '31 minutes' where id = mid;
  assert minigame_battle_state(tv, mid)->>'status' = 'expired', 'placing expired';
end $$;

set local role anon;
do $$ begin
  begin perform 1 from public.minigame_battle; assert false, 'anon read the table'; exception when insufficient_privilege then null; end;
  begin perform public.minigame_battle_view(gen_random_uuid(), gen_random_uuid()); assert false, 'anon viewed'; exception when insufficient_privilege then null; end;
  begin perform public.minigame_battle_cells('[]'); assert false, 'anon helper'; exception when insufficient_privilege then null; end;
end $$;
reset role;
\echo 'minigame battle: all good'
rollback;
