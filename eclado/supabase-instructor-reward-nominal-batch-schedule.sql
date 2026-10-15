-- Pre-production cleanup: remove the unused annual bank-calendar design and
-- retain only the Asia/Taipei monthly cutoff. Existing withdrawal rows keep
-- their batch_date and scheduled_date.
begin;
do $$ begin
 if to_regprocedure('public.reward_withdrawal_schedule(timestamptz)') is null or to_regclass('public.instructor_reward_withdrawals') is null then
  raise exception 'Stage 5 reward withdrawals are required';
 end if;
end $$;

create or replace function public.reward_withdrawal_schedule(p_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare local_at timestamp:=p_at at time zone 'Asia/Taipei';batch date;
begin
 batch:=(date_trunc('month',local_at)+interval '9 days')::date;
 if local_at>=batch::timestamp then batch:=(batch+interval '1 month')::date;end if;
 return jsonb_build_object('batch_date',batch,'scheduled_date',batch);
end $$;

create or replace function public.get_admin_reward_withdrawals(p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 perform public.assert_reward_withdrawal_admin(false);if p_offset is null or p_offset<0 then raise exception 'Invalid offset';end if;
 return jsonb_build_object('total',(select count(*) from public.instructor_reward_withdrawals),
 'withdrawals',coalesce((select jsonb_agg(public.reward_withdrawal_projection(id) order by created_at desc,id) from
 (select id,created_at from public.instructor_reward_withdrawals order by created_at desc,id limit 20 offset p_offset) q),'[]'));end $$;

-- Replace the already-installed request body before removing its old column.
-- CREATE OR REPLACE preserves the existing owner and EXECUTE ACL.
create or replace function public.request_my_reward_withdrawal(p_request_key uuid,p_expected_quote jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$ declare q jsonb;w public.instructor_reward_withdrawals%rowtype;begin
 if auth.uid() is null or p_request_key is null then raise exception 'Invalid withdrawal identity/request key' using errcode='42501';end if;
 perform 1 from auth.users where id=auth.uid() for key share;
 perform 1 from public.profiles where id=auth.uid() and role='instructor' for share;
 if not found then raise exception '師資資格不足' using errcode='42501';end if;
 perform 1 from public.instructor_reward_accounts where user_id=auth.uid() for update;
 select * into w from public.instructor_reward_withdrawals where user_id=auth.uid() and request_key=p_request_key;
 if found then return jsonb_build_object('id',w.id,'status',w.status);end if;
 perform 1 from public.instructor_reward_bank_profiles where user_id=auth.uid() for share;
 q:=public.quote_my_reward_withdrawal();
 if q is distinct from p_expected_quote then raise exception '餘額、銀行資料或批次已變更，請重新確認' using errcode='40001';end if;
 insert into public.instructor_reward_withdrawals(user_id,request_key,amount,net_amount,bank_cipher,bank_masked,bank_version,batch_date,scheduled_date)
 select auth.uid(),p_request_key,(q->>'amount')::bigint,(q->>'net_amount')::bigint,cipher,masked,version,(q->>'batch_date')::date,(q->>'scheduled_date')::date from public.instructor_reward_bank_profiles where user_id=auth.uid() returning * into w;
 perform public.post_reward_withdrawal(w.id,'withdraw_reserve');
 insert into public.instructor_reward_withdrawal_events(withdrawal_id,event_key,event_type,actor_user_id) values(w.id,p_request_key,'requested',auth.uid());
 return jsonb_build_object('id',w.id,'status',w.status);end $$;

drop function if exists public.publish_reward_bank_calendar(integer,date[],text);
alter table public.instructor_reward_withdrawals drop column if exists calendar_versions;
drop table if exists public.instructor_reward_bank_calendar_versions;
notify pgrst,'reload schema';
commit;
