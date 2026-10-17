-- Apply AFTER the current coupon, gift, member-pricing, professional-shipping
-- and assisted-order migrations. Re-run this migration if those engines are rebuilt.
-- Additive and rerunnable. Existing promotions retain their original audience.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.promotions
  add column if not exists audience_roles text[] not null default array['consumer','pro','instructor','distributor','staff']::text[],
  add column if not exists allow_guest boolean not null default true;

alter table public.promotions drop constraint if exists promotions_audience_check;
alter table public.promotions add constraint promotions_audience_check check (
  audience_roles <@ array['consumer','pro','instructor','distributor','staff']::text[]
  and array_position(audience_roles, null) is null
  and (cardinality(audience_roles) > 0 or allow_guest)
);

-- Private helper: callers supply the identity already resolved by the trusted
-- quote engine. In assisted orders it must be the customer, never the operator.
create or replace function public.automatic_promotion_allows_identity(
  p_promotion_id uuid, p_member_role text, p_customer_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select case when p_customer_id is null then promotion.allow_guest
    else p_member_role = any(promotion.audience_roles) end
    from public.promotions promotion where promotion.id = p_promotion_id), false);
$$;
revoke all on function public.automatic_promotion_allows_identity(uuid,text,uuid) from public, anon, authenticated;

-- Keep the installed pricing implementation, including shipping fixes and
-- identity hardening. Fail atomically on an unknown function shape rather than
-- replacing it with an older canonical engine.
do $migration$
declare
  target record;
  target_function regprocedure;
  definition text;
  anchor text;
  replacement text;
  base_signature text;
begin
  base_signature := case when to_regprocedure('public.quote_order_pricing_internal_20260916(jsonb,text)') is not null
    then 'public.quote_order_pricing_internal_20260916(jsonb,text)'
    else 'public.quote_order_pricing(jsonb,text)' end;
  for target in select * from (values
    (base_signature, 'promotion', 'member_role', 'auth.uid()', true),
    ('public.quote_order_pricing_discount_v2(jsonb,text,text,text)', 'promotion', 'member_role', 'current_user_id', true),
    ('public.quote_order_pricing(jsonb,text,text,text)', 'promotion', '(result ->> ''member_role'')', 'auth.uid()', true),
    ('public.assisted_discount_quote(jsonb,text,text,text,uuid,boolean)', 'promotion', 'member_role', 'current_user_id', false),
    ('public.assisted_gift_quote(jsonb,text,text,text,uuid,boolean)', 'promotion', '(result ->> ''member_role'')', 'p_customer_id', false),
    ('public.quote_assisted_order(jsonb)', 'p', 'customer_role', 'customer_id', false)
  ) as targets(signature, alias_name, role_expression, identity_expression, required)
  loop
    target_function := to_regprocedure(target.signature);
    if target_function is null then
      if target.required then raise exception 'Required promotion engine missing: %', target.signature; end if;
      continue;
    end if;
    definition := pg_get_functiondef(target_function);
    -- A later assisted-engine rebuild can inherit the storefront gift filter.
    -- Rebind it to the customer instead of adding an operator-based condition.
    if target.signature = 'public.assisted_gift_quote(jsonb,text,text,text,uuid,boolean)' then
      definition := replace(definition,
        'public.automatic_promotion_allows_identity(promotion.id, (result ->> ''member_role''), auth.uid())',
        'public.automatic_promotion_allows_identity(promotion.id, (result ->> ''member_role''), p_customer_id)');
    end if;
    replacement := format('public.automatic_promotion_allows_identity(%s.id, %s, %s)',
      target.alias_name, target.role_expression, target.identity_expression);
    if position(replacement in definition) > 0 then
      execute definition;
      continue;
    end if;
    -- The compact assisted legacy evaluator uses no spaces around equals.
    anchor := case when target.alias_name = 'p' then 'p.activation_type=''automatic'''
      else 'promotion.activation_type = ''automatic''' end;
    if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
      raise exception 'Unknown promotion engine shape: %', target.signature;
    end if;
    definition := replace(definition, anchor, anchor || ' and ' || replacement);
    execute definition;
  end loop;
end $migration$;

-- Wrap the installed transactional editor so omitted fields from older clients
-- preserve the saved audience. The private editor cannot bypass this validation.
do $$
declare definition text;
begin
  if to_regprocedure('public.save_discount_promotion_before_audience_20261017(jsonb)') is null then
    alter function public.save_discount_promotion(jsonb) rename to save_discount_promotion_before_audience_20261017;
  else
    definition := pg_get_functiondef('public.save_discount_promotion(jsonb)'::regprocedure);
    if position('public.save_discount_promotion_before_audience_20261017(p_payload)' in definition) = 0 then
      -- Preserve a newer editor installed by a subsequent engine rebuild.
      execute replace(definition, 'FUNCTION public.save_discount_promotion(',
        'FUNCTION public.save_discount_promotion_before_audience_20261017(');
    end if;
  end if;
end;
$$;
revoke all on function public.save_discount_promotion_before_audience_20261017(jsonb) from public, anon, authenticated;

create or replace function public.save_discount_promotion(p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target_id uuid;
  selected_roles text[];
  guests boolean;
begin
  if not public.has_backoffice_permission('promotions.manage') then
    raise exception 'Promotion management access required' using errcode = '42501';
  end if;
  if p_payload ? 'audience_roles' then
    if jsonb_typeof(p_payload->'audience_roles') is distinct from 'array' then
      raise exception 'Invalid promotion audience roles' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct role_name), '{}'::text[]) into selected_roles
      from jsonb_array_elements_text(p_payload->'audience_roles') role_name;
    if not selected_roles <@ array['consumer','pro','instructor','distributor','staff']::text[]
      or array_position(selected_roles, null) is not null then
      raise exception 'Invalid promotion audience roles' using errcode = '22023';
    end if;
  end if;
  if p_payload ? 'allow_guest' then
    if jsonb_typeof(p_payload->'allow_guest') is distinct from 'boolean' then
      raise exception 'Invalid promotion guest setting' using errcode = '22023';
    end if;
    guests := (p_payload->>'allow_guest')::boolean;
  end if;
  target_id := public.save_discount_promotion_before_audience_20261017(p_payload);
  update public.promotions set audience_roles = coalesce(selected_roles, audience_roles),
    allow_guest = coalesce(guests, allow_guest) where id = target_id;
  -- The table constraint also rejects an empty audience; everything rolls back.
  return target_id;
end;
$$;
revoke all on function public.save_discount_promotion(jsonb) from public, anon;
grant execute on function public.save_discount_promotion(jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
