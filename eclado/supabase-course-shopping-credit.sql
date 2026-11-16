begin;

-- The existing append-only ledger is both the credit record and the
-- idempotency record. A course order can contain multiple qualifying seats.
create unique index if not exists shopping_credit_one_paid_grant_per_course_registration
  on public.shopping_credit_ledger ((metadata->>'course_registration_id'))
  where event_type = 'grant' and reason_code in ('course_delegated_grant', 'course_pro_grant');

create or replace view public.pending_course_shopping_credit as
select r.id as registration_id, r.course_id, r.order_id, o.payer_id,
  o.unit_price_twd as credit_amount,
  case when r.kind = 'pro_self' then 'course_pro_grant' else 'course_delegated_grant' end as reason_code
from public.course_registrations r
join public.course_orders o on o.id = r.order_id and o.course_id = r.course_id
join public.profiles p on p.id = o.payer_id
left join public.shopping_credit_accounts a on a.user_id = o.payer_id
where r.status = 'active'
  and ((r.kind = 'delegated' and o.payer_role = 'instructor')
    or (r.kind = 'pro_self' and o.payer_role = 'pro' and r.member_id = o.payer_id))
  and o.status = 'paid' and o.paid_at is not null and o.unit_price_twd > 0
  and (a.user_id is null or a.status = 'active')
  and not exists (
    select 1 from public.shopping_credit_ledger l
    where l.event_type = 'grant' and l.reason_code in ('course_delegated_grant', 'course_pro_grant')
      and l.metadata->>'course_registration_id' = r.id::text
  );
revoke all on public.pending_course_shopping_credit from public, anon, authenticated, service_role;

create or replace function public.grant_finished_course_shopping_credit()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  course_id_to_grant uuid;
  seat record;
  account public.shopping_credit_accounts%rowtype;
  granted integer := 0;
begin
  -- Concurrent ticks can exit promptly. Each transaction takes at most one
  -- course lock, in the same order as cancellation and payment confirmation.
  if not pg_try_advisory_xact_lock(hashtextextended('grant_finished_course_shopping_credit', 0)) then
    return jsonb_build_object('status', 'busy', 'granted', 0);
  end if;

  select c.id into course_id_to_grant
  from public.courses c
  where c.ends_at <= statement_timestamp()
    and exists (select 1 from public.pending_course_shopping_credit p where p.course_id = c.id)
  order by c.ends_at, c.id
  limit 1
  for update of c skip locked;

  if course_id_to_grant is null then
    return jsonb_build_object('status', 'complete', 'granted', 0);
  end if;

  -- Read eligibility after taking the course lock so a cancellation committed
  -- before the lock is reflected in the batch.
  for seat in
    select * from public.pending_course_shopping_credit
    where course_id = course_id_to_grant
    order by payer_id, registration_id
    limit 100
  loop
    perform 1 from public.profiles where id = seat.payer_id for key share;
    if not found then continue; end if;

    insert into public.shopping_credit_accounts (user_id)
      values (seat.payer_id) on conflict (user_id) do nothing;
    select * into account from public.shopping_credit_accounts
      where user_id = seat.payer_id for update;
    if account.status <> 'active' then continue; end if;

    insert into public.shopping_credit_ledger (
      user_id, event_type, amount, available_delta, reserved_delta,
      available_balance_after, reserved_balance_after, reason_code, metadata
    ) values (
      seat.payer_id, 'grant', seat.credit_amount, seat.credit_amount, 0,
      account.available_balance + seat.credit_amount, account.reserved_balance,
      seat.reason_code, jsonb_build_object(
        'course_id', seat.course_id, 'course_order_id', seat.order_id,
        'course_registration_id', seat.registration_id
      )
    )
    on conflict ((metadata->>'course_registration_id'))
      where event_type = 'grant' and reason_code in ('course_delegated_grant', 'course_pro_grant')
    do nothing;
    if not found then continue; end if;

    update public.shopping_credit_accounts
      set available_balance = account.available_balance + seat.credit_amount,
        version = version + 1, updated_at = clock_timestamp()
      where user_id = seat.payer_id;
    granted := granted + 1;
  end loop;

  return jsonb_build_object('status', 'complete', 'granted', granted);
end;
$$;

revoke all on function public.grant_finished_course_shopping_credit() from public, anon, authenticated;
grant execute on function public.grant_finished_course_shopping_credit() to service_role;

commit;
