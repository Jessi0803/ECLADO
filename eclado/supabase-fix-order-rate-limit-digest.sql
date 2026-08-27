-- Hotfix: keep the order-creation rate-limit trigger locked to an empty
-- search_path while explicitly resolving pgcrypto from the extensions schema.

create or replace function public.enforce_order_creation_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text := coalesce(auth.role(), '');
  identity_value text;
  identity_hash text;
begin
  if caller_role not in ('anon', 'authenticated') then
    return new;
  end if;

  if length(coalesce(new.member, '')) > 100
     or length(coalesce(new.email, '')) > 254
     or length(coalesce(new.phone, '')) > 30
     or length(coalesce(new.address, '')) > 500
     or length(coalesce(new.note, '')) > 1000 then
    raise exception 'Order contact fields are too long' using errcode = '22001';
  end if;

  identity_value := case
    when new.user_id is not null then 'user:' || new.user_id::text
    else 'guest:' || lower(trim(coalesce(new.email, ''))) || ':'
      || regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g')
  end;
  identity_hash := encode(
    extensions.digest(identity_value::text, 'sha256'::text),
    'hex'
  );

  if not public.consume_rate_limit_internal('order:create', identity_hash, 8, 900) then
    raise exception 'Too many order attempts. Please try again later.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_order_creation_rate_limit() from public;

comment on function public.enforce_order_creation_rate_limit() is
  'Validates order contact length and applies per-identity order rate limits using schema-qualified pgcrypto.';
