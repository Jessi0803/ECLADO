-- Phase 3: read-only projections. Requires 2A/2B. Never enables student pricing.
begin;
do $$ begin
  if to_regclass('public.instructor_reward_ledger') is null or to_regclass('public.student_reward_snapshots') is null then
    raise exception '2A and 2B are required';
  end if;
end $$;

-- Private whitelist projection; one STABLE statement snapshot for every page.
create or replace function public.instructor_reward_report_internal(
  p_instructor_id uuid,p_offset integer,p_limit integer,p_ledger_offset integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if p_instructor_id is null or p_offset is null or p_offset<0 or p_ledger_offset is null
    or p_ledger_offset<0 or p_limit is null or p_limit<1 or p_limit>50 then
    raise exception 'Invalid reward query page' using errcode='22023';
  end if;
  select jsonb_build_object(
    'summary',jsonb_build_object(
      'balance',coalesce((select balance from public.instructor_reward_accounts where user_id=p_instructor_id),0),
      'available_balance',greatest(0,coalesce((select balance from public.instructor_reward_accounts where user_id=p_instructor_id),0)),
      'pending_balance',coalesce((select pending_balance from public.instructor_reward_accounts where user_id=p_instructor_id),0),
      'credited_total',coalesce((select sum(amount) from public.instructor_reward_ledger where instructor_id=p_instructor_id and event_type='credit'),0),
      'reversed_total',coalesce((select sum(amount) from public.instructor_reward_ledger where instructor_id=p_instructor_id and event_type='reverse'),0)),
    'order_count',(select count(*) from public.student_reward_snapshots where instructor_id=p_instructor_id),
    'ledger_count',(select count(*) from public.instructor_reward_ledger where instructor_id=p_instructor_id),
    'orders',coalesce((select jsonb_agg(q.payload order by q.created_at desc,q.order_id desc) from (
      select s.created_at,s.order_id,jsonb_build_object(
        'order_id',s.order_id,'created_at',s.created_at,'order_source',s.order_source,
        'student_name',p.name,'student_deleted',p.id is null,
        'order_status',o.status,'order_missing',o.id is null,
        'reward_status',st.status,'total_reward',s.total_reward,
        'items',(select jsonb_agg(jsonb_build_object(
          'product_id',i->'product_id','variant_id',i->'variant_id','qty',i->'qty',
          'name',coalesce(o.items->((i->>'line_index')::integer-1)->>'name',
            o.items->((i->>'line_index')::integer-1)->>'name_zh'),
          'size',o.items->((i->>'line_index')::integer-1)->>'size',
          'unit_price',i->'basis_unit_price','reward',i->'reward') order by (i->>'line_index')::integer)
          from jsonb_array_elements(s.items) i)) payload
      from public.student_reward_snapshots s
      left join public.profiles p on p.id=s.student_id
      left join public.orders o on o.id=s.order_id
      left join public.instructor_reward_order_states st on st.order_id=s.order_id and st.instructor_id=s.instructor_id
      where s.instructor_id=p_instructor_id order by s.created_at desc,s.order_id desc
      limit p_limit offset p_offset) q),'[]'::jsonb),
    'entries',coalesce((select jsonb_agg(q.payload order by q.id desc) from (
      select l.id,jsonb_build_object('id',l.id,'order_id',l.order_id,'event_type',l.event_type,
        'amount',l.amount,'balance_delta',l.balance_delta,'pending_delta',l.pending_delta,
        'balance_after',l.balance_after,'pending_after',l.pending_after,'created_at',l.created_at) payload
      from public.instructor_reward_ledger l where l.instructor_id=p_instructor_id
      order by l.id desc limit p_limit offset p_ledger_offset) q),'[]'::jsonb)
  ) into result;
  return result;
end $$;

create or replace function public.assert_instructor_reward_read_admin()
returns void language plpgsql stable security definer set search_path='' as $$ begin
  if auth.uid() is null or not public.is_eclado_admin()
    or not public.has_backoffice_permission('orders.read')
    or not public.has_backoffice_permission('members.read') then
    raise exception '返饋帳務查詢權限不足' using errcode='42501';
  end if;
end $$;

create or replace function public.get_admin_instructor_reward_report(
  p_instructor_id uuid,p_offset integer default 0,p_limit integer default 20,p_ledger_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
  perform public.assert_instructor_reward_read_admin();
  return public.instructor_reward_report_internal(p_instructor_id,p_offset,p_limit,p_ledger_offset);
end $$;

create or replace function public.get_admin_instructor_reward_accounts(p_offset integer default 0,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
  perform public.assert_instructor_reward_read_admin();
  if p_offset is null or p_offset<0 or p_limit is null or p_limit<1 or p_limit>50 then
    raise exception 'Invalid reward query page' using errcode='22023';
  end if;
  return (with ids as (
    select user_id id from public.instructor_reward_accounts union select id from public.profiles where role='instructor'
  ), rows as (
    select ids.id,p.name,p.role,coalesce(a.balance,0) balance,coalesce(a.pending_balance,0) pending_balance,
      a.status account_status,p.id is null member_deleted,
      (select count(*) from public.instructor_student_bindings b where b.instructor_id=ids.id and b.ended_at is null) student_count,
      coalesce((select sum(balance_delta) from public.instructor_reward_ledger where instructor_id=ids.id),0)<>coalesce(a.balance,0)
      or coalesce((select sum(pending_delta) from public.instructor_reward_ledger where instructor_id=ids.id),0)<>coalesce(a.pending_balance,0)
      or exists(select 1 from public.student_reward_snapshots s left join public.instructor_reward_order_states st on st.order_id=s.order_id
        where s.instructor_id=ids.id and (st.order_id is null or st.instructor_id<>s.instructor_id or st.amount<>s.total_reward)) inconsistent
    from ids left join public.profiles p on p.id=ids.id left join public.instructor_reward_accounts a on a.user_id=ids.id
  ) select jsonb_build_object('total',(select count(*) from rows),'accounts',coalesce((select jsonb_agg(to_jsonb(q) order by q.id)
    from (select * from rows order by id limit p_limit offset p_offset) q),'[]'::jsonb)));
end $$;
revoke all on function public.instructor_reward_report_internal(uuid,integer,integer,integer),
  public.assert_instructor_reward_read_admin(),public.get_admin_instructor_reward_report(uuid,integer,integer,integer),
  public.get_admin_instructor_reward_accounts(integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_instructor_reward_report(uuid,integer,integer,integer),
  public.get_admin_instructor_reward_accounts(integer,integer) to authenticated;
create or replace function public.get_my_instructor_reward_report(
  p_offset integer default 0,p_limit integer default 20,p_ledger_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='instructor') then
    raise exception '師資資格不足' using errcode='42501';
  end if;
  return public.instructor_reward_report_internal(auth.uid(),p_offset,p_limit,p_ledger_offset);
end $$;
revoke all on function public.get_my_instructor_reward_report(integer,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_my_instructor_reward_report(integer,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
