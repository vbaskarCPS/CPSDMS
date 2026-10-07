-- Security check follow-up: pin the search path of the address-key helper (advisor 0011).
alter function public.client_address_key(text, text, text, text) set search_path = public;
