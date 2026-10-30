-- TEST project only. Pure helper performance check; no table mutation.
begin read only;
do $perf$
declare lines jsonb; activity jsonb; result jsonb; started timestamptz; report jsonb:='[]';
begin
 select jsonb_agg(jsonb_build_object('product_id',1,'variant_id',i,'qty',10,'unit_price',900,'line_total',9000,'_student_policy_base',1000,'_student_policy_reward',200) order by i) into lines from generate_series(1,6) i;
 activity:=jsonb_build_array(jsonb_build_object('id','a','name','six variants buy6get1','benefit_type','buy_x_get_y','buy_quantity',6,'gift_quantity',1,'repeat_mode','repeat','threshold_type','quantity','threshold_value',7,'allow_student_price_stacking',false,'instructor_reward_eligible',false,'q','[true,true,true,true,true,true]'::jsonb,'b','[true,true,true,true,true,true]'::jsonb,'e','[true,true,true,true,true,true]'::jsonb));
 started:=clock_timestamp();result:=public.solve_student_policy_component(lines,activity,1);
 if (result->>'discount')::numeric<>2400 or (result->>'search_nodes')::integer<>1 then raise exception 'six variants result mismatch';end if;
 report:=report||jsonb_build_array(jsonb_build_object('case','six_variants_sixty_units_buy6get1','discount',result->'discount','search_nodes',result->'search_nodes','elapsed_ms',round(extract(epoch from clock_timestamp()-started)*1000,3)));
 lines:='[{"product_id":1,"variant_id":1,"qty":9999,"unit_price":900,"line_total":8999100,"_student_policy_base":1000,"_student_policy_reward":200}]';
 activity:=jsonb_set(jsonb_set(activity,'{0,buy_quantity}','3'),'{0,threshold_value}','4');
 started:=clock_timestamp();result:=public.solve_student_policy_component(lines,activity,1);
 if (result->>'discount')::numeric<>1499400 or (result->>'search_nodes')::integer<>1 then raise exception 'large quantity result mismatch';end if;
 report:=report||jsonb_build_array(jsonb_build_object('case','one_variant_9999_units_buy3get1','discount',result->'discount','search_nodes',result->'search_nodes','elapsed_ms',round(extract(epoch from clock_timestamp()-started)*1000,3)));
 perform set_config('test.student_policy_performance',report::text,true);
end $perf$;
select current_setting('test.student_policy_performance')::jsonb as report;
rollback;
