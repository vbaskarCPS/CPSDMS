-- Card Processing: a sale is now a list of services with one total price, asked the way the worker app's upsell
-- recipes ask (full property / front only / back only for each; spring only / fall only / both for the grub-type
-- plans), plus what the crew needs to know about the property: a locked gate, sprinklers, and a note.
--   card_sales.items  [{ service, label, property_type, timing }]   (no price or season on an item any more)
--   card_sales.locked_gate / sprinklers                              the property, once per sale

alter table public.card_sales add column if not exists locked_gate boolean not null default false;
alter table public.card_sales add column if not exists sprinklers boolean not null default false;

create or replace function public.card_sales_list(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not card_can() then raise exception 'Card Processing isn’t turned on for your account'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (select s.id, s.created_at, s.processed_by_name, s.first_name, s.last_name, s.phone, s.email, s.address, s.city, s.province,
                   s.postal_code, s.items, s.locked_gate, s.sprinklers, s.total, s.subtotal, s.tax_amount, s.tax_name, s.tax_rate, s.notes, s.status,
                   s.transaction_id, s.auth_code, s.card_type, s.last4, s.message, s.receipt_to, s.receipt_sent_at, s.receipt_error
              from card_sales s
             where s.created_at >= (p_from::timestamp at time zone 'America/Toronto')
               and s.created_at < ((p_to + 1)::timestamp at time zone 'America/Toronto')
             order by s.created_at desc limit 3000) x), '[]'::jsonb);
end $$;
revoke all on function public.card_sales_list(date, date) from public, anon;
grant execute on function public.card_sales_list(date, date) to authenticated;
