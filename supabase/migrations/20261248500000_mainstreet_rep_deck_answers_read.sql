-- MainstreetAI rep app: the rep can see a business's questionnaire and proposal again. ADDITIVE ONLY.
-- The deck's answers are saved on the business per campaign (ms_business_answers, ms_save_deck_answers); until now
-- only hosts and admins saw them. A rep who can work that business on that campaign (ms_rep_can) or an admin gets
-- them back, with when they were saved and by whom. The app shows them, reopens the deck filled in with them, and
-- can put a copy in an email to the owner.

create or replace function public.ms_rep_deck_answers(p_business uuid, p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not (ms_is_admin() or ms_rep_can(p_business, p_campaign)) then raise exception 'Not allowed'; end if;
  select jsonb_build_object('data', a.data, 'updated_at', a.updated_at, 'updated_by', u.full_name)
    into r
    from ms_business_answers a left join app_users u on u.id = a.updated_by
   where a.business_id = p_business and a.campaign_id = p_campaign;
  return r;   -- null: no answers yet
end $$;
revoke all on function public.ms_rep_deck_answers(uuid, uuid) from public, anon;
grant execute on function public.ms_rep_deck_answers(uuid, uuid) to authenticated;
