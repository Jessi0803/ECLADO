-- TEST ONLY: qqlgqasbmbicnmvnlqbr. Never run against production.

BEGIN;

SET LOCAL statement_timeout='120s';

SET LOCAL lock_timeout='10s';

SET LOCAL check_function_bodies=false;

SET LOCAL search_path=public,extensions,auth;

DO $guard$ BEGIN
 IF to_regclass('public.student_pricing_feature_settings') IS NOT NULL
 OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v'))<>5
 OR EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM public.orders)
 OR EXISTS(SELECT 1 FROM public.profiles) THEN
 RAISE EXCEPTION 'Refusing: target is not the reviewed empty legacy test baseline';
 END IF;
 END $guard$;

DROP TRIGGER "trg_orders_inventory_sync" ON public."orders";

DROP TRIGGER "trg_orders_updated_at" ON public."orders";

DROP TRIGGER "trg_products_updated_at" ON public."products";

DROP TRIGGER "trg_professional_applications_updated_at" ON public."professional_applications";

DROP TRIGGER "trg_profiles_updated_at" ON public."profiles";

DROP TRIGGER "trg_promotions_updated_at" ON public."promotions";

DROP POLICY "orders_insert_all" ON public."orders";

DROP POLICY "orders_select_all" ON public."orders";

DROP POLICY "orders_update_all" ON public."orders";

DROP POLICY "products_insert_all" ON public."products";

DROP POLICY "products_select_all" ON public."products";

DROP POLICY "products_update_all" ON public."products";

DROP POLICY "professional_applications_insert_all" ON public."professional_applications";

DROP POLICY "professional_applications_select_all" ON public."professional_applications";

DROP POLICY "professional_applications_update_all" ON public."professional_applications";

DROP POLICY "profiles_insert_all" ON public."profiles";

DROP POLICY "profiles_select_all" ON public."profiles";

DROP POLICY "profiles_update_all" ON public."profiles";

DROP POLICY "promotions_delete_all" ON public."promotions";

DROP POLICY "promotions_insert_all" ON public."promotions";

DROP POLICY "promotions_select_all" ON public."promotions";

DROP POLICY "promotions_update_all" ON public."promotions";

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pgcrypto') THEN RAISE EXCEPTION 'pgcrypto required'; END IF; END $$;

CREATE SEQUENCE public."inventory_allocation_events_id_seq" AS bigint INCREMENT 1 MINVALUE 1 MAXVALUE 9223372036854775807 START 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE public."inventory_count_items_id_seq" AS bigint INCREMENT 1 MINVALUE 1 MAXVALUE 9223372036854775807 START 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE public."inventory_count_shortages_id_seq" AS bigint INCREMENT 1 MINVALUE 1 MAXVALUE 9223372036854775807 START 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE public."order_inventory_allocations_id_seq" AS bigint INCREMENT 1 MINVALUE 1 MAXVALUE 9223372036854775807 START 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE public."product_variants_id_seq" AS bigint INCREMENT 1 MINVALUE 1 MAXVALUE 9223372036854775807 START 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE public."products_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE public."purchase_order_number_seq" AS bigint INCREMENT 1 MINVALUE 1 MAXVALUE 9223372036854775807 START 1 CACHE 1 NO CYCLE;

CREATE OR REPLACE FUNCTION public.next_purchase_order_number()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select 'PO-' || to_char(now() at time zone 'Asia/Taipei', 'YYYYMMDD') || '-'
    || lpad(nextval('public.purchase_order_number_seq')::text, 4, '0');
$function$;

CREATE TABLE public."admin_preferences" (
"user_id" uuid NOT NULL,
"sidebar_favorites" text[] DEFAULT '{}'::text[] NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."admin_users" (
"user_id" uuid NOT NULL,
"role" text DEFAULT 'admin'::text NOT NULL,
"active" boolean DEFAULT true NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"created_by" uuid
);

CREATE TABLE public."api_rate_limits" (
"scope" text NOT NULL,
"key_hash" text NOT NULL,
"window_started_at" timestamp with time zone NOT NULL,
"request_count" integer DEFAULT 0 NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."assisted_order_requests" (
"request_key" uuid NOT NULL,
"actor_user_id" uuid NOT NULL,
"payload" jsonb NOT NULL,
"order_id" text,
"payment_token" text NOT NULL,
"link_token" text NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"pricing_context" jsonb DEFAULT '[]'::jsonb NOT NULL,
"credit_consent_at" timestamp with time zone,
"credit_consent_amount" bigint
);

CREATE TABLE public."audit_logs" (
"id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"actor_user_id" uuid,
"actor_email" text,
"actor_role" text,
"actor_type" text DEFAULT 'admin'::text NOT NULL,
"action" text NOT NULL,
"entity_type" text NOT NULL,
"entity_id" text NOT NULL,
"before_data" jsonb,
"after_data" jsonb,
"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
"request_id" uuid DEFAULT gen_random_uuid() NOT NULL
);

CREATE TABLE public."backoffice_role_permissions" (
"role" text NOT NULL,
"permission" text NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."backoffice_roles" (
"role" text NOT NULL,
"label" text NOT NULL,
"active" boolean DEFAULT true NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."coupon_campaign_members" (
"id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
"coupon_campaign_id" uuid NOT NULL,
"user_id" uuid NOT NULL,
"created_by" uuid,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."coupon_campaigns" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"name" text NOT NULL,
"description" text,
"code" text NOT NULL,
"code_normalized" text NOT NULL,
"start_at" timestamp with time zone,
"end_at" timestamp with time zone,
"active" boolean DEFAULT true NOT NULL,
"total_usage_limit" integer,
"per_member_limit" integer,
"audience_roles" text[] DEFAULT ARRAY['consumer'::text, 'pro'::text, 'instructor'::text, 'distributor'::text] NOT NULL,
"allow_guest" boolean DEFAULT true NOT NULL,
"stacking_policy" text DEFAULT 'allow_auto_gifts'::text NOT NULL,
"created_by" uuid,
"updated_by" uuid,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"archived_at" timestamp with time zone,
"audience_mode" text DEFAULT 'roles'::text NOT NULL
);

CREATE TABLE public."coupon_promotions" (
"id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
"coupon_campaign_id" uuid NOT NULL,
"promotion_id" uuid NOT NULL,
"sort_order" integer DEFAULT 0 NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."coupon_redemptions" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"coupon_campaign_id" uuid NOT NULL,
"order_id" text NOT NULL,
"user_id" uuid,
"guest_identity_hash" text,
"status" text NOT NULL,
"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
"expires_at" timestamp with time zone NOT NULL,
"redeemed_at" timestamp with time zone,
"released_at" timestamp with time zone,
"release_reason" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."instructor_student_audit_logs" (
"id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
"event_type" text NOT NULL,
"student_id" uuid,
"instructor_id" uuid,
"previous_instructor_id" uuid,
"actor_user_id" uuid,
"actor_kind" text NOT NULL,
"before_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
"after_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."instructor_student_bindings" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"student_id" uuid NOT NULL,
"instructor_id" uuid NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"created_by" uuid NOT NULL,
"ended_at" timestamp with time zone,
"ended_by" uuid,
"end_reason" text
);

CREATE TABLE public."instructor_student_settings" (
"instructor_id" uuid NOT NULL,
"student_price_type" text,
"version" bigint DEFAULT 0 NOT NULL,
"updated_by" uuid,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."inventory_allocation_events" (
"id" bigint DEFAULT nextval('inventory_allocation_events_id_seq'::regclass) NOT NULL,
"allocation_id" bigint NOT NULL,
"order_id" text NOT NULL,
"product_variant_id" bigint NOT NULL,
"event_type" text NOT NULL,
"quantity" integer NOT NULL,
"actor_user_id" uuid,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."inventory_count_items" (
"id" bigint DEFAULT nextval('inventory_count_items_id_seq'::regclass) NOT NULL,
"session_id" uuid NOT NULL,
"product_id" integer NOT NULL,
"product_variant_id" bigint NOT NULL,
"inventory_type" text NOT NULL,
"product_name" text NOT NULL,
"variant_name" text NOT NULL,
"sku" text NOT NULL,
"publication_status" text NOT NULL,
"system_stock_snapshot" integer NOT NULL,
"onsite_allocated_snapshot" integer DEFAULT 0 NOT NULL,
"expected_physical_snapshot" integer NOT NULL,
"actual_quantity" integer,
"variance" integer,
"version" integer DEFAULT 0 NOT NULL,
"counted_by" uuid,
"counted_by_email" text,
"counted_at" timestamp with time zone,
"applied_delta" integer,
"ledger_quantity_after" integer,
"shortage_quantity" integer DEFAULT 0 NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."inventory_count_sessions" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"name" text NOT NULL,
"status" text DEFAULT 'draft'::text NOT NULL,
"created_by" uuid NOT NULL,
"created_by_email" text DEFAULT ''::text NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"completed_by" uuid,
"completed_by_email" text,
"completed_at" timestamp with time zone
);

CREATE TABLE public."inventory_count_shortages" (
"id" bigint DEFAULT nextval('inventory_count_shortages_id_seq'::regclass) NOT NULL,
"count_item_id" bigint NOT NULL,
"allocation_id" bigint,
"order_id" text,
"product_variant_id" bigint NOT NULL,
"inventory_type" text NOT NULL,
"quantity" integer NOT NULL,
"resolved_quantity" integer DEFAULT 0 NOT NULL,
"status" text DEFAULT 'pending'::text NOT NULL,
"created_by" uuid,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"resolved_by" uuid,
"resolved_at" timestamp with time zone,
"note" text DEFAULT ''::text NOT NULL
);

CREATE TABLE public."member_admin_notes" (
"user_id" uuid NOT NULL,
"note" text NOT NULL,
"updated_by" uuid,
"updated_by_email" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."membership_tiers" (
"role" text NOT NULL,
"label" text NOT NULL,
"professional_price_multiplier" numeric,
"can_buy_pro_products" boolean DEFAULT false NOT NULL,
"active" boolean DEFAULT true NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."order_adjustments" (
"id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
"order_id" text NOT NULL,
"promotion_id" uuid,
"coupon_campaign_id" uuid,
"adjustment_type" text NOT NULL,
"name_snapshot" text NOT NULL,
"qualification_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
"amount" numeric DEFAULT 0 NOT NULL,
"gift_product_id" integer,
"gift_variant_id" bigint,
"gift_quantity" integer,
"sort_order" integer DEFAULT 0 NOT NULL,
"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."order_admin_notes" (
"order_id" text NOT NULL,
"note" text NOT NULL,
"created_by" uuid,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."order_inventory_allocations" (
"id" bigint DEFAULT nextval('order_inventory_allocations_id_seq'::regclass) NOT NULL,
"order_id" text NOT NULL,
"item_index" integer NOT NULL,
"product_id" integer NOT NULL,
"product_variant_id" bigint NOT NULL,
"sku" text NOT NULL,
"product_name" text NOT NULL,
"variant_name" text NOT NULL,
"requested_qty" integer NOT NULL,
"allocated_qty" integer DEFAULT 0 NOT NULL,
"backorder_qty" integer DEFAULT 0 NOT NULL,
"stock_deducted_qty" integer DEFAULT 0 NOT NULL,
"released_qty" integer DEFAULT 0 NOT NULL,
"state" text NOT NULL,
"source" text DEFAULT 'payment_allocation'::text NOT NULL,
"priority_at" timestamp with time zone DEFAULT now() NOT NULL,
"allocated_at" timestamp with time zone,
"last_allocated_at" timestamp with time zone,
"released_at" timestamp with time zone,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"line_type" text DEFAULT 'merchandise'::text NOT NULL,
"promotion_id" uuid,
"coupon_campaign_id" uuid,
"closed_backorder_qty" integer DEFAULT 0 NOT NULL,
"closed_at" timestamp with time zone
);

CREATE TABLE public."order_payment_attempts" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"order_id" text NOT NULL,
"provider_order_no" text NOT NULL,
"attempt_no" integer NOT NULL,
"payment_method" text NOT NULL,
"payment_state" text DEFAULT 'pending'::text NOT NULL,
"provider_transaction_no" text,
"provider_status" text,
"provider_description" text,
"payment_url" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."order_payment_authorizations" (
"order_id" text NOT NULL,
"token_hash" text NOT NULL,
"claimed_at" timestamp with time zone,
"gateway_created_at" timestamp with time zone,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"provider_order_no" text,
"attempt_no" integer DEFAULT 1 NOT NULL
);

CREATE TABLE public."order_payment_instructions" (
"order_id" text NOT NULL,
"payment_method" text NOT NULL,
"provider_transaction_no" text,
"provider_status" text,
"provider_description" text,
"atm_bank_code" text,
"atm_account" text,
"payment_url" text,
"payment_due_at" timestamp with time zone NOT NULL,
"gateway_created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"order_email_sent_at" timestamp with time zone,
"order_email_error" text,
"payment_state" text DEFAULT 'pending'::text NOT NULL,
"provider_order_no" text,
"attempt_no" integer DEFAULT 1 NOT NULL
);

ALTER TABLE public."orders" ADD COLUMN "pricing_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public."orders" ADD COLUMN "payment_due_at" timestamp with time zone DEFAULT (now() + '48:00:00'::interval) NOT NULL;

ALTER TABLE public."orders" ADD COLUMN "payment_second_reminded_at" timestamp with time zone;

ALTER TABLE public."orders" ADD COLUMN "shipping_carrier" text;

ALTER TABLE public."orders" ADD COLUMN "shipped_at" timestamp with time zone;

ALTER TABLE public."orders" ADD COLUMN "shipment_notification_sent_at" timestamp with time zone;

ALTER TABLE public."orders" ADD COLUMN "shipment_notification_channel" text;

ALTER TABLE public."orders" ADD COLUMN "shipment_notification_error" text;

ALTER TABLE public."orders" ADD COLUMN "public_lookup_code" text NOT NULL;

ALTER TABLE public."orders" ADD COLUMN "payment_notification_sent_at" timestamp with time zone;

ALTER TABLE public."orders" ADD COLUMN "payment_notification_channel" text;

ALTER TABLE public."orders" ADD COLUMN "payment_notification_attempts" integer DEFAULT 0 NOT NULL;

ALTER TABLE public."orders" ADD COLUMN "payment_notification_last_attempt_at" timestamp with time zone;

ALTER TABLE public."orders" ADD COLUMN "payment_notification_next_retry_at" timestamp with time zone;

ALTER TABLE public."orders" ADD COLUMN "payment_notification_error" text;

ALTER TABLE public."orders" ADD COLUMN "fulfillment_method" text DEFAULT 'delivery'::text NOT NULL;

ALTER TABLE public."orders" ADD COLUMN "paid_at" timestamp with time zone;

ALTER TABLE public."orders" ADD COLUMN "coupon_campaign_id" uuid;

ALTER TABLE public."orders" ADD COLUMN "coupon_name" text;

ALTER TABLE public."orders" ADD COLUMN "coupon_code_mask" text;

ALTER TABLE public."orders" ADD COLUMN "invoice_type" text;

ALTER TABLE public."orders" ADD COLUMN "invoice_company_name" text;

ALTER TABLE public."orders" ADD COLUMN "invoice_tax_id" text;

ALTER TABLE public."orders" ADD COLUMN "invoice_number" text;

ALTER TABLE public."orders" ADD COLUMN "shopping_credit_amount" bigint DEFAULT 0 NOT NULL;

ALTER TABLE public."orders" ADD COLUMN "payment_amount" numeric NOT NULL;

ALTER TABLE public."orders" ADD COLUMN "order_source" text DEFAULT 'online'::text NOT NULL;

ALTER TABLE public."orders" ADD COLUMN "transaction_date" date;

ALTER TABLE public."orders" ADD COLUMN "shipping_group_id" uuid;

ALTER TABLE public."orders" ADD COLUMN "assisted_payment_method" text;

CREATE TABLE public."procurement_addresses" (
"id" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
"address_text" text NOT NULL,
"is_default" boolean DEFAULT false NOT NULL,
"active" boolean DEFAULT true NOT NULL,
"usage_count" integer DEFAULT 0 NOT NULL,
"last_used_at" timestamp with time zone,
"created_by" uuid,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."product_images" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"product_id" integer NOT NULL,
"storage_path" text NOT NULL,
"original_name" text DEFAULT ''::text NOT NULL,
"alt_text" text DEFAULT ''::text NOT NULL,
"sort_order" integer DEFAULT 0 NOT NULL,
"is_primary" boolean DEFAULT false NOT NULL,
"active" boolean DEFAULT true NOT NULL,
"mime_type" text,
"file_size" integer,
"width" integer,
"height" integer,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."product_variants" (
"id" bigint DEFAULT nextval('product_variants_id_seq'::regclass) NOT NULL,
"product_id" integer NOT NULL,
"sku" text NOT NULL,
"size" text NOT NULL,
"price" numeric DEFAULT 0 NOT NULL,
"pro_price" numeric DEFAULT 0 NOT NULL,
"stock" integer NOT NULL,
"is_default" boolean DEFAULT false NOT NULL,
"sort_order" integer DEFAULT 0 NOT NULL,
"active" boolean DEFAULT true NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"is_custom_order" boolean DEFAULT false NOT NULL,
"procurement_unit_cost_usd" numeric(14,4),
"gift_enabled" boolean DEFAULT false NOT NULL,
"gift_stock" integer DEFAULT 0 NOT NULL,
"gift_min_stock" integer DEFAULT 0 NOT NULL
);

ALTER TABLE public."products" ALTER COLUMN "id" SET DEFAULT nextval('products_id_seq'::regclass);

ALTER TABLE public."products" ADD COLUMN "image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE public."products" ADD COLUMN "variants" jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE public."products" ADD COLUMN "source_folder_name" text;

ALTER TABLE public."products" ADD COLUMN "imported_from_drive" boolean DEFAULT false NOT NULL;

ALTER TABLE public."products" ADD COLUMN "product_list_image_scale" numeric;

ALTER TABLE public."products" ADD COLUMN "product_detail_image_scale" numeric;

ALTER TABLE public."products" ADD COLUMN "asset_key" uuid DEFAULT gen_random_uuid() NOT NULL;

ALTER TABLE public."products" ADD COLUMN "publication_status" text DEFAULT 'draft'::text NOT NULL;

ALTER TABLE public."products" ADD COLUMN "subtitle" text;

ALTER TABLE public."products" ADD COLUMN "series" text;

ALTER TABLE public."products" ADD COLUMN "slug" text;

ALTER TABLE public."products" ADD COLUMN "apply_tier_multiplier" boolean DEFAULT true NOT NULL;

ALTER TABLE public."products" ADD COLUMN "instructor_price_multiplier" numeric;

ALTER TABLE public."products" ADD COLUMN "distributor_price_multiplier" numeric;

ALTER TABLE public."products" ADD COLUMN "staff_price_multiplier" numeric;

CREATE TABLE public."professional_application_certificates" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"application_id" uuid NOT NULL,
"storage_path" text NOT NULL,
"original_name" text NOT NULL,
"mime_type" text NOT NULL,
"file_size" integer NOT NULL,
"sort_order" integer NOT NULL,
"uploaded_by" uuid NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."professional_applications" ALTER COLUMN "created_at" DROP NOT NULL;

ALTER TABLE public."professional_applications" ALTER COLUMN "social_media" DROP NOT NULL;

ALTER TABLE public."professional_applications" ALTER COLUMN "certificate" DROP NOT NULL;

ALTER TABLE public."professional_applications" ALTER COLUMN "source" DROP NOT NULL;

ALTER TABLE public."professional_applications" ALTER COLUMN "updated_at" DROP NOT NULL;

ALTER TABLE public."professional_applications" ADD COLUMN "admin_notification_sent_at" timestamp with time zone;

ALTER TABLE public."professional_applications" ADD COLUMN "admin_notification_attempts" integer DEFAULT 0 NOT NULL;

ALTER TABLE public."professional_applications" ADD COLUMN "admin_notification_last_attempt_at" timestamp with time zone;

ALTER TABLE public."professional_applications" ADD COLUMN "admin_notification_error" text;

ALTER TABLE public."professional_applications" ADD COLUMN "invoice_company_name" text;

ALTER TABLE public."professional_applications" ADD COLUMN "invoice_tax_id" text;

CREATE TABLE public."professional_award_evidence" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"user_id" uuid NOT NULL,
"membership_id" uuid NOT NULL,
"assessment_year" integer NOT NULL,
"student_name" text NOT NULL,
"completed_on" date NOT NULL,
"award_number" text NOT NULL,
"award_number_key" text NOT NULL,
"storage_path" text NOT NULL,
"original_name" text NOT NULL,
"mime_type" text NOT NULL,
"file_size" integer NOT NULL,
"consent_acknowledged_at" timestamp with time zone NOT NULL,
"status" text DEFAULT 'pending'::text NOT NULL,
"reviewed_by" uuid,
"reviewed_at" timestamp with time zone,
"review_reason" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."professional_evidence_entry_windows" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"user_id" uuid NOT NULL,
"assessment_year" integer NOT NULL,
"opened_until" timestamp with time zone NOT NULL,
"reason" text NOT NULL,
"created_by" uuid NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."professional_memberships" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"user_id" uuid NOT NULL,
"role" text NOT NULL,
"started_on" date NOT NULL,
"ended_on" date,
"created_by" uuid,
"change_reason" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."professional_quarterly_notices" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"user_id" uuid NOT NULL,
"quarter_start" date NOT NULL,
"version" integer DEFAULT 1 NOT NULL,
"supersedes_id" uuid,
"correction_reason" text,
"snapshot" jsonb NOT NULL,
"status" text DEFAULT 'pending'::text NOT NULL,
"channel" text,
"sent_at" timestamp with time zone,
"attempt_count" integer DEFAULT 0 NOT NULL,
"last_error" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."professional_renewal_applications" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"user_id" uuid NOT NULL,
"membership_id" uuid NOT NULL,
"assessment_year" integer NOT NULL,
"renewal_year" integer NOT NULL,
"role" text NOT NULL,
"status" text DEFAULT 'submitted'::text NOT NULL,
"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
"finalized_at" timestamp with time zone,
"assessment_snapshot" jsonb,
"a_qualified" boolean,
"qualification_path" text,
"b_approved_count" integer DEFAULT 0 NOT NULL,
"reviewed_by" uuid,
"reviewed_at" timestamp with time zone,
"decision_reason" text,
"result_notification_sent_at" timestamp with time zone,
"result_notification_channel" text,
"result_notification_error" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."professional_renewal_nonapplications" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"user_id" uuid NOT NULL,
"membership_id" uuid NOT NULL,
"assessment_year" integer NOT NULL,
"renewal_year" integer NOT NULL,
"role" text NOT NULL,
"reason" text NOT NULL,
"reviewed_by" uuid NOT NULL,
"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
"effective_on" date NOT NULL
);

CREATE TABLE public."professional_renewal_quarter_snapshots" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"application_id" uuid NOT NULL,
"quarter_start" date NOT NULL,
"calendar_quarter" integer NOT NULL,
"period_start" date,
"period_end_exclusive" date,
"effective_days" integer NOT NULL,
"quarter_days" integer NOT NULL,
"threshold_amount" numeric(12,0) NOT NULL,
"online_sales_amount" numeric(12,0) NOT NULL,
"offline_sales_amount" numeric(12,0) NOT NULL,
"sales_amount" numeric(12,0) NOT NULL,
"has_zero_sales" boolean NOT NULL,
"meets_quarter_threshold" boolean NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."professional_sales_adjustments" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"membership_id" uuid NOT NULL,
"user_id" uuid NOT NULL,
"quarter_number" integer NOT NULL,
"amount" numeric(12,0) NOT NULL,
"note" text,
"created_by" uuid,
"updated_by" uuid,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"quarter_start" date NOT NULL
);

ALTER TABLE public."profiles" ADD COLUMN "studio_name" text;

ALTER TABLE public."profiles" ADD COLUMN "studio_contact_name" text;

ALTER TABLE public."profiles" ADD COLUMN "studio_phone" text;

ALTER TABLE public."profiles" ADD COLUMN "studio_address" text;

ALTER TABLE public."profiles" ADD COLUMN "default_invoice_company_name" text;

ALTER TABLE public."profiles" ADD COLUMN "default_invoice_tax_id" text;

CREATE TABLE public."promotion_gift_reservations" (
"id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
"order_id" text NOT NULL,
"promotion_id" uuid NOT NULL,
"coupon_campaign_id" uuid,
"product_variant_id" bigint NOT NULL,
"quantity" integer NOT NULL,
"status" text NOT NULL,
"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
"expires_at" timestamp with time zone NOT NULL,
"consumed_at" timestamp with time zone,
"released_at" timestamp with time zone,
"release_reason" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."promotion_scopes" (
"id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
"promotion_id" uuid NOT NULL,
"scope_role" text NOT NULL,
"target_type" text NOT NULL,
"product_id" integer,
"product_variant_id" bigint,
"target_value" text,
"mode" text DEFAULT 'include'::text NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."promotions" ADD COLUMN "discount_order" text DEFAULT 'rate_then_amount'::text NOT NULL;

ALTER TABLE public."promotions" ADD COLUMN "benefit_type" text DEFAULT 'legacy_discount'::text NOT NULL;

ALTER TABLE public."promotions" ADD COLUMN "activation_type" text DEFAULT 'automatic'::text NOT NULL;

ALTER TABLE public."promotions" ADD COLUMN "threshold_value" numeric;

ALTER TABLE public."promotions" ADD COLUMN "threshold_basis" text;

ALTER TABLE public."promotions" ADD COLUMN "gift_variant_id" bigint;

ALTER TABLE public."promotions" ADD COLUMN "gift_quantity" integer;

ALTER TABLE public."promotions" ADD COLUMN "repeat_mode" text DEFAULT 'once'::text NOT NULL;

ALTER TABLE public."promotions" ADD COLUMN "exclusive_group" text;

ALTER TABLE public."promotions" ADD COLUMN "priority" integer DEFAULT 100 NOT NULL;

ALTER TABLE public."promotions" ADD COLUMN "archived_at" timestamp with time zone;

ALTER TABLE public."promotions" ADD COLUMN "threshold_type" text DEFAULT 'amount'::text NOT NULL;

CREATE TABLE public."purchase_order_items" (
"id" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
"purchase_order_id" bigint NOT NULL,
"product_sku" text NOT NULL,
"name_zh" text,
"name_en" text NOT NULL,
"specification" text,
"quantity" integer NOT NULL,
"currency" text DEFAULT 'USD'::text NOT NULL,
"unit_cost" numeric(14,4) NOT NULL,
"subtotal_usd" numeric(14,2) NOT NULL,
"stock_at_order" integer,
"sort_order" integer DEFAULT 0 NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"product_variant_id" bigint NOT NULL
);

CREATE TABLE public."purchase_orders" (
"id" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
"po_number" text DEFAULT next_purchase_order_number() NOT NULL,
"status" text DEFAULT 'draft'::text NOT NULL,
"currency" text DEFAULT 'USD'::text NOT NULL,
"exchange_rate" numeric(14,6) NOT NULL,
"total_usd" numeric(14,2) DEFAULT 0 NOT NULL,
"total_twd" numeric(14,2) DEFAULT 0 NOT NULL,
"shipping_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
"notes" text,
"created_by" uuid,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"ordered_at" timestamp with time zone,
"received_at" timestamp with time zone
);

CREATE TABLE public."shipping_groups" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"user_id" uuid NOT NULL,
"status" text DEFAULT 'open'::text NOT NULL,
"fulfillment_method" text DEFAULT 'delivery'::text NOT NULL,
"original_order_id" text NOT NULL,
"original_shipping_amount" bigint DEFAULT 0 NOT NULL,
"shipping_refund_ledger_id" bigint,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"locked_at" timestamp with time zone,
"shipping_refunded_at" timestamp with time zone,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."shopping_credit_accounts" (
"user_id" uuid NOT NULL,
"available_balance" bigint DEFAULT 0 NOT NULL,
"reserved_balance" bigint DEFAULT 0 NOT NULL,
"status" text DEFAULT 'active'::text NOT NULL,
"version" bigint DEFAULT 0 NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."shopping_credit_ledger" (
"id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
"user_id" uuid NOT NULL,
"event_type" text NOT NULL,
"amount" bigint NOT NULL,
"available_delta" bigint NOT NULL,
"reserved_delta" bigint NOT NULL,
"available_balance_after" bigint NOT NULL,
"reserved_balance_after" bigint NOT NULL,
"order_id" text,
"reason_code" text NOT NULL,
"internal_note" text,
"actor_user_id" uuid,
"actor_email" text,
"actor_role" text,
"request_id" uuid DEFAULT gen_random_uuid() NOT NULL,
"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."shopping_credit_order_reservations" (
"order_id" text NOT NULL,
"user_id" uuid NOT NULL,
"amount" bigint NOT NULL,
"status" text DEFAULT 'reserved'::text NOT NULL,
"version" bigint DEFAULT 0 NOT NULL,
"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
"consumed_at" timestamp with time zone,
"released_at" timestamp with time zone,
"refunded_at" timestamp with time zone,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."student_pricing_feature_settings" (
"singleton" boolean DEFAULT true NOT NULL,
"enabled" boolean DEFAULT false NOT NULL,
"version" bigint DEFAULT 0 NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."student_pricing_settings" (
"singleton" boolean DEFAULT true NOT NULL,
"student_1" numeric DEFAULT 0.90 NOT NULL,
"student_2" numeric DEFAULT 0.95 NOT NULL,
"version" bigint DEFAULT 0 NOT NULL,
"updated_by" uuid,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

INSERT INTO public."backoffice_roles" ("role","label","active") VALUES ('admin','管理員',true);

INSERT INTO public."backoffice_roles" ("role","label","active") VALUES ('catalog_editor','商品小編',true);

INSERT INTO public."backoffice_roles" ("role","label","active") VALUES ('super_admin','最高管理員',true);

INSERT INTO public."membership_tiers" ("role","label","active","can_buy_pro_products","professional_price_multiplier") VALUES ('consumer','一般會員',true,false,NULL);

INSERT INTO public."membership_tiers" ("role","label","active","can_buy_pro_products","professional_price_multiplier") VALUES ('distributor','經銷商',true,true,0.65);

INSERT INTO public."membership_tiers" ("role","label","active","can_buy_pro_products","professional_price_multiplier") VALUES ('instructor','師資',true,true,0.7);

INSERT INTO public."membership_tiers" ("role","label","active","can_buy_pro_products","professional_price_multiplier") VALUES ('pending','審核中',true,false,NULL);

INSERT INTO public."membership_tiers" ("role","label","active","can_buy_pro_products","professional_price_multiplier") VALUES ('pro','美容師',true,true,1);

INSERT INTO public."membership_tiers" ("role","label","active","can_buy_pro_products","professional_price_multiplier") VALUES ('staff','內部人員',true,true,0.5);

INSERT INTO public."student_pricing_settings" ("version","singleton","student_1","student_2") VALUES (0,true,0.9,0.95);

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('admin','analytics.read');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('admin','audit_logs.read');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('admin','catalog.read');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('admin','catalog.write');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('admin','instructor_students.manage');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('admin','inventory_counts.manage');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('admin','member_pricing.manage');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('admin','members.read');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('admin','members.write');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('admin','notifications.send');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('admin','orders.read');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('admin','orders.write');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('admin','procurement.manage');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('admin','promotions.manage');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('admin','shopping_credit.manage');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('catalog_editor','catalog.read');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('catalog_editor','catalog.write');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('super_admin','analytics.read');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('super_admin','audit_logs.read');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('super_admin','backorders.manage');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('super_admin','catalog.read');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('super_admin','catalog.write');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('super_admin','instructor_students.manage');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('super_admin','inventory_counts.manage');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('super_admin','member_pricing.manage');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('super_admin','members.read');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('super_admin','members.write');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('super_admin','notifications.send');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('super_admin','orders.read');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('super_admin','orders.write');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('super_admin','procurement.manage');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('super_admin','promotions.manage');

INSERT INTO public."backoffice_role_permissions" ("role","permission") VALUES ('super_admin','shopping_credit.manage');

INSERT INTO public."student_pricing_feature_settings" ("enabled","version","singleton") VALUES (false,0,true);

CREATE OR REPLACE FUNCTION public.adjust_inventory_for_order(order_items jsonb, direction integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  item record;
  product_id integer;
  item_qty integer;
  stock_at_order integer;
  stock_qty integer;
begin
  if order_items is null or jsonb_typeof(order_items) <> 'array' then
    return;
  end if;

  for item in
    select * from jsonb_array_elements(order_items)
  loop
    product_id := nullif(item.value ->> 'id', '')::integer;
    item_qty := coalesce(nullif(item.value ->> 'qty', '')::integer, 0);
    stock_at_order := greatest(coalesce(nullif(item.value ->> 'stock_at_order', '')::integer, item_qty), 0);
    stock_qty := least(item_qty, stock_at_order);

    if product_id is null or item_qty <= 0 then
      continue;
    end if;

    update public.products
    set stock = greatest(0, stock + (direction * stock_qty))
    where id = product_id;

    if not found then
      raise exception 'Product % not found', product_id;
    end if;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.adjust_member_shopping_credit(p_user_id uuid, p_direction text, p_amount bigint, p_reason_code text, p_internal_note text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  normalized_direction text := lower(btrim(coalesce(p_direction, '')));
  normalized_reason text := lower(btrim(coalesce(p_reason_code, '')));
  normalized_note text := nullif(btrim(coalesce(p_internal_note, '')), '');
  target_account public.shopping_credit_accounts%rowtype;
  existing_entry public.shopping_credit_ledger%rowtype;
  next_available bigint;
  event_name text;
  actor_admin_role text;
  result jsonb;
begin
  if auth.uid() is null or not public.has_backoffice_permission('shopping_credit.manage') then
    raise exception 'Shopping credit management permission required' using errcode = '42501';
  end if;
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  if normalized_direction not in ('grant', 'debit') then
    raise exception 'Invalid shopping credit direction' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Shopping credit amount must be a positive integer' using errcode = '22023';
  end if;
  if p_request_id is null then
    raise exception 'Shopping credit request ID is required' using errcode = '22023';
  end if;
  if normalized_direction = 'grant' and normalized_reason not in (
    'customer_service_compensation', 'campaign_grant', 'order_return_adjustment',
    'wrong_account_correction', 'other'
  ) then
    raise exception 'Invalid shopping credit grant reason' using errcode = '22023';
  end if;
  if normalized_direction = 'debit' and normalized_reason not in (
    'wrong_account_correction', 'eligibility_revocation',
    'order_return_adjustment', 'other'
  ) then
    raise exception 'Invalid shopping credit debit reason' using errcode = '22023';
  end if;
  if normalized_reason = 'other' and normalized_note is null then
    raise exception 'A note is required for the other reason' using errcode = '22023';
  end if;
  if normalized_note is not null and length(normalized_note) > 500 then
    raise exception 'Shopping credit note is too long' using errcode = '22023';
  end if;

  insert into public.shopping_credit_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select account.* into target_account
  from public.shopping_credit_accounts account
  where account.user_id = p_user_id
  for update;

  if target_account.status <> 'active' then
    raise exception 'Member shopping credit account is locked for deletion'
      using errcode = '55000';
  end if;

  -- Recheck after acquiring the account lock so simultaneous retries cannot
  -- both pass an earlier request lookup.
  select entry.* into existing_entry
  from public.shopping_credit_ledger entry
  where entry.request_id = p_request_id;

  if found then
    event_name := normalized_direction;
    if existing_entry.user_id <> p_user_id
      or existing_entry.event_type <> event_name
      or existing_entry.amount <> p_amount
      or existing_entry.reason_code <> normalized_reason
      or existing_entry.internal_note is distinct from normalized_note
    then
      raise exception 'Shopping credit request ID was reused with different data'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'ok', true,
      'already_processed', true,
      'entry_id', existing_entry.id,
      'user_id', existing_entry.user_id,
      'available_balance', existing_entry.available_balance_after,
      'reserved_balance', existing_entry.reserved_balance_after
    );
  end if;

  next_available := case normalized_direction
    when 'grant' then target_account.available_balance + p_amount
    else target_account.available_balance - p_amount
  end;
  if next_available < 0 then
    raise exception 'Insufficient available shopping credit' using errcode = '22003';
  end if;

  update public.shopping_credit_accounts
  set available_balance = next_available,
      version = version + 1,
      updated_at = now()
  where user_id = p_user_id;

  select role into actor_admin_role
  from public.admin_users
  where user_id = auth.uid() and active is true;

  insert into public.shopping_credit_ledger (
    user_id, event_type, amount, available_delta, reserved_delta,
    available_balance_after, reserved_balance_after,
    reason_code, internal_note, actor_user_id, actor_email, actor_role, request_id
  ) values (
    p_user_id, normalized_direction, p_amount,
    case when normalized_direction = 'grant' then p_amount else -p_amount end,
    0, next_available, target_account.reserved_balance,
    normalized_reason, normalized_note, auth.uid(),
    nullif(auth.jwt() ->> 'email', ''), actor_admin_role, p_request_id
  )
  returning jsonb_build_object(
    'ok', true,
    'already_processed', false,
    'entry_id', id,
    'user_id', user_id,
    'available_balance', available_balance_after,
    'reserved_balance', reserved_balance_after
  ) into result;

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.allocate_assisted_inventory(target_order_id text, order_items jsonb, p_gifts boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  item record; item_qty integer; variant_id bigint; available_qty integer;
  allocated integer; missing integer; allocation_id bigint; product_id integer;
  sku text; product_name text; variant_name text; gift_reservation record;
  is_gift boolean;
begin
  if order_items is null or jsonb_typeof(order_items) <> 'array' then
    raise exception 'Order items must be an array' using errcode = '22023';
  end if;
  perform 1 from public.product_variants variant where variant.id in (
    select (entry.value ->> 'variant_id')::bigint from jsonb_array_elements(order_items) entry
    where coalesce(entry.value ->> 'variant_id', '') ~ '^[0-9]+$'
  ) order by variant.id for update;

  for item in select value, (ordinality - 1)::integer item_index
    from jsonb_array_elements(order_items) with ordinality
  loop
    item_qty := coalesce(nullif(item.value ->> 'qty', '')::integer, 0);
    if item_qty <= 0 then raise exception 'Invalid quantity on order % item %', target_order_id, item.item_index using errcode='22023'; end if;
    variant_id := case
      when coalesce(item.value ->> 'variant_id', '') ~ '^[0-9]+$'
        then (item.value ->> 'variant_id')::bigint
      else null
    end;
    is_gift := coalesce(item.value ->> 'line_type', '') = 'gift' or coalesce((item.value ->> 'is_gift')::boolean, false);
    if is_gift is distinct from p_gifts then continue; end if;

    -- Keep the pre-variant compatibility path for legacy merchandise orders.
    -- Promotion gifts always carry an explicit gift-enabled variant.
    if variant_id is null and not is_gift then
      select variant.id into variant_id
      from public.product_variants variant
      where variant.product_id = nullif(item.value ->> 'id', '')::integer
        and variant.active = true
      order by variant.is_default desc, variant.sort_order, variant.id
      limit 1;
    end if;

    select variant.product_id,
      variant.sku,
      variant.size,
      case when is_gift then variant.gift_stock else variant.stock end,
      product.name_zh
    into product_id, sku, variant_name, available_qty, product_name
    from public.product_variants variant join public.products product on product.id = variant.product_id
    where variant.id = variant_id for update of variant;
    if not found then raise exception 'Product variant is missing for order % item %', target_order_id, item.item_index using errcode='P0002'; end if;

    if is_gift then
      select reservation.* into gift_reservation
      from public.promotion_gift_reservations reservation
      where reservation.order_id = target_order_id
        and reservation.promotion_id = (item.value ->> 'promotion_id')::uuid
        and reservation.product_variant_id = variant_id
        and reservation.status = 'reserved'
        and reservation.expires_at > now()
      for update;
      if not found or gift_reservation.quantity <> item_qty or available_qty < item_qty then
        raise exception '贈品庫存保留資料不完整，無法完成付款' using errcode='55000';
      end if;
      allocated := item_qty; missing := 0;
      update public.promotion_gift_reservations set status='consumed', consumed_at=now()
      where id = gift_reservation.id;
      update public.product_variants set gift_stock = gift_stock - item_qty where id = variant_id;
    else
      allocated := least(item_qty, greatest(coalesce(available_qty,0),0));
      missing := item_qty - allocated;
      if allocated > 0 then update public.product_variants set stock=stock-allocated where id=variant_id; end if;
    end if;

    insert into public.order_inventory_allocations (
      order_id,item_index,product_id,product_variant_id,sku,product_name,variant_name,
      requested_qty,allocated_qty,backorder_qty,stock_deducted_qty,released_qty,state,source,
      line_type,promotion_id,coupon_campaign_id,priority_at,allocated_at,last_allocated_at,updated_at
    ) values (
      target_order_id,item.item_index,product_id,variant_id,sku,
      coalesce(nullif(item.value->>'name',''),product_name),coalesce(nullif(item.value->>'size',''),variant_name),
      item_qty,allocated,missing,allocated,0,
      case when missing=0 then 'allocated' when allocated=0 then 'backordered' else 'partial' end,
      case when is_gift then 'promotion_gift' else 'payment_allocation' end,
      case when is_gift then 'gift' else 'merchandise' end,
      nullif(item.value->>'promotion_id','')::uuid,nullif(item.value->>'coupon_campaign_id','')::uuid,
      now(),case when allocated>0 then now() end,case when allocated>0 then now() end,now()
    ) on conflict (order_id,item_index) do update set
      requested_qty=excluded.requested_qty,allocated_qty=excluded.allocated_qty,
      backorder_qty=excluded.backorder_qty,stock_deducted_qty=excluded.stock_deducted_qty,
      state=excluded.state,source=excluded.source,line_type=excluded.line_type,
      promotion_id=excluded.promotion_id,coupon_campaign_id=excluded.coupon_campaign_id,
      allocated_at=excluded.allocated_at,last_allocated_at=excluded.last_allocated_at,
      released_at=null,updated_at=now()
    returning id into allocation_id;
    if allocated > 0 then
      insert into public.inventory_allocation_events(allocation_id,order_id,product_variant_id,event_type,quantity,actor_user_id)
      values(allocation_id,target_order_id,variant_id,'payment_allocate',allocated,auth.uid());
    end if;
    if not is_gift then
      perform public.sync_product_stock_mirror(product_id);
    end if;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.allocate_backordered_inventory(p_variant_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  variant_row public.product_variants%rowtype;
  allocation record;
  assign_qty integer;
  total_assigned integer := 0;
  affected_orders text[] := '{}'::text[];
begin
  if not public.has_backoffice_permission('backorders.manage') then
    raise exception 'Backorder management authorization required' using errcode = '42501';
  end if;

  select * into variant_row
  from public.product_variants
  where id = p_variant_id
  for update;

  if not found then
    raise exception 'Product variant not found' using errcode = 'P0002';
  end if;

  for allocation in
    select item.*
    from public.order_inventory_allocations item
    join public.orders orders on orders.id = item.order_id
    where item.product_variant_id = p_variant_id
      and item.backorder_qty > 0
      and item.state in ('partial', 'backordered')
      and public.order_consumes_inventory(orders.status)
    order by item.priority_at, orders.created_at, item.id
    for update of item
  loop
    exit when variant_row.stock <= 0;
    assign_qty := least(variant_row.stock, allocation.backorder_qty);
    if assign_qty <= 0 then continue; end if;

    update public.order_inventory_allocations
    set
      allocated_qty = allocated_qty + assign_qty,
      backorder_qty = backorder_qty - assign_qty,
      stock_deducted_qty = stock_deducted_qty + assign_qty,
      state = case when backorder_qty - assign_qty = 0 then 'allocated' else 'partial' end,
      allocated_at = coalesce(allocated_at, now()),
      last_allocated_at = now(),
      updated_at = now()
    where id = allocation.id;

    insert into public.inventory_allocation_events (
      allocation_id, order_id, product_variant_id, event_type, quantity, actor_user_id
    ) values (
      allocation.id, allocation.order_id, p_variant_id,
      'fifo_allocate', assign_qty, auth.uid()
    );

    variant_row.stock := variant_row.stock - assign_qty;
    total_assigned := total_assigned + assign_qty;
    if not allocation.order_id = any(affected_orders) then
      affected_orders := array_append(affected_orders, allocation.order_id);
    end if;
  end loop;

  update public.product_variants
  set stock = variant_row.stock
  where id = p_variant_id;
  perform public.sync_product_stock_mirror(variant_row.product_id);

  return jsonb_build_object(
    'variant_id', p_variant_id,
    'allocated_qty', total_assigned,
    'remaining_stock', variant_row.stock,
    'affected_orders', to_jsonb(affected_orders)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.allocate_inventory_count_gift_shortages(p_variant_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  variant_row public.product_variants;
  shortage record;
  available_quantity integer;
  assign_quantity integer;
  allocated_total integer := 0;
  affected_orders text[] := array[]::text[];
begin
  if not public.has_backoffice_permission('backorders.manage')
    and not public.has_backoffice_permission('inventory_counts.manage') then
    raise exception 'Inventory shortage authorization required' using errcode = '42501';
  end if;

  select * into variant_row from public.product_variants
  where id = p_variant_id for update;
  if not found then raise exception '找不到贈品規格' using errcode = 'P0002'; end if;
  available_quantity := variant_row.gift_stock;

  for shortage in
    select shortage_record.*, allocation.requested_qty, allocation.allocated_qty,
      allocation.id as target_allocation_id
    from public.inventory_count_shortages shortage_record
    join public.order_inventory_allocations allocation on allocation.id = shortage_record.allocation_id
    join public.orders target_order on target_order.id = shortage_record.order_id
    where shortage_record.product_variant_id = p_variant_id
      and shortage_record.inventory_type = 'gift'
      and shortage_record.status = 'pending'
      and shortage_record.resolved_quantity < shortage_record.quantity
      and target_order.status in ('paid', 'preparing', 'ready_for_pickup')
    order by allocation.priority_at, allocation.id, shortage_record.id
    for update of shortage_record, allocation
  loop
    exit when available_quantity <= 0;
    assign_quantity := least(available_quantity, shortage.quantity - shortage.resolved_quantity);
    if assign_quantity <= 0 then continue; end if;

    update public.product_variants
    set gift_stock = gift_stock - assign_quantity
    where id = p_variant_id;
    update public.order_inventory_allocations
    set allocated_qty = allocated_qty + assign_quantity,
        stock_deducted_qty = stock_deducted_qty + assign_quantity,
        state = case when allocated_qty + assign_quantity >= requested_qty then 'allocated' else 'partial' end,
        last_allocated_at = now(),
        updated_at = now()
    where id = shortage.target_allocation_id;
    update public.inventory_count_shortages
    set resolved_quantity = resolved_quantity + assign_quantity,
        status = case when resolved_quantity + assign_quantity >= quantity then 'resolved' else 'pending' end,
        resolved_by = case when resolved_quantity + assign_quantity >= quantity then auth.uid() else resolved_by end,
        resolved_at = case when resolved_quantity + assign_quantity >= quantity then now() else resolved_at end,
        note = case when resolved_quantity + assign_quantity >= quantity then '贈品庫存已補回訂單' else note end
    where id = shortage.id;

    available_quantity := available_quantity - assign_quantity;
    allocated_total := allocated_total + assign_quantity;
    if not shortage.order_id = any(affected_orders) then
      affected_orders := array_append(affected_orders, shortage.order_id);
    end if;
  end loop;

  return jsonb_build_object(
    'allocated_qty', allocated_total,
    'affected_orders', to_jsonb(affected_orders),
    'remaining_gift_stock', available_quantity
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.allocate_inventory_for_paid_order(target_order_id text, order_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  item record;
  item_qty integer;
  variant_id bigint;
  available_qty integer;
  allocated integer;
  missing integer;
  allocation_id bigint;
  product_id integer;
  sku text;
  product_name text;
  variant_name text;
begin
  if order_items is null or jsonb_typeof(order_items) <> 'array' then
    raise exception 'Order items must be an array' using errcode = '22023';
  end if;

  -- Lock every referenced variant in deterministic order. This prevents two
  -- multi-item payments from taking the same row locks in opposite order.
  perform 1
  from public.product_variants variant
  where variant.id in (
    select (entry.value ->> 'variant_id')::bigint
    from jsonb_array_elements(order_items) entry
    where coalesce(entry.value ->> 'variant_id', '') ~ '^[0-9]+$'
  )
  order by variant.id
  for update;

  for item in
    select value, (ordinality - 1)::integer as item_index
    from jsonb_array_elements(order_items) with ordinality
  loop
    item_qty := coalesce(nullif(item.value ->> 'qty', '')::integer, 0);
    if item_qty <= 0 then
      raise exception 'Invalid quantity on order % item %', target_order_id, item.item_index
        using errcode = '22023';
    end if;

    variant_id := case
      when coalesce(item.value ->> 'variant_id', '') ~ '^[0-9]+$'
        then (item.value ->> 'variant_id')::bigint
      else null
    end;
    if variant_id is null then
      select variant.id into variant_id
      from public.product_variants variant
      where variant.product_id = nullif(item.value ->> 'product_id', '')::integer
        and variant.is_default is true
      order by variant.id
      limit 1
      for update;
    end if;

    select
      variant.product_id,
      variant.sku,
      variant.size,
      variant.stock,
      product.name_zh
    into product_id, sku, variant_name, available_qty, product_name
    from public.product_variants variant
    join public.products product on product.id = variant.product_id
    where variant.id = variant_id
    for update of variant;

    if not found then
      raise exception 'Product variant is missing for order % item %', target_order_id, item.item_index
        using errcode = 'P0002';
    end if;

    allocated := least(item_qty, greatest(coalesce(available_qty, 0), 0));
    missing := item_qty - allocated;

    if allocated > 0 then
      update public.product_variants
      set stock = stock - allocated
      where id = variant_id;
    end if;

    insert into public.order_inventory_allocations (
      order_id, item_index, product_id, product_variant_id, sku,
      product_name, variant_name, requested_qty, allocated_qty,
      backorder_qty, stock_deducted_qty, released_qty, state, source,
      priority_at, allocated_at, last_allocated_at, released_at, updated_at
    ) values (
      target_order_id, item.item_index, product_id, variant_id, sku,
      coalesce(nullif(item.value ->> 'name', ''), product_name),
      coalesce(nullif(item.value ->> 'size', ''), variant_name),
      item_qty, allocated, missing, allocated, 0,
      case when missing = 0 then 'allocated' when allocated = 0 then 'backordered' else 'partial' end,
      'payment_allocation', now(),
      case when allocated > 0 then now() else null end,
      case when allocated > 0 then now() else null end,
      null, now()
    )
    on conflict (order_id, item_index) do update set
      product_id = excluded.product_id,
      product_variant_id = excluded.product_variant_id,
      sku = excluded.sku,
      product_name = excluded.product_name,
      variant_name = excluded.variant_name,
      requested_qty = excluded.requested_qty,
      allocated_qty = excluded.allocated_qty,
      backorder_qty = excluded.backorder_qty,
      stock_deducted_qty = excluded.stock_deducted_qty,
      state = excluded.state,
      source = excluded.source,
      priority_at = excluded.priority_at,
      allocated_at = excluded.allocated_at,
      last_allocated_at = excluded.last_allocated_at,
      released_at = null,
      updated_at = now()
    returning id into allocation_id;

    if allocated > 0 then
      insert into public.inventory_allocation_events (
        allocation_id, order_id, product_variant_id, event_type, quantity, actor_user_id
      ) values (
        allocation_id, target_order_id, variant_id, 'payment_allocate', allocated, auth.uid()
      );
    end if;

    perform public.sync_product_stock_mirror(product_id);
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_student_price(p_base numeric, p_multiplier numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when p_multiplier is null then p_base else round(p_base*p_multiplier) end;
$function$;

CREATE OR REPLACE FUNCTION public.archive_procurement_address(p_address_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_eclado_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  update public.procurement_addresses set active = false, is_default = false where id = p_address_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.assert_assisted_credit_consent(p_order_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists(select 1 from public.orders o where o.id=p_order_id and o.order_source='admin_assisted' and o.shopping_credit_amount>0
    and not exists(select 1 from public.assisted_order_requests r where r.order_id=o.id
      and r.credit_consent_at is not null and r.credit_consent_amount=o.shopping_credit_amount)) then
    raise exception '請先由客戶確認並同意使用購物金。' using errcode='42501';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.assert_instructor_student_admin(p_write boolean)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not public.is_eclado_admin()
    or (p_write and not public.has_backoffice_permission('instructor_students.manage'))
    or (not p_write and not (public.has_backoffice_permission('members.read')
      or public.has_backoffice_permission('instructor_students.manage'))) then
    raise exception '師生管理權限不足' using errcode='42501';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.assign_guest_order_to_member(p_order_id text, p_member_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  target_order public.orders%rowtype;
  target_member public.profiles%rowtype;
begin
  if actor_id is null
    or not public.has_backoffice_permission('orders.write')
    or not public.has_backoffice_permission('members.write')
  then
    raise exception 'Administrator order and member write permissions are required'
      using errcode = '42501';
  end if;

  if nullif(trim(p_order_id), '') is null or p_member_id is null then
    raise exception 'Order and member are required' using errcode = '22023';
  end if;

  select profile.*
    into target_member
  from public.profiles profile
  where profile.id = p_member_id;

  if not found then
    raise exception 'Member profile not found' using errcode = 'P0002';
  end if;

  select orders.*
    into target_order
  from public.orders orders
  where orders.id = trim(p_order_id)
  for update;

  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if target_order.user_id is not null then
    raise exception 'Order is already assigned to a member'
      using errcode = '23505';
  end if;

  update public.orders
  set user_id = target_member.id
  where id = target_order.id
    and user_id is null;

  if not found then
    raise exception 'Order was assigned by another administrator'
      using errcode = '40001';
  end if;

  select admin_user.role
    into actor_role
  from public.admin_users admin_user
  where admin_user.user_id = actor_id
    and admin_user.active = true;

  -- The normal order audit projection intentionally excludes customer data,
  -- so this ownership change is recorded explicitly with UUIDs only.
  insert into public.audit_logs (
    actor_user_id,
    actor_email,
    actor_role,
    actor_type,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    metadata
  ) values (
    actor_id,
    nullif(auth.jwt() ->> 'email', ''),
    actor_role,
    'admin',
    'orders.member_assigned',
    'orders',
    target_order.id,
    jsonb_build_object('user_id', target_order.user_id),
    jsonb_build_object('user_id', target_member.id),
    jsonb_build_object('source', 'manual-order-member-assignment')
  );

  return jsonb_build_object(
    'order_id', target_order.id,
    'member_id', target_member.id,
    'member_name', coalesce(target_member.name, ''),
    'member_email', coalesce(target_member.email, '')
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.assign_shipping_group_to_additional_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  quoted_group_id uuid;
  target_group public.shipping_groups%rowtype;
  trusted_role text;
begin
  if new.order_source = 'admin_assisted' then return new; end if;
  quoted_group_id := nullif(new.pricing_snapshot ->> 'shipping_group_id', '')::uuid;
  if quoted_group_id is null then
    return new;
  end if;

  if new.user_id is null or new.fulfillment_method <> 'delivery' then
    raise exception 'Combined shipping requires a signed-in delivery order'
      using errcode = '42501';
  end if;

  select profile.role into trusted_role
  from public.profiles profile
  where profile.id = new.user_id;
  if not public.is_professional_shipping_role(trusted_role) then
    raise exception 'Combined shipping is available only to professional members'
      using errcode = '42501';
  end if;

  select shipping_group.* into target_group
  from public.shipping_groups shipping_group
  where shipping_group.id = quoted_group_id
  for update;

  if not found
    or target_group.user_id <> new.user_id
    or target_group.status <> 'open'
    or not exists (
      select 1
      from public.orders grouped_order
      where grouped_order.shipping_group_id = target_group.id
        and public.is_shipping_group_valid_order_status(grouped_order.status)
    )
  then
    raise exception 'Combined shipping group is no longer appendable'
      using errcode = '40001';
  end if;

  new.shipping_group_id := target_group.id;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.assisted_auto_unit_price(p_customer_id uuid, p_role text, p_product products, p_variant product_variants, p_student_multiplier numeric)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.apply_student_price(case when p_role='consumer' then p_variant.price else
    round((case when (p_role='instructor' and p_product.instructor_price_multiplier=1)
      or(p_role='distributor' and p_product.distributor_price_multiplier=1)
      or(p_role='staff' and p_product.staff_price_multiplier=1)
      or(p_role='pro' and p_product.instructor_price_multiplier=1
        and p_product.distributor_price_multiplier=1 and p_product.staff_price_multiplier=1)
      then coalesce(p_variant.pro_price,0) else coalesce(nullif(p_variant.pro_price,0),p_variant.price) end)
      *public.resolve_product_price_multiplier(p_product,p_role,
        coalesce((select professional_price_multiplier from public.membership_tiers where role=p_role and active),1))) end,
    case when p_role='pro' then p_student_multiplier end);
$function$;

CREATE OR REPLACE FUNCTION public.assisted_coupon_allows_identity(p_campaign_id uuid, p_member_role text, p_customer_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select case campaign.audience_mode
    when 'members' then p_customer_id is not null and exists(select 1 from public.coupon_campaign_members target
      where target.coupon_campaign_id=campaign.id and target.user_id=p_customer_id)
    else p_member_role=any(campaign.audience_roles) and (p_customer_id is not null or campaign.allow_guest)
    end from public.coupon_campaigns campaign where campaign.id=p_campaign_id),false);
$function$;

CREATE OR REPLACE FUNCTION public.assisted_discount_quote(p_items jsonb, p_fulfillment_method text, p_coupon_code text, p_guest_email text, p_customer_id uuid, p_apply_automatic boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  base_quote jsonb;
  pricing_lines jsonb;
  member_role text;
  subtotal_amount numeric;
  automatic_discount numeric := 0;
  automatic_id uuid;
  automatic_name text;
  automatic_type text;
  automatic_eligible_subtotal numeric;
  automatic_qualification_subtotal numeric;
  automatic_qualification_quantity numeric;
  automatic_threshold_type text := 'amount';
  automatic_threshold_value numeric;
  legacy_discount numeric;
  legacy_id uuid;
  legacy_name text;
  candidate record;
  activity record;
  qualification_subtotal numeric;
  qualification_quantity numeric;
  eligible_subtotal numeric;
  activity_discount numeric;
  total_discount numeric := 0;
  shipping_amount numeric;
  total_amount numeric;
  normalized_code text := upper(btrim(coalesce(p_coupon_code, '')));
  campaign public.coupon_campaigns%rowtype;
  coupon_adjustments jsonb := '[]'::jsonb;
  automatic_adjustments jsonb := '[]'::jsonb;
  all_adjustments jsonb := '[]'::jsonb;
  current_user_id uuid := p_customer_id;
  guest_hash text;
  active_usage integer;
  identity_usage integer;
  normalized_fulfillment text := coalesce(nullif(btrim(p_fulfillment_method), ''), 'delivery');
  shipping_group_context jsonb;
  appendable_group_id uuid;
  is_additional_order boolean := false;
  effective_merchandise_amount numeric;
begin
  base_quote := p_items;
  pricing_lines := base_quote -> 'items';
  member_role := base_quote ->> 'member_role';
  subtotal_amount := (base_quote ->> 'subtotal')::numeric;
  legacy_discount := coalesce((base_quote ->> 'discount')::numeric, 0);
  legacy_id := nullif(base_quote ->> 'promotion_id', '')::uuid;
  legacy_name := base_quote ->> 'promotion_name';

  -- Add a non-rounded remaining amount to each line. It is only an internal
  -- calculation field and is removed before returning the quote.
  select coalesce(jsonb_agg(item || jsonb_build_object(
    'remaining_total', (item ->> 'line_total')::numeric
  )), '[]'::jsonb)
  into pricing_lines
  from jsonb_array_elements(pricing_lines) item;

  -- Compare every atomic automatic discount against the legacy winner. Only
  -- one automatic price discount may win, preserving the site's prior rule.
  automatic_discount := legacy_discount;
  automatic_id := legacy_id;
  automatic_name := legacy_name;
  automatic_type := case when legacy_id is not null then 'legacy_discount' end;
  automatic_eligible_subtotal := coalesce(
    (base_quote #>> '{pricing_snapshot,promotion,eligible_subtotal}')::numeric,
    subtotal_amount
  );
  automatic_qualification_subtotal := subtotal_amount;
  automatic_qualification_quantity := (
    select coalesce(sum((item ->> 'qty')::numeric), 0)
    from jsonb_array_elements(pricing_lines) item
  );

  for candidate in
    select promotion.*
    from public.promotions promotion
    where p_apply_automatic and promotion.active = true
      and promotion.activation_type = 'automatic'
      and promotion.benefit_type in ('percentage_discount', 'fixed_discount')
      and promotion.archived_at is null
      and (promotion.start_at is null or promotion.start_at <= now())
      and (promotion.end_at is null or promotion.end_at > now())
    order by promotion.priority asc, promotion.created_at asc, promotion.id asc
  loop
    select coalesce(sum((item ->> 'line_total')::numeric), 0)
      into qualification_subtotal
      from jsonb_array_elements(pricing_lines) item
      where public.promotion_item_matches_scope(candidate.id, item, 'qualification');

    select coalesce(sum((item ->> 'qty')::numeric), 0)
      into qualification_quantity
      from jsonb_array_elements(pricing_lines) item
      where public.promotion_item_matches_scope(candidate.id, item, 'qualification');

    select coalesce(sum((item ->> 'line_total')::numeric), 0)
      into eligible_subtotal
      from jsonb_array_elements(pricing_lines) item
      where public.promotion_item_matches_scope(candidate.id, item, 'benefit');

    if (case when candidate.threshold_type = 'quantity' then qualification_quantity else qualification_subtotal end) > 0
      and eligible_subtotal > 0
      and (candidate.threshold_value is null or case
        when candidate.threshold_type = 'quantity' then qualification_quantity
        else qualification_subtotal
      end >= candidate.threshold_value)
    then
      activity_discount := case candidate.benefit_type
        when 'percentage_discount' then round(eligible_subtotal * (1 - candidate.discount_rate))
        when 'fixed_discount' then least(eligible_subtotal, candidate.discount_amount)
        else 0
      end;
      activity_discount := least(greatest(coalesce(activity_discount, 0), 0), eligible_subtotal);

      if activity_discount > automatic_discount then
        automatic_discount := activity_discount;
        automatic_id := candidate.id;
        automatic_name := candidate.name;
        automatic_type := candidate.benefit_type;
        automatic_eligible_subtotal := eligible_subtotal;
        automatic_qualification_subtotal := qualification_subtotal;
        automatic_qualification_quantity := qualification_quantity;
        automatic_threshold_type := candidate.threshold_type;
        automatic_threshold_value := candidate.threshold_value;
      end if;
    end if;
  end loop;

  if automatic_id is not null and automatic_discount > 0 then
    automatic_adjustments := jsonb_build_array(jsonb_build_object(
      'promotion_id', automatic_id,
      'coupon_campaign_id', null,
      'adjustment_type', automatic_type,
      'name', automatic_name,
      'amount', automatic_discount,
      'sort_order', 0,
      'qualification', jsonb_build_object(
        'basis', automatic_threshold_type,
        'value', case when automatic_threshold_type = 'quantity' then automatic_qualification_quantity else automatic_qualification_subtotal end,
        'subtotal', automatic_qualification_subtotal,
        'quantity', automatic_qualification_quantity,
        'threshold', automatic_threshold_value
      )
    ));
  end if;

  if normalized_code <> '' then
    select * into campaign
    from public.coupon_campaigns target
    where target.code_normalized = normalized_code
      and target.active = true
      and target.archived_at is null
      and (target.start_at is null or target.start_at <= now())
      and (target.end_at is null or target.end_at > now());

    if not found
      or not public.assisted_coupon_allows_identity(campaign.id, member_role, p_customer_id)
    then
      raise exception '優惠碼無效或目前無法使用' using errcode = '22023';
    end if;

    if current_user_id is null then
      if nullif(lower(btrim(coalesce(p_guest_email, ''))), '') is null then
        raise exception '訪客使用優惠碼時需先填寫 Email' using errcode = '22023';
      end if;
      guest_hash := encode(digest(lower(btrim(p_guest_email)), 'sha256'), 'hex');
    end if;

    select count(*) into active_usage
    from public.coupon_redemptions redemption
    where redemption.coupon_campaign_id = campaign.id
      and (redemption.status = 'redeemed'
        or (redemption.status = 'reserved' and redemption.expires_at > now()));

    select count(*) into identity_usage
    from public.coupon_redemptions redemption
    where redemption.coupon_campaign_id = campaign.id
      and (redemption.status = 'redeemed'
        or (redemption.status = 'reserved' and redemption.expires_at > now()))
      and ((current_user_id is not null and redemption.user_id = current_user_id)
        or (current_user_id is null and redemption.guest_identity_hash = guest_hash));

    if campaign.total_usage_limit is not null and active_usage >= campaign.total_usage_limit then
      raise exception '優惠碼已達使用上限' using errcode = '22023';
    end if;
    if campaign.per_member_limit is not null and identity_usage >= campaign.per_member_limit then
      raise exception '此優惠碼已達個人使用上限' using errcode = '22023';
    end if;

    -- coupon_only and allow_auto_gifts both suppress automatic price discounts.
    -- allow_auto_gifts becomes observably different once the gift batch lands.
    if campaign.stacking_policy <> 'allow_all' then
      automatic_discount := 0;
      automatic_id := null;
      automatic_name := null;
      automatic_type := null;
      automatic_adjustments := '[]'::jsonb;
    else
      -- Reduce all lines proportionally for the automatic winner so subsequent
      -- coupon activities calculate from the remaining payable merchandise.
      if automatic_discount > 0 then
        select coalesce(jsonb_agg(case
          when (
            automatic_type = 'legacy_discount'
            and (item ->> 'product_id')::integer = any(
              (select product_ids from public.promotions where id = automatic_id)::integer[]
            )
          ) or (
            automatic_type in ('percentage_discount', 'fixed_discount')
            and public.promotion_item_matches_scope(automatic_id, item, 'benefit')
          ) then item || jsonb_build_object(
            'remaining_total', greatest(0,
              (item ->> 'remaining_total')::numeric
              - automatic_discount * (item ->> 'remaining_total')::numeric
                / nullif(automatic_eligible_subtotal, 0)
            )
          )
          else item
        end), '[]'::jsonb) into pricing_lines
        from jsonb_array_elements(pricing_lines) item;
      end if;
    end if;

    for activity in
      select promotion.*, link.sort_order as bundle_sort_order
      from public.coupon_promotions link
      join public.promotions promotion on promotion.id = link.promotion_id
      where link.coupon_campaign_id = campaign.id
        and promotion.active = true
        and promotion.activation_type = 'coupon_only'
        and promotion.benefit_type in ('percentage_discount', 'fixed_discount')
        and promotion.archived_at is null
        and (promotion.start_at is null or promotion.start_at <= now())
        and (promotion.end_at is null or promotion.end_at > now())
      order by link.sort_order asc, link.id asc
    loop
      select coalesce(sum(case
        when activity.threshold_basis = 'after_bundle_discount'
          then (item ->> 'remaining_total')::numeric
        else (item ->> 'line_total')::numeric
      end), 0)
      into qualification_subtotal
      from jsonb_array_elements(pricing_lines) item
      where public.promotion_item_matches_scope(activity.id, item, 'qualification');

      select coalesce(sum((item ->> 'qty')::numeric), 0)
        into qualification_quantity
        from jsonb_array_elements(pricing_lines) item
        where public.promotion_item_matches_scope(activity.id, item, 'qualification');

      select coalesce(sum((item ->> 'remaining_total')::numeric), 0)
        into eligible_subtotal
        from jsonb_array_elements(pricing_lines) item
        where public.promotion_item_matches_scope(activity.id, item, 'benefit');

      if (case when activity.threshold_type = 'quantity' then qualification_quantity else qualification_subtotal end) > 0
        and eligible_subtotal > 0
        and (activity.threshold_value is null or case
          when activity.threshold_type = 'quantity' then qualification_quantity
          else qualification_subtotal
        end >= activity.threshold_value)
      then
        activity_discount := case activity.benefit_type
          when 'percentage_discount' then round(eligible_subtotal * (1 - activity.discount_rate))
          when 'fixed_discount' then least(eligible_subtotal, activity.discount_amount)
          else 0
        end;
        activity_discount := least(greatest(coalesce(activity_discount, 0), 0), eligible_subtotal);

        if activity_discount > 0 then
          coupon_adjustments := coupon_adjustments || jsonb_build_array(jsonb_build_object(
            'promotion_id', activity.id,
            'coupon_campaign_id', campaign.id,
            'adjustment_type', activity.benefit_type,
            'name', activity.name,
            'amount', activity_discount,
            'sort_order', activity.bundle_sort_order + 1,
            'qualification', jsonb_build_object(
              'basis', activity.threshold_type,
              'value', case when activity.threshold_type = 'quantity' then qualification_quantity else qualification_subtotal end,
              'subtotal', qualification_subtotal,
              'quantity', qualification_quantity,
              'eligible_subtotal', eligible_subtotal,
              'threshold', activity.threshold_value,
              'threshold_basis', activity.threshold_basis
            )
          ));

          -- Preserve each line's share as a decimal. Individual lines are not
          -- charged from this field, so aggregate rounding stays exact while a
          -- later bundled activity still sees the correct remaining base.
          select coalesce(jsonb_agg(case
            when public.promotion_item_matches_scope(activity.id, item, 'benefit') then
              item || jsonb_build_object(
                'remaining_total', greatest(0,
                  (item ->> 'remaining_total')::numeric
                  - activity_discount * (item ->> 'remaining_total')::numeric / nullif(eligible_subtotal, 0)
                )
              )
            else item
          end), '[]'::jsonb)
          into pricing_lines
          from jsonb_array_elements(pricing_lines) item;
        end if;
      end if;
    end loop;

    if jsonb_array_length(coupon_adjustments) = 0
      and not exists (
        select 1
        from public.coupon_promotions gift_link
        join public.promotions gift_promotion on gift_promotion.id = gift_link.promotion_id
        where gift_link.coupon_campaign_id = campaign.id
          and gift_promotion.active = true
          and gift_promotion.activation_type = 'coupon_only'
          and gift_promotion.benefit_type in ('amount_gift', 'quantity_gift')
          and gift_promotion.archived_at is null
          and (gift_promotion.start_at is null or gift_promotion.start_at <= now())
          and (gift_promotion.end_at is null or gift_promotion.end_at > now())
      )
    then
      raise exception '此優惠碼不適用目前購物車內容' using errcode = '22023';
    end if;
  end if;

  all_adjustments := automatic_adjustments || coupon_adjustments;
  select coalesce(sum((adjustment ->> 'amount')::numeric), 0)
    into total_discount
    from jsonb_array_elements(all_adjustments) adjustment;
  total_discount := least(greatest(total_discount, 0), subtotal_amount);

  effective_merchandise_amount := subtotal_amount - total_discount;

  if member_role in ('pro', 'instructor', 'distributor')
    and normalized_fulfillment = 'delivery'
  then
    shipping_group_context := null;
    appendable_group_id := nullif(shipping_group_context ->> 'id', '')::uuid;
    is_additional_order := appendable_group_id is not null;
  end if;

  if member_role in ('pro', 'instructor', 'distributor')
    and effective_merchandise_amount < 5000
    and false -- minimum exceptions are validated by the assisted editor
  then
    raise exception '專業會員單筆訂單最低金額為 NT$ 5,000' using errcode = '22023';
  end if;

  if normalized_fulfillment = 'onsite_pickup' then
    shipping_amount := 0;
  elsif is_additional_order then
    shipping_amount := 0;
  elsif member_role in ('pro', 'instructor', 'distributor')
    and effective_merchandise_amount >= 15000
  then
    shipping_amount := 0;
  else
    shipping_amount := public.calculate_order_shipping(base_quote -> 'items');
  end if;
  total_amount := effective_merchandise_amount + shipping_amount;

  return jsonb_build_object(
    'member_role', member_role,
    'items', base_quote -> 'items',
    'subtotal', subtotal_amount,
    'discount', total_discount,
    'shipping', shipping_amount,
    'total', total_amount,
    'fulfillment_method', normalized_fulfillment,
    'shipping_group_id', appendable_group_id,
    'is_additional_order', is_additional_order,
    'shipping_group', shipping_group_context,
    'promotion_id', automatic_id,
    'promotion_name', automatic_name,
    'coupon_campaign_id', case when normalized_code = '' then null else campaign.id end,
    'coupon_name', case when normalized_code = '' then null else campaign.name end,
    'coupon_code_mask', case when normalized_code = '' then null
      else left(normalized_code, least(3, length(normalized_code))) || repeat('*', greatest(length(normalized_code) - 3, 3)) end,
    'adjustments', all_adjustments,
    'pricing_snapshot', jsonb_build_object(
      'version', 4,
      'engine', 'authoritative_quote_v2',
      'calculated_at', clock_timestamp(),
      'currency', 'TWD',
      'member_role', member_role,
      'fulfillment_method', normalized_fulfillment,
      'items', base_quote -> 'items',
      'automatic_promotion', case when automatic_id is null then null else jsonb_build_object(
        'id', automatic_id, 'name', automatic_name, 'type', automatic_type,
        'discount', automatic_discount
      ) end,
      'coupon', case when normalized_code = '' then null else jsonb_build_object(
        'id', campaign.id, 'name', campaign.name,
        'code_mask', left(normalized_code, least(3, length(normalized_code))) || repeat('*', greatest(length(normalized_code) - 3, 3)),
        'stacking_policy', campaign.stacking_policy
      ) end,
      'adjustments', all_adjustments,
      'subtotal', subtotal_amount,
      'discount', total_discount,
      'final_subtotal', effective_merchandise_amount,
      'shipping_group_id', appendable_group_id,
      'is_additional_order', is_additional_order,
      'shipping_group', shipping_group_context,
      'shipping', shipping_amount,
      'total', total_amount
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.assisted_gift_quote(p_items jsonb, p_fulfillment_method text, p_coupon_code text, p_guest_email text, p_customer_id uuid, p_apply_automatic boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  result jsonb;
  merchandise_items jsonb;
  gift_items jsonb := '[]'::jsonb;
  gift_adjustments jsonb := '[]'::jsonb;
  campaign_id uuid;
  stacking_policy text;
  candidate record;
  qualification_value numeric;
  repeat_count integer;
  awarded_quantity integer;
  reserved_quantity integer;
  available_quantity integer;
  gift_product_id integer;
  gift_item_sku text;
  gift_size text;
  gift_name_zh text;
  gift_name_en text;
  gift_image_path text;
  normalized_code text := upper(btrim(coalesce(p_coupon_code, '')));
begin
  result := public.assisted_discount_quote(
    p_items, p_fulfillment_method, p_coupon_code, p_guest_email, p_customer_id, p_apply_automatic
  );
  merchandise_items := result -> 'items';
  campaign_id := nullif(result ->> 'coupon_campaign_id', '')::uuid;
  stacking_policy := coalesce(result #>> '{pricing_snapshot,coupon,stacking_policy}', '');

  for candidate in
    select promotion.*, link.coupon_campaign_id, coalesce(link.sort_order, 0) as bundle_sort_order
    from public.promotions promotion
    left join public.coupon_promotions link
      on link.promotion_id = promotion.id and link.coupon_campaign_id = campaign_id
    where promotion.active = true
      and promotion.archived_at is null
      and promotion.benefit_type in ('amount_gift', 'quantity_gift')
      and (promotion.start_at is null or promotion.start_at <= now())
      and (promotion.end_at is null or promotion.end_at > now())
      and (
        (promotion.activation_type = 'coupon_only' and link.coupon_campaign_id = campaign_id)
        or (
          p_apply_automatic and promotion.activation_type = 'automatic'
          and (campaign_id is null or stacking_policy in ('allow_auto_gifts', 'allow_all'))
        )
      )
    order by
      case when promotion.activation_type = 'coupon_only' then 0 else 1 end,
      coalesce(link.sort_order, promotion.priority), promotion.created_at, promotion.id
  loop
    if candidate.benefit_type = 'amount_gift' then
      select coalesce(sum((item ->> 'line_total')::numeric), 0)
      into qualification_value
      from jsonb_array_elements(merchandise_items) item
      where public.promotion_item_matches_scope(candidate.id, item, 'qualification');
    else
      select coalesce(sum((item ->> 'qty')::numeric), 0)
      into qualification_value
      from jsonb_array_elements(merchandise_items) item
      where public.promotion_item_matches_scope(candidate.id, item, 'qualification');
    end if;

    if qualification_value < candidate.threshold_value then
      continue;
    end if;
    repeat_count := case when candidate.repeat_mode = 'repeat'
      then floor(qualification_value / candidate.threshold_value)::integer else 1 end;
    awarded_quantity := candidate.gift_quantity * greatest(repeat_count, 1);

    select variant.product_id, variant.sku, variant.size, variant.gift_stock,
      product.name_zh, product.name,
      image.storage_path
    into gift_product_id, gift_item_sku, gift_size, available_quantity,
      gift_name_zh, gift_name_en, gift_image_path
    from public.product_variants variant
    join public.products product on product.id = variant.product_id
    left join lateral (
      select product_image.storage_path
      from public.product_images product_image
      where product_image.product_id = product.id and product_image.active = true
      order by product_image.is_primary desc, product_image.sort_order, product_image.id
      limit 1
    ) image on true
    where variant.id = candidate.gift_variant_id
      and variant.active = true
      and variant.gift_enabled = true
      and product.publication_status in ('active', 'event_only', 'gift_only');

    if not found then
      if candidate.activation_type = 'coupon_only' then
        raise exception '優惠券指定的贈品庫存目前不可使用' using errcode = '22023';
      end if;
      continue;
    end if;

    select coalesce(sum(reservation.quantity), 0)::integer
    into reserved_quantity
    from public.promotion_gift_reservations reservation
    where reservation.product_variant_id = candidate.gift_variant_id
      and reservation.status = 'reserved'
      and reservation.expires_at > now();
    select reserved_quantity + coalesce(sum((gift ->> 'qty')::integer), 0)::integer
    into reserved_quantity
    from jsonb_array_elements(gift_items) gift
    where (gift ->> 'variant_id')::bigint = candidate.gift_variant_id;
    available_quantity := greatest(coalesce(available_quantity, 0) - reserved_quantity, 0);

    if available_quantity < awarded_quantity then
      if candidate.activation_type = 'coupon_only' then
        raise exception '優惠券贈品已兌換完畢' using errcode = '22023';
      end if;
      continue;
    end if;

    gift_items := gift_items || jsonb_build_array(jsonb_build_object(
      'product_id', gift_product_id,
      'variant_id', candidate.gift_variant_id,
      'sku', gift_item_sku,
      'name', gift_name_zh,
      'nameZh', gift_name_zh,
      'name_en', gift_name_en,
      'size', gift_size,
      'qty', awarded_quantity,
      'unit_price', 0,
      'price', 0,
      'line_total', 0,
      'line_type', 'gift',
      'is_gift', true,
      'promotion_id', candidate.id,
      'coupon_campaign_id', candidate.coupon_campaign_id,
      'image_storage_path', gift_image_path,
      'stock_at_order', awarded_quantity,
      'fulfillment_type', 'in_stock',
      'fulfillment_label', '贈品已保留',
      'shipping_label', '與訂單一併出貨'
    ));
    gift_adjustments := gift_adjustments || jsonb_build_array(jsonb_build_object(
      'promotion_id', candidate.id,
      'coupon_campaign_id', candidate.coupon_campaign_id,
      'adjustment_type', candidate.benefit_type,
      'name', candidate.name,
      'amount', 0,
      'gift_product_id', gift_product_id,
      'gift_variant_id', candidate.gift_variant_id,
      'gift_quantity', awarded_quantity,
      'sort_order', 100 + candidate.bundle_sort_order,
      'qualification', jsonb_build_object(
        'basis', case when candidate.benefit_type = 'amount_gift' then 'amount' else 'quantity' end,
        'value', qualification_value,
        'threshold', candidate.threshold_value,
        'repeat_mode', candidate.repeat_mode,
        'repeat_count', repeat_count
      )
    ));
  end loop;

  if campaign_id is not null
    and not exists (
      select 1 from jsonb_array_elements(
        coalesce(result -> 'adjustments', '[]'::jsonb) || gift_adjustments
      ) adjustment
      where nullif(adjustment ->> 'coupon_campaign_id', '')::uuid = campaign_id
    )
  then
    raise exception '此優惠碼不適用目前購物車內容' using errcode = '22023';
  end if;

  result := jsonb_set(result, '{items}', merchandise_items || gift_items, true);
  result := jsonb_set(result, '{adjustments}', coalesce(result -> 'adjustments', '[]'::jsonb) || gift_adjustments, true);
  result := jsonb_set(result, '{gifts}', gift_items, true);
  result := jsonb_set(result, '{pricing_snapshot,version}', '5'::jsonb, true);
  result := jsonb_set(result, '{pricing_snapshot,engine}', '"authoritative_quote_v3_gifts"'::jsonb, true);
  result := jsonb_set(result, '{pricing_snapshot,items}', merchandise_items || gift_items, true);
  result := jsonb_set(result, '{pricing_snapshot,adjustments}', coalesce(result -> 'adjustments', '[]'::jsonb), true);
  result := jsonb_set(result, '{pricing_snapshot,gifts}', gift_items, true);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.audit_log_projection(table_name text, row_data jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(public.audit_log_projection_before_member_pricing(table_name,row_data),'{}'::jsonb)
    || case table_name
      when 'products' then jsonb_build_object(
        'instructor_price_multiplier',row_data -> 'instructor_price_multiplier',
        'distributor_price_multiplier',row_data -> 'distributor_price_multiplier',
        'staff_price_multiplier',row_data -> 'staff_price_multiplier')
      when 'membership_tiers' then jsonb_build_object(
        'role',row_data -> 'role',
        'professional_price_multiplier',row_data -> 'professional_price_multiplier')
      else '{}'::jsonb end;
$function$;

CREATE OR REPLACE FUNCTION public.audit_log_projection_before_member_pricing(table_name text, row_data jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case table_name
    when 'orders' then jsonb_strip_nulls(jsonb_build_object(
      'id', row_data -> 'id',
      'status', row_data -> 'status',
      'tracking', row_data -> 'tracking',
      'shipping_carrier', row_data -> 'shipping_carrier',
      'shipped_at', row_data -> 'shipped_at',
      'payment_due_at', row_data -> 'payment_due_at',
      'payment_reminded_at', row_data -> 'payment_reminded_at',
      'payment_second_reminded_at', row_data -> 'payment_second_reminded_at',
      'shipment_notification_sent_at', row_data -> 'shipment_notification_sent_at',
      'shipment_notification_channel', row_data -> 'shipment_notification_channel'
    ))
    when 'order_payment_authorizations' then jsonb_strip_nulls(jsonb_build_object(
      'order_id', row_data -> 'order_id',
      'claimed_at', row_data -> 'claimed_at',
      'gateway_created_at', row_data -> 'gateway_created_at'
    ))
    when 'products' then jsonb_strip_nulls(jsonb_build_object(
      'id', row_data -> 'id',
      'name', row_data -> 'name',
      'name_zh', row_data -> 'name_zh',
      'subtitle', row_data -> 'subtitle',
      'category', row_data -> 'category',
      'series', row_data -> 'series',
      'min_stock', row_data -> 'min_stock',
      'is_pro_only', row_data -> 'is_pro_only',
      'publication_status', row_data -> 'publication_status',
      'active', row_data -> 'active',
      'product_list_image_scale', row_data -> 'product_list_image_scale'
    ))
    when 'product_variants' then jsonb_strip_nulls(jsonb_build_object(
      'id', row_data -> 'id',
      'product_id', row_data -> 'product_id',
      'sku', row_data -> 'sku',
      'size', row_data -> 'size',
      'price', row_data -> 'price',
      'pro_price', row_data -> 'pro_price',
      'stock', row_data -> 'stock',
      'is_default', row_data -> 'is_default',
      'sort_order', row_data -> 'sort_order',
      'active', row_data -> 'active'
    ))
    when 'product_images' then jsonb_strip_nulls(jsonb_build_object(
      'id', row_data -> 'id',
      'product_id', row_data -> 'product_id',
      'storage_path', row_data -> 'storage_path',
      'original_name', row_data -> 'original_name',
      'alt_text', row_data -> 'alt_text',
      'sort_order', row_data -> 'sort_order',
      'is_primary', row_data -> 'is_primary',
      'active', row_data -> 'active'
    ))
    when 'profiles' then jsonb_strip_nulls(jsonb_build_object(
      'id', row_data -> 'id',
      'name', row_data -> 'name',
      'role', row_data -> 'role'
    ))
    when 'professional_applications' then jsonb_strip_nulls(jsonb_build_object(
      'id', row_data -> 'id',
      'user_id', row_data -> 'user_id',
      'status', row_data -> 'status',
      'source', row_data -> 'source'
    ))
    when 'promotions' then jsonb_strip_nulls(jsonb_build_object(
      'id', row_data -> 'id',
      'name', row_data -> 'name',
      'product_ids', row_data -> 'product_ids',
      'discount_rate', row_data -> 'discount_rate',
      'discount_amount', row_data -> 'discount_amount',
      'discount_order', row_data -> 'discount_order',
      'start_at', row_data -> 'start_at',
      'end_at', row_data -> 'end_at',
      'active', row_data -> 'active'
    ))
    when 'admin_users' then jsonb_strip_nulls(jsonb_build_object(
      'user_id', row_data -> 'user_id',
      'role', row_data -> 'role',
      'active', row_data -> 'active',
      'created_by', row_data -> 'created_by'
    ))
    else '{}'::jsonb
  end;
$function$;

CREATE OR REPLACE FUNCTION public.authorize_assisted_link(p_order_id text, p_link_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare request_row public.assisted_order_requests%rowtype; target_order public.orders%rowtype;
begin
  if coalesce(p_link_token,'') !~ '^[0-9a-f]{64}$' then raise exception 'Invalid order link' using errcode='42501'; end if;
  select * into request_row from public.assisted_order_requests where order_id=p_order_id and link_token=p_link_token;
  if not found then raise exception 'Invalid order link' using errcode='42501'; end if;
  select * into target_order from public.orders where id=p_order_id and order_source='admin_assisted';
  if not found or target_order.payment_due_at<=now() then raise exception '訂單連結已到期，請使用原有訂單查詢入口。' using errcode='42501'; end if;
  return jsonb_build_object('payment_token',request_row.payment_token,'payment_method',target_order.assisted_payment_method,'credit_consent_at',request_row.credit_consent_at);
end;
$function$;

CREATE OR REPLACE FUNCTION public.authorize_order_payment_access(p_order_id text, p_payment_token text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select exists (
    select 1
    from public.order_payment_authorizations
    where order_id = p_order_id
      and token_hash = encode(digest(p_payment_token, 'sha256'), 'hex')
  );
$function$;

CREATE OR REPLACE FUNCTION public.begin_order_payment_retry(p_order_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  target_order public.orders%rowtype;
  payment_auth public.order_payment_authorizations%rowtype;
  instruction public.order_payment_instructions%rowtype;
  next_attempt integer;
  next_token text := encode(gen_random_bytes(32), 'hex');
  next_provider_order_no text;
begin
  perform public.assert_assisted_credit_consent(p_order_id);
  select * into target_order
  from public.orders
  where id = p_order_id
  for update;

  if not found or target_order.status <> 'unpaid' then
    raise exception 'Order is not eligible for another payment attempt' using errcode = '22023';
  end if;
  if target_order.payment_due_at <= now() then
    raise exception 'Order payment has expired' using errcode = '22023';
  end if;

  select * into instruction
  from public.order_payment_instructions
  where order_id = p_order_id
  for update;

  if not found or instruction.payment_state <> 'failed' then
    raise exception 'Only a failed payment can be retried' using errcode = '22023';
  end if;
  if instruction.payment_method not in ('card', 'apple', 'google') then
    raise exception 'This payment method cannot be retried' using errcode = '22023';
  end if;

  select * into payment_auth
  from public.order_payment_authorizations
  where order_id = p_order_id
  for update;
  if not found then
    raise exception 'Payment authorization not found' using errcode = 'P0002';
  end if;


  if target_order.order_source='admin_assisted' and (
    (payment_auth.claimed_at is not null and payment_auth.gateway_created_at is null)
    or (payment_auth.attempt_no > instruction.attempt_no and not exists(
      select 1 from public.order_payment_attempts attempt
      where attempt.provider_order_no=payment_auth.provider_order_no and attempt.payment_state='failed'))
  ) then
    raise exception 'Assisted payment retry result unresolved; confirm previous bank attempt first' using errcode='55P03';
  end if;
  next_attempt := greatest(coalesce(payment_auth.attempt_no, 1), coalesce(instruction.attempt_no, 1)) + 1;
  next_provider_order_no := left(regexp_replace(p_order_id, '[^A-Za-z0-9_-]', '', 'g'), 42 - length(next_attempt::text))
    || '-R' || next_attempt::text;

  update public.order_payment_authorizations
  set token_hash = encode(digest(next_token, 'sha256'), 'hex'),
      provider_order_no = next_provider_order_no,
      attempt_no = next_attempt,
      claimed_at = null,
      gateway_created_at = null
  where order_id = p_order_id;

  insert into public.order_payment_attempts (
    order_id, provider_order_no, attempt_no, payment_method, payment_state
  ) values (
    p_order_id, next_provider_order_no, next_attempt, instruction.payment_method, 'initiated'
  );

  return jsonb_build_object(
    'order_id', p_order_id,
    'payment_token', next_token,
    'provider_order_no', next_provider_order_no,
    'attempt_no', next_attempt
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_order_shipping(p_items jsonb)
 RETURNS numeric
 LANGUAGE sql
 STABLE STRICT SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.role = 'staff'
    ) then 0::numeric
    when jsonb_array_length(p_items) > 0
      and not exists (
        select 1
        from jsonb_array_elements(p_items) item
        where (item ->> 'product_id')::integer <> 9
      )
    then 0::numeric
    else 120::numeric
  end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_historical_order(p_order_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  target_order public.orders%rowtype;
begin
  if auth.uid() is null or not public.has_backoffice_permission('orders.write') then
    raise exception 'Order write access required' using errcode = '42501';
  end if;

  select * into target_order
  from public.orders target
  where target.id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if target_order.order_source <> 'historical_manual' then
    raise exception 'Only historical orders can use this cancellation workflow'
      using errcode = '22023';
  end if;
  if target_order.status = 'cancelled' then
    return jsonb_build_object(
      'order_id', target_order.id,
      'status', target_order.status,
      'cancelled', true,
      'already_cancelled', true
    );
  end if;
  if target_order.status <> 'delivered' then
    raise exception 'Only completed historical orders can be cancelled'
      using errcode = '22023';
  end if;

  perform set_config('app.eclado_historical_order_cancel', '1', true);
  update public.orders
  set status = 'cancelled'
  where id = target_order.id;
  perform set_config('app.eclado_historical_order_cancel', '0', true);

  return jsonb_build_object(
    'order_id', target_order.id,
    'status', 'cancelled',
    'cancelled', true,
    'already_cancelled', false
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_member_shopping_credit_deletion(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not public.has_backoffice_permission('members.write') then
    raise exception 'Member write permission required' using errcode = '42501';
  end if;
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  update public.shopping_credit_accounts
  set status = 'active', version = version + 1, updated_at = now()
  where user_id = p_user_id and status = 'deletion_pending';

  return jsonb_build_object('ok', true, 'user_id', p_user_id, 'locked', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.capture_admin_audit_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  jwt_role text := coalesce(nullif(auth.role(), ''), auth.jwt() ->> 'role');
  actor_admin_role text;
  actor_kind text;
  is_admin_action boolean := false;
  is_system_action boolean := false;
  old_projection jsonb;
  new_projection jsonb;
  entity_row jsonb;
  entity_key text := tg_argv[0];
  entity_name text := tg_table_name;
  action_name text := tg_table_name || '.' || lower(tg_op);
  request_headers jsonb := '{}'::jsonb;
  audit_source text := 'database_trigger';
begin
  is_admin_action := actor_id is not null and public.is_eclado_backoffice_user();
  is_system_action := jwt_role = 'service_role'
    and tg_table_name in ('orders', 'order_payment_authorizations');

  if not is_admin_action and not is_system_action then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- PostgREST makes request headers available as a transaction setting. Read
  -- only the explicit audit source label; never persist the complete headers.
  begin
    request_headers := coalesce(
      nullif(current_setting('request.headers', true), '')::jsonb,
      '{}'::jsonb
    );
  exception when others then
    request_headers := '{}'::jsonb;
  end;
  audit_source := coalesce(
    nullif(request_headers ->> 'x-eclado-audit-source', ''),
    case when is_system_action then 'service-role' else 'database-trigger' end
  );

  if is_admin_action then
    select role into actor_admin_role
    from public.admin_users
    where user_id = actor_id and active = true;
    actor_kind := 'admin';
  else
    actor_admin_role := jwt_role;
    actor_kind := case
      when audit_source in ('sinopac-notify', 'payment-api', 'payment-return', 'sinopac-webhook') then 'api'
      else 'system'
    end;
  end if;

  old_projection := case when tg_op = 'INSERT' then null
    else public.audit_log_projection(tg_table_name, to_jsonb(old)) end;
  new_projection := case when tg_op = 'DELETE' then null
    else public.audit_log_projection(tg_table_name, to_jsonb(new)) end;

  if tg_op = 'UPDATE' and old_projection is not distinct from new_projection then
    return new;
  end if;

  -- Transient gateway claims are intentionally omitted. A record is created
  -- only after the gateway payment order was successfully established.
  if tg_table_name = 'order_payment_authorizations' then
    if tg_op <> 'UPDATE'
      or (old_projection -> 'gateway_created_at') is not distinct from (new_projection -> 'gateway_created_at')
      or (new_projection -> 'gateway_created_at') is null
    then
      return new;
    end if;
    entity_name := 'orders';
    entity_key := 'order_id';
    action_name := 'orders.payment_created';
  elsif tg_table_name = 'orders' and tg_op = 'UPDATE' then
    if (old_projection -> 'status') is distinct from (new_projection -> 'status')
      and new_projection ->> 'status' = 'paid'
    then
      action_name := 'orders.payment_paid';
    elsif (old_projection -> 'status') is distinct from (new_projection -> 'status')
      and new_projection ->> 'status' = 'cancelled'
    then
      action_name := case
        when audit_source in ('cancel-expired-orders', 'vultr-expire-overdue')
          then 'orders.expired_cancelled'
        else 'orders.cancelled'
      end;
    elsif (old_projection -> 'payment_second_reminded_at')
      is distinct from (new_projection -> 'payment_second_reminded_at')
    then
      action_name := 'orders.payment_second_reminder_sent';
    elsif (old_projection -> 'payment_reminded_at')
      is distinct from (new_projection -> 'payment_reminded_at')
    then
      action_name := 'orders.payment_reminder_sent';
    elsif (old_projection -> 'shipment_notification_sent_at')
      is distinct from (new_projection -> 'shipment_notification_sent_at')
    then
      action_name := 'orders.shipment_notification_sent';
    end if;
  end if;

  entity_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  insert into public.audit_logs (
    actor_user_id,
    actor_email,
    actor_role,
    actor_type,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    metadata
  ) values (
    case when is_admin_action then actor_id else null end,
    case when is_admin_action then nullif(auth.jwt() ->> 'email', '') else null end,
    actor_admin_role,
    actor_kind,
    action_name,
    entity_name,
    coalesce(entity_row ->> entity_key, 'unknown'),
    old_projection,
    new_projection,
    jsonb_build_object('source', audit_source)
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.capture_promotion_configuration_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  actor_admin_role text;
  source_row jsonb;
  before_projection jsonb;
  after_projection jsonb;
  entity_id text;
begin
  if actor_id is null or not public.has_backoffice_permission('promotions.manage') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select role into actor_admin_role
  from public.admin_users
  where user_id = actor_id and active is true;

  if tg_table_name = 'coupon_campaigns' then
    before_projection := case when tg_op = 'INSERT' then null else jsonb_strip_nulls(jsonb_build_object(
      'id', to_jsonb(old) -> 'id',
      'name', to_jsonb(old) -> 'name',
      'start_at', to_jsonb(old) -> 'start_at',
      'end_at', to_jsonb(old) -> 'end_at',
      'active', to_jsonb(old) -> 'active',
      'total_usage_limit', to_jsonb(old) -> 'total_usage_limit',
      'per_member_limit', to_jsonb(old) -> 'per_member_limit',
      'audience_roles', to_jsonb(old) -> 'audience_roles',
      'allow_guest', to_jsonb(old) -> 'allow_guest',
      'stacking_policy', to_jsonb(old) -> 'stacking_policy',
      'archived_at', to_jsonb(old) -> 'archived_at'
    )) end;
    after_projection := case when tg_op = 'DELETE' then null else jsonb_strip_nulls(jsonb_build_object(
      'id', to_jsonb(new) -> 'id',
      'name', to_jsonb(new) -> 'name',
      'start_at', to_jsonb(new) -> 'start_at',
      'end_at', to_jsonb(new) -> 'end_at',
      'active', to_jsonb(new) -> 'active',
      'total_usage_limit', to_jsonb(new) -> 'total_usage_limit',
      'per_member_limit', to_jsonb(new) -> 'per_member_limit',
      'audience_roles', to_jsonb(new) -> 'audience_roles',
      'allow_guest', to_jsonb(new) -> 'allow_guest',
      'stacking_policy', to_jsonb(new) -> 'stacking_policy',
      'archived_at', to_jsonb(new) -> 'archived_at'
    )) end;
  else
    before_projection := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
    after_projection := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  end if;

  if tg_op = 'UPDATE' and before_projection is not distinct from after_projection then
    return new;
  end if;

  source_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  entity_id := coalesce(source_row ->> 'id', 'unknown');

  insert into public.audit_logs (
    actor_user_id,
    actor_email,
    actor_role,
    actor_type,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    metadata
  ) values (
    actor_id,
    nullif(auth.jwt() ->> 'email', ''),
    actor_admin_role,
    'admin',
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    entity_id,
    before_projection,
    after_projection,
    jsonb_build_object('source', 'promotion_foundation_trigger')
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_order_payment(p_order_id text, p_payment_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  payment_auth public.order_payment_authorizations%rowtype;
  target_order public.orders%rowtype;
begin
  perform public.assert_assisted_credit_consent(p_order_id);
  if nullif(trim(p_order_id), '') is null or nullif(trim(p_payment_token), '') is null then
    raise exception 'Order ID and payment token are required' using errcode = '22023';
  end if;

  select * into payment_auth
  from public.order_payment_authorizations
  where order_id = p_order_id
  for update;

  if not found
    or payment_auth.token_hash <> encode(digest(p_payment_token, 'sha256'), 'hex')
  then
    raise exception 'Invalid payment authorization' using errcode = '42501';
  end if;
  if payment_auth.gateway_created_at is not null then
    raise exception 'Payment has already been created' using errcode = '23505';
  end if;
  if payment_auth.claimed_at is not null then
    raise exception 'Payment creation is already in progress' using errcode = '55P03';
  end if;

  select * into target_order from public.orders where id = p_order_id;
  if not found or target_order.status not in ('awaiting_confirm', 'unpaid') then
    raise exception 'Order is not payable' using errcode = '22023';
  end if;
  if target_order.payment_due_at <= now() then
    raise exception 'Order payment has expired' using errcode = '22023';
  end if;
  if target_order.payment_amount < 1 then
    raise exception 'Order gateway payment amount is invalid' using errcode = '23514';
  end if;

  update public.order_payment_authorizations
  set claimed_at = now()
  where order_id = p_order_id;

  return jsonb_build_object(
    'id', target_order.id,
    'total', target_order.payment_amount,
    'order_total', target_order.total,
    'shopping_credit_amount', target_order.shopping_credit_amount,
    'status', target_order.status,
    'items', target_order.items,
    'payment_due_at', target_order.payment_due_at,
    'provider_order_no', coalesce(payment_auth.provider_order_no, target_order.id),
    'attempt_no', coalesce(payment_auth.attempt_no, 1)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_order_payment_notification(p_order_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  claimed_order public.orders;
begin
  update public.orders
  set
    payment_notification_attempts = coalesce(payment_notification_attempts, 0) + 1,
    payment_notification_last_attempt_at = now(),
    -- Reservation prevents concurrent callbacks from sending twice. A crashed
    -- worker becomes eligible again after five minutes.
    payment_notification_next_retry_at = now() + interval '5 minutes'
  where id = p_order_id
    and status in ('paid', 'preparing', 'shipped', 'delivered')
    and payment_notification_sent_at is null
    and (
      payment_notification_next_retry_at is null
      or payment_notification_next_retry_at <= now()
    )
  returning * into claimed_order;

  if claimed_order.id is null then
    return jsonb_build_object(
      'claimed', false,
      'next_retry_at', (
        select payment_notification_next_retry_at
        from public.orders
        where id = p_order_id
      )
    );
  end if;

  return jsonb_build_object(
    'claimed', true,
    'attempts', claimed_order.payment_notification_attempts,
    'next_retry_at', claimed_order.payment_notification_next_retry_at
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_professional_application_admin_notification(p_application_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  claimed public.professional_applications%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  update public.professional_applications application
  set admin_notification_attempts = application.admin_notification_attempts + 1,
      admin_notification_last_attempt_at = now(),
      admin_notification_error = null
  where application.id = p_application_id
    and application.user_id = p_user_id
    and application.status = 'pending'
    and application.admin_notification_sent_at is null
    and (
      application.admin_notification_last_attempt_at is null
      or application.admin_notification_last_attempt_at <= now() - interval '2 minutes'
    )
  returning application.* into claimed;

  if claimed.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', claimed.id,
    'created_at', claimed.created_at,
    'attempts', claimed.admin_notification_attempts
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_professional_quarterly_notices(p_limit integer DEFAULT 100)
 RETURNS SETOF professional_quarterly_notices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  return query
  with candidates as (
    select notice.id
    from public.professional_quarterly_notices notice
    where (
      notice.status in ('pending', 'failed')
      or (notice.status = 'sending' and notice.updated_at < now() - interval '15 minutes')
    )
      and not exists (
        select 1
        from public.professional_quarterly_notices newer
        where newer.user_id = notice.user_id
          and newer.quarter_start = notice.quarter_start
          and newer.version > notice.version
      )
    order by notice.created_at
    limit greatest(1, least(coalesce(p_limit, 100), 100))
    for update skip locked
  )
  update public.professional_quarterly_notices notice
  set status = 'sending',
      attempt_count = notice.attempt_count + 1,
      last_error = null
  from candidates
  where notice.id = candidates.id
  returning notice.*;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_professional_quarterly_notices_for_quarter(p_quarter_start date, p_limit integer DEFAULT 100)
 RETURNS SETOF professional_quarterly_notices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
    begin
      if coalesce(auth.role(), '') <> 'service_role' then
          raise exception 'Service role required' using errcode = '42501';
            end if;
              if p_quarter_start is null
                  or p_quarter_start <> date_trunc('quarter', p_quarter_start::timestamp)::date
                      or (p_quarter_start + interval '3 months')::date > (now() at time zone 'Asia/Taipei')::date
                        then
                            raise exception 'A completed calendar quarter is required' using errcode = '22023';
                              end if;

                                return query
                                  with candidates as (
                                      select notice.id
                                          from public.professional_quarterly_notices notice
                                              where notice.quarter_start = p_quarter_start
                                                    and (
                                                            notice.status in ('pending', 'failed')
                                                                    or (notice.status = 'sending' and notice.updated_at < now() - interval '15 minutes')
                                                                          )
                                                                                and not exists (
                                                                                        select 1
                                                                                                from public.professional_quarterly_notices newer
                                                                                                        where newer.user_id = notice.user_id
                                                                                                                  and newer.quarter_start = notice.quarter_start
                                                                                                                            and newer.version > notice.version
                                                                                                                                  )
                                                                                                                                      order by notice.created_at
                                                                                                                                          limit greatest(1, least(coalesce(p_limit, 100), 100))
                                                                                                                                              for update skip locked
                                                                                                                                                )
                                                                                                                                                  update public.professional_quarterly_notices notice
                                                                                                                                                    set status = 'sending',
                                                                                                                                                          attempt_count = notice.attempt_count + 1,
                                                                                                                                                                last_error = null
                                                                                                                                                                  from candidates
                                                                                                                                                                    where notice.id = candidates.id
                                                                                                                                                                      returning notice.*;
                                                                                                                                                                      end;
                                                                                                                                                                      $function$;

CREATE OR REPLACE FUNCTION public.close_backorders_for_fulfillment(target_order_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  allocation record;
begin
  -- The backorder screen is not part of the current fulfilment workflow. When
  -- staff advances an order, close only the unresolved shortage. Already
  -- allocated stock remains deducted and no unavailable stock is invented.
  for allocation in
    select item.*
    from public.order_inventory_allocations item
    where item.order_id = target_order_id
      and item.backorder_qty > 0
      and item.state in ('partial', 'backordered')
    order by item.product_variant_id, item.item_index
    for update
  loop
    insert into public.inventory_allocation_events (
      allocation_id, order_id, product_variant_id, event_type, quantity, actor_user_id
    ) values (
      allocation.id, target_order_id, allocation.product_variant_id,
      'fulfillment_close', allocation.backorder_qty, auth.uid()
    );

    update public.order_inventory_allocations
    set
      closed_backorder_qty = closed_backorder_qty + allocation.backorder_qty,
      backorder_qty = 0,
      state = 'closed',
      closed_at = now(),
      updated_at = now()
    where id = allocation.id;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.close_inventory_count_shortages_on_order_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.status is distinct from new.status
    and new.status not in ('paid', 'preparing', 'ready_for_pickup') then
    with pending_gift as (
      select shortage.allocation_id,
        sum(shortage.quantity - shortage.resolved_quantity)::integer as quantity
      from public.inventory_count_shortages shortage
      where shortage.order_id = new.id
        and shortage.inventory_type = 'gift'
        and shortage.status = 'pending'
      group by shortage.allocation_id
    )
    update public.order_inventory_allocations allocation
    set closed_backorder_qty = allocation.closed_backorder_qty + pending_gift.quantity,
        state = 'closed',
        closed_at = now(),
        updated_at = now()
    from pending_gift
    where allocation.id = pending_gift.allocation_id;

    update public.inventory_count_shortages
    set status = 'closed',
        resolved_by = auth.uid(),
        resolved_at = now(),
        note = '訂單狀態變更為 ' || new.status || '，停止待處理'
    where order_id = new.id and status = 'pending';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_inventory_count(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  target_session public.inventory_count_sessions;
  item public.inventory_count_items;
  allocation record;
  current_quantity integer;
  next_quantity integer;
  remaining_shortage integer;
  take_quantity integer;
  assigned_shortage integer;
  completed_items integer := 0;
  shortage_total integer := 0;
  is_super_admin boolean;
begin
  if not public.has_backoffice_permission('inventory_counts.manage') then
    raise exception 'Inventory count authorization required' using errcode = '42501';
  end if;

  select session.* into target_session
  from public.inventory_count_sessions session
  where session.id = p_session_id
  for update;
  if not found then raise exception '找不到盤點單' using errcode = 'P0002'; end if;
  if target_session.status <> 'draft' then
    raise exception '盤點單已完成' using errcode = '55000';
  end if;

  select exists (
    select 1 from public.admin_users admin_user
    where admin_user.user_id = auth.uid()
      and admin_user.active is true
      and admin_user.role = 'super_admin'
  ) into is_super_admin;
  if target_session.created_by <> auth.uid() and not is_super_admin then
    raise exception '只有盤點建立者或最高管理員可以完成盤點' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.inventory_count_items
    where session_id = p_session_id and actual_quantity is null
  ) then
    raise exception '仍有尚未盤點的項目，無法完成盤點' using errcode = '22023';
  end if;

  -- Lock every frozen item and its live variant in deterministic order.
  perform 1 from public.inventory_count_items
  where session_id = p_session_id order by product_variant_id, inventory_type for update;
  perform 1 from public.product_variants variant
  where variant.id in (
    select distinct product_variant_id from public.inventory_count_items where session_id = p_session_id
  ) order by variant.id for update;

  for item in
    select * from public.inventory_count_items
    where session_id = p_session_id
    order by product_variant_id, inventory_type, id
    for update
  loop
    select case when item.inventory_type = 'gift' then variant.gift_stock else variant.stock end
    into current_quantity
    from public.product_variants variant where variant.id = item.product_variant_id;

    next_quantity := current_quantity + item.variance;
    remaining_shortage := greatest(-next_quantity, 0);
    assigned_shortage := 0;
    next_quantity := greatest(next_quantity, 0);

    if item.inventory_type = 'gift' then
      update public.product_variants set gift_stock = next_quantity where id = item.product_variant_id;
    else
      update public.product_variants set stock = next_quantity where id = item.product_variant_id;
      perform public.sync_product_stock_mirror(item.product_id);
    end if;

    -- A count shortage consumes free stock first. Any remaining shortage means
    -- physically onsite order allocations are no longer fulfillable. Remove
    -- allocation from newest orders first so older paid orders keep priority.
    if remaining_shortage > 0 then
      for allocation in
        select inventory_allocation.*
        from public.order_inventory_allocations inventory_allocation
        join public.orders target_order on target_order.id = inventory_allocation.order_id
        where inventory_allocation.product_variant_id = item.product_variant_id
          and inventory_allocation.line_type = case when item.inventory_type = 'gift' then 'gift' else 'merchandise' end
          and inventory_allocation.stock_deducted_qty > 0
          and inventory_allocation.state <> 'released'
          and (target_order.status in ('paid', 'preparing', 'ready_for_pickup') OR (target_order.order_source='admin_assisted' AND target_order.status in ('unpaid','awaiting_confirm')))
        order by inventory_allocation.priority_at desc, inventory_allocation.id desc
        for update of inventory_allocation
      loop
        exit when remaining_shortage = 0;
        take_quantity := least(remaining_shortage, allocation.stock_deducted_qty, allocation.allocated_qty);
        if take_quantity <= 0 then continue; end if;

        if item.inventory_type = 'sale' then
          update public.order_inventory_allocations
          set allocated_qty = allocated_qty - take_quantity,
              stock_deducted_qty = stock_deducted_qty - take_quantity,
              backorder_qty = backorder_qty + take_quantity,
              state = case when allocated_qty - take_quantity = 0 then 'backordered' else 'partial' end,
              updated_at = now()
          where id = allocation.id;
        else
          update public.order_inventory_allocations
          set allocated_qty = allocated_qty - take_quantity,
              stock_deducted_qty = stock_deducted_qty - take_quantity,
              state = case when allocated_qty - take_quantity = 0 then 'backordered' else 'partial' end,
              updated_at = now()
          where id = allocation.id;
        end if;

        insert into public.inventory_count_shortages (
          count_item_id, allocation_id, order_id, product_variant_id,
          inventory_type, quantity, status, created_by, resolved_by, resolved_at,
          note
        ) values (
          item.id, allocation.id, allocation.order_id, item.product_variant_id,
          item.inventory_type, take_quantity,
          case when item.inventory_type = 'sale' then 'resolved' else 'pending' end,
          auth.uid(),
          case when item.inventory_type = 'sale' then auth.uid() else null end,
          case when item.inventory_type = 'sale' then now() else null end,
          case when item.inventory_type = 'sale' then '已同步至一般商品待補數量' else '等待補足贈品庫存' end
        );
        remaining_shortage := remaining_shortage - take_quantity;
        assigned_shortage := assigned_shortage + take_quantity;
      end loop;

      if remaining_shortage > 0 then
        insert into public.inventory_count_shortages (
          count_item_id, product_variant_id, inventory_type, quantity,
          resolved_quantity, status, created_by, resolved_by, resolved_at, note
        ) values (
          item.id, item.product_variant_id, item.inventory_type, remaining_shortage,
          remaining_shortage, 'closed', auth.uid(), auth.uid(), now(),
          '完成盤點時已無可對應的現場訂單配置，保留為盤點差異紀錄'
        );
      end if;
    end if;

    update public.inventory_count_items
    set applied_delta = item.variance,
        ledger_quantity_after = next_quantity,
        shortage_quantity = assigned_shortage + remaining_shortage,
        updated_at = now()
    where id = item.id;

    completed_items := completed_items + 1;
    shortage_total := shortage_total + assigned_shortage + remaining_shortage;
  end loop;

  update public.inventory_count_sessions
  set status = 'completed',
      completed_by = auth.uid(),
      completed_by_email = coalesce(auth.jwt() ->> 'email', ''),
      completed_at = now()
  where id = p_session_id;

  return jsonb_build_object(
    'session_id', p_session_id,
    'completed_items', completed_items,
    'shortage_quantity', shortage_total
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_order_payment_claim(p_order_id text, p_payment_token text, p_success boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  update public.order_payment_authorizations
  set
    claimed_at = case when p_success then claimed_at else null end,
    gateway_created_at = case when p_success then now() else gateway_created_at end
  where order_id = p_order_id
    and token_hash = encode(digest(p_payment_token, 'sha256'), 'hex');

  if not found then
    raise exception 'Invalid payment authorization' using errcode = '42501';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_order_payment_notification(p_order_id text, p_sent boolean, p_channel text DEFAULT NULL::text, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  affected integer;
begin
  if p_sent and (p_channel is null or p_channel not in ('line', 'email')) then
    raise exception 'A successful payment notification requires a valid channel';
  end if;

  update public.orders
  set
    payment_notification_sent_at = case when p_sent then now() else null end,
    payment_notification_channel = case when p_sent then p_channel else null end,
    payment_notification_error = case
      when p_sent then null
      else left(coalesce(nullif(trim(p_error), ''), 'notification delivery failed'), 1000)
    end,
    payment_notification_next_retry_at = case
      when p_sent then null
      when coalesce(payment_notification_attempts, 0) <= 3 then now() + interval '5 minutes'
      when coalesce(payment_notification_attempts, 0) <= 6 then now() + interval '30 minutes'
      else now() + interval '2 hours'
    end
  where id = p_order_id
    and payment_notification_sent_at is null;

  get diagnostics affected = row_count;
  return affected = 1;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_professional_application_admin_notification(p_application_id uuid, p_sent boolean, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  updated_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  update public.professional_applications application
  set admin_notification_sent_at = case when p_sent then now() else null end,
      admin_notification_error = case
        when p_sent then null
        else left(coalesce(nullif(btrim(p_error), ''), 'Email delivery failed'), 1000)
      end
  where application.id = p_application_id
    and application.admin_notification_sent_at is null
  returning application.id into updated_id;

  return updated_id is not null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_assisted_credit_consent(p_order_id text, p_link_token text, p_amount bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target public.orders%rowtype;
begin
  perform public.authorize_assisted_link(p_order_id,p_link_token);
  select * into target from public.orders where id=p_order_id for update;
  if target.status not in ('unpaid','awaiting_confirm') or target.payment_due_at<=now()
    or p_amount is distinct from target.shopping_credit_amount or p_amount<=0 then
    raise exception '購物金同意金額或訂單狀態不正確。' using errcode='22023'; end if;
  update public.assisted_order_requests set credit_consent_at=coalesce(credit_consent_at,now()),credit_consent_amount=p_amount where order_id=p_order_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.consume_order_shopping_credit(p_order_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  normalized_order_id text := btrim(coalesce(p_order_id, ''));
  reservation public.shopping_credit_order_reservations%rowtype;
  target_account public.shopping_credit_accounts%rowtype;
  next_reserved bigint;
begin
  select held.* into reservation
  from public.shopping_credit_order_reservations held
  where held.order_id = normalized_order_id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'already_processed', true, 'order_id', normalized_order_id, 'amount', 0);
  end if;
  if reservation.status = 'consumed' then
    return jsonb_build_object('ok', true, 'already_processed', true, 'order_id', normalized_order_id, 'amount', reservation.amount);
  end if;
  if reservation.status <> 'reserved' then
    raise exception 'Shopping credit reservation is not consumable' using errcode = '55000';
  end if;

  select account.* into target_account
  from public.shopping_credit_accounts account
  where account.user_id = reservation.user_id
  for update;

  if target_account.reserved_balance < reservation.amount then
    raise exception 'Shopping credit reserved balance is inconsistent' using errcode = '23514';
  end if;
  next_reserved := target_account.reserved_balance - reservation.amount;

  update public.shopping_credit_accounts
  set reserved_balance = next_reserved, version = version + 1, updated_at = now()
  where user_id = reservation.user_id;

  update public.shopping_credit_order_reservations
  set status = 'consumed', consumed_at = now(), updated_at = now(), version = version + 1
  where order_id = normalized_order_id;

  insert into public.shopping_credit_ledger (
    user_id, event_type, amount, available_delta, reserved_delta,
    available_balance_after, reserved_balance_after,
    order_id, reason_code, metadata
  ) values (
    reservation.user_id, 'consume', reservation.amount, 0, -reservation.amount,
    target_account.available_balance, next_reserved,
    normalized_order_id, 'payment_success',
    jsonb_build_object('source', 'payment_confirmation')
  );

  return jsonb_build_object(
    'ok', true, 'already_processed', false,
    'order_id', normalized_order_id, 'amount', reservation.amount,
    'available_balance', target_account.available_balance,
    'reserved_balance', next_reserved
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.consume_rate_limit_internal(p_scope text, p_key_hash text, p_limit integer, p_window_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  bucket_start timestamptz;
  next_count integer;
begin
  if p_scope !~ '^[a-z0-9:_-]{1,80}$'
     or p_key_hash !~ '^[a-f0-9]{64}$'
     or p_limit not between 1 and 10000
     or p_window_seconds not between 10 and 86400 then
    raise exception 'Invalid rate limit parameters' using errcode = '22023';
  end if;

  bucket_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.api_rate_limits(scope, key_hash, window_started_at, request_count)
  values (p_scope, p_key_hash, bucket_start, 1)
  on conflict (scope, key_hash, window_started_at)
  do update set
    request_count = public.api_rate_limits.request_count + 1,
    updated_at = now()
  returning request_count into next_count;

  delete from public.api_rate_limits
  where window_started_at < now() - interval '2 days';

  return next_count <= p_limit;
end;
$function$;

CREATE OR REPLACE FUNCTION public.consume_service_rate_limit(p_scope text, p_key_hash text, p_limit integer, p_window_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  return public.consume_rate_limit_internal(p_scope, p_key_hash, p_limit, p_window_seconds);
end;
$function$;

CREATE OR REPLACE FUNCTION public.coupon_campaign_allows_identity(p_campaign_id uuid, p_member_role text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((
    select case campaign.audience_mode
      when 'members' then auth.uid() is not null and exists (
        select 1
        from public.coupon_campaign_members target
        where target.coupon_campaign_id = campaign.id
          and target.user_id = auth.uid()
      )
      else p_member_role = any(campaign.audience_roles)
        and (auth.uid() is not null or campaign.allow_guest is true)
    end
    from public.coupon_campaigns campaign
    where campaign.id = p_campaign_id
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.create_assisted_order(p_request_key uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  request_row public.assisted_order_requests%rowtype;
  member_id uuid; member_role text := 'consumer';
  target_variant public.product_variants%rowtype; target_product public.products%rowtype;
  item jsonb; lines jsonb := '[]'::jsonb; quantity integer; unit_price numeric;
  suggested_price numeric; student_multiplier numeric; suggested_prices jsonb := '[]'::jsonb; subtotal_amount numeric := 0; shipping_amount numeric;
  default_shipping numeric; method text; delivery text; all_custom boolean := true; all_free boolean := true;
  created_order_id text; snapshot jsonb; benefit_quote jsonb; benefit_discount numeric; credit_amount bigint; campaign_id uuid;
begin
  if auth.uid() is null or not public.has_backoffice_permission('orders.write')
    or not public.has_backoffice_permission('members.read')
    or not public.has_backoffice_permission('catalog.read') then
    raise exception 'Admin order authorization required' using errcode='42501';
  end if;
  if p_request_key is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or (p_payload - array['customer_type','member_id','member','phone','email','address','note','items',
      'payment_method','fulfillment_method','invoice_type','invoice_company_name','invoice_tax_id',
      'shipping_mode','shipping_amount','shipping_reason','minimum_reason','coupon_code','apply_automatic','shopping_credit_amount','expected_quote'])<>'{}'::jsonb then
    raise exception 'Invalid assisted order payload' using errcode='22023';
  end if;
  insert into public.assisted_order_requests(request_key,actor_user_id,payload,payment_token,link_token)
  values (p_request_key,auth.uid(),p_payload,encode(gen_random_bytes(32),'hex'),encode(gen_random_bytes(32),'hex'))
  on conflict(request_key) do nothing;
  select * into request_row from public.assisted_order_requests where request_key=p_request_key for update;
  if request_row.actor_user_id<>auth.uid() then raise exception 'Request owner mismatch' using errcode='42501'; end if;
  if request_row.payload is distinct from p_payload then
    raise exception '同一次開單內容不同，請找回原單確認後取消重建。' using errcode='22023';
  end if;
  if request_row.order_id is not null then
    return jsonb_build_object('order_id',request_row.order_id,'link_token',request_row.link_token,'recovered',true,'shopping_credit_amount',(select shopping_credit_amount from public.orders where id=request_row.order_id));
  end if;
  if p_payload->>'customer_type'='member' then
    member_id := (p_payload->>'member_id')::uuid;
    select role into member_role from public.profiles where id=member_id;
    if not found then raise exception 'Member not found' using errcode='22023'; end if;
    if member_role not in ('pro','instructor','distributor','staff') then member_role := 'consumer'; end if;
  elsif p_payload->>'customer_type'='guest' and nullif(p_payload->>'member_id','') is null then
    member_id := null;
  else raise exception 'Select member or guest' using errcode='22023'; end if;
  method := p_payload->>'payment_method'; delivery := p_payload->>'fulfillment_method';
  if method is null or method not in ('card','atm','apple','google') or delivery is null or delivery not in ('delivery','onsite_pickup') then
    raise exception 'Invalid payment or fulfillment method' using errcode='22023';
  end if;
  if coalesce(length(btrim(p_payload->>'member')),0) not between 1 and 100
    or coalesce(p_payload->>'phone','') !~ '^[0-9+() -]{9,20}$'
    or coalesce(p_payload->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(p_payload->>'email')>254
    or (delivery='delivery' and coalesce(length(btrim(p_payload->>'address')),0) not between 1 and 500)
    or length(coalesce(p_payload->>'note',''))>1000 then
    raise exception '請完整填寫收件姓名、手機、Email 與地址。' using errcode='22023';
  end if;
  if coalesce(p_payload->>'invoice_type','') not in ('personal','company')
    or (p_payload->>'invoice_type'='company' and (
      coalesce(length(btrim(p_payload->>'invoice_company_name')),0) not between 1 and 200
      or coalesce(p_payload->>'invoice_tax_id','') !~ '^[0-9]{8}$')) then
    raise exception 'Invalid invoice snapshot' using errcode='22023';
  end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' then raise exception 'Items required' using errcode='22023'; end if;
  if jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception 'Invalid item count' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'items') entry where
    coalesce(entry->>'variant_id','') !~ '^[0-9]{1,18}$' or coalesce(entry->>'product_id','') !~ '^[0-9]{1,9}$'
    or coalesce(entry->>'qty','') !~ '^[0-9]{1,4}$' or coalesce(entry->>'unit_price','') !~ '^[0-9]{1,7}$') then
    raise exception 'Invalid item quantity or unit price' using errcode='22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_payload->'items')) <> (select count(distinct entry->>'variant_id') from jsonb_array_elements(p_payload->'items') entry) then
    raise exception '同一規格請合併為一列。' using errcode='22023';
  end if;

  if nullif(btrim(p_payload->>'coupon_code'),'') is not null then
    select id into campaign_id from public.coupon_campaigns where code_normalized=upper(btrim(p_payload->>'coupon_code'));
    if campaign_id is not null then perform pg_advisory_xact_lock(hashtextextended(campaign_id::text,0)); end if;
  end if;
  -- Deterministic locks used by payment/FIFO allocation too.
  perform 1 from public.product_variants where id in (select (entry->>'variant_id')::bigint
    from jsonb_array_elements(p_payload->'items') entry) or id in (select gift_variant_id from public.promotions where active and benefit_type in ('amount_gift','quantity_gift')) order by id for update;
  student_multiplier:=public.student_pricing_multiplier(member_id);
  if exists(select 1 from jsonb_array_elements(p_payload->'items') x where x->>'price_mode'='AUTO')
    and not (p_payload ? 'expected_quote') then
    raise exception 'AUTO 商品須重新報價並確認' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_payload->'items') loop
    quantity := (item->>'qty')::integer; unit_price := (item->>'unit_price')::numeric;
    if quantity<1 then raise exception 'Quantity must be positive' using errcode='22023'; end if;
    select * into target_variant from public.product_variants where id=(item->>'variant_id')::bigint
      and product_id=(item->>'product_id')::integer and active is true;
    if not found then raise exception 'Product variant unavailable' using errcode='22023'; end if;
    select * into target_product from public.products where id=target_variant.product_id
      and active is true and publication_status='active';
    if not found or (target_product.is_pro_only and member_role='consumer') then
      raise exception 'Product unavailable for this customer' using errcode='22023';
    end if;
    if not target_variant.is_custom_order and target_variant.stock<quantity then
      raise exception '商品 % % 現貨不足，請調整數量。',target_product.name_zh,target_variant.size using errcode='22023';
    end if;
    all_custom := all_custom and coalesce(target_variant.is_custom_order,false);
    all_free := all_free and target_product.id=9;
    suggested_price := case when member_role='consumer' then target_variant.price else
      round((case when (member_role='instructor' and target_product.instructor_price_multiplier=1)
        or (member_role='distributor' and target_product.distributor_price_multiplier=1)
        or (member_role='staff' and target_product.staff_price_multiplier=1)
        or (member_role='pro' and target_product.instructor_price_multiplier=1
          and target_product.distributor_price_multiplier=1 and target_product.staff_price_multiplier=1)
        then coalesce(target_variant.pro_price,0) else coalesce(nullif(target_variant.pro_price,0),target_variant.price) end)
        *public.resolve_product_price_multiplier(
        target_product,member_role,coalesce((select professional_price_multiplier from public.membership_tiers where role=member_role and active),1))) end;

    if item ? 'price_mode' and (item->>'price_mode' is null or item->>'price_mode' not in ('AUTO','MANUAL')) then
      raise exception 'Invalid item price mode' using errcode='22023';
    end if;
    if item->>'price_mode'='AUTO' then
      unit_price:=public.assisted_auto_unit_price(member_id,member_role,target_product,target_variant,student_multiplier);
      suggested_price:=unit_price;
    end if;
    suggested_prices := suggested_prices || jsonb_build_array(jsonb_build_object('variant_id',target_variant.id,
      'suggested_unit_price',suggested_price,'final_unit_price',unit_price,'member_role',member_role));
    subtotal_amount := subtotal_amount+unit_price*quantity;
    lines := lines || jsonb_build_array(jsonb_build_object(
      'product_id',target_product.id,'id',target_product.id,'variant_id',target_variant.id,
      'sku',target_variant.sku,'name',target_product.name_zh,'nameZh',target_product.name_zh,
      'size',target_variant.size,'qty',quantity,'price',unit_price,'unit_price',unit_price,'line_total',unit_price*quantity,
      'is_custom_order',target_variant.is_custom_order,'stock_at_order',target_variant.stock,
      'fulfillment_type',case when target_variant.stock>=quantity then 'in_stock' else 'preorder' end));
  end loop;

  benefit_quote:=public.quote_assisted_order(p_payload);
  if p_payload ? 'expected_quote' and p_payload->'expected_quote' is distinct from benefit_quote->'confirmation' then
    raise exception '優惠、贈品或付款金額已變動，請重新計算並確認後再建立。' using errcode='40001';
  end if;

  -- All persisted totals use the same authoritative benefit_quote as items.
  subtotal_amount:=(benefit_quote->>'subtotal')::numeric;
  select jsonb_agg(context || case when line->>'price_mode'='AUTO' then
      jsonb_build_object('suggested_unit_price',line->'unit_price','final_unit_price',line->'unit_price','price_mode','AUTO')
    when line->>'price_mode'='MANUAL' then jsonb_build_object('price_mode','MANUAL') else '{}'::jsonb end order by n)
    into suggested_prices from jsonb_array_elements(suggested_prices) with ordinality as existing(context,n)
    join jsonb_array_elements(benefit_quote->'items') line on line->>'variant_id'=context->>'variant_id' and coalesce(line->>'line_type','merchandise')<>'gift';
  benefit_discount:=(benefit_quote->>'discount')::numeric;
  credit_amount:=(benefit_quote->>'shopping_credit_amount')::bigint;
  lines:=benefit_quote->'items';
  if subtotal_amount<1 then raise exception 'Order requires at least NT$1 payment' using errcode='22023'; end if;
  if delivery='onsite_pickup' and not all_custom then raise exception 'Only custom-order products support pickup' using errcode='22023'; end if;
  if member_role in ('pro','instructor','distributor','staff') and subtotal_amount-benefit_discount<5000
    and coalesce(length(btrim(p_payload->>'minimum_reason')),0) not between 1 and 1000 then
    raise exception '低於最低訂購額，請填寫例外原因。' using errcode='22023';
  end if;
  default_shipping := case when delivery='onsite_pickup' or member_role='staff' or all_free
    or (member_role in ('pro','instructor','distributor') and subtotal_amount-benefit_discount>=15000) then 0 else 120 end;
  case p_payload->>'shipping_mode'
    when 'default' then shipping_amount := default_shipping;
    when 'free' then shipping_amount := 0;
    when 'custom' then
      if coalesce(p_payload->>'shipping_amount','') !~ '^[0-9]{1,7}$' then raise exception 'Invalid shipping amount' using errcode='22023'; end if;
      shipping_amount := (p_payload->>'shipping_amount')::numeric;
    else raise exception 'Invalid shipping mode' using errcode='22023';
  end case;
  if shipping_amount<>default_shipping and coalesce(length(btrim(p_payload->>'shipping_reason')),0) not between 1 and 1000 then
    raise exception '運費異動需填寫原因。' using errcode='22023';
  end if;
  created_order_id := 'ECL-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-')||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  snapshot := jsonb_build_object('version',1,'source','admin_assisted','member_role',member_role,
    'subtotal',subtotal_amount,'discount',benefit_discount,'shipping',shipping_amount,'total',subtotal_amount-benefit_discount+shipping_amount,
    'shopping_credit_amount',credit_amount,'payment_amount',subtotal_amount-benefit_discount+shipping_amount-credit_amount,'items',lines)||jsonb_build_object('adjustments',benefit_quote->'adjustments','coupon',benefit_quote#>'{pricing_snapshot,coupon}','automatic_promotion',benefit_quote#>'{pricing_snapshot,automatic_promotion}','apply_automatic',p_payload->'apply_automatic');
  perform set_config('app.assisted_order_create','1',true);
  perform set_config('app.eclado_order_shopping_credit_amount',credit_amount::text,true);
  insert into public.orders(id,user_id,member,type,items,subtotal,discount,total,payment_amount,shopping_credit_amount,
    status,date,address,phone,email,note,fulfillment_method,invoice_type,invoice_company_name,invoice_tax_id,
    pricing_snapshot,order_source,assisted_payment_method,payment_due_at,promotion_id,promotion_name,coupon_campaign_id,coupon_name,coupon_code_mask)
  values (created_order_id,member_id,btrim(p_payload->>'member'),member_role,lines,subtotal_amount,benefit_discount,subtotal_amount-benefit_discount+shipping_amount,
    subtotal_amount-benefit_discount+shipping_amount-credit_amount,credit_amount,case when method='atm' then 'awaiting_confirm' else 'unpaid' end,
    (now() at time zone 'Asia/Taipei')::date::text,coalesce(p_payload->>'address',''),p_payload->>'phone',p_payload->>'email',
    coalesce(p_payload->>'note',''),delivery,p_payload->>'invoice_type',
    case when p_payload->>'invoice_type'='company' then p_payload->>'invoice_company_name' end,
    case when p_payload->>'invoice_type'='company' then p_payload->>'invoice_tax_id' end,
    snapshot,'admin_assisted',method,now()+interval '48 hours',nullif(benefit_quote->>'promotion_id','')::uuid,benefit_quote->>'promotion_name',nullif(benefit_quote->>'coupon_campaign_id','')::uuid,benefit_quote->>'coupon_name',benefit_quote->>'coupon_code_mask');
  perform set_config('app.assisted_order_create','0',true); perform set_config('app.eclado_order_shopping_credit_amount','0',true); perform public.persist_assisted_benefits(created_order_id,benefit_quote,member_id,p_payload->>'email');
  insert into public.order_payment_authorizations(order_id,token_hash,provider_order_no,attempt_no)
    values(created_order_id,encode(digest(request_row.payment_token,'sha256'),'hex'),created_order_id,1);
  update public.assisted_order_requests set order_id=created_order_id,pricing_context=suggested_prices where request_key=p_request_key;
  return jsonb_build_object('order_id',created_order_id,'link_token',request_row.link_token,'recovered',false,'shopping_credit_amount',credit_amount);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_assisted_order_base_v1(p_request_key uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  request_row public.assisted_order_requests%rowtype;
  member_id uuid; member_role text := 'consumer';
  target_variant public.product_variants%rowtype; target_product public.products%rowtype;
  item jsonb; lines jsonb := '[]'::jsonb; quantity integer; unit_price numeric;
  suggested_price numeric; suggested_prices jsonb := '[]'::jsonb; subtotal_amount numeric := 0; shipping_amount numeric;
  default_shipping numeric; method text; delivery text; all_custom boolean := true; all_free boolean := true;
  created_order_id text; snapshot jsonb;
begin
  if auth.uid() is null or not public.has_backoffice_permission('orders.write')
    or not public.has_backoffice_permission('members.read')
    or not public.has_backoffice_permission('catalog.read') then
    raise exception 'Admin order authorization required' using errcode='42501';
  end if;
  if p_request_key is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or (p_payload - array['customer_type','member_id','member','phone','email','address','note','items',
      'payment_method','fulfillment_method','invoice_type','invoice_company_name','invoice_tax_id',
      'shipping_mode','shipping_amount','shipping_reason','minimum_reason'])<>'{}'::jsonb then
    raise exception 'Invalid assisted order payload' using errcode='22023';
  end if;
  insert into public.assisted_order_requests(request_key,actor_user_id,payload,payment_token,link_token)
  values (p_request_key,auth.uid(),p_payload,encode(gen_random_bytes(32),'hex'),encode(gen_random_bytes(32),'hex'))
  on conflict(request_key) do nothing;
  select * into request_row from public.assisted_order_requests where request_key=p_request_key for update;
  if request_row.actor_user_id<>auth.uid() then raise exception 'Request owner mismatch' using errcode='42501'; end if;
  if request_row.payload is distinct from p_payload then
    raise exception '同一次開單內容不同，請找回原單確認後取消重建。' using errcode='22023';
  end if;
  if request_row.order_id is not null then
    return jsonb_build_object('order_id',request_row.order_id,'link_token',request_row.link_token,'recovered',true);
  end if;
  if p_payload->>'customer_type'='member' then
    member_id := (p_payload->>'member_id')::uuid;
    select role into member_role from public.profiles where id=member_id;
    if not found then raise exception 'Member not found' using errcode='22023'; end if;
    if member_role not in ('pro','instructor','distributor','staff') then member_role := 'consumer'; end if;
  elsif p_payload->>'customer_type'='guest' and nullif(p_payload->>'member_id','') is null then
    member_id := null;
  else raise exception 'Select member or guest' using errcode='22023'; end if;
  method := p_payload->>'payment_method'; delivery := p_payload->>'fulfillment_method';
  if method is null or method not in ('card','atm','apple','google') or delivery is null or delivery not in ('delivery','onsite_pickup') then
    raise exception 'Invalid payment or fulfillment method' using errcode='22023';
  end if;
  if coalesce(length(btrim(p_payload->>'member')),0) not between 1 and 100
    or coalesce(p_payload->>'phone','') !~ '^[0-9+() -]{9,20}$'
    or coalesce(p_payload->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(p_payload->>'email')>254
    or (delivery='delivery' and coalesce(length(btrim(p_payload->>'address')),0) not between 1 and 500)
    or length(coalesce(p_payload->>'note',''))>1000 then
    raise exception '請完整填寫收件姓名、手機、Email 與地址。' using errcode='22023';
  end if;
  if coalesce(p_payload->>'invoice_type','') not in ('personal','company')
    or (p_payload->>'invoice_type'='company' and (
      coalesce(length(btrim(p_payload->>'invoice_company_name')),0) not between 1 and 200
      or coalesce(p_payload->>'invoice_tax_id','') !~ '^[0-9]{8}$')) then
    raise exception 'Invalid invoice snapshot' using errcode='22023';
  end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' then raise exception 'Items required' using errcode='22023'; end if;
  if jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception 'Invalid item count' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'items') entry where
    coalesce(entry->>'variant_id','') !~ '^[0-9]{1,18}$' or coalesce(entry->>'product_id','') !~ '^[0-9]{1,9}$'
    or coalesce(entry->>'qty','') !~ '^[0-9]{1,4}$' or coalesce(entry->>'unit_price','') !~ '^[0-9]{1,7}$') then
    raise exception 'Invalid item quantity or unit price' using errcode='22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_payload->'items')) <> (select count(distinct entry->>'variant_id') from jsonb_array_elements(p_payload->'items') entry) then
    raise exception '同一規格請合併為一列。' using errcode='22023';
  end if;
  -- Deterministic locks used by payment/FIFO allocation too.
  perform 1 from public.product_variants where id in (select (entry->>'variant_id')::bigint
    from jsonb_array_elements(p_payload->'items') entry) order by id for update;
  for item in select value from jsonb_array_elements(p_payload->'items') loop
    quantity := (item->>'qty')::integer; unit_price := (item->>'unit_price')::numeric;
    if quantity<1 then raise exception 'Quantity must be positive' using errcode='22023'; end if;
    select * into target_variant from public.product_variants where id=(item->>'variant_id')::bigint
      and product_id=(item->>'product_id')::integer and active is true;
    if not found then raise exception 'Product variant unavailable' using errcode='22023'; end if;
    select * into target_product from public.products where id=target_variant.product_id
      and active is true and publication_status='active';
    if not found or (target_product.is_pro_only and member_role='consumer') then
      raise exception 'Product unavailable for this customer' using errcode='22023';
    end if;
    if not target_variant.is_custom_order and target_variant.stock<quantity then
      raise exception '商品 % % 現貨不足，請調整數量。',target_product.name_zh,target_variant.size using errcode='22023';
    end if;
    all_custom := all_custom and coalesce(target_variant.is_custom_order,false);
    all_free := all_free and target_product.id=9;
    suggested_price := case when member_role='consumer' then target_variant.price else
      round((case when (member_role='instructor' and target_product.instructor_price_multiplier=1)
        or (member_role='distributor' and target_product.distributor_price_multiplier=1)
        or (member_role='staff' and target_product.staff_price_multiplier=1)
        or (member_role='pro' and target_product.instructor_price_multiplier=1
          and target_product.distributor_price_multiplier=1 and target_product.staff_price_multiplier=1)
        then coalesce(target_variant.pro_price,0) else coalesce(nullif(target_variant.pro_price,0),target_variant.price) end)
        *public.resolve_product_price_multiplier(
        target_product,member_role,coalesce((select professional_price_multiplier from public.membership_tiers where role=member_role and active),1))) end;
    suggested_prices := suggested_prices || jsonb_build_array(jsonb_build_object('variant_id',target_variant.id,
      'suggested_unit_price',suggested_price,'final_unit_price',unit_price,'member_role',member_role));
    subtotal_amount := subtotal_amount+unit_price*quantity;
    lines := lines || jsonb_build_array(jsonb_build_object(
      'product_id',target_product.id,'id',target_product.id,'variant_id',target_variant.id,
      'sku',target_variant.sku,'name',target_product.name_zh,'nameZh',target_product.name_zh,
      'size',target_variant.size,'qty',quantity,'price',unit_price,'unit_price',unit_price,'line_total',unit_price*quantity,
      'is_custom_order',target_variant.is_custom_order,'stock_at_order',target_variant.stock,
      'fulfillment_type',case when target_variant.stock>=quantity then 'in_stock' else 'preorder' end));
  end loop;
  if subtotal_amount<1 then raise exception 'Order requires at least NT$1 payment' using errcode='22023'; end if;
  if delivery='onsite_pickup' and not all_custom then raise exception 'Only custom-order products support pickup' using errcode='22023'; end if;
  if member_role in ('pro','instructor','distributor','staff') and subtotal_amount<5000
    and coalesce(length(btrim(p_payload->>'minimum_reason')),0) not between 1 and 1000 then
    raise exception '低於最低訂購額，請填寫例外原因。' using errcode='22023';
  end if;
  default_shipping := case when delivery='onsite_pickup' or member_role='staff' or all_free
    or (member_role in ('pro','instructor','distributor') and subtotal_amount>=15000) then 0 else 120 end;
  case p_payload->>'shipping_mode'
    when 'default' then shipping_amount := default_shipping;
    when 'free' then shipping_amount := 0;
    when 'custom' then
      if coalesce(p_payload->>'shipping_amount','') !~ '^[0-9]{1,7}$' then raise exception 'Invalid shipping amount' using errcode='22023'; end if;
      shipping_amount := (p_payload->>'shipping_amount')::numeric;
    else raise exception 'Invalid shipping mode' using errcode='22023';
  end case;
  if shipping_amount<>default_shipping and coalesce(length(btrim(p_payload->>'shipping_reason')),0) not between 1 and 1000 then
    raise exception '運費異動需填寫原因。' using errcode='22023';
  end if;
  created_order_id := 'ECL-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-')||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  snapshot := jsonb_build_object('version',1,'source','admin_assisted','member_role',member_role,
    'subtotal',subtotal_amount,'discount',0,'shipping',shipping_amount,'total',subtotal_amount+shipping_amount,
    'shopping_credit_amount',0,'payment_amount',subtotal_amount+shipping_amount,'items',lines);
  perform set_config('app.assisted_order_create','1',true);
  perform set_config('app.eclado_order_shopping_credit_amount','0',true);
  insert into public.orders(id,user_id,member,type,items,subtotal,discount,total,payment_amount,shopping_credit_amount,
    status,date,address,phone,email,note,fulfillment_method,invoice_type,invoice_company_name,invoice_tax_id,
    pricing_snapshot,order_source,assisted_payment_method,payment_due_at)
  values (created_order_id,member_id,btrim(p_payload->>'member'),member_role,lines,subtotal_amount,0,subtotal_amount+shipping_amount,
    subtotal_amount+shipping_amount,0,case when method='atm' then 'awaiting_confirm' else 'unpaid' end,
    (now() at time zone 'Asia/Taipei')::date::text,coalesce(p_payload->>'address',''),p_payload->>'phone',p_payload->>'email',
    coalesce(p_payload->>'note',''),delivery,p_payload->>'invoice_type',
    case when p_payload->>'invoice_type'='company' then p_payload->>'invoice_company_name' end,
    case when p_payload->>'invoice_type'='company' then p_payload->>'invoice_tax_id' end,
    snapshot,'admin_assisted',method,now()+interval '48 hours');
  perform set_config('app.assisted_order_create','0',true);
  insert into public.order_payment_authorizations(order_id,token_hash,provider_order_no,attempt_no)
    values(created_order_id,encode(digest(request_row.payment_token,'sha256'),'hex'),created_order_id,1);
  update public.assisted_order_requests set order_id=created_order_id,pricing_context=suggested_prices where request_key=p_request_key;
  return jsonb_build_object('order_id',created_order_id,'link_token',request_row.link_token,'recovered',false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_historical_order(p_member_id uuid, p_transaction_date date, p_items jsonb, p_admin_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  target_member public.profiles%rowtype;
  requested_item jsonb;
  product_row public.products%rowtype;
  variant_row public.product_variants%rowtype;
  quantity integer;
  historical_unit_price numeric;
  historical_items jsonb := '[]'::jsonb;
  subtotal_amount numeric := 0;
  order_id text;
  clean_note text := nullif(btrim(coalesce(p_admin_note, '')), '');
  created_order public.orders%rowtype;
  today_taipei date := (now() at time zone 'Asia/Taipei')::date;
begin
  if auth.uid() is null or not public.has_backoffice_permission('orders.write') then
    raise exception 'Order write access required' using errcode = '42501';
  end if;

  select * into target_member
  from public.profiles profile
  where profile.id = p_member_id;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  if p_transaction_date is null or p_transaction_date > today_taipei then
    raise exception 'Historical transaction date must not be in the future'
      using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one historical order item is required'
      using errcode = '22023';
  end if;
  if clean_note is not null and char_length(clean_note) > 1000 then
    raise exception 'Historical order note is too long' using errcode = '22001';
  end if;

  for requested_item in select value from jsonb_array_elements(p_items)
  loop
    if coalesce(requested_item ->> 'variant_id', '') !~ '^[0-9]+$' then
      raise exception 'A valid product variant is required' using errcode = '22023';
    end if;
    quantity := case
      when coalesce(requested_item ->> 'qty', '') ~ '^[0-9]+$'
        then (requested_item ->> 'qty')::integer
      else 0
    end;
    if quantity <= 0 then
      raise exception 'Historical order quantity must be greater than zero'
        using errcode = '22023';
    end if;
    begin
      historical_unit_price := (requested_item ->> 'unit_price')::numeric;
    exception when invalid_text_representation then
      historical_unit_price := null;
    end;
    if historical_unit_price is null or historical_unit_price < 0 then
      raise exception 'Historical unit price must be zero or greater'
        using errcode = '22023';
    end if;

    select variant.* into variant_row
    from public.product_variants variant
    where variant.id = (requested_item ->> 'variant_id')::bigint;
    if not found then
      raise exception 'Product variant not found' using errcode = 'P0002';
    end if;
    select product.* into product_row
    from public.products product
    where product.id = variant_row.product_id;
    if not found then
      raise exception 'Product not found' using errcode = 'P0002';
    end if;

    subtotal_amount := subtotal_amount + historical_unit_price * quantity;
    historical_items := historical_items || jsonb_build_array(jsonb_build_object(
      'id', product_row.id,
      'product_id', product_row.id,
      'publication_status', coalesce(product_row.publication_status, case when product_row.active then 'active' else 'archived' end),
      'variant_id', variant_row.id,
      'sku', variant_row.sku,
      'name', product_row.name_zh,
      'nameZh', product_row.name_zh,
      'name_en', product_row.name,
      'size', variant_row.size,
      'image_storage_path', (
        select image.storage_path
        from public.product_images image
        where image.product_id = product_row.id and image.active = true
        order by image.is_primary desc, image.sort_order, image.id
        limit 1
      ),
      'img', product_row.image_url,
      'qty', quantity,
      'list_price', historical_unit_price,
      'price', historical_unit_price,
      'unit_price', historical_unit_price,
      'line_total', historical_unit_price * quantity,
      'is_custom_order', variant_row.is_custom_order,
      'historical_manual', true,
      'fulfillment_type', 'historical',
      'fulfillment', '歷史訂單'
    ));
  end loop;

  order_id := 'ECL-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-')
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  perform set_config('app.eclado_historical_order_write', '1', true);
  insert into public.orders (
    id, member, type, items, total, subtotal, discount, status, date,
    address, phone, email, note, user_id, pricing_snapshot,
    fulfillment_method, order_source, transaction_date,
    shopping_credit_amount, payment_amount
  ) values (
    order_id,
    coalesce(nullif(btrim(target_member.name), ''), split_part(target_member.email, '@', 1), '會員'),
    coalesce(target_member.role, 'consumer'),
    historical_items,
    subtotal_amount,
    subtotal_amount,
    0,
    'delivered',
    to_char(p_transaction_date, 'YYYY-MM-DD'),
    coalesce(target_member.studio_address, ''),
    coalesce(nullif(target_member.studio_phone, ''), target_member.phone, ''),
    coalesce(target_member.email, ''),
    '',
    target_member.id,
    jsonb_build_object(
      'version', 1,
      'engine', 'historical_manual_v1',
      'calculated_at', clock_timestamp(),
      'currency', 'TWD',
      'member_role', coalesce(target_member.role, 'consumer'),
      'items', historical_items,
      'subtotal', subtotal_amount,
      'discount', 0,
      'final_subtotal', subtotal_amount,
      'shipping', 0,
      'total', subtotal_amount,
      'order_source', 'historical_manual',
      'transaction_date', p_transaction_date
    ),
    'delivery',
    'historical_manual',
    p_transaction_date,
    0,
    subtotal_amount
  )
  returning * into created_order;
  perform set_config('app.eclado_historical_order_write', '0', true);

  if clean_note is not null then
    insert into public.order_admin_notes (order_id, note, created_by)
    values (created_order.id, clean_note, auth.uid());
  end if;

  return to_jsonb(created_order) || jsonb_build_object('admin_note', clean_note);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_inventory_count(p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  new_session_id uuid;
  normalized_name text := trim(coalesce(p_name, ''));
begin
  if not public.has_backoffice_permission('inventory_counts.manage') then
    raise exception 'Inventory count authorization required' using errcode = '42501';
  end if;
  if normalized_name = '' then
    raise exception '請輸入盤點名稱' using errcode = '22023';
  end if;

  insert into public.inventory_count_sessions (name, created_by, created_by_email)
  values (normalized_name, auth.uid(), coalesce(auth.jwt() ->> 'email', ''))
  returning id into new_session_id;

  -- All retained product variants are part of a warehouse-wide count,
  -- including draft/archived and zero-stock rows. Gift stock gets a separate
  -- count item only where that inventory pool is enabled.
  insert into public.inventory_count_items (
    session_id, product_id, product_variant_id, inventory_type,
    product_name, variant_name, sku, publication_status,
    system_stock_snapshot, onsite_allocated_snapshot, expected_physical_snapshot
  )
  select
    new_session_id, product.id, variant.id, 'sale',
    product.name_zh, variant.size, variant.sku, product.publication_status,
    variant.stock, coalesce(onsite.quantity, 0), variant.stock + coalesce(onsite.quantity, 0)
  from public.product_variants variant
  join public.products product on product.id = variant.product_id
  left join lateral (
    select sum(allocation.stock_deducted_qty)::integer as quantity
    from public.order_inventory_allocations allocation
    join public.orders target_order on target_order.id = allocation.order_id
    where allocation.product_variant_id = variant.id
      and coalesce(allocation.line_type, 'merchandise') = 'merchandise'
      and allocation.state <> 'released'
      and (target_order.status in ('paid', 'preparing', 'ready_for_pickup') OR (target_order.order_source='admin_assisted' AND target_order.status in ('unpaid','awaiting_confirm')))
  ) onsite on true
  where product.publication_status <> 'gift_only'
  order by product.id, variant.sort_order, variant.id;

  insert into public.inventory_count_items (
    session_id, product_id, product_variant_id, inventory_type,
    product_name, variant_name, sku, publication_status,
    system_stock_snapshot, onsite_allocated_snapshot, expected_physical_snapshot
  )
  select
    new_session_id, product.id, variant.id, 'gift',
    product.name_zh, variant.size, variant.sku, product.publication_status,
    variant.gift_stock, coalesce(onsite.quantity, 0), variant.gift_stock + coalesce(onsite.quantity, 0)
  from public.product_variants variant
  join public.products product on product.id = variant.product_id
  left join lateral (
    select sum(allocation.stock_deducted_qty)::integer as quantity
    from public.order_inventory_allocations allocation
    join public.orders target_order on target_order.id = allocation.order_id
    where allocation.product_variant_id = variant.id
      and allocation.line_type = 'gift'
      and allocation.state <> 'released'
      and (target_order.status in ('paid', 'preparing', 'ready_for_pickup') OR (target_order.order_source='admin_assisted' AND target_order.status in ('unpaid','awaiting_confirm')))
  ) onsite on true
  where variant.gift_enabled is true
  order by product.id, variant.sort_order, variant.id;

  return new_session_id;
exception
  when unique_violation then
    raise exception '目前已有進行中的盤點單，請先完成後再建立新的盤點' using errcode = '23505';
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_order_with_pricing(p_items jsonb, p_member text, p_address text, p_phone text, p_email text, p_note text, p_payment_method text, p_fulfillment_method text, p_coupon_code text, p_invoice_type text, p_invoice_company_name text, p_invoice_tax_id text, p_shopping_credit_amount bigint, p_expected_quote jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if p_expected_quote is null or jsonb_typeof(p_expected_quote)<>'object' then
    raise exception '請重新取得並確認報價' using errcode='22023';
  end if;
  result:=public.create_order_with_pricing(p_items,p_member,p_address,p_phone,p_email,p_note,
    p_payment_method,p_fulfillment_method,p_coupon_code,p_invoice_type,p_invoice_company_name,
    p_invoice_tax_id,p_shopping_credit_amount);
  if public.student_price_confirmation(result) is distinct from public.student_price_confirmation(p_expected_quote) then
    raise exception '商品、優惠或運費已變動，請重新報價並確認。' using errcode='40001';
  end if;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_order_with_pricing(p_items jsonb, p_member text, p_address text, p_phone text, p_email text, p_note text, p_payment_method text, p_fulfillment_method text, p_coupon_code text, p_invoice_type text, p_invoice_company_name text, p_invoice_tax_id text, p_shopping_credit_amount bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  result jsonb;
  created_order_id text;
  current_user_id uuid := auth.uid();
  requested_credit bigint := coalesce(p_shopping_credit_amount, 0);
  gateway_payment numeric;
  next_snapshot jsonb;
begin
  if requested_credit < 0 then
    raise exception 'Shopping credit amount cannot be negative' using errcode = '22023';
  end if;
  if requested_credit > 0 and current_user_id is null then
    raise exception 'Sign in is required to use shopping credit' using errcode = '42501';
  end if;

  -- Pass the requested tender to the BEFORE INSERT trigger so the immutable
  -- order row and pricing snapshot are complete on their first write.
  perform set_config(
    'app.eclado_order_shopping_credit_amount',
    requested_credit::text,
    true
  );
  result := public.create_order_with_pricing(
    p_items, p_member, p_address, p_phone, p_email, p_note,
    p_payment_method, p_fulfillment_method, p_coupon_code,
    p_invoice_type, p_invoice_company_name, p_invoice_tax_id
  );
  perform set_config('app.eclado_order_shopping_credit_amount', '0', true);
  created_order_id := result ->> 'order_id';

  if requested_credit > 0 then
    perform public.reserve_order_shopping_credit(
      current_user_id,
      created_order_id,
      requested_credit
    );
  end if;

  select target.payment_amount,
         coalesce(target.pricing_snapshot, '{}'::jsonb)
  into gateway_payment, next_snapshot
  from public.orders target
  where target.id = created_order_id;

  return result || jsonb_build_object(
    'shopping_credit_amount', requested_credit,
    'payment_amount', gateway_payment,
    'pricing_snapshot', next_snapshot
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_order_with_pricing(p_items jsonb, p_member text, p_address text, p_phone text, p_email text, p_note text, p_payment_method text, p_fulfillment_method text, p_coupon_code text, p_invoice_type text, p_invoice_company_name text, p_invoice_tax_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  result jsonb;
  normalized_invoice_type text := lower(btrim(coalesce(p_invoice_type, 'personal')));
  normalized_company_name text := nullif(btrim(coalesce(p_invoice_company_name, '')), '');
  normalized_tax_id text := nullif(btrim(coalesce(p_invoice_tax_id, '')), '');
  created_order_id text;
begin
  if normalized_invoice_type not in ('personal', 'company') then
    raise exception 'Invalid invoice type' using errcode = '22023';
  end if;
  if normalized_invoice_type = 'company' then
    if normalized_company_name is null then
      raise exception 'Company invoice name is required' using errcode = '22023';
    end if;
    if normalized_tax_id is null or normalized_tax_id !~ '^[0-9]{8}$' then
      raise exception 'Invalid company tax ID' using errcode = '22023';
    end if;
  else
    normalized_company_name := null;
    normalized_tax_id := null;
  end if;

  result := public.create_order_with_pricing(
    p_items, p_member, p_address, p_phone, p_email, p_note,
    p_payment_method, p_fulfillment_method, p_coupon_code
  );
  created_order_id := result ->> 'order_id';

  update public.orders
  set
    invoice_type = normalized_invoice_type,
    invoice_company_name = normalized_company_name,
    invoice_tax_id = normalized_tax_id
  where id = created_order_id;

  return result || jsonb_build_object(
    'invoice_type', normalized_invoice_type,
    'invoice_company_name', normalized_company_name,
    'invoice_tax_id', normalized_tax_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_order_with_pricing(p_items jsonb, p_member text, p_address text, p_phone text, p_email text, p_note text, p_payment_method text, p_fulfillment_method text, p_coupon_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  result jsonb;
  order_id text;
  payment_expiry timestamptz;
  gift jsonb;
  adjustment jsonb;
  stock_quantity integer;
  reserved_quantity integer;
begin
  result := public.create_order_with_pricing_discount_v2(
    p_items, p_member, p_address, p_phone, p_email, p_note,
    p_payment_method, p_fulfillment_method, p_coupon_code
  );
  order_id := result ->> 'order_id';
  select payment_due_at into payment_expiry from public.orders where id = order_id;

  -- Deterministic locks make the quote-to-reservation recheck authoritative.
  perform 1
  from public.product_variants variant
  where variant.id in (
    select distinct (item ->> 'variant_id')::bigint
    from jsonb_array_elements(coalesce(result -> 'gifts', '[]'::jsonb)) item
  )
  order by variant.id for update;

  for gift in select value from jsonb_array_elements(coalesce(result -> 'gifts', '[]'::jsonb))
  loop
    select variant.gift_stock into stock_quantity
    from public.product_variants variant
    join public.products product on product.id = variant.product_id
    where variant.id = (gift ->> 'variant_id')::bigint
      and variant.active = true
      and variant.gift_enabled = true
      and product.publication_status in ('active', 'event_only', 'gift_only')
    for update of variant;
    if not found then raise exception '贈品規格已停用' using errcode = '22023'; end if;

    select coalesce(sum(reservation.quantity), 0)::integer into reserved_quantity
    from public.promotion_gift_reservations reservation
    where reservation.product_variant_id = (gift ->> 'variant_id')::bigint
      and reservation.status = 'reserved' and reservation.expires_at > now();
    if stock_quantity - reserved_quantity < (gift ->> 'qty')::integer then
      raise exception '贈品已兌換完畢，請重新確認訂單' using errcode = '40001';
    end if;

    insert into public.promotion_gift_reservations (
      order_id, promotion_id, coupon_campaign_id, product_variant_id,
      quantity, status, expires_at
    ) values (
      order_id, (gift ->> 'promotion_id')::uuid,
      nullif(gift ->> 'coupon_campaign_id', '')::uuid,
      (gift ->> 'variant_id')::bigint, (gift ->> 'qty')::integer,
      'reserved', payment_expiry
    );
  end loop;

  for adjustment in
    select value from jsonb_array_elements(coalesce(result -> 'adjustments', '[]'::jsonb))
    where value ->> 'adjustment_type' in ('amount_gift', 'quantity_gift')
  loop
    insert into public.order_adjustments (
      order_id, promotion_id, coupon_campaign_id, adjustment_type,
      name_snapshot, qualification_snapshot, amount,
      gift_product_id, gift_variant_id, gift_quantity, sort_order, metadata
    ) values (
      order_id, (adjustment ->> 'promotion_id')::uuid,
      nullif(adjustment ->> 'coupon_campaign_id', '')::uuid,
      adjustment ->> 'adjustment_type', adjustment ->> 'name',
      coalesce(adjustment -> 'qualification', '{}'::jsonb), 0,
      (adjustment ->> 'gift_product_id')::integer,
      (adjustment ->> 'gift_variant_id')::bigint,
      (adjustment ->> 'gift_quantity')::integer,
      coalesce((adjustment ->> 'sort_order')::integer, 100),
      jsonb_build_object('pricing_engine_version', 5)
    );
  end loop;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_order_with_pricing(p_items jsonb, p_member text, p_address text, p_phone text, p_email text, p_note text DEFAULT ''::text, p_payment_method text DEFAULT 'atm'::text, p_fulfillment_method text DEFAULT 'delivery'::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
  select public.create_order_with_pricing(
    p_items, p_member, p_address, p_phone, p_email, p_note,
    p_payment_method, p_fulfillment_method, null
  );
$function$;

CREATE OR REPLACE FUNCTION public.create_order_with_pricing_discount_v2(p_items jsonb, p_member text, p_address text, p_phone text, p_email text, p_note text, p_payment_method text, p_fulfillment_method text, p_coupon_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  current_user_id uuid := auth.uid();
  normalized_fulfillment text := coalesce(nullif(btrim(p_fulfillment_method), ''), 'delivery');
  normalized_code text := upper(btrim(coalesce(p_coupon_code, '')));
  quote_result jsonb;
  campaign public.coupon_campaigns%rowtype;
  guest_hash text;
  active_usage integer;
  identity_usage integer;
  payment_token text := encode(gen_random_bytes(32), 'hex');
  order_id text;
  order_status text;
  payment_expiry timestamptz;
  adjustment jsonb;
begin
  if normalized_fulfillment = 'delivery' and nullif(btrim(p_address), '') is null then
    raise exception 'Delivery address is required' using errcode = '22023';
  end if;

  quote_result := public.quote_order_pricing(p_items, normalized_fulfillment, normalized_code, p_email);

  if normalized_code <> '' then
    campaign.id := nullif(quote_result ->> 'coupon_campaign_id', '')::uuid;
    perform pg_advisory_xact_lock(hashtextextended(campaign.id::text, 0));

    select * into campaign from public.coupon_campaigns target
    where target.id = campaign.id
      and target.code_normalized = normalized_code
      and target.active = true
      and target.archived_at is null
      and (quote_result ->> 'member_role') = any(target.audience_roles)
      and (current_user_id is not null or target.allow_guest = true)
      and (target.start_at is null or target.start_at <= now())
      and (target.end_at is null or target.end_at > now());
    if not found then
      raise exception '優惠碼無效或目前無法使用' using errcode = '22023';
    end if;

    if current_user_id is null then
      guest_hash := encode(digest(lower(btrim(p_email)), 'sha256'), 'hex');
    end if;

    select count(*) into active_usage from public.coupon_redemptions redemption
    where redemption.coupon_campaign_id = campaign.id
      and (redemption.status = 'redeemed'
        or (redemption.status = 'reserved' and redemption.expires_at > now()));
    select count(*) into identity_usage from public.coupon_redemptions redemption
    where redemption.coupon_campaign_id = campaign.id
      and (redemption.status = 'redeemed'
        or (redemption.status = 'reserved' and redemption.expires_at > now()))
      and ((current_user_id is not null and redemption.user_id = current_user_id)
        or (current_user_id is null and redemption.guest_identity_hash = guest_hash));

    if campaign.total_usage_limit is not null and active_usage >= campaign.total_usage_limit then
      raise exception '優惠碼已達使用上限' using errcode = '22023';
    end if;
    if campaign.per_member_limit is not null and identity_usage >= campaign.per_member_limit then
      raise exception '此優惠碼已達個人使用上限' using errcode = '22023';
    end if;
  end if;

  order_status := case when p_payment_method = 'atm' then 'awaiting_confirm' else 'unpaid' end;
  order_id := 'ECL-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-')
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.orders (
    id, member, type, items, total, subtotal, discount, status, date,
    address, phone, email, note, user_id, promotion_id, promotion_name,
    coupon_campaign_id, coupon_name, coupon_code_mask,
    pricing_snapshot, fulfillment_method
  ) values (
    order_id,
    coalesce(nullif(btrim(p_member), ''), '訪客'),
    quote_result ->> 'member_role',
    quote_result -> 'items',
    (quote_result ->> 'total')::numeric,
    (quote_result ->> 'subtotal')::numeric,
    (quote_result ->> 'discount')::numeric,
    order_status, current_date::text, coalesce(p_address, ''), coalesce(p_phone, ''),
    coalesce(p_email, ''), coalesce(p_note, ''), current_user_id,
    nullif(quote_result ->> 'promotion_id', '')::uuid,
    quote_result ->> 'promotion_name',
    nullif(quote_result ->> 'coupon_campaign_id', '')::uuid,
    quote_result ->> 'coupon_name', quote_result ->> 'coupon_code_mask',
    quote_result -> 'pricing_snapshot', quote_result ->> 'fulfillment_method'
  ) returning payment_due_at into payment_expiry;

  insert into public.order_payment_authorizations (order_id, token_hash, provider_order_no, attempt_no)
  values (order_id, encode(digest(payment_token, 'sha256'), 'hex'), order_id, 1);

  for adjustment in select value from jsonb_array_elements(quote_result -> 'adjustments')
  loop
    if adjustment ->> 'adjustment_type' in ('percentage_discount', 'fixed_discount') then
      insert into public.order_adjustments (
        order_id, promotion_id, coupon_campaign_id, adjustment_type,
        name_snapshot, qualification_snapshot, amount, sort_order, metadata
      ) values (
        order_id,
        nullif(adjustment ->> 'promotion_id', '')::uuid,
        nullif(adjustment ->> 'coupon_campaign_id', '')::uuid,
        adjustment ->> 'adjustment_type', adjustment ->> 'name',
        coalesce(adjustment -> 'qualification', '{}'::jsonb),
        (adjustment ->> 'amount')::numeric,
        coalesce((adjustment ->> 'sort_order')::integer, 0),
        jsonb_build_object('pricing_engine_version', 4)
      );
    end if;
  end loop;

  if normalized_code <> '' then
    insert into public.coupon_redemptions (
      coupon_campaign_id, order_id, user_id, guest_identity_hash,
      status, expires_at
    ) values (
      campaign.id, order_id, current_user_id,
      case when current_user_id is null then guest_hash else null end,
      'reserved', payment_expiry
    );
  end if;

  return quote_result || jsonb_build_object(
    'order_id', order_id, 'status', order_status, 'payment_token', payment_token
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_professional_quarterly_notice_correction(p_member_id uuid, p_quarter_start date, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  assessment jsonb;
  notice_quarter jsonb;
  latest public.professional_quarterly_notices%rowtype;
  created public.professional_quarterly_notices%rowtype;
  assessment_year integer := extract(year from p_quarter_start)::integer;
begin
  if not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A correction reason is required' using errcode = '22023';
  end if;

  select * into latest
  from public.professional_quarterly_notices notice
  where notice.user_id = p_member_id
    and notice.quarter_start = p_quarter_start
  order by notice.version desc
  limit 1
  for update;
  if not found then
    raise exception 'Original quarterly notice not found' using errcode = 'P0002';
  end if;

  assessment := public.get_professional_renewal_assessment(
    p_member_id,
    assessment_year,
    (p_quarter_start + interval '3 months')::date - 1
  );
  select value into notice_quarter
  from jsonb_array_elements(coalesce(assessment -> 'quarters', '[]'::jsonb))
  where (value ->> 'quarter_start')::date = p_quarter_start
  limit 1;
  if notice_quarter is null then
    raise exception 'Quarter assessment not found' using errcode = 'P0002';
  end if;

  insert into public.professional_quarterly_notices (
    user_id, quarter_start, version, supersedes_id, correction_reason, snapshot
  ) values (
    p_member_id, p_quarter_start, latest.version + 1, latest.id, btrim(p_reason),
    assessment || jsonb_build_object(
      'notice_quarter', notice_quarter,
      'data_cutoff', (p_quarter_start + interval '3 months')::date - 1,
      'generated_at', now()
    )
  ) returning * into created;

  perform public.record_professional_sales_audit(
    'professional_quarterly_notices.correction_created',
    'professional_quarterly_notices', created.id::text,
    jsonb_build_object('supersedes_id', latest.id, 'version', latest.version),
    jsonb_build_object('version', created.version, 'reason', btrim(p_reason))
  );

  return to_jsonb(created);
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_cancelled_order(p_order_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  target_order public.orders%rowtype;
begin
  if actor_id is null
    or not public.has_backoffice_permission('orders.write')
  then
    raise exception 'Administrator order write permission is required'
      using errcode = '42501';
  end if;

  if nullif(trim(p_order_id), '') is null then
    raise exception 'Order is required' using errcode = '22023';
  end if;

  select target.*
    into target_order
  from public.orders target
  where target.id = trim(p_order_id)
  for update;

  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if target_order.status <> 'cancelled' then
    raise exception 'Only cancelled orders can be permanently deleted'
      using errcode = '22023';
  end if;

  -- Paid orders must remain available for accounting and payment reconciliation.
  if target_order.paid_at is not null
    or exists (
      select 1
      from public.order_payment_attempts attempt
      where attempt.order_id = target_order.id
        and attempt.payment_state = 'paid'
    )
    or exists (
      select 1
      from public.order_payment_instructions instruction
      where instruction.order_id = target_order.id
        and instruction.payment_state = 'paid'
    )
  then
    raise exception 'Paid order records cannot be permanently deleted'
      using errcode = '22023';
  end if;

  delete from public.orders
  where id = target_order.id;

  return jsonb_build_object(
    'deleted', true,
    'order_id', target_order.id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_draft_inventory_count(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  target_session public.inventory_count_sessions;
  is_super_admin boolean;
  item_count integer;
  counted_count integer;
  actor_role text;
begin
  if not public.has_backoffice_permission('inventory_counts.manage') then
    raise exception 'Inventory count authorization required' using errcode = '42501';
  end if;

  select session.* into target_session
  from public.inventory_count_sessions session
  where session.id = p_session_id
  for update;
  if not found then raise exception '找不到盤點單，可能已被刪除' using errcode = 'P0002'; end if;
  if target_session.status <> 'draft' then
    raise exception '已完成的盤點單不可刪除' using errcode = '55000';
  end if;

  select exists (
    select 1 from public.admin_users admin_user
    where admin_user.user_id = auth.uid()
      and admin_user.active is true
      and admin_user.role = 'super_admin'
  ) into is_super_admin;
  if target_session.created_by <> auth.uid() and not is_super_admin then
    raise exception '只有盤點建立者或最高管理員可以刪除草稿' using errcode = '42501';
  end if;

  select count(*)::integer,
    count(*) filter (where actual_quantity is not null)::integer
  into item_count, counted_count
  from public.inventory_count_items where session_id = p_session_id;
  select role into actor_role from public.admin_users
  where user_id = auth.uid() and active is true;

  insert into public.audit_logs (
    actor_user_id, actor_email, actor_role, actor_type,
    action, entity_type, entity_id, metadata
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), actor_role, 'admin',
    'inventory_count_sessions.delete_draft', 'inventory_count_sessions', p_session_id::text,
    jsonb_build_object(
      'name', target_session.name,
      'created_at', target_session.created_at,
      'item_count', item_count,
      'counted_count', counted_count,
      'source', 'inventory_count_rpc'
    )
  );

  delete from public.inventory_count_items where session_id = p_session_id;
  delete from public.inventory_count_sessions where id = p_session_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_professional_award_evidence(p_evidence_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target public.professional_award_evidence%rowtype;
begin
  select * into target
  from public.professional_award_evidence evidence
  where evidence.id = p_evidence_id
    and evidence.user_id = auth.uid()
  for update;
  if not found then
    raise exception 'Award evidence not found' using errcode = 'P0002';
  end if;
  if target.status <> 'pending' then
    raise exception 'Only pending evidence can be deleted' using errcode = '42501';
  end if;
  delete from public.professional_award_evidence where id = target.id;
  return target.storage_path;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_purchase_order(p_order_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  deleted_id bigint;
begin
  if not public.is_eclado_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  delete from public.purchase_orders
  where id = p_order_id
    and status in ('draft', 'pending')
  returning id into deleted_id;

  if deleted_id is null then
    if exists (select 1 from public.purchase_orders where id = p_order_id) then
      raise exception 'Only draft or pending purchase orders can be deleted' using errcode = '22023';
    end if;
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.downgrade_professional_renewal_nonapplicant(p_member_id uuid, p_renewal_year integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  today date := (now() at time zone 'Asia/Taipei')::date;
  renewal_start date;
  target_profile public.profiles%rowtype;
  target_membership public.professional_memberships%rowtype;
  saved public.professional_renewal_nonapplications%rowtype;
begin
  if auth.uid() is null or not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if p_renewal_year is null or p_renewal_year <> extract(year from today)::integer then
    raise exception 'Only overdue nonapplicants for the current renewal year can be downgraded' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'A downgrade reason of 1 to 500 characters is required' using errcode = '22023';
  end if;
  renewal_start := make_date(p_renewal_year, 1, 1);
  -- Same member lock as normal backoffice role changes. Submit locks the
  -- membership too; recheck applications only after acquiring that lock.
  select * into target_profile from public.profiles where id = p_member_id for update;
  if not found then raise exception 'Member not found' using errcode = 'P0002'; end if;
  select * into saved from public.professional_renewal_nonapplications result
  where result.user_id = p_member_id and result.renewal_year = p_renewal_year;
  if found then return jsonb_build_object('id', saved.id, 'changed', false); end if;
  select * into target_membership from public.professional_memberships membership
  where membership.user_id = p_member_id and membership.role = target_profile.role
    and membership.role in ('instructor', 'distributor')
    and membership.started_on < renewal_start and membership.ended_on is null
  order by membership.started_on desc limit 1 for update;
  if not found then raise exception 'Member qualification has changed; refresh the roster' using errcode = '22023'; end if;
  if exists (select 1 from public.professional_renewal_applications application
    where application.user_id = p_member_id and application.renewal_year = p_renewal_year) then
    raise exception 'Member has a renewal application; use application review instead' using errcode = '22023';
  end if;
  -- Benefits remain until manual handling. Do not backdate to January 1.
  update public.professional_memberships set ended_on = today where id = target_membership.id;
  perform set_config('app.eclado_allow_profile_security_update', 'true', true);
  update public.profiles set role = 'pro' where id = p_member_id;
  perform set_config('app.eclado_allow_profile_security_update', 'false', true);
  insert into public.professional_renewal_nonapplications (
    user_id, membership_id, assessment_year, renewal_year, role, reason, reviewed_by, effective_on
  ) values (
    p_member_id, target_membership.id, p_renewal_year - 1, p_renewal_year,
    target_membership.role, btrim(p_reason), auth.uid(), today
  ) returning * into saved;
  perform public.record_professional_sales_audit(
    'professional_renewals.not_applied_downgraded', 'profiles', p_member_id::text,
    jsonb_build_object('role', target_membership.role, 'membership_id', target_membership.id),
    jsonb_build_object('role', 'pro', 'renewal_year', p_renewal_year, 'effective_on', today, 'reason', btrim(p_reason))
  );
  return jsonb_build_object('id', saved.id, 'changed', true, 'role', 'pro');
end;
$function$;

CREATE OR REPLACE FUNCTION public.end_instructor_student_bindings_on_member_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare binding public.instructor_student_bindings%rowtype;
begin
  for binding in select * from public.instructor_student_bindings
    where ended_at is null and (student_id=old.id or instructor_id=old.id) order by id for update loop
    update public.instructor_student_bindings set ended_at=now(),ended_by=auth.uid(),end_reason='member_deleted'
      where id=binding.id;
    insert into public.instructor_student_audit_logs(event_type,student_id,instructor_id,previous_instructor_id,
      actor_user_id,actor_kind,before_data,after_data)
    values('member_deleted',binding.student_id,binding.instructor_id,binding.instructor_id,auth.uid(),
      case when auth.uid() is null then 'system' else 'admin' end,
      jsonb_build_object('binding_id',binding.id,'instructor_id',binding.instructor_id),
      jsonb_build_object('binding_id',binding.id,'deleted_member_id',old.id,'end_reason','member_deleted'));
  end loop;
  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_order_creation_rate_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.enforce_product_variant_default()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_product_id integer;
  variant_count integer;
  default_count integer;
begin
  target_product_id := coalesce(new.product_id, old.product_id);

  select
    count(*),
    count(*) filter (where is_default is true)
  into variant_count, default_count
  from public.product_variants
  where product_id = target_product_id;

  if variant_count > 0 and default_count <> 1 then
    raise exception 'Product % must have exactly one default variant', target_product_id
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and old.product_id is distinct from new.product_id then
    select
      count(*),
      count(*) filter (where is_default is true)
    into variant_count, default_count
    from public.product_variants
    where product_id = old.product_id;

    if variant_count > 0 and default_count <> 1 then
      raise exception 'Product % must have exactly one default variant', old.product_id
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_professional_renewal_application(p_application_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  today date := (now() at time zone 'Asia/Taipei')::date;
  target public.professional_renewal_applications%rowtype;
  assessment jsonb;
  quarter_record jsonb;
begin
  if auth.uid() is null or not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  select * into target from public.professional_renewal_applications application
  where application.id = p_application_id for update;
  if not found then raise exception 'Renewal application not found' using errcode = 'P0002'; end if;
  if target.assessment_year <> extract(year from today)::integer - 1 then
    raise exception 'Only the previous assessment year can be settled' using errcode = '22023';
  end if;
  if target.status <> 'submitted' then
    return jsonb_build_object('id', target.id, 'changed', false, 'status', target.status);
  end if;
  assessment := public.get_professional_renewal_assessment(target.user_id, target.assessment_year, make_date(target.assessment_year, 12, 31));
  for quarter_record in select value from jsonb_array_elements(coalesce(assessment -> 'quarters', '[]'::jsonb)) loop
    insert into public.professional_renewal_quarter_snapshots (
      application_id, quarter_start, calendar_quarter, period_start, period_end_exclusive,
      effective_days, quarter_days, threshold_amount, online_sales_amount, offline_sales_amount,
      sales_amount, has_zero_sales, meets_quarter_threshold
    ) values (
      target.id, (quarter_record ->> 'quarter_start')::date, (quarter_record ->> 'calendar_quarter')::integer,
      (quarter_record ->> 'period_start')::date, (quarter_record ->> 'period_end_exclusive')::date,
      (quarter_record ->> 'effective_days')::integer, (quarter_record ->> 'quarter_days')::integer,
      (quarter_record ->> 'threshold_amount')::numeric, (quarter_record ->> 'online_sales_amount')::numeric,
      (quarter_record ->> 'offline_sales_amount')::numeric, (quarter_record ->> 'sales_amount')::numeric,
      (quarter_record ->> 'has_zero_sales')::boolean, (quarter_record ->> 'meets_quarter_threshold')::boolean
    );
  end loop;
  update public.professional_renewal_applications
  set status = 'pending_review', finalized_at = now(), assessment_snapshot = assessment,
      a_qualified = coalesce((assessment ->> 'a_qualified')::boolean, false),
      b_approved_count = coalesce((assessment ->> 'student_approved_count')::integer, 0)
  where id = target.id;
  perform public.record_professional_sales_audit(
    'professional_renewals.member_finalized', 'professional_renewal_applications', target.id::text,
    jsonb_build_object('status', target.status),
    jsonb_build_object('status', 'pending_review', 'assessment_year', target.assessment_year)
  );
  return jsonb_build_object('id', target.id, 'changed', true, 'status', 'pending_review');
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_professional_renewal_year(p_assessment_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  raise exception 'Bulk annual settlement is disabled. Process each member individually.' using errcode = '22023';
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_assisted_link(p_order_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if auth.uid() is null or not public.has_backoffice_permission('orders.write') then raise exception 'Admin required' using errcode='42501'; end if;
  select jsonb_build_object('order_id',order_id,'link_token',link_token,'shopping_credit_amount',(select shopping_credit_amount from public.orders where id=order_id),
    'actor_user_id',actor_user_id,'created_at',created_at,'pricing_context',pricing_context,
    'minimum_reason',payload->>'minimum_reason','shipping_reason',payload->>'shipping_reason') into result
    from public.assisted_order_requests where order_id=p_order_id;
  if result is null then raise exception 'Assisted order not found' using errcode='22023'; end if;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_assisted_request(p_request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if auth.uid() is null or not public.has_backoffice_permission('orders.write') then raise exception 'Admin required' using errcode='42501'; end if;
  if exists(select 1 from public.assisted_order_requests where request_key=p_request_key and actor_user_id<>auth.uid()) then
    raise exception '此開單紀錄屬於其他管理員，請使用原帳號找回或在訂單管理確認。' using errcode='42501';
  end if;
  select jsonb_build_object('order_id',order_id,'link_token',link_token,'shopping_credit_amount',(select shopping_credit_amount from public.orders where id=order_id)) into result
    from public.assisted_order_requests where request_key=p_request_key and actor_user_id=auth.uid();
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_catalog()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
      declare payload jsonb; defaults jsonb;
      begin
        payload := public.get_admin_catalog_before_member_pricing();
        defaults := public.member_pricing_defaults();
        if 'get_admin_catalog' <> 'get_admin_catalog' then
          payload := jsonb_set(payload, '{variants}', coalesce((select jsonb_agg(item - array['procurement_unit_cost_usd','gift_enabled','gift_stock','gift_min_stock'] order by position) from jsonb_array_elements(payload -> 'variants') with ordinality entries(item,position)),'[]'::jsonb));
        end if;
        return jsonb_set(payload, '{products}', coalesce((select jsonb_agg(item || jsonb_build_object('pricing_defaults',defaults) order by position) from jsonb_array_elements(payload -> 'products') with ordinality entries(item,position)),'[]'::jsonb)) || jsonb_build_object('member_pricing_version',1,'pricing_defaults',defaults);
      end $function$;

CREATE OR REPLACE FUNCTION public.get_admin_catalog_before_member_pricing()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  payload jsonb;
  can_manage_procurement boolean;
begin
  if not public.has_backoffice_permission('catalog.read') then
    raise exception 'Catalog read access required' using errcode = '42501';
  end if;
  can_manage_procurement := public.has_backoffice_permission('procurement.manage');

  select jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(to_jsonb(product) order by product.id)
      from public.products product
    ), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(
        case when can_manage_procurement
          then to_jsonb(variant)
          else to_jsonb(variant) - 'procurement_unit_cost_usd'
        end
        order by variant.product_id, variant.sort_order, variant.id
      )
      from public.product_variants variant
    ), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(to_jsonb(image) order by image.product_id, image.sort_order, image.id)
      from public.product_images image
      where image.active is true
    ), '[]'::jsonb)
  ) into payload;
  return payload;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_instructor_student_member(p_member_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.assert_instructor_student_admin(false);
  return jsonb_build_object('context',public.instructor_student_context(p_member_id),
    'instructor_settings',(select jsonb_build_object('student_price_type',student_price_type,'version',version,
      'updated_at',updated_at,'updated_by',updated_by) from public.instructor_student_settings where instructor_id=p_member_id),
    'students',coalesce((select jsonb_agg(jsonb_build_object('student_id',b.student_id,'student_name',s.name,
      'binding_id',b.id,'context',public.instructor_student_context(b.student_id)) order by b.created_at,b.id)
      from public.instructor_student_bindings b left join public.profiles s on s.id=b.student_id
      where b.instructor_id=p_member_id and b.ended_at is null),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc) from (
      select * from public.instructor_student_audit_logs where student_id=p_member_id
        or instructor_id=p_member_id or previous_instructor_id=p_member_id
      order by created_at desc,id desc limit 100) h),'[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_inventory_allocations()
 RETURNS TABLE(order_id text, item_index integer, product_variant_id bigint, requested_qty integer, allocated_qty integer, backorder_qty integer, released_qty integer, state text, source text, priority_at timestamp with time zone, last_allocated_at timestamp with time zone, released_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.has_backoffice_permission('orders.read') then
    raise exception 'Order read authorization required' using errcode = '42501';
  end if;

  return query
  select
    allocation.order_id,
    allocation.item_index,
    allocation.product_variant_id,
    allocation.requested_qty,
    allocation.allocated_qty,
    allocation.backorder_qty,
    allocation.released_qty,
    allocation.state,
    allocation.source,
    allocation.priority_at,
    allocation.last_allocated_at,
    allocation.released_at
  from public.order_inventory_allocations allocation
  order by allocation.order_id, allocation.item_index;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_member_notes()
 RETURNS TABLE(user_id uuid, note text, updated_by_email text, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (
    public.has_backoffice_permission('members.read')
    or public.has_backoffice_permission('orders.read')
  ) then
    raise exception 'Member or order read access required' using errcode = '42501';
  end if;

  return query
  select member_note.user_id, member_note.note, member_note.updated_by_email, member_note.updated_at
  from public.member_admin_notes member_note;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_member_pricing()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_backoffice_permission('catalog.read') and not public.has_backoffice_permission('member_pricing.manage') then
    raise exception 'Member pricing read access required' using errcode='42501';
  end if;
  return jsonb_build_object('multipliers', public.member_pricing_defaults());
end $function$;

CREATE OR REPLACE FUNCTION public.get_admin_order_notes()
 RETURNS TABLE(order_id text, note text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or not public.has_backoffice_permission('orders.read') then
    raise exception 'Order read access required' using errcode = '42501';
  end if;
  return query
  select target.order_id, target.note, target.created_at
  from public.order_admin_notes target;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_order_payment_details()
 RETURNS TABLE(order_id text, attempt_no integer, payment_method text, payment_state text, provider_status text, provider_description text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_eclado_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return query
  select
    attempt.order_id,
    attempt.attempt_no,
    attempt.payment_method,
    attempt.payment_state,
    attempt.provider_status,
    left(attempt.provider_description, 300),
    attempt.created_at,
    attempt.updated_at
  from public.order_payment_attempts attempt

  union all

  select
    instruction.order_id,
    coalesce(instruction.attempt_no, 1),
    instruction.payment_method,
    instruction.payment_state,
    instruction.provider_status,
    left(instruction.provider_description, 300),
    instruction.gateway_created_at,
    instruction.updated_at
  from public.order_payment_instructions instruction
  where not exists (
    select 1
    from public.order_payment_attempts attempt
    where attempt.order_id = instruction.order_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_order_payment_methods()
 RETURNS TABLE(order_id text, payment_method text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_eclado_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return query
  select instruction.order_id, instruction.payment_method
  from public.order_payment_instructions instruction;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_professional_quarterly_notices()
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', notice.id,
    'user_id', notice.user_id,
    'member_name', profile.name,
    'member_email', profile.email,
    'quarter_start', notice.quarter_start,
    'version', notice.version,
    'supersedes_id', notice.supersedes_id,
    'correction_reason', notice.correction_reason,
    'snapshot', notice.snapshot,
    'status', notice.status,
    'channel', notice.channel,
    'sent_at', notice.sent_at,
    'attempt_count', notice.attempt_count,
    'last_error', notice.last_error,
    'created_at', notice.created_at
  )
  from public.professional_quarterly_notices notice
  join public.profiles profile on profile.id = notice.user_id
  where public.has_backoffice_permission('members.read')
  order by notice.quarter_start desc, notice.user_id, notice.version desc
  limit 500;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_professional_renewal_roster(p_renewal_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  roster_rows jsonb;
  today date := (now() at time zone 'Asia/Taipei')::date;
  renewal_start date;
  current_instructors integer;
  current_distributors integer;
begin
  if not public.has_backoffice_permission('members.read') then
    raise exception 'Member read access required' using errcode = '42501';
  end if;
  if p_renewal_year is null or p_renewal_year not between 2021 and extract(year from today)::integer + 1 then
    raise exception 'Invalid renewal year' using errcode = '22023';
  end if;
  renewal_start := make_date(p_renewal_year, 1, 1);
  select count(*) filter (where role = 'instructor'), count(*) filter (where role = 'distributor')
    into current_instructors, current_distributors from public.profiles;
  with cohort as (
    select membership.user_id from public.professional_memberships membership
    where membership.role in ('instructor', 'distributor')
      and membership.started_on < renewal_start and membership.started_on <= today
      and coalesce(membership.ended_on, 'infinity'::date) >= renewal_start
    union
    select application.user_id from public.professional_renewal_applications application where application.renewal_year = p_renewal_year
    union
    select result.user_id from public.professional_renewal_nonapplications result where result.renewal_year = p_renewal_year
  ), entries as (
    select profile.*, application.id as application_id, application.status as application_status,
      application.role as application_role, application.submitted_at, application.finalized_at,
      application.assessment_snapshot, application.b_approved_count,
      application.decision_reason, application.reviewed_at as application_reviewed_at,
      membership.id as source_membership_id, membership.role as source_role,
      result.id as resolution_id, result.role as resolution_role, result.reason as resolution_reason,
      result.reviewed_at as resolution_reviewed_at, result.effective_on,
      case when application.id is not null then application.status
        when result.id is not null then 'not_applied_downgraded'
        when not exists (select 1 from public.professional_memberships active_membership
          where active_membership.user_id = profile.id and active_membership.role = profile.role
            and active_membership.role in ('instructor', 'distributor')
            and active_membership.started_on < renewal_start and active_membership.ended_on is null) then 'qualification_changed'
        when today >= renewal_start then 'overdue'
        else 'not_applied' end as roster_status,
      exists (select 1 from public.professional_memberships active_membership
        where active_membership.user_id = profile.id and active_membership.role = profile.role
          and active_membership.role in ('instructor', 'distributor')
          and active_membership.started_on < renewal_start and active_membership.ended_on is null) as has_eligible_active_membership
    from cohort join public.profiles profile on profile.id = cohort.user_id
    left join public.professional_renewal_applications application on application.user_id = profile.id and application.renewal_year = p_renewal_year
    left join public.professional_renewal_nonapplications result on result.user_id = profile.id and result.renewal_year = p_renewal_year
    left join lateral (
      select history.id, history.role from public.professional_memberships history
      where history.user_id = profile.id and history.started_on < renewal_start
        and coalesce(history.ended_on, 'infinity'::date) >= renewal_start
      order by history.started_on desc limit 1
    ) membership on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', coalesce(entry.application_id::text, p_renewal_year::text || ':' || entry.id::text),
    'application_id', entry.application_id, 'user_id', entry.id,
    'member_name', entry.name, 'member_email', entry.email, 'member_role', entry.role,
    'role', coalesce(entry.application_role, entry.resolution_role, entry.source_role),
    'assessment_year', p_renewal_year - 1, 'renewal_year', p_renewal_year,
    'status', entry.roster_status, 'submitted_at', entry.submitted_at, 'finalized_at', entry.finalized_at,
    'assessment', coalesce(entry.assessment_snapshot, public.get_professional_renewal_assessment(entry.id, p_renewal_year - 1)),
    'b_approved_count', (select count(distinct lower(regexp_replace(btrim(evidence.student_name), '\s+', '', 'g')))
      from public.professional_award_evidence evidence where evidence.user_id = entry.id
        and evidence.assessment_year = p_renewal_year - 1 and evidence.status = 'approved'),
    'decision_reason', coalesce(entry.decision_reason, entry.resolution_reason),
    'reviewed_at', coalesce(entry.application_reviewed_at, entry.resolution_reviewed_at), 'effective_on', entry.effective_on,
    'can_finalize', entry.application_status = 'submitted' and p_renewal_year = extract(year from today)::integer,
    'can_downgrade', entry.application_id is null and entry.resolution_id is null
      and entry.has_eligible_active_membership and p_renewal_year = extract(year from today)::integer,
    'evidence', coalesce((select jsonb_agg(to_jsonb(evidence) order by evidence.completed_on, evidence.created_at)
      from public.professional_award_evidence evidence where evidence.user_id = entry.id
        and evidence.assessment_year = p_renewal_year - 1 and evidence.status <> 'void'), '[]'::jsonb),
    'recent_notices', coalesce((select jsonb_agg(to_jsonb(notice) order by notice.quarter_start desc, notice.version desc)
      from (select * from public.professional_quarterly_notices notice where notice.user_id = entry.id
        order by notice.quarter_start desc, notice.version desc limit 8) notice), '[]'::jsonb)
  ) order by entry.name, entry.id), '[]'::jsonb) into roster_rows from entries entry;
  return jsonb_build_object(
    'renewal_year', p_renewal_year, 'rows', roster_rows,
    'current_instructors', current_instructors, 'current_distributors', current_distributors,
    'eligible_count', jsonb_array_length(roster_rows),
    'submitted_count', (select count(*) from jsonb_array_elements(roster_rows) item where item ->> 'application_id' is not null),
    'not_submitted_count', (select count(*) from jsonb_array_elements(roster_rows) item where item ->> 'application_id' is null),
    'unprocessed_count', (select count(*) from jsonb_array_elements(roster_rows) item where item ->> 'status' in ('submitted', 'pending_review', 'not_applied', 'overdue'))
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_professional_renewals()
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', application.id,
    'user_id', application.user_id,
    'member_name', profile.name,
    'member_email', profile.email,
    'member_role', profile.role,
    'membership_id', application.membership_id,
    'assessment_year', application.assessment_year,
    'renewal_year', application.renewal_year,
    'role', application.role,
    'status', application.status,
    'submitted_at', application.submitted_at,
    'finalized_at', application.finalized_at,
    'assessment', coalesce(
      application.assessment_snapshot,
      public.get_professional_renewal_assessment(application.user_id, application.assessment_year)
    ),
    'a_qualified', application.a_qualified,
    'qualification_path', application.qualification_path,
    'b_approved_count', application.b_approved_count,
    'reviewed_at', application.reviewed_at,
    'decision_reason', application.decision_reason,
    'result_notification_sent_at', application.result_notification_sent_at,
    'result_notification_channel', application.result_notification_channel,
    'result_notification_error', application.result_notification_error,
    'evidence', coalesce((
      select jsonb_agg(to_jsonb(evidence) order by evidence.completed_on, evidence.created_at)
      from public.professional_award_evidence evidence
      where evidence.user_id = application.user_id
        and evidence.assessment_year = application.assessment_year
        and evidence.status <> 'void'
    ), '[]'::jsonb),
    'recent_notices', coalesce((
      select jsonb_agg(to_jsonb(notice) order by notice.quarter_start desc, notice.version desc)
      from (
        select * from public.professional_quarterly_notices
        where user_id = application.user_id
        order by quarter_start desc, version desc
        limit 8
      ) notice
    ), '[]'::jsonb)
  )
  from public.professional_renewal_applications application
  join public.profiles profile on profile.id = application.user_id
  where public.has_backoffice_permission('members.read')
  order by application.renewal_year desc, application.submitted_at;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_professional_sales()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare payload jsonb;
begin
  if not public.has_backoffice_permission('members.read') then raise exception 'Member read access required' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(public.get_professional_sales_payload(profile.id) order by profile.created_at desc), '[]'::jsonb)
    into payload from public.profiles profile
    where profile.role in ('instructor', 'distributor')
      or exists (select 1 from public.professional_memberships membership where membership.user_id = profile.id);
  return payload;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_shipping_groups()
 RETURNS TABLE(order_id text, shipping_group jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
begin
  if auth.uid() is null
    or not public.has_backoffice_permission('orders.read')
  then
    raise exception 'Order read permission required' using errcode = '42501';
  end if;

  return query
  with group_totals as (
    select
      shipping_group.id,
      coalesce(sum(
        case
          when public.is_shipping_group_valid_order_status(target_order.status)
            then public.shipping_group_effective_amount(target_order)
          else 0
        end
      ), 0) as effective_total,
      count(*) filter (
        where public.is_shipping_group_valid_order_status(target_order.status)
      ) as valid_order_count,
      count(*) filter (
        where target_order.status in ('awaiting_confirm', 'unpaid')
      ) as pending_order_count,
      jsonb_agg(
        jsonb_build_object(
          'id', target_order.id,
          'status', target_order.status,
          'effective_amount', public.shipping_group_effective_amount(target_order),
          'is_valid', public.is_shipping_group_valid_order_status(target_order.status)
        )
        order by target_order.created_at, target_order.id
      ) as orders
    from public.shipping_groups shipping_group
    join public.orders target_order
      on target_order.shipping_group_id = shipping_group.id
    group by shipping_group.id
  )
  select
    target_order.id,
    jsonb_build_object(
      'id', shipping_group.id,
      'status', shipping_group.status,
      'created_at', shipping_group.created_at,
      'locked_at', shipping_group.locked_at,
      'original_order_id', shipping_group.original_order_id,
      'original_shipping_amount', shipping_group.original_shipping_amount,
      'effective_total', group_totals.effective_total,
      'valid_order_count', group_totals.valid_order_count,
      'pending_order_count', group_totals.pending_order_count,
      'free_shipping', group_totals.effective_total >= 15000,
      'shipping_refunded', shipping_group.shipping_refund_ledger_id is not null,
      'shipping_refunded_at', shipping_group.shipping_refunded_at,
      'orders', group_totals.orders,
      'requires_manual_review',
        shipping_group.shipping_refund_ledger_id is not null
        and group_totals.effective_total < 15000,
      'below_minimum_warning',
        group_totals.effective_total > 0
        and group_totals.effective_total < 5000
    )
  from public.orders target_order
  join public.shipping_groups shipping_group
    on shipping_group.id = target_order.shipping_group_id
  join group_totals on group_totals.id = shipping_group.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_student_pricing_history()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.assert_instructor_student_admin(false);
  return coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc) from (
    select * from public.instructor_student_audit_logs where event_type='global_settings'
    order by created_at desc,id desc limit 100) h),'[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_student_pricing_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.assert_instructor_student_admin(false);
  return (select jsonb_build_object('multipliers',jsonb_build_object('student_1',student_1,'student_2',student_2),
    'version',version,'updated_by',updated_by,'updated_at',updated_at,'prices_applied',false)
    from public.student_pricing_settings where singleton);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_backorder_management_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare payload jsonb;
begin
  if not public.has_backoffice_permission('backorders.manage') then
    raise exception 'Backorder management authorization required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'variant_id', variant.id,
      'product_id', variant.product_id,
      'sku', variant.sku,
      'product_name', product.name_zh,
      'variant_name', variant.size,
      'available_stock', variant.stock,
      'total_backorder_qty', summary.total_backorder_qty,
      'order_count', summary.order_count,
      'orders', summary.orders
    ) order by summary.oldest_priority_at, variant.id
  ), '[]'::jsonb)
  into payload
  from public.product_variants variant
  join public.products product on product.id = variant.product_id
  join lateral (
    select
      sum(allocation.backorder_qty)::integer as total_backorder_qty,
      count(distinct allocation.order_id)::integer as order_count,
      min(allocation.priority_at) as oldest_priority_at,
      jsonb_agg(jsonb_build_object(
        'allocation_id', allocation.id,
        'order_id', allocation.order_id,
        'member', orders.member,
        'order_status', orders.status,
        'requested_qty', allocation.requested_qty,
        'allocated_qty', allocation.allocated_qty,
        'backorder_qty', allocation.backorder_qty,
        'priority_at', allocation.priority_at,
        'source', allocation.source
      ) order by allocation.priority_at, orders.created_at, allocation.id) as orders
    from public.order_inventory_allocations allocation
    join public.orders orders on orders.id = allocation.order_id
    where allocation.product_variant_id = variant.id
      and allocation.backorder_qty > 0
      and allocation.state in ('partial', 'backordered')
      and public.order_consumes_inventory(orders.status)
  ) summary on summary.total_backorder_qty > 0;

  return payload;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_coupon_campaign_members(p_coupon_campaign_id uuid)
 RETURNS TABLE(user_id uuid, name text, email text, phone text, role text, contact_name text, studio_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_backoffice_permission('promotions.manage') then
    raise exception 'Promotion management access required' using errcode = '42501';
  end if;

  return query
  select profile.id, profile.name, profile.email, profile.phone, profile.role,
    application.contact_name, application.studio_name
  from public.coupon_campaign_members target
  join public.profiles profile on profile.id = target.user_id
  left join lateral (
    select app.contact_name, app.studio_name
    from public.professional_applications app
    where app.user_id = profile.id
      or (app.user_id is null and lower(app.user_email) = lower(profile.email))
    order by (app.status = 'approved') desc, app.created_at desc
    limit 1
  ) application on true
  where target.coupon_campaign_id = p_coupon_campaign_id
  order by profile.name nulls last, profile.created_at desc, profile.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_catalog()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
      declare payload jsonb; defaults jsonb;
      begin
        payload := public.get_event_catalog_before_member_pricing();
        defaults := public.member_pricing_defaults();
        if 'get_event_catalog' <> 'get_admin_catalog' then
          payload := jsonb_set(payload, '{variants}', coalesce((select jsonb_agg(item - array['procurement_unit_cost_usd','gift_enabled','gift_stock','gift_min_stock'] order by position) from jsonb_array_elements(payload -> 'variants') with ordinality entries(item,position)),'[]'::jsonb));
        end if;
        return jsonb_set(payload, '{products}', coalesce((select jsonb_agg(item || jsonb_build_object('pricing_defaults',defaults) order by position) from jsonb_array_elements(payload -> 'products') with ordinality entries(item,position)),'[]'::jsonb)) || jsonb_build_object('member_pricing_version',1,'pricing_defaults',defaults);
      end $function$;

CREATE OR REPLACE FUNCTION public.get_event_catalog_before_member_pricing()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  viewer_role text := 'consumer';
  can_view_professional_price boolean := false;
  payload jsonb;
begin
  if auth.uid() is not null then
    select coalesce(profile.role, 'consumer') into viewer_role
    from public.profiles profile where profile.id = auth.uid();
  end if;
  can_view_professional_price := viewer_role in ('pro', 'instructor', 'distributor', 'staff');
  select jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(
        (to_jsonb(product) - array['min_stock','pro_price','stock','variants','created_at','updated_at'])
        || jsonb_build_object(
          'pro_price', case when can_view_professional_price then product.pro_price else null end,
          'stock', case when product.stock > 0 then 1 else 0 end
        ) order by product.id
      ) from public.products product where product.publication_status='event_only'
    ), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(
        (to_jsonb(variant) - array[
          'sku','pro_price','stock','gift_enabled','gift_stock','gift_min_stock','created_at','updated_at'
        ]) || jsonb_build_object(
          'pro_price', case when can_view_professional_price then variant.pro_price else null end,
          'stock', case when variant.stock > 0 then 1 else 0 end
        ) order by variant.product_id,variant.sort_order,variant.id
      ) from public.product_variants variant
      join public.products product on product.id=variant.product_id
      where variant.active=true and product.publication_status='event_only'
    ), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',image.id,'product_id',image.product_id,'storage_path',image.storage_path,
        'alt_text',image.alt_text,'sort_order',image.sort_order,'is_primary',image.is_primary,'active',image.active
      ) order by image.product_id,image.sort_order,image.id)
      from public.product_images image
      join public.products product on product.id=image.product_id
      where image.active=true and product.publication_status='event_only'
    ), '[]'::jsonb)
  ) into payload;
  return payload;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_inventory_count_detail(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare payload jsonb;
begin
  if not public.has_backoffice_permission('inventory_counts.manage') then
    raise exception 'Inventory count authorization required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'session', to_jsonb(session),
    'items', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.product_name, item.variant_name, item.inventory_type, item.id)
      from public.inventory_count_items item where item.session_id = session.id
    ), '[]'::jsonb),
    'shortages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', shortage.id, 'count_item_id', shortage.count_item_id,
        'order_id', shortage.order_id, 'inventory_type', shortage.inventory_type,
        'quantity', shortage.quantity, 'resolved_quantity', shortage.resolved_quantity,
        'status', shortage.status,
        'created_at', shortage.created_at
      ) order by shortage.created_at, shortage.id)
      from public.inventory_count_shortages shortage
      join public.inventory_count_items count_item on count_item.id = shortage.count_item_id
      where count_item.session_id = session.id
    ), '[]'::jsonb)
  ) into payload
  from public.inventory_count_sessions session
  where session.id = p_session_id;
  if payload is null then raise exception '找不到盤點單' using errcode = 'P0002'; end if;
  return payload;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_inventory_count_gift_shortages()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare payload jsonb;
begin
  if not public.has_backoffice_permission('backorders.manage')
    and not public.has_backoffice_permission('inventory_counts.manage') then
    raise exception 'Inventory shortage authorization required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'variant_id', variant.id,
    'product_id', variant.product_id,
    'sku', variant.sku,
    'product_name', product.name_zh,
    'variant_name', variant.size,
    'available_stock', variant.gift_stock,
    'total_shortage_qty', summary.total_shortage_qty,
    'order_count', summary.order_count,
    'orders', summary.orders
  ) order by summary.oldest_priority_at, variant.id), '[]'::jsonb)
  into payload
  from public.product_variants variant
  join public.products product on product.id = variant.product_id
  join lateral (
    select sum(shortage.quantity - shortage.resolved_quantity)::integer as total_shortage_qty,
      count(distinct shortage.order_id)::integer as order_count,
      min(allocation.priority_at) as oldest_priority_at,
      jsonb_agg(jsonb_build_object(
        'shortage_id', shortage.id,
        'order_id', shortage.order_id,
        'order_status', target_order.status,
        'shortage_qty', shortage.quantity - shortage.resolved_quantity,
        'priority_at', allocation.priority_at
      ) order by allocation.priority_at, allocation.id) as orders
    from public.inventory_count_shortages shortage
    join public.order_inventory_allocations allocation on allocation.id = shortage.allocation_id
    join public.orders target_order on target_order.id = shortage.order_id
    where shortage.product_variant_id = variant.id
      and shortage.inventory_type = 'gift'
      and shortage.status = 'pending'
      and shortage.resolved_quantity < shortage.quantity
      and target_order.status in ('paid', 'preparing', 'ready_for_pickup')
  ) summary on summary.total_shortage_qty > 0;
  return payload;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_inventory_count_sessions()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare payload jsonb;
begin
  if not public.has_backoffice_permission('inventory_counts.manage') then
    raise exception 'Inventory count authorization required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(summary) order by summary.created_at desc), '[]'::jsonb)
  into payload
  from (
    select session.id, session.name, session.status, session.created_by,
      session.created_by_email, session.created_at, session.completed_by_email, session.completed_at,
      count(item.id)::integer as total_count,
      count(item.id) filter (where item.actual_quantity is null)::integer as uncounted_count,
      count(item.id) filter (where item.variance > 0)::integer as gain_count,
      count(item.id) filter (where item.variance < 0)::integer as loss_count,
      coalesce(sum(item.shortage_quantity), 0)::integer as shortage_quantity
    from public.inventory_count_sessions session
    left join public.inventory_count_items item on item.session_id = session.id
    group by session.id
  ) summary;
  return payload;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_member_shopping_credit(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not public.has_backoffice_permission('shopping_credit.manage') then
    raise exception 'Shopping credit management permission required' using errcode = '42501';
  end if;
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'user_id', p_user_id,
    'available_balance', coalesce((
      select account.available_balance from public.shopping_credit_accounts account
      where account.user_id = p_user_id
    ), 0),
    'reserved_balance', coalesce((
      select account.reserved_balance from public.shopping_credit_accounts account
      where account.user_id = p_user_id
    ), 0),
    'entries', coalesce((
      select jsonb_agg(to_jsonb(history) order by history.created_at desc, history.id desc)
      from (
        select entry.id, entry.event_type, entry.amount,
          entry.available_delta, entry.reserved_delta,
          entry.available_balance_after, entry.reserved_balance_after,
          entry.reason_code, entry.internal_note, entry.order_id,
          entry.actor_user_id, entry.actor_email, entry.actor_role,
          entry.request_id, entry.created_at
        from public.shopping_credit_ledger entry
        where entry.user_id = p_user_id
        order by entry.created_at desc, entry.id desc
        limit 100
      ) history
    ), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_appendable_shipping_group()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  current_user_id uuid := auth.uid();
  member_role text;
  group_count integer;
  target_group public.shipping_groups%rowtype;
  effective_total numeric;
  valid_order_count integer;
  pending_order_count integer;
  legacy_candidate_count integer;
  legacy_order_id text;
  legacy_order public.orders%rowtype;
  created_group_id uuid;
begin
  if current_user_id is null then
    return null;
  end if;

  select profile.role into member_role
  from public.profiles profile
  where profile.id = current_user_id;

  if not public.is_professional_shipping_role(member_role) then
    return null;
  end if;

  -- Safe lazy compatibility for a single pre-migration paid order. Multiple
  -- candidates are deliberately not guessed or merged.
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));
  if not exists (
    select 1 from public.shipping_groups existing_group
    where existing_group.user_id = current_user_id
      and existing_group.status = 'open'
  ) then
    select count(*), min(target_order.id)
    into legacy_candidate_count, legacy_order_id
    from public.orders target_order
    where target_order.user_id = current_user_id
      and target_order.shipping_group_id is null
      and target_order.fulfillment_method = 'delivery'
      and target_order.status = 'paid'
      and public.shipping_group_effective_amount(target_order) >= 5000;

    if legacy_candidate_count > 1 then
      raise exception '此會員有多張可追加的舊訂單，請聯繫客服確認出貨批次'
        using errcode = '55000';
    elsif legacy_candidate_count = 1 then
      select * into legacy_order
      from public.orders target_order
      where target_order.id = legacy_order_id
      for update;

      insert into public.shipping_groups (
        user_id, status, fulfillment_method, original_order_id,
        original_shipping_amount
      ) values (
        current_user_id, 'open', 'delivery', legacy_order.id,
        floor(greatest(0, coalesce((legacy_order.pricing_snapshot ->> 'shipping')::numeric, 0)))::bigint
      )
      returning id into created_group_id;

      perform set_config('app.eclado_shipping_group_write', '1', true);
      update public.orders
      set shipping_group_id = created_group_id
      where id = legacy_order.id
        and shipping_group_id is null;
      perform set_config('app.eclado_shipping_group_write', '0', true);
    end if;
  end if;

  select count(*) into group_count
  from public.shipping_groups shipping_group
  where shipping_group.user_id = current_user_id
    and shipping_group.status = 'open'
    and exists (
      select 1
      from public.orders target_order
      where target_order.shipping_group_id = shipping_group.id
        and public.is_shipping_group_valid_order_status(target_order.status)
    );

  if group_count > 1 then
    raise exception '此會員有多個可追加出貨批次，請聯繫客服確認'
      using errcode = '55000';
  end if;
  if group_count = 0 then
    return null;
  end if;

  select shipping_group.* into target_group
  from public.shipping_groups shipping_group
  where shipping_group.user_id = current_user_id
    and shipping_group.status = 'open'
    and exists (
      select 1
      from public.orders target_order
      where target_order.shipping_group_id = shipping_group.id
        and public.is_shipping_group_valid_order_status(target_order.status)
    )
  order by shipping_group.created_at, shipping_group.id
  limit 1;

  select
    coalesce(sum(
      case
        when public.is_shipping_group_valid_order_status(target_order.status)
          then public.shipping_group_effective_amount(target_order)
        else 0
      end
    ), 0),
    count(*) filter (
      where public.is_shipping_group_valid_order_status(target_order.status)
    ),
    count(*) filter (
      where target_order.status in ('awaiting_confirm', 'unpaid')
    )
  into effective_total, valid_order_count, pending_order_count
  from public.orders target_order
  where target_order.shipping_group_id = target_group.id;

  return jsonb_build_object(
    'id', target_group.id,
    'status', target_group.status,
    'original_order_id', target_group.original_order_id,
    'original_shipping_amount', target_group.original_shipping_amount,
    'effective_total', effective_total,
    'valid_order_count', valid_order_count,
    'pending_order_count', pending_order_count,
    'free_shipping', effective_total >= 15000,
    'shipping_refunded', target_group.shipping_refund_ledger_id is not null
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_backoffice_access()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((
    select jsonb_build_object(
      'role', admin_user.role,
      'permissions', coalesce((
        select jsonb_agg(role_permission.permission order by role_permission.permission)
        from public.backoffice_role_permissions role_permission
        where role_permission.role = admin_user.role
      ), '[]'::jsonb)
    )
    from public.admin_users admin_user
    join public.backoffice_roles backoffice_role
      on backoffice_role.role = admin_user.role
     and backoffice_role.active is true
    where admin_user.user_id = auth.uid()
      and admin_user.active is true
  ), jsonb_build_object('role', '', 'permissions', '[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.get_my_instructor_students()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='instructor') then
    raise exception '師資資格不足' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('binding_id',b.id,'student_name',s.name,
    'bound_at',b.created_at,'student_role_eligible',s.role='pro') order by b.created_at,b.id)
    from public.instructor_student_bindings b join public.profiles s on s.id=b.student_id
    where b.instructor_id=auth.uid() and b.ended_at is null),'[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_professional_renewal()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  member_id uuid := auth.uid();
  today date := (now() at time zone 'Asia/Taipei')::date;
  current_year integer := extract(year from today)::integer;
  result jsonb;
begin
  if member_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'current_year', current_year,
    'application_window_open', extract(month from today)::integer between 10 and 12,
    'current_assessment', public.get_professional_renewal_assessment(member_id, current_year),
    'current_application', (
      select to_jsonb(application)
      from public.professional_renewal_applications application
      where application.user_id = member_id
        and application.assessment_year = current_year
      limit 1
    ),
    'latest_application', (
      select to_jsonb(application)
      from public.professional_renewal_applications application
      where application.user_id = member_id
      order by application.assessment_year desc
      limit 1
    ),
    'current_evidence', coalesce((
      select jsonb_agg(to_jsonb(evidence) order by evidence.completed_on desc, evidence.created_at desc)
      from public.professional_award_evidence evidence
      where evidence.user_id = member_id
        and evidence.assessment_year >= current_year - 1
        and evidence.status <> 'void'
    ), '[]'::jsonb),
    'recent_notices', coalesce((
      select jsonb_agg(to_jsonb(notice) order by notice.quarter_start desc, notice.version desc)
      from (
        select * from public.professional_quarterly_notices
        where user_id = member_id
        order by quarter_start desc, version desc
        limit 8
      ) notice
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_professional_sales()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  return public.get_professional_sales_payload(auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_shopping_credit()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when auth.uid() is null then
    jsonb_build_object('available_balance', 0, 'entries', '[]'::jsonb)
  else jsonb_build_object(
    'available_balance', coalesce((
      select account.available_balance
      from public.shopping_credit_accounts account
      where account.user_id = auth.uid() and account.status = 'active'
    ), 0),
    'entries', coalesce((
      select jsonb_agg(to_jsonb(history) order by history.created_at desc, history.id desc)
      from (
        select entry.id, entry.event_type, entry.amount,
          entry.available_delta, entry.reserved_delta,
          entry.available_balance_after, entry.reason_code,
          entry.order_id, entry.created_at
        from public.shopping_credit_ledger entry
        where entry.user_id = auth.uid()
        order by entry.created_at desc, entry.id desc
        limit 100
      ) history
    ), '[]'::jsonb)
  ) end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_student_pricing_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if auth.uid() is null then raise exception '請先登入' using errcode='42501'; end if;
  result:=public.instructor_student_context(auth.uid());
  return jsonb_build_object('has_binding',result->'has_binding','instructor_id',result->'instructor_id',
    'instructor_name',result->'instructor_name','student_price_type',result->'student_price_type',
    'student_role_eligible',result->'student_role_eligible','instructor_role_eligible',result->'instructor_role_eligible',
    'instructor_type_set',result->'instructor_type_set','student_pricing_eligible',result->'student_pricing_eligible',
    'prices_applied',false,'binding_id',result->'binding_id','settings_version',result->'settings_version');
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_student_product_prices()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare multiplier numeric; prices jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('enabled',false,'prices','[]'::jsonb); end if;
  multiplier:=public.student_pricing_multiplier(auth.uid());
  if multiplier is null then return jsonb_build_object('enabled',false,'prices','[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object('product_id',p.id,'variant_id',v.id,
    'unit_price',public.assisted_auto_unit_price(auth.uid(),'pro',p,v,multiplier)) order by p.id,v.id),'[]'::jsonb)
    into prices from public.products p join public.product_variants v on v.product_id=p.id
    where p.publication_status in('active','event_only') and v.active;
  return jsonb_build_object('enabled',true,'prices',prices);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_procurement_management_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  payload jsonb;
begin
  if not public.is_eclado_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'product_variants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', variant.id,
        'product_id', product.id,
        'sku', variant.sku,
        'name_zh', product.name_zh,
        'name_en', product.name,
        'specification', variant.size,
        'active', variant.active,
        'unit_cost', variant.procurement_unit_cost_usd,
        'cost_configured', variant.procurement_unit_cost_usd is not null,
        'available_stock', variant.stock
      ) order by product.name_zh, variant.sort_order, variant.id)
      from public.product_variants variant
      join public.products product on product.id = variant.product_id
      where variant.active is true
    ), '[]'::jsonb),
    'addresses', coalesce((
      select jsonb_agg(to_jsonb(address) order by address.is_default desc, address.last_used_at desc nulls last, address.id desc)
      from public.procurement_addresses address where address.active is true
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(
        to_jsonb(purchase_order) || jsonb_build_object(
          'supplier_name', 'ECLADO',
          'supplier_code', 'ECLADO',
          'items', coalesce((
            select jsonb_agg(to_jsonb(order_item) order by order_item.sort_order, order_item.id)
            from public.purchase_order_items order_item
            where order_item.purchase_order_id = purchase_order.id
          ), '[]'::jsonb)
        ) order by purchase_order.created_at desc, purchase_order.id desc
      )
      from public.purchase_orders purchase_order
    ), '[]'::jsonb)
  ) into payload;
  return payload;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_professional_renewal_assessment(p_member_id uuid, p_assessment_year integer, p_as_of date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with year_bounds as (
    select
      make_date(p_assessment_year, 1, 1) as year_start,
      make_date(p_assessment_year + 1, 1, 1) as year_end
  ), quarter_bounds as (
    select
      (bounds.year_start + make_interval(months => offset_month))::date as quarter_start,
      (bounds.year_start + make_interval(months => offset_month + 3))::date as quarter_end,
      (offset_month / 3 + 1)::integer as calendar_quarter
    from year_bounds bounds
    cross join unnest(array[0, 3, 6, 9]) offset_month
  ), quarter_activity as (
    select
      quarter.quarter_start,
      quarter.quarter_end,
      quarter.calendar_quarter,
      (quarter.quarter_end - quarter.quarter_start)::integer as quarter_days,
      (count(day_value) filter (where day_value <= least(
        coalesce(p_as_of, (now() at time zone 'Asia/Taipei')::date),
        (now() at time zone 'Asia/Taipei')::date
      ) and exists (
        select 1 from public.professional_memberships membership
        where membership.user_id = p_member_id
          and membership.role in ('instructor', 'distributor')
          and day_value >= membership.started_on
          and day_value < coalesce(membership.ended_on, 'infinity'::date)
      )))::integer as effective_days,
      min(day_value) filter (where day_value <= least(
        coalesce(p_as_of, (now() at time zone 'Asia/Taipei')::date),
        (now() at time zone 'Asia/Taipei')::date
      ) and exists (
        select 1 from public.professional_memberships membership
        where membership.user_id = p_member_id
          and membership.role in ('instructor', 'distributor')
          and day_value >= membership.started_on
          and day_value < coalesce(membership.ended_on, 'infinity'::date)
      )) as period_start,
      max(day_value) filter (where day_value <= least(
        coalesce(p_as_of, (now() at time zone 'Asia/Taipei')::date),
        (now() at time zone 'Asia/Taipei')::date
      ) and exists (
        select 1 from public.professional_memberships membership
        where membership.user_id = p_member_id
          and membership.role in ('instructor', 'distributor')
          and day_value >= membership.started_on
          and day_value < coalesce(membership.ended_on, 'infinity'::date)
      )) + 1 as period_end_exclusive
    from quarter_bounds quarter
    cross join lateral generate_series(
      quarter.quarter_start,
      quarter.quarter_end - 1,
      interval '1 day'
    ) generated(day_timestamp)
    cross join lateral (select generated.day_timestamp::date as day_value) day_row
    group by quarter.quarter_start, quarter.quarter_end, quarter.calendar_quarter
  ), quarter_sales as (
    select
      activity.*,
      ceil(30000::numeric * activity.effective_days / activity.quarter_days)::numeric(12, 0) as threshold_amount,
      coalesce((
        select sum(public.order_net_merchandise_amount(
          target_order.subtotal,
          target_order.discount,
          target_order.total,
          target_order.items,
          target_order.pricing_snapshot
        ))
        from public.orders target_order
        where target_order.user_id = p_member_id
          and target_order.status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered')
          and target_order.paid_at is not null
          and (target_order.paid_at at time zone 'Asia/Taipei')::date >= activity.quarter_start
          and (target_order.paid_at at time zone 'Asia/Taipei')::date < activity.quarter_end
          and exists (
            select 1 from public.professional_memberships membership
            where membership.user_id = p_member_id
              and membership.role in ('instructor', 'distributor')
              and (target_order.paid_at at time zone 'Asia/Taipei')::date >= membership.started_on
              and (target_order.paid_at at time zone 'Asia/Taipei')::date < coalesce(membership.ended_on, 'infinity'::date)
          )
      ), 0)::numeric(12, 0) as online_sales_amount,
      coalesce((
        select sum(adjustment.amount)
        from public.professional_sales_adjustments adjustment
        join public.professional_memberships membership on membership.id = adjustment.membership_id
        where membership.user_id = p_member_id
          and adjustment.quarter_start = activity.quarter_start
      ), 0)::numeric(12, 0) as offline_sales_amount
    from quarter_activity activity
  ), active_quarters as (
    select
      sales.*,
      (sales.online_sales_amount + sales.offline_sales_amount)::numeric(12, 0) as sales_amount
    from quarter_sales sales
    where sales.effective_days > 0
  ), annual as (
    select
      coalesce(sum(effective_days), 0)::integer as effective_days,
      (make_date(p_assessment_year + 1, 1, 1) - make_date(p_assessment_year, 1, 1))::integer as year_days,
      coalesce(sum(sales_amount), 0)::numeric(12, 0) as sales_amount,
      coalesce(bool_and(sales_amount >= threshold_amount), false) as quarterly_route_qualified,
      coalesce(bool_and(sales_amount > 0), false) as has_no_zero_quarter,
      count(*)::integer as active_quarter_count
    from active_quarters
  ), evidence_counts as (
    select
      count(distinct lower(regexp_replace(btrim(student_name), '\s+', '', 'g')))
        filter (where status in ('pending', 'approved'))::integer as provisional_count,
      count(distinct lower(regexp_replace(btrim(student_name), '\s+', '', 'g')))
        filter (where status = 'approved')::integer as approved_count
    from public.professional_award_evidence evidence
    where evidence.user_id = p_member_id
      and evidence.assessment_year = p_assessment_year
  )
  select jsonb_build_object(
    'member_id', p_member_id,
    'assessment_year', p_assessment_year,
    'renewal_year', p_assessment_year + 1,
    'effective_days', annual.effective_days,
    'year_days', annual.year_days,
    'annual_threshold', ceil(120000::numeric * annual.effective_days / annual.year_days)::numeric(12, 0),
    'annual_sales_amount', annual.sales_amount,
    'annual_remaining_amount', greatest(
      ceil(120000::numeric * annual.effective_days / annual.year_days) - annual.sales_amount,
      0
    )::numeric(12, 0),
    'active_quarter_count', annual.active_quarter_count,
    'quarterly_route_qualified', annual.quarterly_route_qualified,
    'has_no_zero_quarter', annual.has_no_zero_quarter,
    'annual_route_qualified', annual.active_quarter_count > 0
      and annual.has_no_zero_quarter
      and annual.sales_amount >= ceil(120000::numeric * annual.effective_days / annual.year_days),
    'a_qualified', annual.quarterly_route_qualified or (
      annual.active_quarter_count > 0
      and annual.has_no_zero_quarter
      and annual.sales_amount >= ceil(120000::numeric * annual.effective_days / annual.year_days)
    ),
    'student_provisional_count', coalesce(evidence_counts.provisional_count, 0),
    'student_approved_count', coalesce(evidence_counts.approved_count, 0),
    'quarters', coalesce((
      select jsonb_agg(jsonb_build_object(
        'quarter_start', quarter.quarter_start,
        'calendar_quarter', quarter.calendar_quarter,
        'period_start', quarter.period_start,
        'period_end_exclusive', quarter.period_end_exclusive,
        'effective_days', quarter.effective_days,
        'quarter_days', quarter.quarter_days,
        'threshold_amount', quarter.threshold_amount,
        'online_sales_amount', quarter.online_sales_amount,
        'offline_sales_amount', quarter.offline_sales_amount,
        'sales_amount', quarter.sales_amount,
        'has_zero_sales', quarter.sales_amount = 0,
        'meets_quarter_threshold', quarter.sales_amount >= quarter.threshold_amount
      ) order by quarter.quarter_start)
      from active_quarters quarter
    ), '[]'::jsonb)
  )
  from annual cross join evidence_counts;
$function$;

CREATE OR REPLACE FUNCTION public.get_professional_sales_payload(p_member_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with membership_rows as (
    select membership.*
    from public.professional_memberships membership
    where membership.user_id = p_member_id
  ), calendar_quarters as (
    select
      membership.*,
      series.quarter_index,
      (
        date_trunc('quarter', membership.started_on::timestamp)
        + make_interval(months => series.quarter_index * 3)
      )::date as quarter_start
    from membership_rows membership
    cross join lateral generate_series(0, 399) series(quarter_index)
  ), quarter_periods as (
    select
      membership.id as membership_id,
      membership.role,
      membership.started_on as membership_started_on,
      membership.ended_on as membership_ended_on,
      membership.quarter_index + 1 as quarter_number,
      membership.quarter_start,
      extract(year from membership.quarter_start)::integer as calendar_year,
      extract(quarter from membership.quarter_start)::integer as calendar_quarter,
      greatest(membership.started_on, membership.quarter_start) as period_start,
      least(
        (membership.quarter_start + interval '3 months')::date,
        coalesce(membership.ended_on, 'infinity'::date)
      ) as period_end_exclusive,
      membership.ended_on is null
        and (now() at time zone 'Asia/Taipei')::date >= greatest(membership.started_on, membership.quarter_start)
        and (now() at time zone 'Asia/Taipei')::date < (membership.quarter_start + interval '3 months')::date
        as is_current,
      greatest(membership.started_on, membership.quarter_start) > membership.quarter_start
        or least(
          (membership.quarter_start + interval '3 months')::date,
          coalesce(membership.ended_on, 'infinity'::date)
        ) < (membership.quarter_start + interval '3 months')::date
        as is_partial
    from calendar_quarters membership
    where membership.quarter_start <= (now() at time zone 'Asia/Taipei')::date
      and greatest(membership.started_on, membership.quarter_start) < least(
        (membership.quarter_start + interval '3 months')::date,
        coalesce(membership.ended_on, ((now() at time zone 'Asia/Taipei')::date + 1))
      )
  ), online_sales as (
    select
      period.*,
      coalesce(sum(public.order_net_merchandise_amount(
        target_order.subtotal,
        target_order.discount,
        target_order.total,
        target_order.items,
        target_order.pricing_snapshot
      )) filter (where target_order.id is not null), 0) as online_sales_amount,
      count(target_order.id)::integer as order_count,
      max(target_order.paid_at) as last_paid_at
    from quarter_periods period
    left join public.orders target_order
      on target_order.user_id = p_member_id
      and target_order.status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered')
      and target_order.paid_at is not null
      and (target_order.paid_at at time zone 'Asia/Taipei')::date >= period.period_start
      and (target_order.paid_at at time zone 'Asia/Taipei')::date < period.period_end_exclusive
    group by
      period.membership_id,
      period.role,
      period.membership_started_on,
      period.membership_ended_on,
      period.quarter_number,
      period.quarter_start,
      period.calendar_year,
      period.calendar_quarter,
      period.period_start,
      period.period_end_exclusive,
      period.is_current,
      period.is_partial
  ), quarter_sales as (
    select
      online.*,
      coalesce(adjustment.amount, 0) as offline_sales_amount,
      adjustment.note as offline_note,
      online.online_sales_amount + coalesce(adjustment.amount, 0) as sales_amount
    from online_sales online
    left join public.professional_sales_adjustments adjustment
      on adjustment.membership_id = online.membership_id
      and adjustment.quarter_start = online.quarter_start
  )
  select jsonb_build_object(
    'member_id', p_member_id,
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', membership.id,
        'role', membership.role,
        'started_on', membership.started_on,
        'ended_on', membership.ended_on,
        'change_reason', membership.change_reason
      ) order by membership.started_on desc, membership.created_at desc)
      from membership_rows membership
    ), '[]'::jsonb),
    'quarters', coalesce((
      select jsonb_agg(to_jsonb(recent_quarter) order by recent_quarter.period_start desc)
      from (
        select *
        from quarter_sales
        order by period_start desc
        limit 40
      ) recent_quarter
    ), '[]'::jsonb)
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_public_sales_orders()
 RETURNS TABLE(status text, items jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select orders.status, orders.items
  from public.orders
  where orders.status in ('paid', 'preparing', 'shipped', 'delivered')
  order by orders.created_at desc
  limit 1000;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_sales_stats()
 RETURNS TABLE(product_id integer, sold_qty bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    (item.value ->> 'product_id')::integer as product_id,
    sum(greatest(coalesce(nullif(item.value ->> 'qty', '')::integer, 1), 1))::bigint as sold_qty
  from public.orders orders
  cross join lateral jsonb_array_elements(orders.items) item(value)
  where orders.status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered')
    and orders.order_source <> 'historical_manual'
    and coalesce(item.value ->> 'product_id', '') ~ '^[0-9]+$'
    and coalesce(item.value ->> 'is_custom_order', 'false') <> 'true'
  group by (item.value ->> 'product_id')::integer;
$function$;

CREATE OR REPLACE FUNCTION public.get_storefront_catalog()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
      declare payload jsonb; defaults jsonb;
      begin
        payload := public.get_storefront_catalog_before_member_pricing();
        defaults := public.member_pricing_defaults();
        if 'get_storefront_catalog' <> 'get_admin_catalog' then
          payload := jsonb_set(payload, '{variants}', coalesce((select jsonb_agg(item - array['procurement_unit_cost_usd','gift_enabled','gift_stock','gift_min_stock'] order by position) from jsonb_array_elements(payload -> 'variants') with ordinality entries(item,position)),'[]'::jsonb));
        end if;
        return jsonb_set(payload, '{products}', coalesce((select jsonb_agg(item || jsonb_build_object('pricing_defaults',defaults) order by position) from jsonb_array_elements(payload -> 'products') with ordinality entries(item,position)),'[]'::jsonb)) || jsonb_build_object('member_pricing_version',1,'pricing_defaults',defaults);
      end $function$;

CREATE OR REPLACE FUNCTION public.get_storefront_catalog_before_member_pricing()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  viewer_role text := 'consumer';
  can_view_professional_price boolean := false;
  payload jsonb;
begin
  if auth.uid() is not null then
    select coalesce(profile.role, 'consumer') into viewer_role
    from public.profiles profile where profile.id = auth.uid();
  end if;
  can_view_professional_price := viewer_role in ('pro', 'instructor', 'distributor', 'staff');
  select jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(
        (to_jsonb(product) - array['min_stock','pro_price','stock','variants','created_at','updated_at'])
        || jsonb_build_object(
          'pro_price', case when can_view_professional_price then product.pro_price else null end,
          'stock', case when product.stock > 0 then 1 else 0 end
        ) order by product.id
      ) from public.products product
      where product.publication_status='active' and product.active=true
    ), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(
        (to_jsonb(variant) - array[
          'sku','pro_price','stock','gift_enabled','gift_stock','gift_min_stock','created_at','updated_at'
        ]) || jsonb_build_object(
          'pro_price', case when can_view_professional_price then variant.pro_price else null end,
          'stock', case when variant.stock > 0 then 1 else 0 end
        ) order by variant.product_id,variant.sort_order,variant.id
      ) from public.product_variants variant
      join public.products product on product.id=variant.product_id
      where variant.active=true and product.publication_status='active' and product.active=true
    ), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',image.id,'product_id',image.product_id,'storage_path',image.storage_path,
        'alt_text',image.alt_text,'sort_order',image.sort_order,'is_primary',image.is_primary,'active',image.active
      ) order by image.product_id,image.sort_order,image.id)
      from public.product_images image
      join public.products product on product.id=image.product_id
      where image.active=true and product.publication_status='active' and product.active=true
    ), '[]'::jsonb)
  ) into payload;
  return payload;
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, email, name, phone, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'phone',
    'consumer'
  )
  on conflict (id) do update set
    email = excluded.email,
    name = coalesce(public.profiles.name, excluded.name),
    phone = coalesce(public.profiles.phone, excluded.phone),
    updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.has_backoffice_permission(requested_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select requested_permission is not null and exists (
    select 1
    from public.admin_users admin_user
    join public.backoffice_roles backoffice_role
      on backoffice_role.role = admin_user.role
     and backoffice_role.active is true
    join public.backoffice_role_permissions role_permission
      on role_permission.role = admin_user.role
    where admin_user.user_id = auth.uid()
      and admin_user.active is true
      and role_permission.permission = requested_permission
  );
$function$;

CREATE OR REPLACE FUNCTION public.instructor_student_context(p_student_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'binding_id',b.id,'instructor_id',b.instructor_id,'instructor_name',teacher.name,
    'has_binding',b.id is not null,'student_exists',student.id is not null,
    'instructor_exists',teacher.id is not null,
    'student_role_eligible',coalesce(student.role='pro',false),
    'instructor_role_eligible',coalesce(teacher.role='instructor',false),
    'instructor_type_set',settings.student_price_type is not null,
    'student_price_type',settings.student_price_type,'settings_version',coalesce(settings.version,0),
    'bound_at',b.created_at,'prices_applied',false,
    'student_pricing_eligible',coalesce(b.id is not null and student.role='pro'
      and teacher.role='instructor' and settings.student_price_type is not null,false))
  from (select p_student_id as id) identity_row
  left join public.profiles student on student.id=identity_row.id
  left join public.instructor_student_bindings b on b.student_id=identity_row.id and b.ended_at is null
  left join public.profiles teacher on teacher.id=b.instructor_id
  left join public.instructor_student_settings settings on settings.instructor_id=b.instructor_id;
$function$;

CREATE OR REPLACE FUNCTION public.is_eclado_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid()
      and active = true
      and role in ('admin', 'super_admin')
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_eclado_backoffice_user()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.admin_users admin_user
    join public.backoffice_roles backoffice_role
      on backoffice_role.role = admin_user.role
     and backoffice_role.active is true
    where admin_user.user_id = auth.uid()
      and admin_user.active is true
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_professional_shipping_role(p_role text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select coalesce(p_role, '') in ('pro', 'instructor', 'distributor');
$function$;

CREATE OR REPLACE FUNCTION public.is_public_product_image_storage_path(p_storage_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.product_images image
    join public.products product on product.id = image.product_id
    where image.storage_path = p_storage_path
      and image.active is true
      and product.active is true
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_shipping_group_valid_order_status(p_status text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select coalesce(p_status, '') in (
    'paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered'
  );
$function$;

CREATE OR REPLACE FUNCTION public.make_product_slug(input_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select trim(both '-' from regexp_replace(
    lower(translate(btrim(coalesce(input_value, '')), chr(39) || '’', '')),
    '[^a-z0-9一-龥]+',
    '-',
    'g'
  ));
$function$;

CREATE OR REPLACE FUNCTION public.member_pricing_defaults()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_object_agg(role,professional_price_multiplier) from public.membership_tiers
  where role in ('instructor','distributor','staff') and active is true;
$function$;

CREATE OR REPLACE FUNCTION public.next_purchase_order_number()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select 'PO-' || to_char(now() at time zone 'Asia/Taipei', 'YYYYMMDD') || '-'
    || lpad(nextval('public.purchase_order_number_seq')::text, 4, '0');
$function$;

CREATE OR REPLACE FUNCTION public.normalize_coupon_campaign_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.code := btrim(new.code);
  new.code_normalized := upper(new.code);
  if new.code_normalized = '' then
    raise exception 'Coupon code is required' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.open_professional_evidence_entry_window(p_member_id uuid, p_assessment_year integer, p_opened_until timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  saved public.professional_evidence_entry_windows%rowtype;
begin
  if not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if p_opened_until <= now() or nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A future deadline and reason are required' using errcode = '22023';
  end if;

  insert into public.professional_evidence_entry_windows (
    user_id, assessment_year, opened_until, reason, created_by
  ) values (
    p_member_id, p_assessment_year, p_opened_until, btrim(p_reason), auth.uid()
  )
  on conflict (user_id, assessment_year) do update set
    opened_until = excluded.opened_until,
    reason = excluded.reason,
    created_by = auth.uid(),
    created_at = now()
  returning * into saved;

  perform public.record_professional_sales_audit(
    'professional_award_evidence.entry_window_opened',
    'profiles', p_member_id::text, null,
    jsonb_build_object(
      'assessment_year', p_assessment_year,
      'opened_until', p_opened_until,
      'reason', btrim(p_reason)
    )
  );

  return to_jsonb(saved);
end;
$function$;

CREATE OR REPLACE FUNCTION public.order_consumes_inventory(order_status text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select order_status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered');
$function$;

CREATE OR REPLACE FUNCTION public.order_net_merchandise_amount(p_subtotal numeric, p_discount numeric, p_total numeric, p_items jsonb, p_pricing_snapshot jsonb)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select greatest(0, coalesce(
    case when p_subtotal is not null then p_subtotal - coalesce(p_discount, 0) end,
    case when jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then (
      select coalesce(sum(
        coalesce(nullif(item ->> 'price', '')::numeric, nullif(item ->> 'unit_price', '')::numeric, 0)
        * coalesce(nullif(item ->> 'qty', '')::numeric, 1)
      ), 0) from jsonb_array_elements(p_items) item
    ) - coalesce(p_discount, 0) end,
    coalesce(p_total, 0) - coalesce(nullif(p_pricing_snapshot ->> 'shipping', '')::numeric, 0)
  ));
$function$;

CREATE OR REPLACE FUNCTION public.order_reserves_inventory(order_status text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select order_status in ('awaiting_confirm', 'paid', 'preparing', 'shipped', 'delivered');
$function$;

CREATE OR REPLACE FUNCTION public.persist_assisted_benefits(p_order_id text, p_quote jsonb, p_customer_id uuid, p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare gift jsonb; adjustment jsonb; expiry timestamptz; credit bigint;
begin
  select payment_due_at,shopping_credit_amount into expiry,credit from public.orders where id=p_order_id;
  if credit>0 then perform public.reserve_order_shopping_credit(p_customer_id,p_order_id,credit); end if;
  if nullif(p_quote->>'coupon_campaign_id','') is not null then
    insert into public.coupon_redemptions(coupon_campaign_id,order_id,user_id,guest_identity_hash,status,expires_at)
    values((p_quote->>'coupon_campaign_id')::uuid,p_order_id,p_customer_id,
      case when p_customer_id is null then encode(digest(lower(btrim(p_email)),'sha256'),'hex') end,'reserved',expiry);
  end if;
  for gift in select value from jsonb_array_elements(p_quote->'items') where value->>'line_type'='gift' loop
    insert into public.promotion_gift_reservations(order_id,promotion_id,coupon_campaign_id,product_variant_id,quantity,status,expires_at)
    values(p_order_id,(gift->>'promotion_id')::uuid,nullif(gift->>'coupon_campaign_id','')::uuid,(gift->>'variant_id')::bigint,(gift->>'qty')::integer,'reserved',expiry);
  end loop;
  for adjustment in select value from jsonb_array_elements(p_quote->'adjustments') loop
    -- Legacy activities have their own order promotion snapshot and are not
    -- accepted by the atomic-adjustment table's existing type constraint.
    if adjustment->>'adjustment_type'='legacy_discount' then continue; end if;
    insert into public.order_adjustments(order_id,promotion_id,coupon_campaign_id,adjustment_type,name_snapshot,qualification_snapshot,
      amount,gift_product_id,gift_variant_id,gift_quantity,sort_order,metadata)
    values(p_order_id,nullif(adjustment->>'promotion_id','')::uuid,nullif(adjustment->>'coupon_campaign_id','')::uuid,
      adjustment->>'adjustment_type',adjustment->>'name',coalesce(adjustment->'qualification','{}'),coalesce((adjustment->>'amount')::numeric,0),
      nullif(adjustment->>'gift_product_id','')::integer,nullif(adjustment->>'gift_variant_id','')::bigint,
      nullif(adjustment->>'gift_quantity','')::integer,coalesce((adjustment->>'sort_order')::integer,0),'{"source":"admin_assisted"}');
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_member_shopping_credit_deletion(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_account public.shopping_credit_accounts%rowtype;
begin
  if auth.uid() is null or not public.has_backoffice_permission('members.write') then
    raise exception 'Member write permission required' using errcode = '42501';
  end if;
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  insert into public.shopping_credit_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select account.* into target_account
  from public.shopping_credit_accounts account
  where account.user_id = p_user_id
  for update;

  if target_account.available_balance <> 0 or target_account.reserved_balance <> 0 then
    raise exception 'Member still has available or reserved shopping credit'
      using errcode = '55000';
  end if;

  update public.shopping_credit_accounts
  set status = 'deletion_pending', version = version + 1, updated_at = now()
  where user_id = p_user_id and status <> 'deletion_pending';

  return jsonb_build_object('ok', true, 'user_id', p_user_id, 'locked', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_product_variant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.sku := btrim(new.sku);
  new.size := btrim(new.size);
  if new.gift_enabled is not true then
    new.gift_stock := 0;
    new.gift_min_stock := 0;
  end if;
  new.updated_at := now();
  if new.is_default is true then
    update public.product_variants
    set is_default=false
    where product_id=new.product_id and id is distinct from new.id and is_default=true;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_professional_quarterly_notices(p_quarter_start date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  normalized_start date := date_trunc('quarter', p_quarter_start::timestamp)::date;
  quarter_end date := (normalized_start + interval '3 months')::date;
  assessment_year integer := extract(year from normalized_start)::integer;
  target record;
  assessment jsonb;
  notice_quarter jsonb;
  inserted_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and not public.has_backoffice_permission('members.write')
  then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if normalized_start <> p_quarter_start
    or quarter_end > (now() at time zone 'Asia/Taipei')::date
  then
    raise exception 'Only completed calendar quarters can be prepared' using errcode = '22023';
  end if;

  for target in
    select distinct membership.user_id
    from public.professional_memberships membership
    where membership.role in ('instructor', 'distributor')
      and membership.started_on < quarter_end
      and coalesce(membership.ended_on, 'infinity'::date) > normalized_start
  loop
    assessment := public.get_professional_renewal_assessment(target.user_id, assessment_year, quarter_end - 1);
    select value into notice_quarter
    from jsonb_array_elements(coalesce(assessment -> 'quarters', '[]'::jsonb))
    where (value ->> 'quarter_start')::date = normalized_start
    limit 1;

    if notice_quarter is not null then
      insert into public.professional_quarterly_notices (
        user_id, quarter_start, version, snapshot
      ) values (
        target.user_id,
        normalized_start,
        1,
        assessment || jsonb_build_object(
          'notice_quarter', notice_quarter,
          'data_cutoff', quarter_end - 1,
          'generated_at', now()
        )
      )
      on conflict (user_id, quarter_start, version) do nothing;
      if found then inserted_count := inserted_count + 1; end if;
    end if;
  end loop;

  return jsonb_build_object(
    'quarter_start', normalized_start,
    'inserted_count', inserted_count
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_shipping_group_for_order_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  trusted_role text;
  created_group_id uuid;
  original_shipping numeric;
begin
  if new.order_source = 'admin_assisted' then return new; end if;
  if old.status is not distinct from new.status then
    return new;
  end if;

  if not public.is_shipping_group_valid_order_status(old.status)
    and new.status = 'paid'
    and new.shipping_group_id is null
    and new.user_id is not null
    and new.fulfillment_method = 'delivery'
  then
    select profile.role into trusted_role
    from public.profiles profile
    where profile.id = new.user_id;

    if public.is_professional_shipping_role(trusted_role) then
      if public.shipping_group_effective_amount(new) < 5000 then
        raise exception 'A new professional shipping group requires NT$5,000 merchandise'
          using errcode = '23514';
      end if;

      perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
      original_shipping := greatest(
        0,
        coalesce((new.pricing_snapshot ->> 'shipping')::numeric, 0)
      );

      insert into public.shipping_groups (
        user_id, status, fulfillment_method, original_order_id,
        original_shipping_amount
      ) values (
        new.user_id, 'open', 'delivery', new.id,
        floor(original_shipping)::bigint
      )
      returning id into created_group_id;

      new.shipping_group_id := created_group_id;
    end if;
  end if;

  if new.shipping_group_id is not null
    and new.status in (
      'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered'
    )
  then
    update public.shipping_groups
    set status = 'locked',
        locked_at = coalesce(locked_at, now()),
        updated_at = now()
    where id = new.shipping_group_id
      and status = 'open';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'Audit logs are append-only' using errcode = '42501';
end;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_instructor_student_audit_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'Instructor/student audit history is append-only' using errcode='42501';
end;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_order_adjustment_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'Order adjustments are immutable' using errcode = '42501';
end;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_shopping_credit_ledger_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'Shopping credit ledger is append-only' using errcode = '42501';
end;
$function$;

CREATE OR REPLACE FUNCTION public.promotion_item_matches_scope(p_promotion_id uuid, p_item jsonb, p_scope_role text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with item_data as (
    select
      nullif(p_item ->> 'product_id', '')::integer as product_id,
      nullif(p_item ->> 'variant_id', '')::bigint as variant_id
  ), product_data as (
    select product.*
    from public.products product
    join item_data item on item.product_id = product.id
  ), scopes as (
    select scope.*
    from public.promotion_scopes scope
    where scope.promotion_id = p_promotion_id
      and scope.scope_role = p_scope_role
  ), matched as (
    select scope.mode
    from scopes scope
    cross join item_data item
    cross join product_data product
    where case scope.target_type
      when 'all_regular' then product.publication_status = 'active'
      when 'all_sellable' then product.publication_status in ('active', 'event_only')
      when 'product' then scope.product_id = item.product_id
      when 'variant' then scope.product_variant_id = item.variant_id
      when 'category' then lower(btrim(scope.target_value)) = lower(btrim(coalesce(product.category, '')))
      when 'series' then lower(btrim(scope.target_value)) = lower(btrim(coalesce(product.series, '')))
      else false
    end
  )
  select exists (select 1 from matched where mode = 'include')
    and not exists (select 1 from matched where mode = 'exclude');
$function$;

CREATE OR REPLACE FUNCTION public.protect_assisted_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op='DELETE' then
    if old.order_source='admin_assisted' then
      raise exception 'Assisted orders must remain for audit; cancel instead' using errcode='55000';
    end if;
    return old;
  end if;
  if tg_op='INSERT' then
    if new.order_source='admin_assisted' and coalesce(current_setting('app.assisted_order_create',true),'')<>'1' then
      raise exception 'Assisted orders require admin RPC' using errcode='42501';
    end if;
  elsif new.order_source='admin_assisted' and old.order_source<>'admin_assisted' then
    raise exception 'Existing orders cannot become assisted orders' using errcode='55000';
  elsif old.order_source='admin_assisted' then
    if new.order_source is distinct from old.order_source
      or new.user_id is distinct from old.user_id or new.member is distinct from old.member
      or new.address is distinct from old.address or new.phone is distinct from old.phone
      or new.email is distinct from old.email or new.note is distinct from old.note
      or new.date is distinct from old.date or new.type is distinct from old.type
      or new.fulfillment_method is distinct from old.fulfillment_method
      or new.shipping_group_id is distinct from old.shipping_group_id
      or new.assisted_payment_method is distinct from old.assisted_payment_method
      or new.invoice_type is distinct from old.invoice_type
      or new.invoice_company_name is distinct from old.invoice_company_name
      or new.invoice_tax_id is distinct from old.invoice_tax_id
      or new.payment_due_at is distinct from old.payment_due_at then
      raise exception 'Assisted order information is locked; cancel and recreate' using errcode='55000';
    end if;
    if old.status in ('cancelled','returned') and new.status not in ('cancelled','returned')
      and not (old.status='cancelled' and new.status='paid' and auth.role()='service_role') then
      raise exception 'Cancelled assisted orders cannot be reopened' using errcode='55000';
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.protect_historical_order_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    if old.order_source = 'historical_manual' then
      raise exception 'Historical orders cannot be permanently deleted' using errcode = '55000';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.order_source = 'historical_manual'
      and coalesce(current_setting('app.eclado_historical_order_write', true), '0') <> '1'
    then
      raise exception 'Historical orders must be created through the backoffice RPC'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.order_source is distinct from old.order_source then
    raise exception 'Order source is immutable' using errcode = '55000';
  end if;

  if old.order_source = 'historical_manual'
    and new.status is distinct from old.status
    and not (
      old.status = 'delivered'
      and new.status = 'cancelled'
      and coalesce(current_setting('app.eclado_historical_order_cancel', true), '0') = '1'
    )
  then
    raise exception 'Historical order status is immutable outside the cancellation workflow'
      using errcode = '55000';
  end if;

  if old.order_source = 'historical_manual' and (
    new.items is distinct from old.items
    or new.total is distinct from old.total
    or new.subtotal is distinct from old.subtotal
    or new.discount is distinct from old.discount
    or new.date is distinct from old.date
    or new.transaction_date is distinct from old.transaction_date
    or new.user_id is distinct from old.user_id
    or new.member is distinct from old.member
    or new.type is distinct from old.type
    or new.address is distinct from old.address
    or new.phone is distinct from old.phone
    or new.email is distinct from old.email
    or new.note is distinct from old.note
    or new.pricing_snapshot is distinct from old.pricing_snapshot
    or new.fulfillment_method is distinct from old.fulfillment_method
    or new.invoice_type is distinct from old.invoice_type
    or new.invoice_company_name is distinct from old.invoice_company_name
    or new.invoice_tax_id is distinct from old.invoice_tax_id
    or new.invoice_number is distinct from old.invoice_number
    or new.shopping_credit_amount is distinct from old.shopping_credit_amount
    or new.payment_amount is distinct from old.payment_amount
    or new.paid_at is distinct from old.paid_at
  ) then
    raise exception 'Historical order snapshots are immutable' using errcode = '55000';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.protect_order_pricing_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.items is distinct from old.items
    or new.total is distinct from old.total
    or new.subtotal is distinct from old.subtotal
    or new.discount is distinct from old.discount
    or new.type is distinct from old.type
    or new.promotion_id is distinct from old.promotion_id
    or new.promotion_name is distinct from old.promotion_name
    or new.coupon_campaign_id is distinct from old.coupon_campaign_id
    or new.coupon_name is distinct from old.coupon_name
    or new.coupon_code_mask is distinct from old.coupon_code_mask
    or new.shopping_credit_amount is distinct from old.shopping_credit_amount
    or new.payment_amount is distinct from old.payment_amount
    or new.pricing_snapshot is distinct from old.pricing_snapshot
  then
    raise exception 'Order pricing snapshot is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.protect_order_shipping_group_relationship()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.shipping_group_id is distinct from old.shipping_group_id
    and coalesce(current_setting('app.eclado_shipping_group_write', true), '0') <> '1'
  then
    raise exception 'Order shipping group relationship is managed by the combined-shipping workflow'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.protect_profile_invoice_default_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
begin
  if auth.role() <> 'service_role'
    and not public.is_eclado_admin()
    and coalesce(old.role, 'consumer') not in ('pro', 'instructor', 'distributor')
    and (
      new.default_invoice_company_name is distinct from old.default_invoice_company_name
      or new.default_invoice_tax_id is distinct from old.default_invoice_tax_id
    )
  then
    raise exception 'Invoice defaults are available only to professional members'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.protect_profile_salon_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
begin
  if auth.role() <> 'service_role'
    and not public.is_eclado_admin()
    and coalesce(current_setting('app.eclado_allow_profile_salon_seed', true), '') <> 'true'
    and (
      new.studio_name is distinct from old.studio_name
      or new.studio_contact_name is distinct from old.studio_contact_name
      or new.studio_phone is distinct from old.studio_phone
      or new.studio_address is distinct from old.studio_address
    )
  then
    raise exception 'Salon profile fields may only be changed through an application or by an administrator'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.protect_profile_security_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
begin
  if auth.role() <> 'service_role'
    and not public.is_eclado_admin()
    and coalesce(current_setting('app.eclado_allow_profile_security_update', true), '') <> 'true'
    and (
      new.id is distinct from old.id
      or new.email is distinct from old.email
      or new.role is distinct from old.role
      or new.line_user_id is distinct from old.line_user_id
    )
  then
    raise exception 'Profile security fields may only be changed by an administrator'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.protect_reserved_gift_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  reserved_quantity integer;
begin
  select coalesce(sum(reservation.quantity), 0)::integer
  into reserved_quantity
  from public.promotion_gift_reservations reservation
  where reservation.product_variant_id = new.id
    and reservation.status = 'reserved'
    and reservation.expires_at > now();

  if reserved_quantity > 0 and (
    new.gift_enabled is false or new.active is false or new.gift_stock < reserved_quantity
  ) then
    raise exception 'Gift inventory has % reserved units and cannot be reduced or disabled', reserved_quantity
      using errcode='55000';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.protect_shopping_credit_reservation_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.order_id is distinct from old.order_id
    or new.user_id is distinct from old.user_id
    or new.amount is distinct from old.amount
    or new.reserved_at is distinct from old.reserved_at
  then
    raise exception 'Shopping credit reservation identity is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.quote_assisted_order(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  customer_id uuid; customer_role text:='consumer'; lines jsonb:='[]'; entry jsonb;
  product public.products%rowtype; variant public.product_variants%rowtype;
  quantity integer; price numeric; student_multiplier numeric; subtotal numeric:=0; legacy record;
  base jsonb; result jsonb; shipping numeric; default_shipping numeric; credit bigint;
  available bigint:=0; maximum bigint; automatic boolean; all_custom boolean:=true; confirmation_items jsonb;
begin
  if auth.uid() is null or not public.has_backoffice_permission('orders.write')
    or not public.has_backoffice_permission('members.read') or not public.has_backoffice_permission('catalog.read') then
    raise exception 'Admin order authorization required' using errcode='42501';
  end if;
  if p_payload->>'customer_type'='member' then
    customer_id:=(p_payload->>'member_id')::uuid;
    select role into customer_role from public.profiles where id=customer_id;
    if not found then raise exception 'Member not found' using errcode='22023'; end if;
    if customer_role not in ('pro','instructor','distributor','staff') then customer_role:='consumer'; end if;
  elsif p_payload->>'customer_type'<>'guest' or nullif(p_payload->>'member_id','') is not null then
    raise exception 'Select member or guest' using errcode='22023';
  end if;
  if (p_payload ? 'apply_automatic' and jsonb_typeof(p_payload->'apply_automatic') is distinct from 'boolean')
    or coalesce(p_payload->>'shopping_credit_amount','0') !~ '^[0-9]{1,10}$'
    or coalesce(length(p_payload->>'coupon_code'),0)>100 then
    raise exception 'Invalid assisted benefits' using errcode='22023';
  end if;
  -- Older admin clients never offered benefits. Keep their existing no-benefit behavior.
  automatic:=coalesce((p_payload->>'apply_automatic')::boolean,false);
  credit:=coalesce((p_payload->>'shopping_credit_amount')::bigint,0);
  if credit>0 and not public.has_backoffice_permission('shopping_credit.manage') then
    raise exception 'Shopping credit management permission required' using errcode='42501'; end if;
  if credit>0 and customer_id is null then raise exception '訪客不能使用購物金' using errcode='22023'; end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' then raise exception 'Items required' using errcode='22023'; end if;
  if jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception 'Invalid item count' using errcode='22023'; end if;
  if (select count(*) from jsonb_array_elements(p_payload->'items'))<>(select count(distinct x->>'variant_id') from jsonb_array_elements(p_payload->'items') x) then
    raise exception '同一規格請合併為一列。' using errcode='22023';
  end if;
  student_multiplier:=public.student_pricing_multiplier(customer_id);
  for entry in select value from jsonb_array_elements(p_payload->'items') loop
    if coalesce(entry->>'variant_id','') !~ '^[0-9]{1,18}$' or coalesce(entry->>'product_id','') !~ '^[0-9]{1,9}$'
      or coalesce(entry->>'qty','') !~ '^[0-9]{1,4}$' or coalesce(entry->>'unit_price','') !~ '^[0-9]{1,7}$' then
      raise exception 'Invalid item quantity or unit price' using errcode='22023'; end if;
    quantity:=(entry->>'qty')::integer; price:=(entry->>'unit_price')::numeric;
    if quantity<1 then raise exception 'Invalid quantity' using errcode='22023'; end if;
    select * into variant from public.product_variants where id=(entry->>'variant_id')::bigint
      and product_id=(entry->>'product_id')::integer and active;
    if not found then raise exception 'Product variant unavailable' using errcode='22023'; end if;
    select * into product from public.products where id=variant.product_id and active and publication_status='active';
    if not found or (product.is_pro_only and customer_role='consumer') then raise exception 'Product unavailable for customer' using errcode='22023'; end if;

    if entry ? 'price_mode' and entry->>'price_mode' not in ('AUTO','MANUAL') then
      raise exception 'Invalid item price mode' using errcode='22023';
    end if;
    if entry ? 'price_mode' and entry->>'price_mode' is null then
      raise exception 'Invalid item price mode' using errcode='22023';
    end if;
    if entry->>'price_mode'='AUTO' then
      price:=public.assisted_auto_unit_price(customer_id,customer_role,product,variant,student_multiplier);
    end if;
    all_custom:=all_custom and coalesce(variant.is_custom_order,false);
    subtotal:=subtotal+quantity*price;
    lines:=lines||jsonb_build_array(jsonb_build_object('id',product.id,'product_id',product.id,'variant_id',variant.id,
      'sku',variant.sku,'name',product.name_zh,'nameZh',product.name_zh,'size',variant.size,'qty',quantity,
      'image_storage_path',(select image.storage_path from public.product_images image where image.product_id=product.id and image.active is true order by image.is_primary desc,image.sort_order,image.id limit 1),
      'price',price,'unit_price',price,'line_total',price*quantity,'publication_status',product.publication_status,
      'is_custom_order',variant.is_custom_order,'stock_at_order',variant.stock,'line_type','merchandise',
      'fulfillment_type',case when variant.stock>=quantity then 'in_stock' else 'preorder' end));
  end loop;

  select jsonb_agg(line || case when input ? 'price_mode' then jsonb_build_object('price_mode',input->'price_mode') else '{}'::jsonb end order by n)
    into lines from jsonb_array_elements(lines) with ordinality as actual(line,n)
    join jsonb_array_elements(p_payload->'items') input on input->>'variant_id'=line->>'variant_id';
  if p_payload->>'fulfillment_method' not in ('delivery','onsite_pickup')
    or (p_payload->>'fulfillment_method'='onsite_pickup' and not all_custom) then raise exception 'Invalid fulfillment method' using errcode='22023'; end if;
  base:=jsonb_build_object('items',lines,'subtotal',subtotal,'member_role',customer_role,'discount',0);
  if automatic then
    select p.id,p.name,round(eligible.amount-priced.amount) as discount,eligible.amount as eligible
    into legacy from public.promotions p cross join lateral (
      select coalesce(sum((x->>'line_total')::numeric),0) amount from jsonb_array_elements(lines) x
      where (x->>'product_id')::integer=any(p.product_ids)) eligible cross join lateral (
      select greatest(0,case p.discount_order when 'amount_then_rate' then
        (eligible.amount-p.discount_amount)*p.discount_rate else eligible.amount*p.discount_rate-p.discount_amount end) amount) priced
    where p.active and p.benefit_type='legacy_discount' and p.activation_type='automatic' and p.archived_at is null
      and (p.start_at is null or p.start_at<=now()) and (p.end_at is null or p.end_at>now())
      and p.discount_rate between 0 and 1 and p.discount_amount>=0 and eligible.amount>priced.amount
    order by discount desc,p.created_at,p.id limit 1;
    if found then base:=base||jsonb_build_object('discount',legacy.discount,'promotion_id',legacy.id,'promotion_name',legacy.name,
      'pricing_snapshot',jsonb_build_object('promotion',jsonb_build_object('eligible_subtotal',legacy.eligible))); end if;
  end if;
  result:=public.assisted_gift_quote(base,p_payload->>'fulfillment_method',p_payload->>'coupon_code',p_payload->>'email',customer_id,automatic);
  default_shipping:=(result->>'shipping')::numeric;
  case p_payload->>'shipping_mode'
    when 'default' then shipping:=default_shipping;
    when 'free' then shipping:=0;
    when 'custom' then
      if coalesce(p_payload->>'shipping_amount','') !~ '^[0-9]{1,7}$' then raise exception 'Invalid shipping' using errcode='22023'; end if;
      shipping:=(p_payload->>'shipping_amount')::numeric;
    else raise exception 'Invalid shipping mode' using errcode='22023';
  end case;
  if customer_id is not null and public.has_backoffice_permission('shopping_credit.manage') then
    select coalesce(available_balance,0) into available from public.shopping_credit_accounts where user_id=customer_id and status='active';
    available:=coalesce(available,0);
  end if;
  maximum:=greatest(0,least(available,floor(subtotal-(result->>'discount')::numeric),floor(subtotal-(result->>'discount')::numeric+shipping-1)));
  if credit>maximum then raise exception '購物金超過可用額度；不可支付運費，且銀行付款至少需 NT$1。' using errcode='22023'; end if;
  if subtotal-(result->>'discount')::numeric+shipping-credit<1 then raise exception '銀行付款至少需 NT$1。' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('variant_id',x->'variant_id','qty',x->'qty','unit_price',x->'unit_price',
    'line_type',x->'line_type','promotion_id',x->'promotion_id') order by n) into confirmation_items
    from jsonb_array_elements(result->'items') with ordinality as items(x,n);
  return result||jsonb_build_object('price_modes_supported',true,'confirmation',jsonb_build_object('subtotal',subtotal,'discount',result->'discount',
      'shipping',shipping,'credit',credit,'coupon_campaign_id',result->'coupon_campaign_id','items',confirmation_items),
    'shipping',shipping,'default_shipping',default_shipping,
    'total',subtotal-(result->>'discount')::numeric+shipping,'shopping_credit_amount',credit,
    'payment_amount',subtotal-(result->>'discount')::numeric+shipping-credit,
    'available_credit',available,'maximum_credit',maximum);
end;
$function$;

CREATE OR REPLACE FUNCTION public.quote_order_pricing(p_items jsonb, p_fulfillment_method text, p_coupon_code text, p_guest_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  result jsonb;
  merchandise_items jsonb;
  gift_items jsonb := '[]'::jsonb;
  gift_adjustments jsonb := '[]'::jsonb;
  campaign_id uuid;
  stacking_policy text;
  candidate record;
  qualification_value numeric;
  repeat_count integer;
  awarded_quantity integer;
  reserved_quantity integer;
  available_quantity integer;
  gift_product_id integer;
  gift_item_sku text;
  gift_size text;
  gift_name_zh text;
  gift_name_en text;
  gift_image_path text;
  normalized_code text := upper(btrim(coalesce(p_coupon_code, '')));
begin
  result := public.quote_order_pricing_discount_v2(
    p_items, p_fulfillment_method, p_coupon_code, p_guest_email
  );
  merchandise_items := result -> 'items';
  campaign_id := nullif(result ->> 'coupon_campaign_id', '')::uuid;
  stacking_policy := coalesce(result #>> '{pricing_snapshot,coupon,stacking_policy}', '');

  for candidate in
    select promotion.*, link.coupon_campaign_id, coalesce(link.sort_order, 0) as bundle_sort_order
    from public.promotions promotion
    left join public.coupon_promotions link
      on link.promotion_id = promotion.id and link.coupon_campaign_id = campaign_id
    where promotion.active = true
      and promotion.archived_at is null
      and promotion.benefit_type in ('amount_gift', 'quantity_gift')
      and (promotion.start_at is null or promotion.start_at <= now())
      and (promotion.end_at is null or promotion.end_at > now())
      and (
        (promotion.activation_type = 'coupon_only' and link.coupon_campaign_id = campaign_id)
        or (
          promotion.activation_type = 'automatic'
          and (campaign_id is null or stacking_policy in ('allow_auto_gifts', 'allow_all'))
        )
      )
    order by
      case when promotion.activation_type = 'coupon_only' then 0 else 1 end,
      coalesce(link.sort_order, promotion.priority), promotion.created_at, promotion.id
  loop
    if candidate.benefit_type = 'amount_gift' then
      select coalesce(sum((item ->> 'line_total')::numeric), 0)
      into qualification_value
      from jsonb_array_elements(merchandise_items) item
      where public.promotion_item_matches_scope(candidate.id, item, 'qualification');
    else
      select coalesce(sum((item ->> 'qty')::numeric), 0)
      into qualification_value
      from jsonb_array_elements(merchandise_items) item
      where public.promotion_item_matches_scope(candidate.id, item, 'qualification');
    end if;

    if qualification_value < candidate.threshold_value then
      continue;
    end if;
    repeat_count := case when candidate.repeat_mode = 'repeat'
      then floor(qualification_value / candidate.threshold_value)::integer else 1 end;
    awarded_quantity := candidate.gift_quantity * greatest(repeat_count, 1);

    select variant.product_id, variant.sku, variant.size, variant.gift_stock,
      product.name_zh, product.name,
      image.storage_path
    into gift_product_id, gift_item_sku, gift_size, available_quantity,
      gift_name_zh, gift_name_en, gift_image_path
    from public.product_variants variant
    join public.products product on product.id = variant.product_id
    left join lateral (
      select product_image.storage_path
      from public.product_images product_image
      where product_image.product_id = product.id and product_image.active = true
      order by product_image.is_primary desc, product_image.sort_order, product_image.id
      limit 1
    ) image on true
    where variant.id = candidate.gift_variant_id
      and variant.active = true
      and variant.gift_enabled = true
      and product.publication_status in ('active', 'event_only', 'gift_only');

    if not found then
      if candidate.activation_type = 'coupon_only' then
        raise exception '優惠券指定的贈品庫存目前不可使用' using errcode = '22023';
      end if;
      continue;
    end if;

    select coalesce(sum(reservation.quantity), 0)::integer
    into reserved_quantity
    from public.promotion_gift_reservations reservation
    where reservation.product_variant_id = candidate.gift_variant_id
      and reservation.status = 'reserved'
      and reservation.expires_at > now();
    select reserved_quantity + coalesce(sum((gift ->> 'qty')::integer), 0)::integer
    into reserved_quantity
    from jsonb_array_elements(gift_items) gift
    where (gift ->> 'variant_id')::bigint = candidate.gift_variant_id;
    available_quantity := greatest(coalesce(available_quantity, 0) - reserved_quantity, 0);

    if available_quantity < awarded_quantity then
      if candidate.activation_type = 'coupon_only' then
        raise exception '優惠券贈品已兌換完畢' using errcode = '22023';
      end if;
      continue;
    end if;

    gift_items := gift_items || jsonb_build_array(jsonb_build_object(
      'product_id', gift_product_id,
      'variant_id', candidate.gift_variant_id,
      'sku', gift_item_sku,
      'name', gift_name_zh,
      'nameZh', gift_name_zh,
      'name_en', gift_name_en,
      'size', gift_size,
      'qty', awarded_quantity,
      'unit_price', 0,
      'price', 0,
      'line_total', 0,
      'line_type', 'gift',
      'is_gift', true,
      'promotion_id', candidate.id,
      'coupon_campaign_id', candidate.coupon_campaign_id,
      'image_storage_path', gift_image_path,
      'stock_at_order', awarded_quantity,
      'fulfillment_type', 'in_stock',
      'fulfillment_label', '贈品已保留',
      'shipping_label', '與訂單一併出貨'
    ));
    gift_adjustments := gift_adjustments || jsonb_build_array(jsonb_build_object(
      'promotion_id', candidate.id,
      'coupon_campaign_id', candidate.coupon_campaign_id,
      'adjustment_type', candidate.benefit_type,
      'name', candidate.name,
      'amount', 0,
      'gift_product_id', gift_product_id,
      'gift_variant_id', candidate.gift_variant_id,
      'gift_quantity', awarded_quantity,
      'sort_order', 100 + candidate.bundle_sort_order,
      'qualification', jsonb_build_object(
        'basis', case when candidate.benefit_type = 'amount_gift' then 'amount' else 'quantity' end,
        'value', qualification_value,
        'threshold', candidate.threshold_value,
        'repeat_mode', candidate.repeat_mode,
        'repeat_count', repeat_count
      )
    ));
  end loop;

  if campaign_id is not null
    and not exists (
      select 1 from jsonb_array_elements(
        coalesce(result -> 'adjustments', '[]'::jsonb) || gift_adjustments
      ) adjustment
      where nullif(adjustment ->> 'coupon_campaign_id', '')::uuid = campaign_id
    )
  then
    raise exception '此優惠碼不適用目前購物車內容' using errcode = '22023';
  end if;

  result := jsonb_set(result, '{items}', merchandise_items || gift_items, true);
  result := jsonb_set(result, '{adjustments}', coalesce(result -> 'adjustments', '[]'::jsonb) || gift_adjustments, true);
  result := jsonb_set(result, '{gifts}', gift_items, true);
  result := jsonb_set(result, '{pricing_snapshot,version}', '5'::jsonb, true);
  result := jsonb_set(result, '{pricing_snapshot,engine}', '"authoritative_quote_v3_gifts"'::jsonb, true);
  result := jsonb_set(result, '{pricing_snapshot,items}', merchandise_items || gift_items, true);
  result := jsonb_set(result, '{pricing_snapshot,adjustments}', coalesce(result -> 'adjustments', '[]'::jsonb), true);
  result := jsonb_set(result, '{pricing_snapshot,gifts}', gift_items, true);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.quote_order_pricing(p_items jsonb, p_fulfillment_method text DEFAULT 'delivery'::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
  select public.sanitize_public_order_quote(
    public.quote_order_pricing_internal_20260916(p_items, p_fulfillment_method)
  );
$function$;

CREATE OR REPLACE FUNCTION public.quote_order_pricing_discount_v2(p_items jsonb, p_fulfillment_method text, p_coupon_code text, p_guest_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  base_quote jsonb;
  pricing_lines jsonb;
  member_role text;
  subtotal_amount numeric;
  automatic_discount numeric := 0;
  automatic_id uuid;
  automatic_name text;
  automatic_type text;
  automatic_eligible_subtotal numeric;
  automatic_qualification_subtotal numeric;
  automatic_qualification_quantity numeric;
  automatic_threshold_type text := 'amount';
  automatic_threshold_value numeric;
  legacy_discount numeric;
  legacy_id uuid;
  legacy_name text;
  candidate record;
  activity record;
  qualification_subtotal numeric;
  qualification_quantity numeric;
  eligible_subtotal numeric;
  activity_discount numeric;
  total_discount numeric := 0;
  shipping_amount numeric;
  total_amount numeric;
  normalized_code text := upper(btrim(coalesce(p_coupon_code, '')));
  campaign public.coupon_campaigns%rowtype;
  coupon_adjustments jsonb := '[]'::jsonb;
  automatic_adjustments jsonb := '[]'::jsonb;
  all_adjustments jsonb := '[]'::jsonb;
  current_user_id uuid := auth.uid();
  guest_hash text;
  active_usage integer;
  identity_usage integer;
  normalized_fulfillment text := coalesce(nullif(btrim(p_fulfillment_method), ''), 'delivery');
  shipping_group_context jsonb;
  appendable_group_id uuid;
  is_additional_order boolean := false;
  effective_merchandise_amount numeric;
begin
  base_quote := public.quote_order_pricing(p_items, normalized_fulfillment);
  pricing_lines := base_quote -> 'items';
  member_role := base_quote ->> 'member_role';
  subtotal_amount := (base_quote ->> 'subtotal')::numeric;
  legacy_discount := coalesce((base_quote ->> 'discount')::numeric, 0);
  legacy_id := nullif(base_quote ->> 'promotion_id', '')::uuid;
  legacy_name := base_quote ->> 'promotion_name';

  -- Add a non-rounded remaining amount to each line. It is only an internal
  -- calculation field and is removed before returning the quote.
  select coalesce(jsonb_agg(item || jsonb_build_object(
    'remaining_total', (item ->> 'line_total')::numeric
  )), '[]'::jsonb)
  into pricing_lines
  from jsonb_array_elements(pricing_lines) item;

  -- Compare every atomic automatic discount against the legacy winner. Only
  -- one automatic price discount may win, preserving the site's prior rule.
  automatic_discount := legacy_discount;
  automatic_id := legacy_id;
  automatic_name := legacy_name;
  automatic_type := case when legacy_id is not null then 'legacy_discount' end;
  automatic_eligible_subtotal := coalesce(
    (base_quote #>> '{pricing_snapshot,promotion,eligible_subtotal}')::numeric,
    subtotal_amount
  );
  automatic_qualification_subtotal := subtotal_amount;
  automatic_qualification_quantity := (
    select coalesce(sum((item ->> 'qty')::numeric), 0)
    from jsonb_array_elements(pricing_lines) item
  );

  for candidate in
    select promotion.*
    from public.promotions promotion
    where promotion.active = true
      and promotion.activation_type = 'automatic'
      and promotion.benefit_type in ('percentage_discount', 'fixed_discount')
      and promotion.archived_at is null
      and (promotion.start_at is null or promotion.start_at <= now())
      and (promotion.end_at is null or promotion.end_at > now())
    order by promotion.priority asc, promotion.created_at asc, promotion.id asc
  loop
    select coalesce(sum((item ->> 'line_total')::numeric), 0)
      into qualification_subtotal
      from jsonb_array_elements(pricing_lines) item
      where public.promotion_item_matches_scope(candidate.id, item, 'qualification');

    select coalesce(sum((item ->> 'qty')::numeric), 0)
      into qualification_quantity
      from jsonb_array_elements(pricing_lines) item
      where public.promotion_item_matches_scope(candidate.id, item, 'qualification');

    select coalesce(sum((item ->> 'line_total')::numeric), 0)
      into eligible_subtotal
      from jsonb_array_elements(pricing_lines) item
      where public.promotion_item_matches_scope(candidate.id, item, 'benefit');

    if (case when candidate.threshold_type = 'quantity' then qualification_quantity else qualification_subtotal end) > 0
      and eligible_subtotal > 0
      and (candidate.threshold_value is null or case
        when candidate.threshold_type = 'quantity' then qualification_quantity
        else qualification_subtotal
      end >= candidate.threshold_value)
    then
      activity_discount := case candidate.benefit_type
        when 'percentage_discount' then round(eligible_subtotal * (1 - candidate.discount_rate))
        when 'fixed_discount' then least(eligible_subtotal, candidate.discount_amount)
        else 0
      end;
      activity_discount := least(greatest(coalesce(activity_discount, 0), 0), eligible_subtotal);

      if activity_discount > automatic_discount then
        automatic_discount := activity_discount;
        automatic_id := candidate.id;
        automatic_name := candidate.name;
        automatic_type := candidate.benefit_type;
        automatic_eligible_subtotal := eligible_subtotal;
        automatic_qualification_subtotal := qualification_subtotal;
        automatic_qualification_quantity := qualification_quantity;
        automatic_threshold_type := candidate.threshold_type;
        automatic_threshold_value := candidate.threshold_value;
      end if;
    end if;
  end loop;

  if automatic_id is not null and automatic_discount > 0 then
    automatic_adjustments := jsonb_build_array(jsonb_build_object(
      'promotion_id', automatic_id,
      'coupon_campaign_id', null,
      'adjustment_type', automatic_type,
      'name', automatic_name,
      'amount', automatic_discount,
      'sort_order', 0,
      'qualification', jsonb_build_object(
        'basis', automatic_threshold_type,
        'value', case when automatic_threshold_type = 'quantity' then automatic_qualification_quantity else automatic_qualification_subtotal end,
        'subtotal', automatic_qualification_subtotal,
        'quantity', automatic_qualification_quantity,
        'threshold', automatic_threshold_value
      )
    ));
  end if;

  if normalized_code <> '' then
    select * into campaign
    from public.coupon_campaigns target
    where target.code_normalized = normalized_code
      and target.active = true
      and target.archived_at is null
      and (target.start_at is null or target.start_at <= now())
      and (target.end_at is null or target.end_at > now());

    if not found
      or not public.coupon_campaign_allows_identity(campaign.id, member_role)
    then
      raise exception '優惠碼無效或目前無法使用' using errcode = '22023';
    end if;

    if current_user_id is null then
      if nullif(lower(btrim(coalesce(p_guest_email, ''))), '') is null then
        raise exception '訪客使用優惠碼時需先填寫 Email' using errcode = '22023';
      end if;
      guest_hash := encode(digest(lower(btrim(p_guest_email)), 'sha256'), 'hex');
    end if;

    select count(*) into active_usage
    from public.coupon_redemptions redemption
    where redemption.coupon_campaign_id = campaign.id
      and (redemption.status = 'redeemed'
        or (redemption.status = 'reserved' and redemption.expires_at > now()));

    select count(*) into identity_usage
    from public.coupon_redemptions redemption
    where redemption.coupon_campaign_id = campaign.id
      and (redemption.status = 'redeemed'
        or (redemption.status = 'reserved' and redemption.expires_at > now()))
      and ((current_user_id is not null and redemption.user_id = current_user_id)
        or (current_user_id is null and redemption.guest_identity_hash = guest_hash));

    if campaign.total_usage_limit is not null and active_usage >= campaign.total_usage_limit then
      raise exception '優惠碼已達使用上限' using errcode = '22023';
    end if;
    if campaign.per_member_limit is not null and identity_usage >= campaign.per_member_limit then
      raise exception '此優惠碼已達個人使用上限' using errcode = '22023';
    end if;

    -- coupon_only and allow_auto_gifts both suppress automatic price discounts.
    -- allow_auto_gifts becomes observably different once the gift batch lands.
    if campaign.stacking_policy <> 'allow_all' then
      automatic_discount := 0;
      automatic_id := null;
      automatic_name := null;
      automatic_type := null;
      automatic_adjustments := '[]'::jsonb;
    else
      -- Reduce all lines proportionally for the automatic winner so subsequent
      -- coupon activities calculate from the remaining payable merchandise.
      if automatic_discount > 0 then
        select coalesce(jsonb_agg(case
          when (
            automatic_type = 'legacy_discount'
            and (item ->> 'product_id')::integer = any(
              (select product_ids from public.promotions where id = automatic_id)
            )
          ) or (
            automatic_type in ('percentage_discount', 'fixed_discount')
            and public.promotion_item_matches_scope(automatic_id, item, 'benefit')
          ) then item || jsonb_build_object(
            'remaining_total', greatest(0,
              (item ->> 'remaining_total')::numeric
              - automatic_discount * (item ->> 'remaining_total')::numeric
                / nullif(automatic_eligible_subtotal, 0)
            )
          )
          else item
        end), '[]'::jsonb) into pricing_lines
        from jsonb_array_elements(pricing_lines) item;
      end if;
    end if;

    for activity in
      select promotion.*, link.sort_order as bundle_sort_order
      from public.coupon_promotions link
      join public.promotions promotion on promotion.id = link.promotion_id
      where link.coupon_campaign_id = campaign.id
        and promotion.active = true
        and promotion.activation_type = 'coupon_only'
        and promotion.benefit_type in ('percentage_discount', 'fixed_discount')
        and promotion.archived_at is null
        and (promotion.start_at is null or promotion.start_at <= now())
        and (promotion.end_at is null or promotion.end_at > now())
      order by link.sort_order asc, link.id asc
    loop
      select coalesce(sum(case
        when activity.threshold_basis = 'after_bundle_discount'
          then (item ->> 'remaining_total')::numeric
        else (item ->> 'line_total')::numeric
      end), 0)
      into qualification_subtotal
      from jsonb_array_elements(pricing_lines) item
      where public.promotion_item_matches_scope(activity.id, item, 'qualification');

      select coalesce(sum((item ->> 'qty')::numeric), 0)
        into qualification_quantity
        from jsonb_array_elements(pricing_lines) item
        where public.promotion_item_matches_scope(activity.id, item, 'qualification');

      select coalesce(sum((item ->> 'remaining_total')::numeric), 0)
        into eligible_subtotal
        from jsonb_array_elements(pricing_lines) item
        where public.promotion_item_matches_scope(activity.id, item, 'benefit');

      if (case when activity.threshold_type = 'quantity' then qualification_quantity else qualification_subtotal end) > 0
        and eligible_subtotal > 0
        and (activity.threshold_value is null or case
          when activity.threshold_type = 'quantity' then qualification_quantity
          else qualification_subtotal
        end >= activity.threshold_value)
      then
        activity_discount := case activity.benefit_type
          when 'percentage_discount' then round(eligible_subtotal * (1 - activity.discount_rate))
          when 'fixed_discount' then least(eligible_subtotal, activity.discount_amount)
          else 0
        end;
        activity_discount := least(greatest(coalesce(activity_discount, 0), 0), eligible_subtotal);

        if activity_discount > 0 then
          coupon_adjustments := coupon_adjustments || jsonb_build_array(jsonb_build_object(
            'promotion_id', activity.id,
            'coupon_campaign_id', campaign.id,
            'adjustment_type', activity.benefit_type,
            'name', activity.name,
            'amount', activity_discount,
            'sort_order', activity.bundle_sort_order + 1,
            'qualification', jsonb_build_object(
              'basis', activity.threshold_type,
              'value', case when activity.threshold_type = 'quantity' then qualification_quantity else qualification_subtotal end,
              'subtotal', qualification_subtotal,
              'quantity', qualification_quantity,
              'eligible_subtotal', eligible_subtotal,
              'threshold', activity.threshold_value,
              'threshold_basis', activity.threshold_basis
            )
          ));

          -- Preserve each line's share as a decimal. Individual lines are not
          -- charged from this field, so aggregate rounding stays exact while a
          -- later bundled activity still sees the correct remaining base.
          select coalesce(jsonb_agg(case
            when public.promotion_item_matches_scope(activity.id, item, 'benefit') then
              item || jsonb_build_object(
                'remaining_total', greatest(0,
                  (item ->> 'remaining_total')::numeric
                  - activity_discount * (item ->> 'remaining_total')::numeric / nullif(eligible_subtotal, 0)
                )
              )
            else item
          end), '[]'::jsonb)
          into pricing_lines
          from jsonb_array_elements(pricing_lines) item;
        end if;
      end if;
    end loop;

    if jsonb_array_length(coupon_adjustments) = 0
      and not exists (
        select 1
        from public.coupon_promotions gift_link
        join public.promotions gift_promotion on gift_promotion.id = gift_link.promotion_id
        where gift_link.coupon_campaign_id = campaign.id
          and gift_promotion.active = true
          and gift_promotion.activation_type = 'coupon_only'
          and gift_promotion.benefit_type in ('amount_gift', 'quantity_gift')
          and gift_promotion.archived_at is null
          and (gift_promotion.start_at is null or gift_promotion.start_at <= now())
          and (gift_promotion.end_at is null or gift_promotion.end_at > now())
      )
    then
      raise exception '此優惠碼不適用目前購物車內容' using errcode = '22023';
    end if;
  end if;

  all_adjustments := automatic_adjustments || coupon_adjustments;
  select coalesce(sum((adjustment ->> 'amount')::numeric), 0)
    into total_discount
    from jsonb_array_elements(all_adjustments) adjustment;
  total_discount := least(greatest(total_discount, 0), subtotal_amount);

  effective_merchandise_amount := subtotal_amount - total_discount;

  if member_role in ('pro', 'instructor', 'distributor')
    and normalized_fulfillment = 'delivery'
  then
    shipping_group_context := public.get_my_appendable_shipping_group();
    appendable_group_id := nullif(shipping_group_context ->> 'id', '')::uuid;
    is_additional_order := appendable_group_id is not null;
  end if;

  if member_role in ('pro', 'instructor', 'distributor','staff')
    and effective_merchandise_amount < 5000
    and not is_additional_order
  then
    raise exception '專業會員單筆訂單最低金額為 NT$ 5,000' using errcode = '22023';
  end if;

  if normalized_fulfillment = 'onsite_pickup' then
    shipping_amount := 0;
  elsif is_additional_order then
    shipping_amount := 0;
  elsif member_role in ('pro', 'instructor', 'distributor')
    and effective_merchandise_amount >= 15000
  then
    shipping_amount := 0;
  else
    shipping_amount := public.calculate_order_shipping(base_quote -> 'items');
  end if;
  total_amount := effective_merchandise_amount + shipping_amount;

  return jsonb_build_object(
    'member_role', member_role,
    'items', base_quote -> 'items',
    'subtotal', subtotal_amount,
    'discount', total_discount,
    'shipping', shipping_amount,
    'total', total_amount,
    'fulfillment_method', normalized_fulfillment,
    'shipping_group_id', appendable_group_id,
    'is_additional_order', is_additional_order,
    'shipping_group', shipping_group_context,
    'promotion_id', automatic_id,
    'promotion_name', automatic_name,
    'coupon_campaign_id', case when normalized_code = '' then null else campaign.id end,
    'coupon_name', case when normalized_code = '' then null else campaign.name end,
    'coupon_code_mask', case when normalized_code = '' then null
      else left(normalized_code, least(3, length(normalized_code))) || repeat('*', greatest(length(normalized_code) - 3, 3)) end,
    'adjustments', all_adjustments,
    'pricing_snapshot', jsonb_build_object(
      'version', 4,
      'engine', 'authoritative_quote_v2',
      'calculated_at', clock_timestamp(),
      'currency', 'TWD',
      'member_role', member_role,
      'fulfillment_method', normalized_fulfillment,
      'items', base_quote -> 'items',
      'automatic_promotion', case when automatic_id is null then null else jsonb_build_object(
        'id', automatic_id, 'name', automatic_name, 'type', automatic_type,
        'discount', automatic_discount
      ) end,
      'coupon', case when normalized_code = '' then null else jsonb_build_object(
        'id', campaign.id, 'name', campaign.name,
        'code_mask', left(normalized_code, least(3, length(normalized_code))) || repeat('*', greatest(length(normalized_code) - 3, 3)),
        'stacking_policy', campaign.stacking_policy
      ) end,
      'adjustments', all_adjustments,
      'subtotal', subtotal_amount,
      'discount', total_discount,
      'final_subtotal', effective_merchandise_amount,
      'shipping_group_id', appendable_group_id,
      'is_additional_order', is_additional_order,
      'shipping_group', shipping_group_context,
      'shipping', shipping_amount,
      'total', total_amount
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.quote_order_pricing_internal_20260916(p_items jsonb, p_fulfillment_method text DEFAULT 'delivery'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  current_user_id uuid := auth.uid(); student_multiplier numeric := public.student_pricing_multiplier(auth.uid());
  member_role text := 'consumer';
  tier public.membership_tiers%rowtype;
  requested_item record;
  product_row public.products%rowtype;
  variant_row public.product_variants%rowtype;
  requested_variant text;
  quantity integer;
  list_price numeric;
  professional_price numeric;
  unit_price numeric;
  item_stock integer;
  item_size text;
  order_items jsonb := '[]'::jsonb;
  subtotal_amount numeric := 0;
  discount_amount numeric := 0;
  shipping_amount numeric := 120;
  total_amount numeric := 0;
  selected_promotion_id uuid;
  selected_promotion_name text;
  selected_promotion_rate numeric;
  selected_promotion_amount numeric;
  selected_promotion_order text;
  selected_promotion_subtotal numeric := 0;
  selected_promotion_final_subtotal numeric := 0;
  pricing_snapshot jsonb;
  normalized_fulfillment_method text := coalesce(nullif(trim(p_fulfillment_method), ''), 'delivery');
  all_custom_order_items boolean := true;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception 'Too many cart items' using errcode = '22023';
  end if;

  if normalized_fulfillment_method not in ('delivery', 'onsite_pickup') then
    raise exception 'Invalid fulfillment method' using errcode = '22023';
  end if;

  if current_user_id is not null then
    select coalesce(role, 'consumer')
      into member_role
      from public.profiles
      where id = current_user_id;
    member_role := coalesce(member_role, 'consumer');
  end if;

  select *
    into tier
    from public.membership_tiers
    where role = member_role and active = true;

  if not found then
    select *
      into tier
      from public.membership_tiers
      where role = 'consumer' and active = true;
    member_role := 'consumer';
  end if;

  for requested_item in
    select value from jsonb_array_elements(p_items)
  loop
    quantity := nullif(requested_item.value ->> 'qty', '')::integer;
    if quantity is null or quantity < 1 or quantity > 99 then
      raise exception 'Invalid quantity' using errcode = '22023';
    end if;

    select *
      into product_row
      from public.products
      where id = nullif(requested_item.value ->> 'product_id', '')::integer
        and publication_status in ('active', 'event_only');

    if not found then
      raise exception 'Product not found or inactive' using errcode = 'P0002';
    end if;

    if product_row.is_pro_only and not tier.can_buy_pro_products then
      raise exception 'Professional membership required for product %', product_row.id
        using errcode = '42501';
    end if;

    requested_variant := nullif(trim(requested_item.value ->> 'variant_id'), '');
    if requested_variant is null then
      select *
        into variant_row
        from public.product_variants
        where product_id = product_row.id
          and active = true
          and is_default = true
        order by sort_order asc, id asc
        limit 1;
    else
      select *
        into variant_row
        from public.product_variants
        where product_id = product_row.id
          and active = true
          and (
            id::text = requested_variant
            or sku = requested_variant
            or size = requested_variant
          )
        order by is_default desc, sort_order asc, id asc
        limit 1;
    end if;

    if not found then
      raise exception 'Active product variant not found for product %', product_row.id
        using errcode = 'P0002';
    end if;

    requested_variant := variant_row.id::text;
    list_price := variant_row.price;
    professional_price := variant_row.pro_price;
    item_stock := greatest(coalesce(variant_row.stock, 0), 0);
    item_size := variant_row.size;
    all_custom_order_items := all_custom_order_items and variant_row.is_custom_order;

    if tier.professional_price_multiplier is null then
      unit_price := list_price;
    else
      unit_price := round(
        case when
          (member_role='instructor' and product_row.instructor_price_multiplier=1)
          or (member_role='distributor' and product_row.distributor_price_multiplier=1)
          or (member_role='staff' and product_row.staff_price_multiplier=1)
          or (member_role='pro' and product_row.instructor_price_multiplier=1
            and product_row.distributor_price_multiplier=1 and product_row.staff_price_multiplier=1)
        then professional_price else coalesce(nullif(professional_price, 0), list_price) end
        * public.resolve_product_price_multiplier(product_row, member_role, tier.professional_price_multiplier)
      );
    end if;



    if member_role='pro' then
      unit_price:=public.apply_student_price(unit_price,student_multiplier);
    end if;
    if requested_item.value ? 'expected_unit_price' and
      (requested_item.value ->> 'expected_unit_price')::numeric is distinct from unit_price then
      raise exception '商品價格已更新，請重新整理並確認金額後再建立付款單。' using errcode='22023';
    end if;
    if unit_price is null or unit_price < 0 then
      raise exception 'Invalid authoritative price for product %', product_row.id;
    end if;

    subtotal_amount := subtotal_amount + unit_price * quantity;
    order_items := order_items || jsonb_build_array(jsonb_build_object(
      'id', product_row.id,
      'product_id', product_row.id,
      'publication_status', product_row.publication_status,
      'variant_id', requested_variant,
      'name', product_row.name_zh,
      'nameZh', product_row.name_zh,
      'name_en', product_row.name,
      'size', item_size,
      'image_storage_path', (
        select image.storage_path
        from public.product_images image
        where image.product_id = product_row.id
          and image.active = true
        order by image.is_primary desc, image.sort_order asc, image.id asc
        limit 1
      ),
      'img', product_row.image_url,
      'qty', quantity,
      'list_price', list_price,
      'professional_price', professional_price,
      'apply_tier_multiplier', product_row.apply_tier_multiplier,
      'member_role', member_role,
      'price', unit_price,
      'unit_price', unit_price,
      'line_total', unit_price * quantity,
      'stock_at_order', item_stock,
      'available_qty_at_order', least(quantity, item_stock),
      'backorder_qty_at_order', greatest(quantity - item_stock, 0),
      'is_custom_order', variant_row.is_custom_order,
      'fulfillment_type', case when item_stock >= quantity then 'in_stock' else 'preorder' end,
      'fulfillment', case when item_stock >= quantity then '現貨商品' else '含預購商品' end,
      'shipping_time', case when item_stock >= quantity then '出貨時間為 5 個工作天內，每週二出貨' else '出貨時間為 7-14 個工作天' end
    ));
  end loop;

  if normalized_fulfillment_method = 'onsite_pickup' and not all_custom_order_items then
    raise exception 'Onsite pickup is available only when every item is a custom-order variant'
      using errcode = '42501';
  end if;

  -- Batch 2 only evaluates the exact legacy automatic activity model. The
  -- additional predicates prevent future coupon-only or gift definitions from
  -- accidentally entering checkout before their dedicated engine is enabled.
  select
    candidate.id,
    candidate.name,
    candidate.discount,
    candidate.discount_rate,
    candidate.discount_amount,
    candidate.discount_order,
    candidate.promotion_subtotal,
    candidate.promotion_final_subtotal
  into
    selected_promotion_id,
    selected_promotion_name,
    discount_amount,
    selected_promotion_rate,
    selected_promotion_amount,
    selected_promotion_order,
    selected_promotion_subtotal,
    selected_promotion_final_subtotal
  from (
    select
      promotion.id,
      promotion.name,
      round(eligible.subtotal - priced.final_subtotal) as discount,
      promotion.discount_rate,
      promotion.discount_amount,
      promotion.discount_order,
      eligible.subtotal as promotion_subtotal,
      priced.final_subtotal as promotion_final_subtotal,
      promotion.created_at
    from public.promotions promotion
    cross join lateral (
      select coalesce(sum((item ->> 'line_total')::numeric), 0) as subtotal
      from jsonb_array_elements(order_items) item
      where (item ->> 'product_id')::integer = any(promotion.product_ids)
        and coalesce(item ->> 'publication_status', 'active') = 'active'
    ) eligible
    cross join lateral (
      select greatest(
        0,
        case promotion.discount_order
          when 'amount_then_rate' then
            (eligible.subtotal - promotion.discount_amount) * promotion.discount_rate
          else
            eligible.subtotal * promotion.discount_rate - promotion.discount_amount
        end
      ) as final_subtotal
    ) priced
    where promotion.active = true
      and promotion.benefit_type = 'legacy_discount'
      and promotion.activation_type = 'automatic'
      and promotion.archived_at is null
      and (promotion.start_at is null or promotion.start_at <= now())
      and (promotion.end_at is null or promotion.end_at > now())
      and promotion.discount_rate between 0 and 1
      and promotion.discount_amount >= 0
      and cardinality(promotion.product_ids) > 0
      and eligible.subtotal > 0
      and priced.final_subtotal < eligible.subtotal
  ) candidate
  order by candidate.discount desc, candidate.created_at asc, candidate.id asc
  limit 1;

  if not found then
    selected_promotion_id := null;
    selected_promotion_name := null;
    discount_amount := 0;
    selected_promotion_rate := null;
    selected_promotion_amount := null;
    selected_promotion_order := null;
    selected_promotion_subtotal := 0;
    selected_promotion_final_subtotal := 0;
  end if;

  discount_amount := least(greatest(coalesce(discount_amount, 0), 0), subtotal_amount);
  if member_role in ('pro', 'instructor', 'distributor')
    and subtotal_amount - discount_amount < 5000
  then
    if not exists (
      select 1
      from public.shipping_groups appendable_group
      where appendable_group.user_id = auth.uid()
        and appendable_group.status = 'open'
        and exists (
          select 1
          from public.orders grouped_order
          where grouped_order.shipping_group_id = appendable_group.id
            and grouped_order.status in (
              'paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered'
            )
        )
    ) then
      raise exception 'Professional member order minimum is TWD 5000' using errcode = '22023';
    end if;
  end if;

  if normalized_fulfillment_method = 'onsite_pickup' then
    shipping_amount := 0;
  elsif member_role in ('pro', 'instructor', 'distributor')
    and subtotal_amount - discount_amount >= 15000
  then
    shipping_amount := 0;
  else
    shipping_amount := public.calculate_order_shipping(order_items);
  end if;

  total_amount := subtotal_amount - discount_amount + shipping_amount;
  pricing_snapshot := jsonb_build_object(
    'version', 3,
    'engine', 'authoritative_quote_v1',
    'calculated_at', clock_timestamp(),
    'currency', 'TWD',
    'member_role', member_role,
    'fulfillment_method', normalized_fulfillment_method,
    'items', order_items,
    'subtotal', subtotal_amount,
    'promotion', case
      when selected_promotion_id is null then null
      else jsonb_build_object(
        'id', selected_promotion_id,
        'name', selected_promotion_name,
        'discount_rate', selected_promotion_rate,
        'discount_amount', selected_promotion_amount,
        'discount_order', selected_promotion_order,
        'eligible_subtotal', selected_promotion_subtotal,
        'final_subtotal', selected_promotion_final_subtotal,
        'discount', discount_amount
      )
    end,
    'discount', discount_amount,
    'final_subtotal', subtotal_amount - discount_amount,
    'shipping_rule', jsonb_build_object(
      'version', 2,
      'code', case
        when normalized_fulfillment_method = 'onsite_pickup' then 'onsite-pickup'
        when member_role in ('pro', 'instructor', 'distributor') then 'professional-threshold'
        else 'standard'
      end,
      'standard_fee', 120,
      'professional_minimum', 5000,
      'professional_free_shipping_threshold', 15000,
      'free_product_id', 9
    ),
    'shipping', shipping_amount,
    'total', total_amount
  );

  return jsonb_build_object(
    'member_role', member_role,
    'items', order_items,
    'subtotal', subtotal_amount,
    'discount', discount_amount,
    'shipping', shipping_amount,
    'total', total_amount,
    'fulfillment_method', normalized_fulfillment_method,
    'promotion_id', selected_promotion_id,
    'promotion_name', selected_promotion_name,
    'pricing_snapshot', pricing_snapshot
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_member_shopping_credit(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  account_available bigint := 0;
  account_reserved bigint := 0;
  ledger_available bigint := 0;
  ledger_reserved bigint := 0;
begin
  if auth.uid() is null or not public.has_backoffice_permission('shopping_credit.manage') then
    raise exception 'Shopping credit management permission required' using errcode = '42501';
  end if;

  select coalesce(max(account.available_balance), 0), coalesce(max(account.reserved_balance), 0)
  into account_available, account_reserved
  from public.shopping_credit_accounts account
  where account.user_id = p_user_id;

  select coalesce(sum(entry.available_delta), 0), coalesce(sum(entry.reserved_delta), 0)
  into ledger_available, ledger_reserved
  from public.shopping_credit_ledger entry
  where entry.user_id = p_user_id;

  return jsonb_build_object(
    'user_id', p_user_id,
    'account_available', account_available,
    'ledger_available', ledger_available,
    'account_reserved', account_reserved,
    'ledger_reserved', ledger_reserved,
    'matches', account_available = ledger_available and account_reserved = ledger_reserved
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_professional_sales_audit(p_action text, p_entity_type text, p_entity_id text, p_before jsonb, p_after jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
begin
  select admin_user.role
    into actor_role
  from public.admin_users admin_user
  where admin_user.user_id = actor_id
    and admin_user.active = true;

  insert into public.audit_logs (
    actor_user_id, actor_email, actor_role, actor_type,
    action, entity_type, entity_id, before_data, after_data, metadata
  ) values (
    actor_id,
    nullif(auth.jwt() ->> 'email', ''),
    actor_role,
    'admin',
    p_action,
    p_entity_type,
    p_entity_id,
    p_before,
    p_after,
    jsonb_build_object('source', 'professional-sales-opening-balance')
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.refund_order_shopping_credit(p_order_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  normalized_order_id text := btrim(coalesce(p_order_id, ''));
  reservation public.shopping_credit_order_reservations%rowtype;
  target_account public.shopping_credit_accounts%rowtype;
  next_available bigint;
begin
  select held.* into reservation
  from public.shopping_credit_order_reservations held
  where held.order_id = normalized_order_id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'already_processed', true, 'order_id', normalized_order_id, 'amount', 0);
  end if;
  if reservation.status = 'refunded' then
    return jsonb_build_object('ok', true, 'already_processed', true, 'order_id', normalized_order_id, 'amount', reservation.amount);
  end if;
  if reservation.status <> 'consumed' then
    raise exception 'Shopping credit use is not refundable' using errcode = '55000';
  end if;

  select account.* into target_account
  from public.shopping_credit_accounts account
  where account.user_id = reservation.user_id
  for update;
  if target_account.status <> 'active' then
    raise exception 'Member shopping credit account is unavailable' using errcode = '55000';
  end if;
  next_available := target_account.available_balance + reservation.amount;

  update public.shopping_credit_accounts
  set available_balance = next_available, version = version + 1, updated_at = now()
  where user_id = reservation.user_id;

  update public.shopping_credit_order_reservations
  set status = 'refunded', refunded_at = now(), updated_at = now(), version = version + 1
  where order_id = normalized_order_id;

  insert into public.shopping_credit_ledger (
    user_id, event_type, amount, available_delta, reserved_delta,
    available_balance_after, reserved_balance_after,
    order_id, reason_code, metadata
  ) values (
    reservation.user_id, 'refund', reservation.amount, reservation.amount, 0,
    next_available, target_account.reserved_balance,
    normalized_order_id, 'order_cancelled',
    jsonb_build_object('source', 'paid_order_cancellation')
  );

  return jsonb_build_object(
    'ok', true, 'already_processed', false,
    'order_id', normalized_order_id, 'amount', reservation.amount,
    'available_balance', next_available,
    'reserved_balance', target_account.reserved_balance
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.refund_shipping_group_fee(p_shipping_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_group public.shipping_groups%rowtype;
  original_order public.orders%rowtype;
  target_account public.shopping_credit_accounts%rowtype;
  effective_total numeric;
  refund_amount bigint;
  next_available bigint;
  ledger_id bigint;
begin
  select shipping_group.* into target_group
  from public.shipping_groups shipping_group
  where shipping_group.id = p_shipping_group_id
  for update;

  if not found then
    raise exception 'Shipping group not found' using errcode = 'P0002';
  end if;
  if target_group.shipping_refund_ledger_id is not null then
    return jsonb_build_object(
      'ok', true, 'already_processed', true,
      'amount', target_group.original_shipping_amount
    );
  end if;

  select coalesce(sum(public.shipping_group_effective_amount(target_order)), 0)
  into effective_total
  from public.orders target_order
  where target_order.shipping_group_id = target_group.id
    and public.is_shipping_group_valid_order_status(target_order.status);

  refund_amount := target_group.original_shipping_amount;
  if effective_total < 15000 or refund_amount <= 0 then
    return jsonb_build_object(
      'ok', true, 'already_processed', false, 'amount', 0,
      'effective_total', effective_total
    );
  end if;

  select * into original_order
  from public.orders target_order
  where target_order.id = target_group.original_order_id
    and target_order.user_id = target_group.user_id
    and public.is_shipping_group_valid_order_status(target_order.status);

  if not found then
    return jsonb_build_object(
      'ok', true, 'already_processed', false, 'amount', 0,
      'effective_total', effective_total
    );
  end if;

  insert into public.shopping_credit_accounts (user_id)
  values (target_group.user_id)
  on conflict (user_id) do nothing;

  select account.* into target_account
  from public.shopping_credit_accounts account
  where account.user_id = target_group.user_id
  for update;

  if target_account.status <> 'active' then
    raise exception 'Member shopping credit account is unavailable'
      using errcode = '55000';
  end if;

  next_available := target_account.available_balance + refund_amount;
  update public.shopping_credit_accounts
  set available_balance = next_available,
      version = version + 1,
      updated_at = now()
  where user_id = target_group.user_id;

  insert into public.shopping_credit_ledger (
    user_id, event_type, amount, available_delta, reserved_delta,
    available_balance_after, reserved_balance_after,
    order_id, reason_code, metadata
  ) values (
    target_group.user_id, 'grant', refund_amount, refund_amount, 0,
    next_available, target_account.reserved_balance,
    target_group.original_order_id, 'shipping_refund',
    jsonb_build_object(
      'source', 'shipping_group',
      'shipping_group_id', target_group.id,
      'original_order_id', target_group.original_order_id
    )
  )
  returning id into ledger_id;

  update public.shipping_groups
  set shipping_refund_ledger_id = ledger_id,
      shipping_refunded_at = now(),
      updated_at = now()
  where id = target_group.id;

  return jsonb_build_object(
    'ok', true, 'already_processed', false,
    'amount', refund_amount, 'effective_total', effective_total,
    'ledger_id', ledger_id
  );
exception
  when unique_violation then
    select entry.id into ledger_id
    from public.shopping_credit_ledger entry
    where entry.reason_code = 'shipping_refund'
      and entry.metadata ->> 'shipping_group_id' = p_shipping_group_id::text
    order by entry.id
    limit 1;

    if ledger_id is null then
      raise;
    end if;

    update public.shipping_groups
    set shipping_refund_ledger_id = ledger_id,
        shipping_refunded_at = coalesce(shipping_refunded_at, now()),
        updated_at = now()
    where id = p_shipping_group_id
      and shipping_refund_ledger_id is null;

    return jsonb_build_object(
      'ok', true, 'already_processed', true,
      'amount', target_group.original_shipping_amount,
      'ledger_id', ledger_id
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.release_assisted_inventory(target_order_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  allocation record;
begin
  perform 1
  from public.product_variants variant
  where variant.id in (
    select item.product_variant_id
    from public.order_inventory_allocations item
    where item.order_id = target_order_id and item.state <> 'released'
  )
  order by variant.id
  for update;

  for allocation in
    select *
    from public.order_inventory_allocations
    where order_id = target_order_id and state <> 'released'
    order by product_variant_id, item_index
    for update
  loop
    if allocation.stock_deducted_qty > 0 then
      if allocation.line_type = 'gift' then
        update public.product_variants
        set gift_stock = gift_stock + allocation.stock_deducted_qty
        where id = allocation.product_variant_id;
      else
        update public.product_variants
        set stock = stock + allocation.stock_deducted_qty
        where id = allocation.product_variant_id;
      end if;

      insert into public.inventory_allocation_events (
        allocation_id, order_id, product_variant_id, event_type, quantity, actor_user_id
      ) values (
        allocation.id, target_order_id, allocation.product_variant_id,
        'release', allocation.stock_deducted_qty, auth.uid()
      );
    end if;

    update public.order_inventory_allocations
    set released_qty = released_qty + allocated_qty,
        allocated_qty = 0,
        backorder_qty = 0,
        stock_deducted_qty = 0,
        state = 'released',
        released_at = now(),
        updated_at = now()
    where id = allocation.id;

    if allocation.line_type <> 'gift' then
      perform public.sync_product_stock_mirror(allocation.product_id);
    end if;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.release_inventory_for_order(target_order_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  allocation record;
begin
  -- Match the payment/FIFO lock order: variants first, allocations second.
  perform 1
  from public.product_variants variant
  where variant.id in (
    select item.product_variant_id
    from public.order_inventory_allocations item
    where item.order_id = target_order_id
      and item.state <> 'released'
  )
  order by variant.id
  for update;

  for allocation in
    select *
    from public.order_inventory_allocations
    where order_id = target_order_id
      and state <> 'released'
    order by product_variant_id, item_index
    for update
  loop
    if allocation.stock_deducted_qty > 0 then
      update public.product_variants
      set stock = stock + allocation.stock_deducted_qty
      where id = allocation.product_variant_id;

      insert into public.inventory_allocation_events (
        allocation_id, order_id, product_variant_id, event_type, quantity, actor_user_id
      ) values (
        allocation.id, target_order_id, allocation.product_variant_id,
        'release', allocation.stock_deducted_qty, auth.uid()
      );
    end if;

    update public.order_inventory_allocations
    set
      released_qty = released_qty + allocated_qty,
      allocated_qty = 0,
      backorder_qty = 0,
      stock_deducted_qty = 0,
      state = 'released',
      released_at = now(),
      updated_at = now()
    where id = allocation.id;

    perform public.sync_product_stock_mirror(allocation.product_id);
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.release_order_shopping_credit(p_order_id text, p_reason_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  normalized_order_id text := btrim(coalesce(p_order_id, ''));
  normalized_reason text := lower(btrim(coalesce(p_reason_code, '')));
  reservation public.shopping_credit_order_reservations%rowtype;
  target_account public.shopping_credit_accounts%rowtype;
  next_available bigint;
  next_reserved bigint;
begin
  if normalized_reason not in ('order_cancelled', 'order_expired', 'payment_failed') then
    raise exception 'Invalid shopping credit release reason' using errcode = '22023';
  end if;

  select held.* into reservation
  from public.shopping_credit_order_reservations held
  where held.order_id = normalized_order_id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'already_processed', true, 'order_id', normalized_order_id, 'amount', 0);
  end if;
  if reservation.status = 'released' then
    return jsonb_build_object('ok', true, 'already_processed', true, 'order_id', normalized_order_id, 'amount', reservation.amount);
  end if;
  if reservation.status <> 'reserved' then
    raise exception 'Shopping credit reservation is not releasable' using errcode = '55000';
  end if;

  select account.* into target_account
  from public.shopping_credit_accounts account
  where account.user_id = reservation.user_id
  for update;

  if target_account.reserved_balance < reservation.amount then
    raise exception 'Shopping credit reserved balance is inconsistent' using errcode = '23514';
  end if;
  next_available := target_account.available_balance + reservation.amount;
  next_reserved := target_account.reserved_balance - reservation.amount;

  update public.shopping_credit_accounts
  set available_balance = next_available, reserved_balance = next_reserved,
      version = version + 1, updated_at = now()
  where user_id = reservation.user_id;

  update public.shopping_credit_order_reservations
  set status = 'released', released_at = now(), updated_at = now(), version = version + 1
  where order_id = normalized_order_id;

  insert into public.shopping_credit_ledger (
    user_id, event_type, amount, available_delta, reserved_delta,
    available_balance_after, reserved_balance_after,
    order_id, reason_code, metadata
  ) values (
    reservation.user_id, 'release', reservation.amount, reservation.amount, -reservation.amount,
    next_available, next_reserved, normalized_order_id, normalized_reason,
    jsonb_build_object('source', 'order_lifecycle')
  );

  return jsonb_build_object(
    'ok', true, 'already_processed', false,
    'order_id', normalized_order_id, 'amount', reservation.amount,
    'available_balance', next_available, 'reserved_balance', next_reserved
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_order_shopping_credit(p_user_id uuid, p_order_id text, p_amount bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  normalized_order_id text := btrim(coalesce(p_order_id, ''));
  target_account public.shopping_credit_accounts%rowtype;
  existing_reservation public.shopping_credit_order_reservations%rowtype;
  next_available bigint;
  next_reserved bigint;
begin
  if p_user_id is null or normalized_order_id = '' or p_amount is null or p_amount <= 0 then
    raise exception 'Invalid shopping credit reservation' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.orders target_order
    where target_order.id = normalized_order_id
      and target_order.user_id = p_user_id
  ) then
    raise exception 'Shopping credit order does not belong to the member'
      using errcode = '42501';
  end if;

  insert into public.shopping_credit_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select account.* into target_account
  from public.shopping_credit_accounts account
  where account.user_id = p_user_id
  for update;

  if target_account.status <> 'active' then
    raise exception 'Member shopping credit account is unavailable' using errcode = '55000';
  end if;

  select reservation.* into existing_reservation
  from public.shopping_credit_order_reservations reservation
  where reservation.order_id = normalized_order_id
  for update;

  if found then
    if existing_reservation.user_id = p_user_id
      and existing_reservation.amount = p_amount
      and existing_reservation.status in ('reserved', 'consumed')
    then
      return jsonb_build_object(
        'ok', true, 'already_processed', true,
        'order_id', existing_reservation.order_id,
        'status', existing_reservation.status,
        'amount', existing_reservation.amount
      );
    end if;
    raise exception 'Order shopping credit reservation conflicts with existing data'
      using errcode = '23505';
  end if;

  if target_account.available_balance < p_amount then
    raise exception 'Insufficient available shopping credit' using errcode = '22003';
  end if;

  next_available := target_account.available_balance - p_amount;
  next_reserved := target_account.reserved_balance + p_amount;

  update public.shopping_credit_accounts
  set available_balance = next_available,
      reserved_balance = next_reserved,
      version = version + 1,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.shopping_credit_order_reservations (order_id, user_id, amount)
  values (normalized_order_id, p_user_id, p_amount);

  insert into public.shopping_credit_ledger (
    user_id, event_type, amount, available_delta, reserved_delta,
    available_balance_after, reserved_balance_after,
    order_id, reason_code, metadata
  ) values (
    p_user_id, 'reserve', p_amount, -p_amount, p_amount,
    next_available, next_reserved,
    normalized_order_id, 'order_checkout',
    jsonb_build_object('source', 'order_creation')
  );

  return jsonb_build_object(
    'ok', true, 'already_processed', false,
    'order_id', normalized_order_id, 'status', 'reserved', 'amount', p_amount,
    'available_balance', next_available, 'reserved_balance', next_reserved
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_assisted_payment_claim(p_order_id text, p_payment_token text, p_outcome text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if p_outcome not in ('success','rejected') or p_outcome is null then raise exception 'Invalid claim outcome'; end if;
  update public.order_payment_authorizations payment_auth set
    claimed_at=case when p_outcome='rejected' then null else claimed_at end,
    gateway_created_at=case when p_outcome='success' then coalesce(gateway_created_at,now()) else gateway_created_at end
  where payment_auth.order_id=p_order_id and payment_auth.token_hash=encode(digest(p_payment_token,'sha256'),'hex')
    and exists(select 1 from public.orders where id=p_order_id and order_source='admin_assisted');
  if not found then raise exception 'Invalid assisted payment claim' using errcode='42501'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_product_price_multiplier(p_product products, p_role text, p_default numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_role
    when 'instructor' then coalesce(p_product.instructor_price_multiplier, p_default)
    when 'distributor' then coalesce(p_product.distributor_price_multiplier, p_default)
    when 'staff' then coalesce(p_product.staff_price_multiplier, p_default)
    else p_default end;
$function$;

CREATE OR REPLACE FUNCTION public.review_professional_award_evidence(p_evidence_id uuid, p_status text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target public.professional_award_evidence%rowtype;
begin
  if not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'rejected') then
    raise exception 'Invalid evidence review status' using errcode = '22023';
  end if;
  if p_status = 'rejected' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A rejection reason is required' using errcode = '22023';
  end if;

  select * into target
  from public.professional_award_evidence evidence
  where evidence.id = p_evidence_id
  for update;
  if not found then
    raise exception 'Award evidence not found' using errcode = 'P0002';
  end if;

  update public.professional_award_evidence
  set status = p_status,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = target.id;

  perform public.record_professional_sales_audit(
    'professional_award_evidence.reviewed',
    'professional_award_evidence',
    target.id::text,
    jsonb_build_object('status', target.status),
    jsonb_build_object('status', p_status, 'reason', nullif(btrim(coalesce(p_reason, '')), ''))
  );

  return jsonb_build_object('id', target.id, 'status', p_status);
end;
$function$;

CREATE OR REPLACE FUNCTION public.review_professional_renewal_application(p_application_id uuid, p_decision text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target public.professional_renewal_applications%rowtype;
  renewal_start date;
  approved_evidence_count integer;
  path text;
  existing_renewal_membership uuid;
begin
  if not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid renewal decision' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A review reason is required' using errcode = '22023';
  end if;

  select * into target
  from public.professional_renewal_applications application
  where application.id = p_application_id
  for update;
  if not found then
    raise exception 'Renewal application not found' using errcode = 'P0002';
  end if;
  if target.status <> 'pending_review' or target.finalized_at is null then
    raise exception 'Renewal application is not ready for review' using errcode = '22023';
  end if;

  renewal_start := make_date(target.renewal_year, 1, 1);
  if (now() at time zone 'Asia/Taipei')::date < renewal_start then
    raise exception 'Renewal cannot be reviewed before the renewal year' using errcode = '22023';
  end if;

  perform 1 from public.profiles profile
  where profile.id = target.user_id and profile.role = target.role for update;
  if not found then
    raise exception 'Member qualification has changed; refresh and verify membership history' using errcode = '22023';
  end if;
  perform 1 from public.professional_memberships membership
  where membership.user_id = target.user_id and membership.role = target.role
    and membership.started_on < renewal_start and membership.ended_on is null for update;
  if not found then
    raise exception 'Member qualification has changed; refresh and verify membership history' using errcode = '22023';
  end if;

  select count(distinct lower(regexp_replace(btrim(evidence.student_name), '\s+', '', 'g')))::integer
    into approved_evidence_count
  from public.professional_award_evidence evidence
  where evidence.user_id = target.user_id
    and evidence.assessment_year = target.assessment_year
    and evidence.status = 'approved';

  if p_decision = 'approved' then
    if target.a_qualified is true then
      path := case
        when coalesce((target.assessment_snapshot ->> 'quarterly_route_qualified')::boolean, false)
          then 'a_quarterly'
        else 'a_annual'
      end;
    elsif approved_evidence_count >= 8 then
      path := 'b_manual';
    else
      raise exception 'Neither renewal condition A nor B has been confirmed' using errcode = '22023';
    end if;
  end if;

  perform set_config('app.eclado_allow_profile_security_update', 'true', true);
  if p_decision = 'approved' then
    update public.professional_memberships
    set ended_on = renewal_start
    where user_id = target.user_id
      and role in ('instructor', 'distributor')
      and started_on < renewal_start
      and (ended_on is null or ended_on > renewal_start);

    select membership.id into existing_renewal_membership
    from public.professional_memberships membership
    where membership.user_id = target.user_id
      and membership.started_on = renewal_start
      and membership.role = target.role
    limit 1;

    if existing_renewal_membership is null then
      insert into public.professional_memberships (
        user_id, role, started_on, change_reason, created_by
      ) values (
        target.user_id, target.role, renewal_start,
        'annual_renewal_' || path, auth.uid()
      ) returning id into existing_renewal_membership;
    else
      update public.professional_memberships
      set ended_on = null,
          change_reason = 'annual_renewal_' || path
      where id = existing_renewal_membership;
    end if;

    update public.profiles set role = target.role where id = target.user_id;
  else
    update public.professional_memberships
    set ended_on = (now() at time zone 'Asia/Taipei')::date
    where user_id = target.user_id
      and role in ('instructor', 'distributor')
      and started_on < renewal_start
      and (ended_on is null or ended_on > renewal_start);
    update public.profiles set role = 'pro' where id = target.user_id;
  end if;
  perform set_config('app.eclado_allow_profile_security_update', 'false', true);

  update public.professional_renewal_applications
  set status = p_decision,
      qualification_path = path,
      b_approved_count = approved_evidence_count,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      decision_reason = btrim(p_reason),
      result_notification_sent_at = null,
      result_notification_channel = null,
      result_notification_error = null
  where id = target.id;

  perform public.record_professional_sales_audit(
    'professional_renewals.reviewed',
    'professional_renewal_applications', target.id::text,
    jsonb_build_object('status', target.status, 'role', target.role),
    jsonb_build_object(
      'status', p_decision,
      'qualification_path', path,
      'b_approved_count', approved_evidence_count,
      'reason', btrim(p_reason)
    )
  );

  return jsonb_build_object(
    'id', target.id,
    'status', p_decision,
    'qualification_path', path,
    'b_approved_count', approved_evidence_count,
    'membership_id', existing_renewal_membership
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sanitize_public_order_quote(p_quote jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  sanitized jsonb := p_quote;
  sanitized_items jsonb;
begin
  if sanitized is null then
    return null;
  end if;

  if jsonb_typeof(sanitized -> 'items') = 'array' then
    select coalesce(
      jsonb_agg(item - 'professional_price' - 'apply_tier_multiplier'),
      '[]'::jsonb
    )
    into sanitized_items
    from jsonb_array_elements(sanitized -> 'items') item;
    sanitized := jsonb_set(sanitized, '{items}', sanitized_items, true);
  end if;

  if jsonb_typeof(sanitized #> '{pricing_snapshot,items}') = 'array' then
    select coalesce(
      jsonb_agg(item - 'professional_price' - 'apply_tier_multiplier'),
      '[]'::jsonb
    )
    into sanitized_items
    from jsonb_array_elements(sanitized #> '{pricing_snapshot,items}') item;
    sanitized := jsonb_set(sanitized, '{pricing_snapshot,items}', sanitized_items, true);
  end if;

  return sanitized;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_coupon_campaign(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  target_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  promotion_id uuid;
  position integer := 0;
  audience_mode_value text := coalesce(nullif(p_payload ->> 'audience_mode', ''), 'roles');
  audience_role_values text[];
  selected_member_ids uuid[];
begin
  if not public.has_backoffice_permission('promotions.manage') then raise exception 'Promotion management access required' using errcode = '42501'; end if;
  if nullif(btrim(p_payload ->> 'name'), '') is null or nullif(btrim(p_payload ->> 'code'), '') is null then raise exception 'Coupon name and code are required' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p_payload -> 'promotion_ids', '[]'::jsonb)) = 0 then raise exception 'Choose at least one coupon activity' using errcode = '22023'; end if;
  if audience_mode_value not in ('roles', 'members') then raise exception 'Invalid coupon audience mode' using errcode = '22023'; end if;

  select coalesce(array_agg(distinct role_name), '{}'::text[])
  into audience_role_values
  from jsonb_array_elements_text(coalesce(p_payload -> 'audience_roles', '[]'::jsonb)) role_name;

  select coalesce(array_agg(distinct member_id), '{}'::uuid[])
  into selected_member_ids
  from (
    select value::uuid as member_id
    from jsonb_array_elements_text(coalesce(p_payload -> 'member_ids', '[]'::jsonb))
  ) selected;

  if audience_mode_value = 'roles' and cardinality(audience_role_values) = 0 then
    raise exception 'Choose at least one member role' using errcode = '22023';
  end if;
  if audience_mode_value = 'members' and cardinality(selected_member_ids) = 0 then
    raise exception 'Choose at least one member' using errcode = '22023';
  end if;
  if audience_mode_value = 'members' and exists (
    select 1
    from unnest(selected_member_ids) as selected(member_id)
    where not exists (
      select 1
      from public.profiles profile
      where profile.id = selected.member_id
    )
  ) then
    raise exception 'Selected member not found' using errcode = '22023';
  end if;
  if target_id is null then
    insert into public.coupon_campaigns (name, description, code, code_normalized, start_at, end_at, active, total_usage_limit, per_member_limit, audience_mode, audience_roles, allow_guest, stacking_policy, created_by, updated_by)
    values (btrim(p_payload ->> 'name'), nullif(btrim(p_payload ->> 'description'), ''), btrim(p_payload ->> 'code'), upper(btrim(p_payload ->> 'code')), nullif(p_payload ->> 'start_at', '')::timestamptz, nullif(p_payload ->> 'end_at', '')::timestamptz, coalesce((p_payload ->> 'active')::boolean, true), nullif(p_payload ->> 'total_usage_limit', '')::integer, nullif(p_payload ->> 'per_member_limit', '')::integer, audience_mode_value, case when audience_mode_value = 'roles' then audience_role_values else '{}'::text[] end, case when audience_mode_value = 'roles' then coalesce((p_payload ->> 'allow_guest')::boolean, true) else false end, coalesce(p_payload ->> 'stacking_policy', 'allow_auto_gifts'), auth.uid(), auth.uid()) returning id into target_id;
  else
    update public.coupon_campaigns set name = btrim(p_payload ->> 'name'), description = nullif(btrim(p_payload ->> 'description'), ''), code = btrim(p_payload ->> 'code'), start_at = nullif(p_payload ->> 'start_at', '')::timestamptz, end_at = nullif(p_payload ->> 'end_at', '')::timestamptz, active = coalesce((p_payload ->> 'active')::boolean, true), total_usage_limit = nullif(p_payload ->> 'total_usage_limit', '')::integer, per_member_limit = nullif(p_payload ->> 'per_member_limit', '')::integer, audience_mode = audience_mode_value, audience_roles = case when audience_mode_value = 'roles' then audience_role_values else '{}'::text[] end, allow_guest = case when audience_mode_value = 'roles' then coalesce((p_payload ->> 'allow_guest')::boolean, true) else false end, stacking_policy = coalesce(p_payload ->> 'stacking_policy', 'allow_auto_gifts'), updated_by = auth.uid()
    where id = target_id and archived_at is null;
    if not found then raise exception 'Coupon campaign not found' using errcode = 'P0002'; end if;
    delete from public.coupon_promotions link where link.coupon_campaign_id = target_id;
  end if;
  for promotion_id in select jsonb_array_elements_text(p_payload -> 'promotion_ids')::uuid loop
    insert into public.coupon_promotions (coupon_campaign_id, promotion_id, sort_order) values (target_id, promotion_id, position);
    position := position + 1;
  end loop;
  delete from public.coupon_campaign_members target
  where target.coupon_campaign_id = target_id
    and (audience_mode_value = 'roles' or not (target.user_id = any(selected_member_ids)));
  if audience_mode_value = 'members' then
    insert into public.coupon_campaign_members (coupon_campaign_id, user_id, created_by)
    select target_id, member_id, auth.uid()
    from unnest(selected_member_ids) member_id
    on conflict (coupon_campaign_id, user_id) do nothing;
  end if;
  return target_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_discount_promotion(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  target_id uuid := nullif(p_payload->>'id','')::uuid;
  benefit text := p_payload->>'benefit_type'; activation text := p_payload->>'activation_type';
  scope_type text := coalesce(p_payload->>'scope_type','all_regular'); target_product_id integer;
  gift_variant bigint := nullif(p_payload->>'gift_variant_id','')::bigint;
  threshold_kind text;
begin
  threshold_kind := case
    when benefit = 'quantity_gift' then 'quantity'
    when benefit = 'amount_gift' then 'amount'
    else coalesce(nullif(p_payload->>'threshold_type',''), 'amount')
  end;
  if not public.has_backoffice_permission('promotions.manage') then raise exception 'Promotion management access required' using errcode='42501'; end if;
  if nullif(btrim(p_payload->>'name'),'') is null then raise exception 'Promotion name is required' using errcode='22023'; end if;
  if benefit not in ('percentage_discount','fixed_discount','amount_gift','quantity_gift')
    or activation not in ('automatic','coupon_only') or scope_type not in ('all_regular','all_sellable','products')
    then raise exception 'Invalid promotion configuration' using errcode='22023'; end if;
  if threshold_kind not in ('amount','quantity') then raise exception 'Invalid promotion threshold type' using errcode='22023'; end if;
  if threshold_kind = 'quantity' and nullif(p_payload->>'threshold_value','') is not null
    and (p_payload->>'threshold_value')::numeric <> trunc((p_payload->>'threshold_value')::numeric)
    then raise exception 'Quantity threshold must be a whole number' using errcode='22023'; end if;
  if benefit in ('amount_gift','quantity_gift') then
    if coalesce((p_payload->>'threshold_value')::numeric,0)<=0 or coalesce((p_payload->>'gift_quantity')::integer,0)<=0 then raise exception 'Gift threshold and quantity are required' using errcode='22023'; end if;
    if not exists(select 1 from public.product_variants variant join public.products product on product.id=variant.product_id where variant.id=gift_variant and variant.active=true and variant.gift_enabled=true and product.publication_status in ('active','event_only','gift_only')) then raise exception 'Gift must use enabled gift inventory' using errcode='22023'; end if;
  end if;
  if benefit='percentage_discount' and coalesce((p_payload->>'discount_rate')::numeric,1) not between 0 and 1 then raise exception 'Discount rate must be between 0 and 1' using errcode='22023'; end if;
  if benefit='fixed_discount' and coalesce((p_payload->>'discount_amount')::numeric,0)<=0 then raise exception 'Discount amount must be greater than zero' using errcode='22023'; end if;
  if scope_type='products' and jsonb_array_length(coalesce(p_payload->'product_ids','[]'::jsonb))=0 then raise exception 'Choose at least one product' using errcode='22023'; end if;

  if target_id is null then
    insert into public.promotions(name,description,product_ids,discount_rate,discount_amount,discount_order,start_at,end_at,active,benefit_type,activation_type,threshold_value,threshold_type,threshold_basis,gift_variant_id,gift_quantity,repeat_mode,priority)
    values(btrim(p_payload->>'name'),nullif(btrim(p_payload->>'description'),''),array(select jsonb_array_elements_text(coalesce(p_payload->'product_ids','[]'::jsonb))::integer),case when benefit='percentage_discount' then (p_payload->>'discount_rate')::numeric else 1 end,case when benefit='fixed_discount' then (p_payload->>'discount_amount')::numeric else 0 end,'rate_then_amount',nullif(p_payload->>'start_at','')::timestamptz,nullif(p_payload->>'end_at','')::timestamptz,coalesce((p_payload->>'active')::boolean,true),benefit,activation,nullif(p_payload->>'threshold_value','')::numeric,threshold_kind,case when benefit in ('percentage_discount','fixed_discount') and threshold_kind='amount' and nullif(p_payload->>'threshold_value','') is not null then coalesce(nullif(p_payload->>'threshold_basis',''),'before_bundle_discount') end,case when benefit in ('amount_gift','quantity_gift') then gift_variant end,case when benefit in ('amount_gift','quantity_gift') then (p_payload->>'gift_quantity')::integer end,coalesce(nullif(p_payload->>'repeat_mode',''),'once'),coalesce((p_payload->>'priority')::integer,100)) returning id into target_id;
  else
    update public.promotions set name=btrim(p_payload->>'name'),description=nullif(btrim(p_payload->>'description'),''),product_ids=array(select jsonb_array_elements_text(coalesce(p_payload->'product_ids','[]'::jsonb))::integer),discount_rate=case when benefit='percentage_discount' then (p_payload->>'discount_rate')::numeric else 1 end,discount_amount=case when benefit='fixed_discount' then (p_payload->>'discount_amount')::numeric else 0 end,start_at=nullif(p_payload->>'start_at','')::timestamptz,end_at=nullif(p_payload->>'end_at','')::timestamptz,active=coalesce((p_payload->>'active')::boolean,true),benefit_type=benefit,activation_type=activation,threshold_value=nullif(p_payload->>'threshold_value','')::numeric,threshold_type=threshold_kind,threshold_basis=case when benefit in ('percentage_discount','fixed_discount') and threshold_kind='amount' and nullif(p_payload->>'threshold_value','') is not null then coalesce(nullif(p_payload->>'threshold_basis',''),'before_bundle_discount') end,gift_variant_id=case when benefit in ('amount_gift','quantity_gift') then gift_variant end,gift_quantity=case when benefit in ('amount_gift','quantity_gift') then (p_payload->>'gift_quantity')::integer end,repeat_mode=coalesce(nullif(p_payload->>'repeat_mode',''),'once'),priority=coalesce((p_payload->>'priority')::integer,100)
    where id=target_id and archived_at is null;
    if not found then raise exception 'Promotion not found' using errcode='P0002'; end if;
    delete from public.promotion_scopes where promotion_id=target_id;
  end if;
  if scope_type in ('all_regular','all_sellable') then
    insert into public.promotion_scopes(promotion_id,scope_role,target_type) values(target_id,'qualification',scope_type),(target_id,'benefit',scope_type);
  else
    for target_product_id in select jsonb_array_elements_text(p_payload->'product_ids')::integer loop
      insert into public.promotion_scopes(promotion_id,scope_role,target_type,product_id) values(target_id,'qualification','product',target_product_id),(target_id,'benefit','product',target_product_id);
    end loop;
  end if;
  return target_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_instructor_student_binding(p_student_id uuid, p_instructor_id uuid, p_expected_binding_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.instructor_student_bindings%rowtype; student_role text; new_binding_id uuid;
begin
  perform public.assert_instructor_student_admin(true);
  if p_action is null or p_action not in ('bind','unbind','rebind') or p_student_id is null
    or (p_action='unbind' and p_instructor_id is not null)
    or (p_action<>'unbind' and p_instructor_id is null) then
    raise exception '師生異動參數無效' using errcode='22023';
  end if;
  if p_student_id=p_instructor_id then raise exception '學生不能綁定自己' using errcode='22023'; end if;
  -- Same sorted profile locks serialize competing student writes, role changes
  -- and deletion. Deletion cleanup never acquires other profile locks.
  perform 1 from public.profiles where id in (p_student_id,p_instructor_id) order by id for update;
  select role into student_role from public.profiles where id=p_student_id;
  if not found then raise exception '學生會員不存在' using errcode='22023'; end if;
  select * into previous from public.instructor_student_bindings where student_id=p_student_id and ended_at is null for update;
  if p_expected_binding_id is distinct from previous.id then
    raise exception '綁定已被其他管理員修改，請重新載入' using errcode='40001';
  end if;
  if p_action='bind' and previous.id is not null then
    raise exception '學生已有有效老師，請使用更換老師' using errcode='22023';
  end if;
  if p_action<>'bind' and previous.id is null then raise exception '學生目前沒有綁定' using errcode='22023'; end if;
  if p_action='bind' and student_role<>'pro' then raise exception '學生必須是 pro 美容師' using errcode='22023'; end if;
  if p_action<>'unbind' then
    if not exists(select 1 from public.profiles where id=p_instructor_id and role='instructor') then
      raise exception '新老師目前不是師資' using errcode='22023';
    end if;
    if not exists(select 1 from public.instructor_student_settings where instructor_id=p_instructor_id and student_price_type is not null) then
      raise exception '老師尚未設定學生價格類型' using errcode='22023';
    end if;
    if previous.instructor_id=p_instructor_id then raise exception '新老師與原老師相同' using errcode='22023'; end if;
  end if;
  if previous.id is not null then
    update public.instructor_student_bindings set ended_at=now(),ended_by=auth.uid(),
      end_reason=case when p_action='unbind' then 'unbound' else 'rebound' end where id=previous.id;
  end if;
  if p_action<>'unbind' then
    insert into public.instructor_student_bindings(student_id,instructor_id,created_by)
    values(p_student_id,p_instructor_id,auth.uid()) returning id into new_binding_id;
  end if;
  insert into public.instructor_student_audit_logs(event_type,student_id,instructor_id,previous_instructor_id,
    actor_user_id,actor_kind,before_data,after_data)
  values(p_action,p_student_id,p_instructor_id,previous.instructor_id,auth.uid(),'admin',
    jsonb_build_object('binding_id',previous.id,'instructor_id',previous.instructor_id),
    jsonb_build_object('binding_id',new_binding_id,'instructor_id',p_instructor_id));
  return public.get_admin_instructor_student_member(p_student_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_member_admin_note(p_user_id uuid, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  actor_email text := nullif(auth.jwt() ->> 'email', '');
  actor_role text;
  clean_note text := nullif(btrim(coalesce(p_note, '')), '');
  previous public.member_admin_notes%rowtype;
begin
  if not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if clean_note is not null and char_length(clean_note) > 1000 then
    raise exception 'Note is longer than 1000 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles profile where profile.id = p_user_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  select * into previous
  from public.member_admin_notes
  where user_id = p_user_id
  for update;

  if previous.note is not distinct from clean_note then
    return jsonb_build_object('user_id', p_user_id, 'note', clean_note, 'changed', false);
  end if;

  if clean_note is null then
    delete from public.member_admin_notes where user_id = p_user_id;
  else
    insert into public.member_admin_notes (user_id, note, updated_by, updated_by_email)
    values (p_user_id, clean_note, actor_id, actor_email)
    on conflict (user_id) do update
      set note = excluded.note,
          updated_by = excluded.updated_by,
          updated_by_email = excluded.updated_by_email;
  end if;

  select admin_user.role
    into actor_role
  from public.admin_users admin_user
  where admin_user.user_id = actor_id
    and admin_user.active = true;

  insert into public.audit_logs (
    actor_user_id, actor_email, actor_role, actor_type,
    action, entity_type, entity_id, before_data, after_data, metadata
  ) values (
    actor_id,
    actor_email,
    actor_role,
    'admin',
    'profiles.admin_note_saved',
    'profiles',
    p_user_id::text,
    case when previous.user_id is null then null else jsonb_build_object('note', previous.note) end,
    case when clean_note is null then null else jsonb_build_object('note', clean_note) end,
    jsonb_build_object('source', 'member-admin-note')
  );

  return jsonb_build_object('user_id', p_user_id, 'note', clean_note, 'changed', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_member_pricing(p_multipliers jsonb, p_expected_multipliers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare role_name text; multiplier numeric; previous_values jsonb;
begin
  if auth.uid() is null or not public.has_backoffice_permission('member_pricing.manage') then
    raise exception 'Member pricing manage access required' using errcode='42501';
  end if;
  if p_multipliers is null or jsonb_typeof(p_multipliers) <> 'object'
    or (select count(*) from jsonb_object_keys(p_multipliers)) <> 3 then
    raise exception 'Exactly three pricing roles are required' using errcode='22023';
  end if;
  foreach role_name in array array['instructor','distributor','staff'] loop
    if jsonb_typeof(p_multipliers -> role_name) is distinct from 'number' then
      raise exception 'Each multiplier must be numeric' using errcode='22023';
    end if;
    multiplier := (p_multipliers ->> role_name)::numeric;
    if multiplier <= 0 or multiplier > 1 or multiplier <> round(multiplier,3) then
      raise exception 'Fold must be greater than 0, at most 10, with at most two decimal places' using errcode='22023';
    end if;
  end loop;
  -- Consistent lock order; atomic comparison/update across all three roles.
  perform 1 from public.membership_tiers where role in ('instructor','distributor','staff') order by role for update;
  previous_values := public.member_pricing_defaults();
  if previous_values is distinct from p_expected_multipliers then
    raise exception 'Pricing settings changed; reload before saving' using errcode='40001';
  end if;
  if (select count(*) from public.membership_tiers where role in ('instructor','distributor','staff') and active) <> 3 then
    raise exception 'Pricing roles are incomplete';
  end if;
  update public.membership_tiers set professional_price_multiplier=(p_multipliers ->> role)::numeric, updated_at=now()
  where role in ('instructor','distributor','staff') and professional_price_multiplier is distinct from (p_multipliers ->> role)::numeric;
  return jsonb_build_object('multipliers', public.member_pricing_defaults());
end $function$;

CREATE OR REPLACE FUNCTION public.save_order_invoice_number(p_order_id text, p_invoice_number text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  normalized_invoice_number text := nullif(upper(btrim(coalesce(p_invoice_number, ''))), '');
begin
  if auth.uid() is null or not public.has_backoffice_permission('orders.write') then
    raise exception 'Order write permission required' using errcode = '42501';
  end if;
  if normalized_invoice_number is not null and char_length(normalized_invoice_number) > 40 then
    raise exception 'Invoice number is too long' using errcode = '22023';
  end if;

  update public.orders
  set invoice_number = normalized_invoice_number
  where id = p_order_id;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  return normalized_invoice_number;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_procurement_address(p_address jsonb)
 RETURNS procurement_addresses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  address_id bigint := nullif(p_address ->> 'id', '')::bigint;
  saved public.procurement_addresses%rowtype;
  make_default boolean := coalesce((p_address ->> 'is_default')::boolean, false);
begin
  if not public.is_eclado_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if btrim(coalesce(p_address ->> 'address_text', '')) = '' then
    raise exception 'Shipping address is required' using errcode = '22023';
  end if;
  if make_default then
    update public.procurement_addresses set is_default = false where is_default is true;
  end if;

  if address_id is null then
    insert into public.procurement_addresses (
      address_text, is_default, active, created_by
    ) values (
      btrim(p_address ->> 'address_text'), make_default, true, auth.uid()
    ) returning * into saved;
  else
    update public.procurement_addresses set
      address_text = btrim(p_address ->> 'address_text'),
      is_default = make_default,
      active = true
    where id = address_id
    returning * into saved;
    if saved.id is null then raise exception 'Address not found' using errcode = 'P0002'; end if;
  end if;
  return saved;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_product_images(p_product_id integer, p_images jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  product_row public.products%rowtype;
  image_input jsonb;
  image_position bigint;
  image_id uuid;
  saved_image_ids uuid[] := '{}'::uuid[];
  active_primary_count integer := 0;
  normalized_path text;
  normalized_active boolean;
  normalized_primary boolean;
  response_images jsonb;
begin
  if auth.role() <> 'service_role'
    and (auth.uid() is null or not public.has_backoffice_permission('catalog.write'))
  then
    raise exception 'Administrator authorization required' using errcode = '42501';
  end if;
  if p_images is null or jsonb_typeof(p_images) <> 'array' then
    raise exception 'Images payload must be an array' using errcode = '22023';
  end if;

  select * into product_row
  from public.products
  where id = p_product_id
  for update;
  if not found then
    raise exception 'Product % not found', p_product_id using errcode = 'P0002';
  end if;

  for image_input, image_position in
    select value, ordinality
    from jsonb_array_elements(p_images) with ordinality
  loop
    normalized_path := nullif(trim(image_input ->> 'storage_path'), '');
    normalized_active := coalesce((image_input ->> 'active')::boolean, true);
    normalized_primary := coalesce((image_input ->> 'is_primary')::boolean, false);

    if normalized_path is null
      or split_part(normalized_path, '/', 1) <> 'products'
      or split_part(normalized_path, '/', 2) <> product_row.asset_key::text
    then
      raise exception 'Image % does not belong to product asset key', image_position
        using errcode = '22023';
    end if;
    if normalized_active and normalized_primary then
      active_primary_count := active_primary_count + 1;
    end if;

    if nullif(trim(image_input ->> 'id'), '') is not null then
      image_id := (image_input ->> 'id')::uuid;
      if image_id = any(saved_image_ids) then
        raise exception 'Image % is repeated in payload', image_id
          using errcode = '23505';
      end if;
      if not exists (
        select 1 from public.product_images
        where id = image_id and product_id = p_product_id
      ) then
        raise exception 'Image % does not belong to product %', image_id, p_product_id
          using errcode = '42501';
      end if;
      saved_image_ids := array_append(saved_image_ids, image_id);
    end if;
  end loop;

  if jsonb_array_length(p_images) > 0 and active_primary_count <> 1 then
    raise exception 'Product must have exactly one active primary image'
      using errcode = '22023';
  end if;

  -- Clear the previous primary first to avoid the partial unique index while
  -- another image becomes primary in the same transaction.
  update public.product_images
  set is_primary = false, updated_at = now()
  where product_id = p_product_id;

  update public.product_images
  set active = false, is_primary = false, updated_at = now()
  where product_id = p_product_id
    and not (id = any(saved_image_ids));

  for image_input, image_position in
    select value, ordinality
    from jsonb_array_elements(p_images) with ordinality
  loop
    normalized_path := trim(image_input ->> 'storage_path');
    normalized_active := coalesce((image_input ->> 'active')::boolean, true);
    normalized_primary := normalized_active
      and coalesce((image_input ->> 'is_primary')::boolean, false);

    if nullif(trim(image_input ->> 'id'), '') is not null then
      image_id := (image_input ->> 'id')::uuid;
      update public.product_images
      set
        storage_path = normalized_path,
        original_name = coalesce(image_input ->> 'original_name', original_name),
        alt_text = coalesce(image_input ->> 'alt_text', alt_text),
        sort_order = image_position::integer - 1,
        is_primary = normalized_primary,
        active = normalized_active,
        mime_type = nullif(image_input ->> 'mime_type', ''),
        file_size = nullif(image_input ->> 'file_size', '')::integer,
        width = nullif(image_input ->> 'width', '')::integer,
        height = nullif(image_input ->> 'height', '')::integer,
        updated_at = now()
      where id = image_id and product_id = p_product_id;
    else
      insert into public.product_images (
        product_id, storage_path, original_name, alt_text, sort_order,
        is_primary, active, mime_type, file_size, width, height
      )
      values (
        p_product_id,
        normalized_path,
        coalesce(image_input ->> 'original_name', ''),
        coalesce(image_input ->> 'alt_text', ''),
        image_position::integer - 1,
        normalized_primary,
        normalized_active,
        nullif(image_input ->> 'mime_type', ''),
        nullif(image_input ->> 'file_size', '')::integer,
        nullif(image_input ->> 'width', '')::integer,
        nullif(image_input ->> 'height', '')::integer
      );
    end if;
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', image.id,
        'storage_path', image.storage_path,
        'original_name', image.original_name,
        'alt_text', image.alt_text,
        'sort_order', image.sort_order,
        'is_primary', image.is_primary,
        'active', image.active,
        'mime_type', image.mime_type,
        'file_size', image.file_size,
        'width', image.width,
        'height', image.height
      )
      order by image.sort_order, image.id
    ),
    '[]'::jsonb
  )
  into response_images
  from public.product_images image
  where image.product_id = p_product_id
    and image.active is true;

  return jsonb_build_object(
    'product_id', p_product_id,
    'asset_key', product_row.asset_key,
    'images', response_images
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Image payload contains an invalid UUID or number'
      using errcode = '22023';
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_product_with_variants(p_product jsonb, p_variants jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  target_product_id integer;
  requested_product_id integer;
  target_asset_key uuid;
  requested_asset_key uuid;
  existing_product public.products%rowtype;
  variant_input jsonb;
  variant_position bigint;
  variant_id bigint;
  saved_variant_ids bigint[] := '{}'::bigint[];
  seen_skus text[] := '{}'::text[];
  normalized_sku text;
  normalized_size text;
  normalized_price numeric;
  normalized_pro_price numeric;
  normalized_stock integer;
  normalized_active boolean;
  normalized_default boolean;
  normalized_custom_order boolean;
  normalized_procurement_unit_cost numeric;
  normalized_gift_enabled boolean;
  normalized_gift_stock integer;
  normalized_gift_min_stock integer;
  can_manage_procurement_cost boolean;
  normalized_publication_status text;
  default_count integer := 0;
  gift_enabled_count integer := 0;
  default_variant public.product_variants%rowtype;
  response_variants jsonb;
begin
  if auth.uid() is null or not public.has_backoffice_permission('catalog.write') then
    raise exception 'Catalog write authorization required' using errcode = '42501';
  end if;
  can_manage_procurement_cost := public.has_backoffice_permission('procurement.manage');

  if p_product is null or jsonb_typeof(p_product) <> 'object' then
    raise exception 'Product payload must be an object' using errcode = '22023';
  end if;
  if p_variants is null
    or jsonb_typeof(p_variants) <> 'array'
    or jsonb_array_length(p_variants) = 0
  then
    raise exception 'At least one product variant is required' using errcode = '22023';
  end if;

  if nullif(trim(p_product ->> 'name'), '') is null
    or nullif(trim(p_product ->> 'name_zh'), '') is null
    or nullif(trim(p_product ->> 'category'), '') is null
  then
    raise exception 'Product name, Chinese name and category are required' using errcode = '22023';
  end if;
  if p_product ? 'image_urls'
    and p_product -> 'image_urls' <> 'null'::jsonb
    and jsonb_typeof(p_product -> 'image_urls') <> 'array'
  then
    raise exception 'Product image_urls must be an array' using errcode = '22023';
  end if;
  if p_product ? 'features'
    and p_product -> 'features' <> 'null'::jsonb
    and jsonb_typeof(p_product -> 'features') <> 'array'
  then
    raise exception 'Product features must be an array' using errcode = '22023';
  end if;
  if nullif(p_product ->> 'product_list_image_scale', '') is not null
    and (
      (p_product ->> 'product_list_image_scale')::numeric < 0.1
      or (p_product ->> 'product_list_image_scale')::numeric > 3
    )
  then
    raise exception 'Product list image scale must be between 0.1 and 3' using errcode = '22023';
  end if;

  if nullif(trim(p_product ->> 'id'), '') is not null then
    begin
      requested_product_id := (p_product ->> 'id')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Product ID must be an integer' using errcode = '22023';
    end;
  end if;

  if nullif(trim(p_product ->> 'asset_key'), '') is not null then
    requested_asset_key := (p_product ->> 'asset_key')::uuid;
  end if;

  normalized_publication_status := case
    when p_product ? 'publication_status'
      then nullif(trim(p_product ->> 'publication_status'), '')
    when p_product ? 'active'
      then case when (p_product ->> 'active')::boolean then 'active' else 'archived' end
    else null
  end;
  if normalized_publication_status is not null
    and normalized_publication_status not in ('draft', 'active', 'event_only', 'gift_only', 'archived')
  then
    raise exception 'Invalid product publication status' using errcode = '22023';
  end if;

  if requested_product_id is null then
    insert into public.products (
      asset_key, name, name_zh, subtitle, category, series, min_stock, is_pro_only, apply_tier_multiplier, instructor_price_multiplier, distributor_price_multiplier, staff_price_multiplier,
      image_url, image_urls, description, skin_type, ingredients, features,
      source_folder_name, imported_from_drive, product_list_image_scale, publication_status, active,
      size, price, pro_price, stock, variants
    )
    values (
      coalesce(requested_asset_key, gen_random_uuid()),
      trim(p_product ->> 'name'),
      trim(p_product ->> 'name_zh'),
      nullif(trim(p_product ->> 'subtitle'), ''),
      trim(p_product ->> 'category'),
      nullif(trim(p_product ->> 'series'), ''),
      greatest(coalesce((p_product ->> 'min_stock')::integer, 3), 0),
      coalesce((p_product ->> 'is_pro_only')::boolean, false),
      coalesce((p_product ->> 'apply_tier_multiplier')::boolean, true),
      case when p_product ? 'instructor_price_multiplier' then nullif(p_product ->> 'instructor_price_multiplier', '')::numeric else case when (p_product ->> 'apply_tier_multiplier')::boolean is false then 1 else null end end,
      case when p_product ? 'distributor_price_multiplier' then nullif(p_product ->> 'distributor_price_multiplier', '')::numeric else case when (p_product ->> 'apply_tier_multiplier')::boolean is false then 1 else null end end,
      case when p_product ? 'staff_price_multiplier' then nullif(p_product ->> 'staff_price_multiplier', '')::numeric else case when (p_product ->> 'apply_tier_multiplier')::boolean is false then 1 else null end end,
      nullif(trim(p_product ->> 'image_url'), ''),
      case
        when jsonb_typeof(p_product -> 'image_urls') = 'array' then p_product -> 'image_urls'
        else '[]'::jsonb
      end,
      coalesce(p_product ->> 'description', ''),
      coalesce(p_product ->> 'skin_type', ''),
      coalesce(p_product ->> 'ingredients', ''),
      case
        when jsonb_typeof(p_product -> 'features') = 'array' then p_product -> 'features'
        else '[]'::jsonb
      end,
      nullif(trim(p_product ->> 'source_folder_name'), ''),
      coalesce((p_product ->> 'imported_from_drive')::boolean, false),
      nullif(p_product ->> 'product_list_image_scale', '')::numeric,
      coalesce(normalized_publication_status, 'draft'),
      coalesce(normalized_publication_status, 'draft') = 'active',
      '', 0, 0, 0, '[]'::jsonb
    )
    returning id, asset_key into target_product_id, target_asset_key;
  else
    target_product_id := requested_product_id;

    select * into existing_product
    from public.products
    where id = target_product_id
    for update;

    if not found then
      raise exception 'Product % not found', target_product_id using errcode = 'P0002';
    end if;

      if (p_product ?| array['instructor_price_multiplier','distributor_price_multiplier','staff_price_multiplier'])
        and not (p_product ? 'expected_pricing_overrides') then
        raise exception 'Original product pricing snapshot required; reload before saving' using errcode='22023';
      end if;
      if p_product ? 'expected_pricing_overrides' and
        jsonb_build_object('instructor',existing_product.instructor_price_multiplier,
          'distributor',existing_product.distributor_price_multiplier,'staff',existing_product.staff_price_multiplier)
        is distinct from p_product -> 'expected_pricing_overrides' then
        raise exception 'Product pricing changed; reload before saving' using errcode='40001';
      end if;
      target_asset_key := existing_product.asset_key;
    normalized_publication_status := coalesce(
      normalized_publication_status,
      existing_product.publication_status
    );

    update public.products
    set
      name = trim(p_product ->> 'name'),
      name_zh = trim(p_product ->> 'name_zh'),
      subtitle = case
        when p_product ? 'subtitle' then nullif(trim(p_product ->> 'subtitle'), '')
        else subtitle
      end,
      category = trim(p_product ->> 'category'),
      series = case
        when p_product ? 'series' then nullif(trim(p_product ->> 'series'), '')
        else series
      end,
      min_stock = greatest(coalesce((p_product ->> 'min_stock')::integer, min_stock, 3), 0),
      is_pro_only = coalesce((p_product ->> 'is_pro_only')::boolean, is_pro_only),
      apply_tier_multiplier = coalesce((p_product ->> 'apply_tier_multiplier')::boolean, apply_tier_multiplier),
      instructor_price_multiplier = case when p_product ? 'instructor_price_multiplier' then nullif(p_product ->> 'instructor_price_multiplier', '')::numeric else instructor_price_multiplier end,
      distributor_price_multiplier = case when p_product ? 'distributor_price_multiplier' then nullif(p_product ->> 'distributor_price_multiplier', '')::numeric else distributor_price_multiplier end,
      staff_price_multiplier = case when p_product ? 'staff_price_multiplier' then nullif(p_product ->> 'staff_price_multiplier', '')::numeric else staff_price_multiplier end,
      image_url = case
        when p_product ? 'image_url' then nullif(trim(p_product ->> 'image_url'), '')
        else image_url
      end,
      image_urls = case
        when jsonb_typeof(p_product -> 'image_urls') = 'array' then p_product -> 'image_urls'
        when p_product ? 'image_urls' then '[]'::jsonb
        else image_urls
      end,
      description = coalesce(p_product ->> 'description', description),
      skin_type = coalesce(p_product ->> 'skin_type', skin_type),
      ingredients = coalesce(p_product ->> 'ingredients', ingredients),
      features = case
        when jsonb_typeof(p_product -> 'features') = 'array' then p_product -> 'features'
        when p_product ? 'features' then '[]'::jsonb
        else features
      end,
      source_folder_name = case
        when p_product ? 'source_folder_name' then nullif(trim(p_product ->> 'source_folder_name'), '')
        else source_folder_name
      end,
      imported_from_drive = coalesce((p_product ->> 'imported_from_drive')::boolean, imported_from_drive),
      product_list_image_scale = case
        when p_product ? 'product_list_image_scale'
          then nullif(p_product ->> 'product_list_image_scale', '')::numeric
        else product_list_image_scale
      end,
      publication_status = normalized_publication_status,
      active = normalized_publication_status = 'active',
      updated_at = now()
    where id = target_product_id;
  end if;

  -- Validate every variant and collect existing IDs before writing anything.
  for variant_input, variant_position in
    select value, ordinality
    from jsonb_array_elements(p_variants) with ordinality
  loop
    if jsonb_typeof(variant_input) <> 'object' then
      raise exception 'Variant % must be an object', variant_position using errcode = '22023';
    end if;

    normalized_sku := nullif(trim(variant_input ->> 'sku'), '');
    normalized_size := nullif(trim(variant_input ->> 'size'), '');
    if normalized_sku is null or normalized_size is null then
      raise exception 'Variant % requires SKU and size', variant_position using errcode = '22023';
    end if;

    begin
      normalized_price := (variant_input ->> 'price')::numeric;
      normalized_pro_price := (variant_input ->> 'pro_price')::numeric;
      normalized_stock := (variant_input ->> 'stock')::integer;
      normalized_gift_stock := coalesce((variant_input ->> 'gift_stock')::integer, 0);
      normalized_gift_min_stock := coalesce((variant_input ->> 'gift_min_stock')::integer, 0);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Variant % has invalid price or stock', variant_position using errcode = '22023';
    end;

    if normalized_price < 0 or normalized_pro_price < 0 or normalized_stock < 0
      or normalized_gift_stock < 0 or normalized_gift_min_stock < 0
    then
      raise exception 'Variant % price and stock cannot be negative', variant_position using errcode = '22023';
    end if;

    normalized_gift_enabled := coalesce((variant_input ->> 'gift_enabled')::boolean, false);
    if normalized_gift_enabled and not coalesce((variant_input ->> 'active')::boolean, true) then
      raise exception 'Enabled gift inventory requires an active variant' using errcode = '22023';
    end if;
    if normalized_gift_enabled then
      gift_enabled_count := gift_enabled_count + 1;
    end if;

    if lower(normalized_sku) = any(seen_skus) then
      raise exception 'Duplicate SKU in request: %', normalized_sku using errcode = '23505';
    end if;
    seen_skus := array_append(seen_skus, lower(normalized_sku));

    normalized_default := coalesce((variant_input ->> 'is_default')::boolean, false);
    if normalized_default then
      default_count := default_count + 1;
    end if;

    variant_id := null;
    if coalesce(variant_input ->> 'id', '') ~ '^[0-9]+$' then
      variant_id := (variant_input ->> 'id')::bigint;
      if not exists (
        select 1
        from public.product_variants
        where id = variant_id
          and product_id = target_product_id
      ) then
        raise exception 'Variant % does not belong to product %', variant_id, target_product_id
          using errcode = '42501';
      end if;
      saved_variant_ids := array_append(saved_variant_ids, variant_id);
    end if;
  end loop;

  if default_count <> 1 then
    raise exception 'Exactly one default variant is required' using errcode = '23514';
  end if;
  if normalized_publication_status = 'gift_only' and gift_enabled_count = 0 then
    raise exception 'Gift-only products require at least one enabled gift inventory' using errcode = '23514';
  end if;

  -- Allow existing variants to exchange SKU values without transient conflicts.
  update public.product_variants
  set sku = '__pending__' || id
  where product_id = target_product_id
    and id = any(saved_variant_ids);

  for variant_input, variant_position in
    select value, ordinality
    from jsonb_array_elements(p_variants) with ordinality
  loop
    normalized_sku := trim(variant_input ->> 'sku');
    normalized_size := trim(variant_input ->> 'size');
    normalized_price := (variant_input ->> 'price')::numeric;
    normalized_pro_price := (variant_input ->> 'pro_price')::numeric;
    normalized_stock := (variant_input ->> 'stock')::integer;
    if normalized_publication_status = 'gift_only' then
      normalized_stock := 0;
    end if;
    normalized_default := coalesce((variant_input ->> 'is_default')::boolean, false);
    normalized_active := coalesce((variant_input ->> 'active')::boolean, true);
    normalized_custom_order := coalesce((variant_input ->> 'is_custom_order')::boolean, false);
    normalized_gift_enabled := coalesce((variant_input ->> 'gift_enabled')::boolean, false);
    normalized_gift_stock := case when normalized_gift_enabled then coalesce((variant_input ->> 'gift_stock')::integer, 0) else 0 end;
    normalized_gift_min_stock := case when normalized_gift_enabled then coalesce((variant_input ->> 'gift_min_stock')::integer, 0) else 0 end;
    variant_id := case
      when coalesce(variant_input ->> 'id', '') ~ '^[0-9]+$'
        then (variant_input ->> 'id')::bigint
      else null
    end;
    if can_manage_procurement_cost then
      normalized_procurement_unit_cost := nullif(variant_input ->> 'procurement_unit_cost_usd', '')::numeric;
    elsif variant_id is not null then
      select procurement_unit_cost_usd
        into normalized_procurement_unit_cost
      from public.product_variants
      where id = variant_id
        and product_id = target_product_id;
    else
      normalized_procurement_unit_cost := null;
    end if;

    if normalized_procurement_unit_cost is not null and normalized_procurement_unit_cost < 0 then
      raise exception 'Procurement unit cost must be zero or greater' using errcode = '22023';
    end if;

    if coalesce(variant_input ->> 'id', '') ~ '^[0-9]+$' then
      update public.product_variants
      set
        sku = normalized_sku,
        size = normalized_size,
        price = normalized_price,
        pro_price = normalized_pro_price,
        stock = normalized_stock,
        is_default = normalized_default,
        is_custom_order = normalized_custom_order,
        procurement_unit_cost_usd = normalized_procurement_unit_cost,
        gift_enabled = normalized_gift_enabled,
        gift_stock = normalized_gift_stock,
        gift_min_stock = normalized_gift_min_stock,
        sort_order = greatest(coalesce((variant_input ->> 'sort_order')::integer, variant_position::integer - 1), 0),
        active = normalized_active,
        updated_at = now()
      where id = variant_id
        and product_id = target_product_id;
    else
      insert into public.product_variants (
        product_id, sku, size, price, pro_price, stock,
        is_default, is_custom_order, procurement_unit_cost_usd,
        gift_enabled, gift_stock, gift_min_stock, sort_order, active
      )
      values (
        target_product_id, normalized_sku, normalized_size,
        normalized_price, normalized_pro_price, normalized_stock,
        normalized_default, normalized_custom_order, normalized_procurement_unit_cost,
        normalized_gift_enabled, normalized_gift_stock, normalized_gift_min_stock,
        greatest(coalesce((variant_input ->> 'sort_order')::integer, variant_position::integer - 1), 0),
        normalized_active
      )
      returning id into variant_id;

      saved_variant_ids := array_append(saved_variant_ids, variant_id);
    end if;
  end loop;

  -- Missing rows are retained for historical references, but are no longer sellable.
  update public.product_variants
  set active = false, is_default = false,
      gift_enabled = false, gift_stock = 0, gift_min_stock = 0,
      updated_at = now()
  where product_id = target_product_id
    and not (id = any(saved_variant_ids));

  select * into default_variant
  from public.product_variants
  where product_id = target_product_id
    and is_default is true
    and active is true;

  if not found then
    raise exception 'The default variant must be active' using errcode = '23514';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', variant.id::text,
        'sku', variant.sku,
        'size', variant.size,
        'price', variant.price,
        'proPrice', variant.pro_price,
        'stock', variant.stock,
        'isDefault', variant.is_default,
        'isCustomOrder', variant.is_custom_order,
        'procurementUnitCostUsd', case
          when can_manage_procurement_cost then variant.procurement_unit_cost_usd
          else null
        end,
        'giftEnabled', variant.gift_enabled,
        'giftStock', variant.gift_stock,
        'giftMinStock', variant.gift_min_stock,
        'sortOrder', variant.sort_order,
        'active', variant.active
      )
      order by variant.sort_order, variant.id
    ),
    '[]'::jsonb
  )
  into response_variants
  from public.product_variants variant
  where variant.product_id = target_product_id
    and variant.active is true;

  -- Transitional compatibility: legacy readers receive the same default and
  -- JSON data, while product_variants remains the source of truth for this RPC.
  update public.products
  set
    size = default_variant.size,
    price = default_variant.price,
    pro_price = default_variant.pro_price,
    stock = default_variant.stock,
    variants = response_variants,
    updated_at = now()
  where id = target_product_id;

  return jsonb_build_object(
    'product_id', target_product_id,
    'asset_key', target_asset_key,
    'default_variant_id', default_variant.id,
    'variants', response_variants
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Product payload contains an invalid number or boolean' using errcode = '22023';
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_professional_award_evidence(p_evidence_id uuid, p_student_name text, p_completed_on date, p_award_number text, p_storage_path text, p_original_name text, p_mime_type text, p_file_size integer, p_consent_acknowledged boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  member_id uuid := auth.uid();
  today date := (now() at time zone 'Asia/Taipei')::date;
  evidence_id uuid := p_evidence_id;
  target_year integer := extract(year from p_completed_on)::integer;
  award_key text := lower(regexp_replace(btrim(coalesce(p_award_number, '')), '\s+', '', 'g'));
  target_membership public.professional_memberships%rowtype;
  existing public.professional_award_evidence%rowtype;
  saved public.professional_award_evidence%rowtype;
  late_window_valid boolean := false;
begin
  if member_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_student_name, '')), '') is null
    or p_completed_on is null
    or p_completed_on > today
    or award_key = ''
  then
    raise exception 'Student name, completion date and award number are required' using errcode = '22023';
  end if;
  if p_consent_acknowledged is not true then
    raise exception 'Privacy acknowledgement is required' using errcode = '22023';
  end if;
  -- A new upload already has its UUID in the Storage path. Null means create;
  -- a supplied p_evidence_id means edit an existing owned pending record.
  if evidence_id is null then
    if p_storage_path is null or p_storage_path !~ (
      '^' || member_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
    ) then
      raise exception 'Invalid award image path' using errcode = '22023';
    end if;
    evidence_id := split_part(p_storage_path, '/', 2)::uuid;
  end if;
  if p_storage_path !~ ('^' || member_id::text || '/' || evidence_id::text || '/[^/]+$')
    or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_file_size is null or p_file_size not between 1 and 5242880
    or nullif(btrim(coalesce(p_original_name, '')), '') is null
    or not exists (
      select 1 from storage.objects object
      where object.bucket_id = 'professional-renewal-evidence'
        and object.name = p_storage_path
    )
  then
    raise exception 'Invalid award image metadata' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.professional_evidence_entry_windows entry_window
    where entry_window.user_id = member_id
      and entry_window.assessment_year = target_year
      and entry_window.opened_until >= now()
  ) into late_window_valid;

  if target_year <> extract(year from today)::integer and not late_window_valid then
    raise exception 'Evidence entry for this year is closed' using errcode = '22023';
  end if;

  select * into target_membership
  from public.professional_memberships membership
  where membership.user_id = member_id
    and membership.role in ('instructor', 'distributor')
    and p_completed_on >= membership.started_on
    and p_completed_on < coalesce(membership.ended_on, 'infinity'::date)
  order by membership.started_on desc
  limit 1;
  if not found then
    raise exception 'The completion date is outside the professional membership period' using errcode = '22023';
  end if;

  if p_evidence_id is not null then
    select * into existing
    from public.professional_award_evidence evidence
    where evidence.id = p_evidence_id
      and evidence.user_id = member_id
    for update;
    if not found then
      raise exception 'Award evidence not found' using errcode = 'P0002';
    end if;
    if existing.status <> 'pending' then
      raise exception 'Only pending evidence can be edited' using errcode = '42501';
    end if;
  end if;

  insert into public.professional_award_evidence as target_evidence (
    id, user_id, membership_id, assessment_year, student_name, completed_on,
    award_number, award_number_key, storage_path, original_name, mime_type,
    file_size, consent_acknowledged_at
  ) values (
    evidence_id, member_id, target_membership.id, target_year, btrim(p_student_name), p_completed_on,
    btrim(p_award_number), award_key, p_storage_path, left(btrim(p_original_name), 255), p_mime_type,
    p_file_size, now()
  )
  on conflict (id) do update set
    membership_id = excluded.membership_id,
    assessment_year = excluded.assessment_year,
    student_name = excluded.student_name,
    completed_on = excluded.completed_on,
    award_number = excluded.award_number,
    award_number_key = excluded.award_number_key,
    storage_path = excluded.storage_path,
    original_name = excluded.original_name,
    mime_type = excluded.mime_type,
    file_size = excluded.file_size,
    consent_acknowledged_at = excluded.consent_acknowledged_at
  where p_evidence_id is not null
    and target_evidence.user_id = member_id
    and target_evidence.status = 'pending'
  returning * into saved;

  if not found then
    raise exception 'Award evidence already exists or cannot be edited' using errcode = '23505';
  end if;

  return to_jsonb(saved);
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_professional_sales_adjustment(p_membership_id uuid, p_quarter_number integer, p_amount numeric, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target public.professional_memberships%rowtype;
  membership_anchor date;
begin
  if p_quarter_number is null or p_quarter_number < 1 then
    raise exception 'Invalid quarter number' using errcode = '22023';
  end if;

  select * into target
  from public.professional_memberships
  where id = p_membership_id;
  if not found then
    raise exception 'Membership not found' using errcode = 'P0002';
  end if;

  membership_anchor := date_trunc('quarter', target.started_on::timestamp)::date;
  return public.save_professional_sales_adjustment_v2(
    p_membership_id,
    (membership_anchor + make_interval(months => (p_quarter_number - 1) * 3))::date,
    p_amount,
    p_note
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_professional_sales_adjustment_v2(p_membership_id uuid, p_quarter_start date, p_amount numeric, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target public.professional_memberships%rowtype;
  existing public.professional_sales_adjustments%rowtype;
  today date := (now() at time zone 'Asia/Taipei')::date;
  normalized_quarter_start date;
  membership_anchor date;
  target_quarter_end date;
  target_quarter_number integer;
  clean_note text := nullif(btrim(coalesce(p_note, '')), '');
  clean_amount numeric(12, 0) := round(coalesce(p_amount, 0));
begin
  if not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if p_quarter_start is null then
    raise exception 'Quarter start is required' using errcode = '22023';
  end if;

  normalized_quarter_start := date_trunc('quarter', p_quarter_start::timestamp)::date;
  if normalized_quarter_start <> p_quarter_start then
    raise exception 'Quarter start must be the first day of a calendar quarter' using errcode = '22023';
  end if;
  if clean_amount < 0 or clean_amount > 999999999 then
    raise exception 'Invalid adjustment amount' using errcode = '22023';
  end if;

  select * into target
  from public.professional_memberships
  where id = p_membership_id
  for update;
  if not found then
    raise exception 'Membership not found' using errcode = 'P0002';
  end if;

  membership_anchor := date_trunc('quarter', target.started_on::timestamp)::date;
  target_quarter_end := (normalized_quarter_start + interval '3 months')::date;
  if normalized_quarter_start > date_trunc('quarter', today::timestamp)::date
    or target_quarter_end <= target.started_on
    or (target.ended_on is not null and normalized_quarter_start >= target.ended_on)
  then
    raise exception 'Quarter is outside the membership period' using errcode = '22023';
  end if;

  target_quarter_number := (
    (extract(year from normalized_quarter_start)::integer - extract(year from membership_anchor)::integer) * 4
    + extract(quarter from normalized_quarter_start)::integer
    - extract(quarter from membership_anchor)::integer
    + 1
  );

  select * into existing
  from public.professional_sales_adjustments
  where membership_id = target.id
    and quarter_start = normalized_quarter_start
  for update;

  if clean_amount = 0 and clean_note is null then
    if existing.id is not null then
      delete from public.professional_sales_adjustments where id = existing.id;
    end if;
  elsif existing.id is not null then
    update public.professional_sales_adjustments
    set quarter_number = target_quarter_number,
        amount = clean_amount,
        note = clean_note,
        updated_by = auth.uid()
    where id = existing.id;
  else
    insert into public.professional_sales_adjustments (
      membership_id, user_id, quarter_number, quarter_start,
      amount, note, created_by, updated_by
    ) values (
      target.id, target.user_id, target_quarter_number, normalized_quarter_start,
      clean_amount, clean_note, auth.uid(), auth.uid()
    );
  end if;

  if coalesce(existing.amount, 0) <> clean_amount or existing.note is distinct from clean_note then
    perform public.record_professional_sales_audit(
      'professional_sales_adjustments.saved',
      'professional_sales_adjustments',
      target.id::text || ':' || normalized_quarter_start::text,
      case when existing.id is null then null
        else jsonb_build_object(
          'user_id', target.user_id,
          'quarter_start', existing.quarter_start,
          'amount', existing.amount,
          'note', existing.note
        ) end,
      case when clean_amount = 0 and clean_note is null then null
        else jsonb_build_object(
          'user_id', target.user_id,
          'quarter_start', normalized_quarter_start,
          'amount', clean_amount,
          'note', clean_note
        ) end
    );
  end if;

  return jsonb_build_object(
    'membership_id', target.id,
    'quarter_number', target_quarter_number,
    'quarter_start', normalized_quarter_start,
    'amount', clean_amount,
    'note', clean_note
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_purchase_order(p_order jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  order_id bigint := nullif(p_order ->> 'id', '')::bigint;
  exchange_rate_value numeric := nullif(p_order ->> 'exchange_rate', '')::numeric;
  status_value text := coalesce(nullif(btrim(p_order ->> 'status'), ''), 'draft');
  address_value jsonb := coalesce(p_order -> 'shipping_address', '{}'::jsonb);
  total_usd_value numeric(14, 2) := 0;
  total_twd_value numeric(14, 2) := 0;
  saved_order public.purchase_orders%rowtype;
  item_value jsonb;
  variant_row record;
  product_variant_id_value bigint;
  quantity_value integer;
  unit_cost_value numeric;
  item_index integer := 0;
begin
  if not public.is_eclado_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if exchange_rate_value is null or exchange_rate_value <= 0 then
    raise exception 'Exchange rate must be greater than zero' using errcode = '22023';
  end if;
  if status_value not in ('draft', 'pending') then
    raise exception 'New or edited order status must be draft or pending' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one purchase item is required' using errcode = '22023';
  end if;
  if status_value <> 'draft' and btrim(coalesce(address_value ->> 'address_text', '')) = '' then
    raise exception 'Shipping address is required' using errcode = '22023';
  end if;

  for item_value in select value from jsonb_array_elements(p_items)
  loop
    product_variant_id_value := nullif(item_value ->> 'product_variant_id', '')::bigint;
    quantity_value := nullif(item_value ->> 'quantity', '')::integer;
    unit_cost_value := nullif(item_value ->> 'unit_cost', '')::numeric;
    if product_variant_id_value is null or quantity_value is null or quantity_value <= 0
      or unit_cost_value is null or unit_cost_value < 0 then
      raise exception 'Item variant, quantity and unit cost are invalid' using errcode = '22023';
    end if;
    if not exists (
      select 1
      from public.product_variants variant
      join public.products product on product.id = variant.product_id
      where variant.id = product_variant_id_value
        and variant.active is true
        and variant.procurement_unit_cost_usd is not null
    ) then
      raise exception 'Active product variant with procurement cost is required' using errcode = 'P0002';
    end if;
    total_usd_value := total_usd_value + round(quantity_value * unit_cost_value, 2);
  end loop;
  total_twd_value := round(total_usd_value * exchange_rate_value, 2);

  if order_id is null then
    insert into public.purchase_orders (
      status, exchange_rate, total_usd, total_twd,
      shipping_address, notes, created_by
    ) values (
      status_value, exchange_rate_value, total_usd_value, total_twd_value,
      address_value, nullif(btrim(p_order ->> 'notes'), ''), auth.uid()
    ) returning * into saved_order;
    order_id := saved_order.id;
  else
    update public.purchase_orders set
      status = status_value,
      exchange_rate = exchange_rate_value,
      total_usd = total_usd_value,
      total_twd = total_twd_value,
      shipping_address = address_value,
      notes = nullif(btrim(p_order ->> 'notes'), '')
    where id = order_id and status in ('draft', 'pending')
    returning * into saved_order;
    if saved_order.id is null then
      raise exception 'Editable purchase order not found' using errcode = 'P0002';
    end if;
    delete from public.purchase_order_items where purchase_order_id = order_id;
  end if;

  for item_value in select value from jsonb_array_elements(p_items)
  loop
    product_variant_id_value := (item_value ->> 'product_variant_id')::bigint;
    select
      variant.id,
      variant.sku,
      variant.size,
      variant.stock,
      variant.procurement_unit_cost_usd,
      product.name_zh,
      product.name as name_en
    into variant_row
    from public.product_variants variant
    join public.products product on product.id = variant.product_id
    where variant.id = product_variant_id_value
      and variant.active is true
      and variant.procurement_unit_cost_usd is not null;
    if variant_row.id is null then
      raise exception 'Product variant not found' using errcode = 'P0002';
    end if;

    quantity_value := (item_value ->> 'quantity')::integer;
    unit_cost_value := (item_value ->> 'unit_cost')::numeric;

    insert into public.purchase_order_items (
      purchase_order_id, product_variant_id,
      product_sku, name_zh, name_en, specification,
      quantity, unit_cost, subtotal_usd, stock_at_order, sort_order
    ) values (
      order_id, variant_row.id,
      variant_row.sku, variant_row.name_zh, variant_row.name_en, variant_row.size,
      quantity_value, unit_cost_value, round(quantity_value * unit_cost_value, 2),
      variant_row.stock, item_index
    );
    item_index := item_index + 1;
  end loop;

  if nullif(p_order ->> 'address_id', '') is not null then
    update public.procurement_addresses set
      usage_count = usage_count + 1,
      last_used_at = now()
    where id = (p_order ->> 'address_id')::bigint and active is true;
  end if;

  return jsonb_build_object(
    'id', saved_order.id,
    'po_number', saved_order.po_number,
    'status', saved_order.status,
    'total_usd', saved_order.total_usd,
    'total_twd', saved_order.total_twd
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_student_pricing_settings(p_multipliers jsonb, p_expected_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.student_pricing_settings%rowtype; key text; multiplier numeric;
begin
  perform public.assert_instructor_student_admin(true);
  if p_multipliers is null or jsonb_typeof(p_multipliers)<>'object'
    or (select count(*) from jsonb_object_keys(p_multipliers))<>2 then
    raise exception '請提供學生1及學生2折數' using errcode='22023';
  end if;
  foreach key in array array['student_1','student_2'] loop
    if jsonb_typeof(p_multipliers->key) is distinct from 'number' then
      raise exception '折數必須是有效數值' using errcode='22023';
    end if;
    multiplier:=(p_multipliers->>key)::numeric;
    if not (multiplier>0 and multiplier<=1 and multiplier=round(multiplier,3)) then
      raise exception '折數須大於0、不超過10折，最多兩位折數小數' using errcode='22023';
    end if;
  end loop;
  select * into previous from public.student_pricing_settings where singleton for update;
  if not found then raise exception '學生全域設定尚未初始化' using errcode='55000'; end if;
  if p_expected_version is distinct from previous.version then
    raise exception '設定已被其他管理員修改，請重新載入' using errcode='40001';
  end if;
  if previous.student_1 is distinct from (p_multipliers->>'student_1')::numeric
    or previous.student_2 is distinct from (p_multipliers->>'student_2')::numeric then
    update public.student_pricing_settings set student_1=(p_multipliers->>'student_1')::numeric,
      student_2=(p_multipliers->>'student_2')::numeric,version=version+1,
      updated_by=auth.uid(),updated_at=now() where singleton;
    insert into public.instructor_student_audit_logs(event_type,actor_user_id,actor_kind,before_data,after_data)
    values('global_settings',auth.uid(),'admin',
      jsonb_build_object('student_1',previous.student_1,'student_2',previous.student_2,'version',previous.version),
      p_multipliers||jsonb_build_object('version',previous.version+1));
  end if;
  return public.get_admin_student_pricing_settings();
end;
$function$;

CREATE OR REPLACE FUNCTION public.search_coupon_members(p_query text, p_limit integer DEFAULT 20)
 RETURNS TABLE(user_id uuid, name text, email text, phone text, role text, contact_name text, studio_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  query_text text := btrim(coalesce(p_query, ''));
  result_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if not public.has_backoffice_permission('promotions.manage') then
    raise exception 'Promotion management access required' using errcode = '42501';
  end if;
  return query
  select profile.id, profile.name, profile.email, profile.phone, profile.role,
    application.contact_name, application.studio_name
  from public.profiles profile
  left join lateral (
    select app.contact_name, app.studio_name
    from public.professional_applications app
    where app.user_id = profile.id
      or (app.user_id is null and lower(app.user_email) = lower(profile.email))
    order by (app.status = 'approved') desc, app.created_at desc
    limit 1
  ) application on true
  where coalesce(profile.name, '') ilike '%' || query_text || '%'
    or coalesce(profile.email, '') ilike '%' || query_text || '%'
    or coalesce(profile.phone, '') ilike '%' || query_text || '%'
    or coalesce(application.contact_name, '') ilike '%' || query_text || '%'
    or coalesce(application.studio_name, '') ilike '%' || query_text || '%'
  order by profile.name nulls last, profile.created_at desc, profile.id
  limit result_limit;
end;
$function$;

CREATE OR REPLACE FUNCTION public.seed_profile_salon_from_application()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.user_id is not null then
    perform set_config('app.eclado_allow_profile_salon_seed', 'true', true);
    update public.profiles profile
    set
      studio_name = coalesce(nullif(btrim(profile.studio_name), ''), nullif(btrim(new.studio_name), '')),
      studio_contact_name = coalesce(nullif(btrim(profile.studio_contact_name), ''), nullif(btrim(new.contact_name), '')),
      studio_phone = coalesce(nullif(btrim(profile.studio_phone), ''), nullif(btrim(new.phone), '')),
      studio_address = coalesce(nullif(btrim(profile.studio_address), ''), nullif(btrim(new.address), '')),
      updated_at = now()
    where profile.id = new.user_id;
    perform set_config('app.eclado_allow_profile_salon_seed', 'false', true);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_instructor_student_price_type(p_instructor_id uuid, p_student_price_type text, p_expected_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.instructor_student_settings%rowtype;
begin
  perform public.assert_instructor_student_admin(true);
  perform 1 from public.profiles where id=p_instructor_id and role='instructor' for update;
  if not found then raise exception '老師不存在或目前不是師資' using errcode='22023'; end if;
  if p_student_price_type is not null and p_student_price_type not in ('student_1','student_2') then
    raise exception '學生價格類型無效' using errcode='22023';
  end if;
  insert into public.instructor_student_settings(instructor_id) values(p_instructor_id) on conflict do nothing;
  select * into previous from public.instructor_student_settings where instructor_id=p_instructor_id for update;
  if p_expected_version is distinct from previous.version then
    raise exception '老師設定已被其他管理員修改，請重新載入' using errcode='40001';
  end if;
  if previous.student_price_type is distinct from p_student_price_type then
    update public.instructor_student_settings set student_price_type=p_student_price_type,
      version=version+1,updated_by=auth.uid(),updated_at=now() where instructor_id=p_instructor_id;
    insert into public.instructor_student_audit_logs(event_type,instructor_id,actor_user_id,actor_kind,before_data,after_data)
    values('instructor_type',p_instructor_id,auth.uid(),'admin',
      jsonb_build_object('student_price_type',previous.student_price_type,'version',previous.version),
      jsonb_build_object('student_price_type',p_student_price_type,'version',previous.version+1));
  end if;
  return public.get_admin_instructor_student_member(p_instructor_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_member_role_with_membership(p_member_id uuid, p_role text, p_effective_on date DEFAULT NULL::date, p_change_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_profile public.profiles%rowtype;
  effective_on date := coalesce(p_effective_on, (now() at time zone 'Asia/Taipei')::date);
begin
  if not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if p_role not in ('consumer', 'pro', 'instructor', 'distributor', 'staff', 'pending') then
    raise exception 'Invalid member role' using errcode = '22023';
  end if;
  if effective_on > (now() at time zone 'Asia/Taipei')::date then
    raise exception 'Effective date cannot be in the future' using errcode = '22023';
  end if;

  select * into target_profile
  from public.profiles
  where id = p_member_id
  for update;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  if target_profile.role = p_role then
    return jsonb_build_object('member_id', p_member_id, 'role', p_role, 'changed', false);
  end if;

  delete from public.professional_memberships membership
  where membership.user_id = p_member_id
    and membership.ended_on is null
    and membership.started_on >= effective_on
    and not exists (
      select 1
      from public.professional_sales_adjustments adjustment
      where adjustment.membership_id = membership.id
    );

  update public.professional_memberships
  set ended_on = greatest(effective_on, started_on),
      change_reason = coalesce(nullif(btrim(p_change_reason), ''), change_reason)
  where user_id = p_member_id
    and ended_on is null;

  if p_role in ('instructor', 'distributor') then
    insert into public.professional_memberships (
      user_id, role, started_on, created_by, change_reason
    ) values (
      p_member_id,
      p_role,
      effective_on,
      auth.uid(),
      nullif(btrim(p_change_reason), '')
    );
  end if;

  update public.profiles
  set role = p_role
  where id = p_member_id;

  return jsonb_build_object(
    'member_id', p_member_id,
    'previous_role', target_profile.role,
    'role', p_role,
    'effective_on', effective_on,
    'changed', true
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_order_first_paid_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.paid_at is null
    and new.status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered')
    and (tg_op = 'INSERT' or old.status not in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered'))
  then new.paid_at := now(); end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_order_payment_amount_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  requested_credit_text text;
  requested_credit bigint := 0;
  merchandise_total numeric;
  maximum_credit bigint;
begin
  requested_credit_text := current_setting(
    'app.eclado_order_shopping_credit_amount',
    true
  );
  if nullif(requested_credit_text, '') is not null then
    requested_credit := requested_credit_text::bigint;
  end if;

  if requested_credit < 0 then
    raise exception 'Shopping credit amount cannot be negative' using errcode = '22023';
  end if;

  merchandise_total := greatest(
    0,
    coalesce(new.subtotal, 0) - coalesce(new.discount, 0)
  );
  maximum_credit := greatest(
    0,
    least(floor(merchandise_total), floor(new.total - 1))::bigint
  );
  if requested_credit > maximum_credit then
    raise exception 'Shopping credit exceeds the eligible merchandise amount or minimum gateway payment'
      using errcode = '22003';
  end if;

  new.shopping_credit_amount := requested_credit;
  new.payment_amount := new.total - requested_credit;
  new.pricing_snapshot := jsonb_set(
    jsonb_set(
      coalesce(new.pricing_snapshot, '{}'::jsonb),
      '{shopping_credit_amount}',
      to_jsonb(requested_credit),
      true
    ),
    '{payment_amount}',
    to_jsonb(new.payment_amount),
    true
  );
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_order_payment_due_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.payment_due_at is null then
    new.payment_due_at := coalesce(new.created_at, now()) + interval '48 hours';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_order_public_lookup_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if nullif(trim(new.public_lookup_code), '') is null then
    new.public_lookup_code := upper(
      substr(encode(gen_random_bytes(5), 'hex'), 1, 5)
      || '-'
      || substr(encode(gen_random_bytes(5), 'hex'), 6, 5)
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_order_shipment_metadata()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'shipped' and old.status is distinct from 'shipped' then
    new.shipped_at := coalesce(new.shipped_at, now());
    if new.tracking is not null and btrim(new.tracking) <> '' then
      new.shipping_carrier := coalesce(new.shipping_carrier, 'sf_express');
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_product_publication_status(p_product_id integer, p_publication_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.has_backoffice_permission('catalog.write') then
    raise exception 'Catalog write access required' using errcode = '42501';
  end if;
  if p_publication_status not in ('draft', 'active', 'event_only', 'gift_only', 'archived') then
    raise exception 'Invalid publication status' using errcode = '22023';
  end if;
  update public.products
  set publication_status = p_publication_status
  where id = p_product_id;
  if not found then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_product_slug_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    new.slug := public.make_product_slug(coalesce(nullif(btrim(new.slug), ''), new.name));
  elsif nullif(btrim(new.slug), '') is null then
    new.slug := old.slug;
  else
    new.slug := public.make_product_slug(new.slug);
  end if;

  if nullif(new.slug, '') is null then
    raise exception 'Product English name must produce a non-empty slug'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_professional_membership_start(p_membership_id uuid, p_started_on date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target public.professional_memberships%rowtype;
  today date := (now() at time zone 'Asia/Taipei')::date;
begin
  if not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if p_started_on is null or p_started_on > today then
    raise exception 'Start date cannot be empty or in the future' using errcode = '22023';
  end if;

  select * into target
  from public.professional_memberships
  where id = p_membership_id
  for update;
  if not found then
    raise exception 'Membership not found' using errcode = 'P0002';
  end if;
  if target.ended_on is not null and p_started_on > target.ended_on then
    raise exception 'Start date cannot be after the membership end date' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.professional_memberships other
    where other.user_id = target.user_id
      and other.id <> target.id
      and coalesce(other.ended_on, 'infinity'::date) > other.started_on
      and other.started_on < coalesce(target.ended_on, 'infinity'::date)
      and coalesce(other.ended_on, 'infinity'::date) > p_started_on
  ) then
    raise exception 'Start date overlaps another membership period' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.professional_sales_adjustments adjustment
    where adjustment.membership_id = target.id
      and greatest(p_started_on, adjustment.quarter_start) >= least(
        coalesce(target.ended_on, 'infinity'::date),
        (adjustment.quarter_start + interval '3 months')::date
      )
  ) then
    raise exception 'Start date change would orphan an offline sales adjustment' using errcode = '22023';
  end if;
  if target.started_on = p_started_on then
    return jsonb_build_object('membership_id', target.id, 'started_on', target.started_on, 'changed', false);
  end if;

  update public.professional_memberships
  set started_on = p_started_on
  where id = target.id;

  update public.professional_sales_adjustments adjustment
  set quarter_number = (
    (extract(year from adjustment.quarter_start)::integer
      - extract(year from date_trunc('quarter', p_started_on::timestamp))::integer) * 4
    + extract(quarter from adjustment.quarter_start)::integer
    - extract(quarter from date_trunc('quarter', p_started_on::timestamp))::integer
    + 1
  )
  where adjustment.membership_id = target.id;

  perform public.record_professional_sales_audit(
    'professional_memberships.start_changed',
    'professional_memberships',
    target.id::text,
    jsonb_build_object('user_id', target.user_id, 'role', target.role, 'started_on', target.started_on),
    jsonb_build_object('user_id', target.user_id, 'role', target.role, 'started_on', p_started_on)
  );

  return jsonb_build_object('membership_id', target.id, 'started_on', p_started_on, 'changed', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ship_shipping_group(p_group_id uuid, p_tracking text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_group public.shipping_groups%rowtype;
  normalized_tracking text := nullif(btrim(coalesce(p_tracking, '')), '');
  unpaid_ids text[];
  shipped_ids text[];
  skipped_ids text[];
begin
  if not public.has_backoffice_permission('orders.write') then
    raise exception 'Order write access required' using errcode = '42501';
  end if;
  if normalized_tracking is null then
    raise exception '請輸入順豐托運單號' using errcode = '22023';
  end if;

  select * into target_group
  from public.shipping_groups
  where id = p_group_id
  for update;
  if not found then
    raise exception '找不到出貨批次' using errcode = 'P0002';
  end if;

  select
    coalesce(array_agg(target_order.id) filter (
      where target_order.status in ('awaiting_confirm', 'unpaid')
    ), '{}'),
    coalesce(array_agg(target_order.id) filter (
      where target_order.status in ('paid', 'preparing')
    ), '{}'),
    coalesce(array_agg(target_order.id) filter (
      where target_order.status in ('shipped', 'delivered', 'picked_up', 'ready_for_pickup')
    ), '{}')
  into unpaid_ids, shipped_ids, skipped_ids
  from public.orders target_order
  where target_order.shipping_group_id = target_group.id;

  if cardinality(unpaid_ids) > 0 then
    raise exception '此批次還有 % 張未付款訂單，請先確認付款或取消後再出貨',
      cardinality(unpaid_ids)
      using errcode = '22023';
  end if;
  if cardinality(shipped_ids) = 0 then
    raise exception '此批次沒有可出貨的訂單' using errcode = '22023';
  end if;

  update public.orders
  set status = 'shipped',
      tracking = normalized_tracking,
      shipping_carrier = 'sf_express'
  where id = any(shipped_ids);

  return jsonb_build_object(
    'group_id', target_group.id,
    'tracking', normalized_tracking,
    'shipped_order_ids', to_jsonb(shipped_ids),
    'skipped_order_ids', to_jsonb(skipped_ids)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.shipping_group_effective_amount(p_order orders)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select greatest(0, coalesce(p_order.subtotal, 0) - coalesce(p_order.discount, 0));
$function$;

CREATE OR REPLACE FUNCTION public.student_price_confirmation(p_quote jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object('subtotal',p_quote->'subtotal','discount',p_quote->'discount',
    'shipping',p_quote->'shipping','total',p_quote->'total',
    'items',(select jsonb_agg(jsonb_build_object('product_id',coalesce(x->'product_id',x->'id'),
      'variant_id',x->'variant_id','qty',x->'qty','unit_price',x->'unit_price',
      'line_type',coalesce(x->>'line_type','merchandise')) order by n)
      from jsonb_array_elements(p_quote->'items') with ordinality as lines(x,n)));
$function$;

CREATE OR REPLACE FUNCTION public.student_pricing_multiplier(p_user_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when feature.enabled and coalesce((context.data->>'student_pricing_eligible')::boolean,false)
    then case context.data->>'student_price_type' when 'student_1' then settings.student_1
      when 'student_2' then settings.student_2 end end
  from public.student_pricing_feature_settings feature
  cross join public.student_pricing_settings settings
  cross join lateral (select public.instructor_student_context(p_user_id) as data) context
  where feature.singleton and settings.singleton
    and exists(select 1 from public.membership_tiers where role='pro' and active);
$function$;

CREATE OR REPLACE FUNCTION public.submit_professional_application(p_studio_name text, p_contact_name text, p_phone text, p_address text, p_social_media text, p_certificate text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  current_user_id uuid := auth.uid();
  application_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.professional_applications
    where user_id = current_user_id and status = 'pending'
  ) then
    raise exception 'A pending application already exists' using errcode = '23505';
  end if;
  if nullif(trim(p_studio_name), '') is null
    or nullif(trim(p_contact_name), '') is null
    or nullif(trim(p_phone), '') is null
    or nullif(trim(p_address), '') is null
    or nullif(trim(p_social_media), '') is null
    or nullif(trim(p_certificate), '') is null
  then
    raise exception 'All application fields are required' using errcode = '22023';
  end if;

  insert into public.professional_applications (
    studio_name, contact_name, phone, address, social_media, certificate,
    user_id, user_email, status, source
  )
  select
    trim(p_studio_name), trim(p_contact_name), trim(p_phone), trim(p_address),
    trim(p_social_media), trim(p_certificate), current_user_id, profile.email,
    'pending', 'standalone'
  from public.profiles profile
  where profile.id = current_user_id
  returning id into application_id;

  if application_id is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  perform set_config('app.eclado_allow_profile_security_update', 'true', true);
  update public.profiles set role = 'pending' where id = current_user_id;
  perform set_config('app.eclado_allow_profile_security_update', 'false', true);
  return application_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_professional_application_with_certificates(p_studio_name text, p_contact_name text, p_phone text, p_address text, p_social_media text, p_certificate text, p_application_id uuid, p_certificates jsonb, p_invoice_company_name text, p_invoice_tax_id text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'storage', 'extensions', 'pg_temp'
AS $function$
declare
  created_application_id uuid;
  normalized_company_name text := nullif(btrim(coalesce(p_invoice_company_name, '')), '');
  normalized_tax_id text := nullif(btrim(coalesce(p_invoice_tax_id, '')), '');
begin
  if (normalized_company_name is null) <> (normalized_tax_id is null) then
    raise exception 'Invoice company name and tax id must be provided together'
      using errcode = '22023';
  end if;
  if normalized_tax_id is not null and normalized_tax_id !~ '^[0-9]{8}$' then
    raise exception 'Invoice tax id must contain exactly eight digits'
      using errcode = '22023';
  end if;

  created_application_id := public.submit_professional_application_with_certificates(
    p_studio_name,
    p_contact_name,
    p_phone,
    p_address,
    p_social_media,
    p_certificate,
    p_application_id,
    coalesce(p_certificates, '[]'::jsonb)
  );

  update public.professional_applications
  set
    invoice_company_name = normalized_company_name,
    invoice_tax_id = normalized_tax_id
  where id = created_application_id;

  return created_application_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_professional_application_with_certificates(p_studio_name text, p_contact_name text, p_phone text, p_address text, p_social_media text, p_certificate text, p_application_id uuid, p_certificates jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'storage', 'extensions', 'pg_temp'
AS $function$
declare
  current_user_id uuid := auth.uid();
  certificate_record record;
  certificate_count integer;
  certificate_path text;
  certificate_name text;
  certificate_mime text;
  certificate_size integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_application_id is null then
    raise exception 'Application id is required' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.professional_applications
    where user_id = current_user_id and status = 'pending'
  ) then
    raise exception 'A pending application already exists' using errcode = '23505';
  end if;
  if nullif(btrim(p_studio_name), '') is null
    or nullif(btrim(p_contact_name), '') is null
    or nullif(btrim(p_phone), '') is null
    or nullif(btrim(p_address), '') is null
    or nullif(btrim(p_social_media), '') is null
    or nullif(btrim(p_certificate), '') is null
  then
    raise exception 'All application fields are required' using errcode = '22023';
  end if;
  if p_certificates is null or jsonb_typeof(p_certificates) <> 'array' then
    raise exception 'Certificates must be an array' using errcode = '22023';
  end if;

  certificate_count := jsonb_array_length(p_certificates);
  if certificate_count > 3 then
    raise exception 'At most three certificate images are allowed' using errcode = '22023';
  end if;

  -- Verify every referenced private object before creating the application.
  for certificate_record in
    select value, ordinality
    from jsonb_array_elements(p_certificates) with ordinality
  loop
    certificate_path := btrim(certificate_record.value ->> 'storage_path');
    certificate_name := left(btrim(certificate_record.value ->> 'original_name'), 255);
    certificate_mime := btrim(certificate_record.value ->> 'mime_type');
    certificate_size := nullif(certificate_record.value ->> 'file_size', '')::integer;

    if certificate_path !~ ('^' || current_user_id::text || '/' || p_application_id::text || '/[^/]+$')
      or certificate_name = ''
      or certificate_mime not in ('image/jpeg', 'image/png', 'image/webp')
      or certificate_size is null
      or certificate_size not between 1 and 5242880
      or not exists (
        select 1 from storage.objects object
        where object.bucket_id = 'professional-certificates'
          and object.name = certificate_path
      )
    then
      raise exception 'Invalid certificate image metadata' using errcode = '22023';
    end if;
  end loop;

  insert into public.professional_applications (
    id, studio_name, contact_name, phone, address, social_media, certificate,
    user_id, user_email, status, source
  )
  select
    p_application_id, btrim(p_studio_name), btrim(p_contact_name), btrim(p_phone),
    btrim(p_address), btrim(p_social_media), btrim(p_certificate),
    current_user_id, profile.email, 'pending', 'standalone'
  from public.profiles profile
  where profile.id = current_user_id;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  insert into public.professional_application_certificates (
    application_id, storage_path, original_name, mime_type, file_size, sort_order, uploaded_by
  )
  select
    p_application_id,
    btrim(entry.value ->> 'storage_path'),
    left(btrim(entry.value ->> 'original_name'), 255),
    btrim(entry.value ->> 'mime_type'),
    (entry.value ->> 'file_size')::integer,
    (entry.ordinality - 1)::integer,
    current_user_id
  from jsonb_array_elements(p_certificates) with ordinality entry;

  perform set_config('app.eclado_allow_profile_security_update', 'true', true);
  update public.profiles set role = 'pending' where id = current_user_id;
  perform set_config('app.eclado_allow_profile_security_update', 'false', true);

  return p_application_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_professional_renewal_application()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  member_id uuid := auth.uid();
  today date := (now() at time zone 'Asia/Taipei')::date;
  target_assessment_year integer := extract(year from today)::integer;
  target_role text;
  target_membership public.professional_memberships%rowtype;
  existing public.professional_renewal_applications%rowtype;
  created public.professional_renewal_applications%rowtype;
begin
  if member_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if extract(month from today)::integer not between 10 and 12 then
    raise exception 'Renewal applications are open from October 1 through December 31' using errcode = '22023';
  end if;

  select profile.role into target_role
  from public.profiles profile
  where profile.id = member_id;
  if target_role not in ('instructor', 'distributor') then
    raise exception 'Active instructor or distributor membership required' using errcode = '42501';
  end if;

  select * into target_membership
  from public.professional_memberships membership
  where membership.user_id = member_id
    and membership.role = target_role
    and today >= membership.started_on
    and today < coalesce(membership.ended_on, 'infinity'::date)
  order by membership.started_on desc
  limit 1
  for update;
  if not found then
    raise exception 'Active professional membership not found' using errcode = 'P0002';
  end if;

  select * into existing
  from public.professional_renewal_applications application
  where application.user_id = member_id
    and application.renewal_year = target_assessment_year + 1;
  if found then
    return to_jsonb(existing);
  end if;

  insert into public.professional_renewal_applications (
    user_id, membership_id, assessment_year, renewal_year, role
  ) values (
    member_id, target_membership.id, target_assessment_year, target_assessment_year + 1, target_role
  ) returning * into created;

  return to_jsonb(created);
exception
  when unique_violation then
    select * into existing
    from public.professional_renewal_applications application
    where application.user_id = member_id
      and application.renewal_year = target_assessment_year + 1;
    return to_jsonb(existing);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_approved_application_invoice_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  should_sync boolean := false;
begin
  if new.status = 'approved' and new.user_id is not null then
    if tg_op = 'INSERT' then
      should_sync := true;
    elsif tg_op = 'UPDATE' then
      should_sync := old.status is distinct from 'approved';
    end if;
  end if;

  if should_sync then
    update public.profiles profile
    set
      default_invoice_company_name = coalesce(
        nullif(btrim(new.invoice_company_name), ''),
        profile.default_invoice_company_name
      ),
      default_invoice_tax_id = coalesce(
        nullif(btrim(new.invoice_tax_id), ''),
        profile.default_invoice_tax_id
      ),
      updated_at = now()
    where profile.id = new.user_id;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_assisted_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op='INSERT' then
    perform public.allocate_assisted_inventory(new.id,new.items,false);
  elsif new.items is distinct from old.items then raise exception 'Assisted order items are locked' using errcode='55000';
  elsif old.status='cancelled' and new.status='paid' then
    perform public.allocate_assisted_inventory(new.id,new.items,false);
    -- Verified late payment uses the existing strict gift-stock checks.
    update public.promotion_gift_reservations set status='reserved',expires_at=now()+interval '5 minutes'
      where order_id=new.id and status='released';
    perform public.allocate_assisted_inventory(new.id,new.items,true);
  elsif new.status in ('paid','preparing','ready_for_pickup','picked_up','shipped','delivered') and old.status in ('unpaid','awaiting_confirm') then
    perform public.allocate_assisted_inventory(new.id,new.items,true);
  elsif new.status in ('cancelled','returned') and old.status not in ('cancelled','returned') then
    perform public.release_assisted_inventory(new.id);
  end if;
  if new.status in ('ready_for_pickup','picked_up','shipped','delivered') then perform public.close_backorders_for_fulfillment(new.id); end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_coupon_redemption_from_order_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered') then
    update public.coupon_redemptions
    set status = 'redeemed', redeemed_at = coalesce(redeemed_at, now()), released_at = null,
        release_reason = null
    where order_id = new.id and status = 'reserved';
  elsif new.status in ('cancelled', 'returned') then
    update public.coupon_redemptions
    set status = 'released', released_at = coalesce(released_at, now()),
        release_reason = 'order_' || new.status
    where order_id = new.id and status = 'reserved';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_gift_reservation_from_order_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status in ('cancelled','returned') then
    update public.promotion_gift_reservations
    set status='released', released_at=coalesce(released_at,now()), release_reason='order_'||new.status
    where order_id=new.id and status in ('reserved','consumed');
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_inventory_allocation_for_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'INSERT' then
    if public.order_consumes_inventory(new.status) then
      perform public.allocate_inventory_for_paid_order(new.id, new.items);
    end if;
    if new.status in ('ready_for_pickup', 'picked_up', 'shipped', 'delivered') then
      perform public.close_backorders_for_fulfillment(new.id);
    end if;
    return new;
  end if;

  if public.order_consumes_inventory(old.status)
    and public.order_consumes_inventory(new.status)
    and old.items is distinct from new.items
  then
    raise exception 'Paid order items cannot be changed after inventory allocation'
      using errcode = '55000';
  end if;

  if not public.order_consumes_inventory(old.status)
    and public.order_consumes_inventory(new.status)
  then
    perform public.allocate_inventory_for_paid_order(new.id, new.items);
  elsif public.order_consumes_inventory(old.status)
    and not public.order_consumes_inventory(new.status)
  then
    perform public.release_inventory_for_order(old.id);
  end if;

  if new.status in ('ready_for_pickup', 'picked_up', 'shipped', 'delivered') then
    perform public.close_backorders_for_fulfillment(new.id);
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_inventory_for_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    if public.order_consumes_inventory(new.status) then
      perform public.adjust_inventory_for_order(new.items, -1);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if public.order_consumes_inventory(old.status) and not public.order_consumes_inventory(new.status) then
      perform public.adjust_inventory_for_order(old.items, 1);
    elsif not public.order_consumes_inventory(old.status) and public.order_consumes_inventory(new.status) then
      perform public.adjust_inventory_for_order(new.items, -1);
    elsif public.order_consumes_inventory(old.status) and public.order_consumes_inventory(new.status) and old.items is distinct from new.items then
      perform public.adjust_inventory_for_order(old.items, 1);
      perform public.adjust_inventory_for_order(new.items, -1);
    end if;

    return new;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_product_publication_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'UPDATE'
    and new.publication_status is not distinct from old.publication_status
    and new.active is distinct from old.active
  then
    -- Temporary compatibility for older admin/API clients.
    new.publication_status := case when new.active then 'active' else 'archived' end;
  else
    new.active := new.publication_status = 'active';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_product_stock_mirror(target_product_id integer)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  update public.products product
  set stock = variant.stock
  from public.product_variants variant
  where product.id = target_product_id
    and variant.product_id = product.id
    and variant.is_default is true
    and product.stock is distinct from variant.stock;
$function$;

CREATE OR REPLACE FUNCTION public.sync_shipping_group_from_order_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.order_source = 'admin_assisted' then return new; end if;
  if new.shipping_group_id is not null
    and (
      new.status is distinct from old.status
      or new.shipping_group_id is distinct from old.shipping_group_id
    )
  then
    perform public.refund_shipping_group_fee(new.shipping_group_id);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_shopping_credit_from_order_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  reservation_status text;
  release_reason text;
begin
  if new.shopping_credit_amount <= 0 or new.status is not distinct from old.status then
    return new;
  end if;

  select reservation.status
  into reservation_status
  from public.shopping_credit_order_reservations reservation
  where reservation.order_id = new.id;

  if reservation_status is null then
    raise exception 'Shopping credit reservation is missing for order %', new.id
      using errcode = '23514';
  end if;

  if new.status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered') then
    if reservation_status = 'reserved' then
      perform public.consume_order_shopping_credit(new.id);
    elsif reservation_status not in ('consumed', 'refunded') then
      raise exception 'Shopping credit reservation cannot enter a paid order state'
        using errcode = '55000';
    end if;
  elsif new.status in ('cancelled', 'returned') then
    if reservation_status = 'reserved' then
      release_reason := case
        when new.payment_due_at <= now() then 'order_expired'
        else 'order_cancelled'
      end;
      perform public.release_order_shopping_credit(new.id, release_reason);
    elsif reservation_status = 'consumed' then
      perform public.refund_order_shopping_credit(new.id);
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_inventory_count_item(p_item_id bigint, p_actual_quantity integer, p_expected_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  updated_item public.inventory_count_items;
  target_status text;
begin
  if not public.has_backoffice_permission('inventory_counts.manage') then
    raise exception 'Inventory count authorization required' using errcode = '42501';
  end if;
  if p_actual_quantity is not null and p_actual_quantity < 0 then
    raise exception '實際數量不可小於 0' using errcode = '22023';
  end if;

  -- Serialize item saves with completion. Different items can still be saved
  -- concurrently because they only share a non-exclusive lock on the session.
  select session.status into target_status
  from public.inventory_count_sessions session
  join public.inventory_count_items item on item.session_id = session.id
  where item.id = p_item_id
  for share of session;
  if not found then raise exception '找不到盤點項目' using errcode = 'P0002'; end if;
  if target_status <> 'draft' then
    raise exception '盤點單已完成，無法修改' using errcode = '55000';
  end if;

  update public.inventory_count_items item
  set actual_quantity = p_actual_quantity,
      variance = case when p_actual_quantity is null then null else p_actual_quantity - item.expected_physical_snapshot end,
      counted_by = case when p_actual_quantity is null then null else auth.uid() end,
      counted_by_email = case when p_actual_quantity is null then null else coalesce(auth.jwt() ->> 'email', '') end,
      counted_at = case when p_actual_quantity is null then null else now() end,
      version = item.version + 1,
      updated_at = now()
  from public.inventory_count_sessions session
  where item.id = p_item_id
    and item.session_id = session.id
    and session.status = 'draft'
    and item.version = p_expected_version
  returning item.* into updated_item;

  if not found then
    if exists (
      select 1 from public.inventory_count_items item
      join public.inventory_count_sessions session on session.id = item.session_id
      where item.id = p_item_id and session.status = 'completed'
    ) then
      raise exception '盤點單已完成，無法修改' using errcode = '55000';
    end if;
    raise exception '此項目已被其他工作階段更新，請重新載入最新數量' using errcode = '40001';
  end if;

  return to_jsonb(updated_item);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_purchase_order_status(p_order_id bigint, p_status text)
 RETURNS purchase_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare saved public.purchase_orders%rowtype;
begin
  if not public.is_eclado_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_status not in ('draft', 'pending', 'ordered', 'shipping', 'received') then
    raise exception 'Invalid purchase order status' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.purchase_orders
    where id = p_order_id
      and status in ('ordered', 'shipping', 'received')
      and p_status in ('draft', 'pending')
  ) then
    raise exception 'Processed purchase orders cannot return to draft or pending' using errcode = '22023';
  end if;
  update public.purchase_orders set
    status = p_status,
    ordered_at = case when p_status = 'ordered' and ordered_at is null then now() else ordered_at end,
    received_at = case when p_status = 'received' and received_at is null then now() else received_at end
  where id = p_order_id
  returning * into saved;
  if saved.id is null then raise exception 'Purchase order not found' using errcode = 'P0002'; end if;
  return saved;
end;
$function$;

CREATE OR REPLACE FUNCTION public.validate_coupon_promotion_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if not exists (
    select 1
    from public.promotions promotion
    where promotion.id = new.promotion_id
      and promotion.activation_type = 'coupon_only'
      and promotion.archived_at is null
  ) then
    raise exception 'Coupon campaigns can only include active coupon-only promotion definitions'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

UPDATE public.products SET slug=public.make_product_slug(name) WHERE slug IS NULL;

ALTER TABLE public.products ALTER COLUMN slug SET NOT NULL;

UPDATE public.products SET publication_status=CASE WHEN active THEN 'active' ELSE 'archived' END;

ALTER TABLE public."professional_applications" DROP CONSTRAINT "professional_applications_source_check";

ALTER TABLE public."professional_applications" DROP CONSTRAINT "professional_applications_status_check";

ALTER TABLE public."profiles" DROP CONSTRAINT "profiles_line_user_id_key";

ALTER TABLE public."admin_preferences" ADD CONSTRAINT "admin_preferences_pkey" PRIMARY KEY (user_id);

ALTER TABLE public."admin_preferences" ADD CONSTRAINT "admin_preferences_sidebar_favorites_check" CHECK (cardinality(sidebar_favorites) <= 30 AND array_to_string(sidebar_favorites, ','::text) ~ '^[a-z_,]*$'::text);

ALTER TABLE public."admin_users" ADD CONSTRAINT "admin_users_pkey" PRIMARY KEY (user_id);

ALTER TABLE public."api_rate_limits" ADD CONSTRAINT "api_rate_limits_pkey" PRIMARY KEY (scope, key_hash, window_started_at);

ALTER TABLE public."api_rate_limits" ADD CONSTRAINT "api_rate_limits_request_count_check" CHECK (request_count >= 0);

ALTER TABLE public."assisted_order_requests" ADD CONSTRAINT "assisted_order_requests_link_token_key" UNIQUE (link_token);

ALTER TABLE public."assisted_order_requests" ADD CONSTRAINT "assisted_order_requests_order_id_key" UNIQUE (order_id);

ALTER TABLE public."assisted_order_requests" ADD CONSTRAINT "assisted_order_requests_pkey" PRIMARY KEY (request_key);

ALTER TABLE public."audit_logs" ADD CONSTRAINT "audit_logs_actor_type_check" CHECK (actor_type = ANY (ARRAY['admin'::text, 'system'::text, 'api'::text]));

ALTER TABLE public."audit_logs" ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY (id);

ALTER TABLE public."backoffice_role_permissions" ADD CONSTRAINT "backoffice_role_permissions_permission_check" CHECK (permission = 'instructor_students.manage'::text OR permission = 'member_pricing.manage'::text OR (permission = ANY (ARRAY['catalog.read'::text, 'catalog.write'::text, 'orders.read'::text, 'orders.write'::text, 'members.read'::text, 'members.write'::text, 'promotions.manage'::text, 'procurement.manage'::text, 'analytics.read'::text, 'audit_logs.read'::text, 'notifications.send'::text, 'backorders.manage'::text, 'inventory_counts.manage'::text, 'shopping_credit.manage'::text])));

ALTER TABLE public."backoffice_role_permissions" ADD CONSTRAINT "backoffice_role_permissions_pkey" PRIMARY KEY (role, permission);

ALTER TABLE public."backoffice_roles" ADD CONSTRAINT "backoffice_roles_pkey" PRIMARY KEY (role);

ALTER TABLE public."coupon_campaign_members" ADD CONSTRAINT "coupon_campaign_members_coupon_campaign_id_user_id_key" UNIQUE (coupon_campaign_id, user_id);

ALTER TABLE public."coupon_campaign_members" ADD CONSTRAINT "coupon_campaign_members_pkey" PRIMARY KEY (id);

ALTER TABLE public."coupon_campaigns" ADD CONSTRAINT "coupon_campaigns_audience_mode_check" CHECK (audience_mode = 'roles'::text AND cardinality(audience_roles) > 0 AND audience_roles <@ ARRAY['consumer'::text, 'pro'::text, 'instructor'::text, 'distributor'::text, 'staff'::text] OR audience_mode = 'members'::text AND cardinality(audience_roles) = 0 AND allow_guest IS FALSE);

ALTER TABLE public."coupon_campaigns" ADD CONSTRAINT "coupon_campaigns_name_check" CHECK (NULLIF(btrim(name), ''::text) IS NOT NULL);

ALTER TABLE public."coupon_campaigns" ADD CONSTRAINT "coupon_campaigns_per_member_limit_check" CHECK (per_member_limit IS NULL OR per_member_limit > 0);

ALTER TABLE public."coupon_campaigns" ADD CONSTRAINT "coupon_campaigns_period_check" CHECK (start_at IS NULL OR end_at IS NULL OR start_at < end_at);

ALTER TABLE public."coupon_campaigns" ADD CONSTRAINT "coupon_campaigns_pkey" PRIMARY KEY (id);

ALTER TABLE public."coupon_campaigns" ADD CONSTRAINT "coupon_campaigns_stacking_policy_check" CHECK (stacking_policy = ANY (ARRAY['coupon_only'::text, 'allow_auto_gifts'::text, 'allow_all'::text]));

ALTER TABLE public."coupon_campaigns" ADD CONSTRAINT "coupon_campaigns_total_usage_limit_check" CHECK (total_usage_limit IS NULL OR total_usage_limit > 0);

ALTER TABLE public."coupon_promotions" ADD CONSTRAINT "coupon_promotions_coupon_campaign_id_promotion_id_key" UNIQUE (coupon_campaign_id, promotion_id);

ALTER TABLE public."coupon_promotions" ADD CONSTRAINT "coupon_promotions_pkey" PRIMARY KEY (id);

ALTER TABLE public."coupon_promotions" ADD CONSTRAINT "coupon_promotions_sort_order_check" CHECK (sort_order >= 0);

ALTER TABLE public."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_campaign_id_order_id_key" UNIQUE (coupon_campaign_id, order_id);

ALTER TABLE public."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_identity_check" CHECK (user_id IS NOT NULL OR NULLIF(guest_identity_hash, ''::text) IS NOT NULL);

ALTER TABLE public."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_lifecycle_check" CHECK (status = 'reserved'::text AND redeemed_at IS NULL AND released_at IS NULL OR status = 'redeemed'::text AND redeemed_at IS NOT NULL AND released_at IS NULL OR status = 'released'::text AND released_at IS NOT NULL);

ALTER TABLE public."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY (id);

ALTER TABLE public."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_status_check" CHECK (status = ANY (ARRAY['reserved'::text, 'redeemed'::text, 'released'::text]));

ALTER TABLE public."instructor_student_audit_logs" ADD CONSTRAINT "instructor_student_audit_logs_actor_kind_check" CHECK (actor_kind = ANY (ARRAY['admin'::text, 'system'::text]));

ALTER TABLE public."instructor_student_audit_logs" ADD CONSTRAINT "instructor_student_audit_logs_event_type_check" CHECK (event_type = ANY (ARRAY['global_settings'::text, 'instructor_type'::text, 'bind'::text, 'unbind'::text, 'rebind'::text, 'member_deleted'::text]));

ALTER TABLE public."instructor_student_audit_logs" ADD CONSTRAINT "instructor_student_audit_logs_pkey" PRIMARY KEY (id);

ALTER TABLE public."instructor_student_bindings" ADD CONSTRAINT "instructor_student_bindings_check" CHECK (student_id <> instructor_id);

ALTER TABLE public."instructor_student_bindings" ADD CONSTRAINT "instructor_student_bindings_check1" CHECK (ended_at IS NULL AND ended_by IS NULL AND end_reason IS NULL OR ended_at IS NOT NULL AND end_reason IS NOT NULL);

ALTER TABLE public."instructor_student_bindings" ADD CONSTRAINT "instructor_student_bindings_end_reason_check" CHECK (end_reason = ANY (ARRAY['unbound'::text, 'rebound'::text, 'member_deleted'::text]));

ALTER TABLE public."instructor_student_bindings" ADD CONSTRAINT "instructor_student_bindings_pkey" PRIMARY KEY (id);

ALTER TABLE public."instructor_student_settings" ADD CONSTRAINT "instructor_student_settings_pkey" PRIMARY KEY (instructor_id);

ALTER TABLE public."instructor_student_settings" ADD CONSTRAINT "instructor_student_settings_student_price_type_check" CHECK (student_price_type = ANY (ARRAY['student_1'::text, 'student_2'::text]));

ALTER TABLE public."instructor_student_settings" ADD CONSTRAINT "instructor_student_settings_version_check" CHECK (version >= 0);

ALTER TABLE public."inventory_allocation_events" ADD CONSTRAINT "inventory_allocation_events_event_type_check" CHECK (event_type = ANY (ARRAY['payment_allocate'::text, 'fifo_allocate'::text, 'fulfillment_close'::text, 'release'::text]));

ALTER TABLE public."inventory_allocation_events" ADD CONSTRAINT "inventory_allocation_events_pkey" PRIMARY KEY (id);

ALTER TABLE public."inventory_allocation_events" ADD CONSTRAINT "inventory_allocation_events_quantity_check" CHECK (quantity > 0);

ALTER TABLE public."inventory_count_items" ADD CONSTRAINT "inventory_count_items_actual_quantity_check" CHECK (actual_quantity IS NULL OR actual_quantity >= 0);

ALTER TABLE public."inventory_count_items" ADD CONSTRAINT "inventory_count_items_check" CHECK (actual_quantity IS NULL AND variance IS NULL AND counted_at IS NULL OR actual_quantity IS NOT NULL AND variance = (actual_quantity - expected_physical_snapshot) AND counted_at IS NOT NULL);

ALTER TABLE public."inventory_count_items" ADD CONSTRAINT "inventory_count_items_expected_physical_snapshot_check" CHECK (expected_physical_snapshot >= 0);

ALTER TABLE public."inventory_count_items" ADD CONSTRAINT "inventory_count_items_inventory_type_check" CHECK (inventory_type = ANY (ARRAY['sale'::text, 'gift'::text]));

ALTER TABLE public."inventory_count_items" ADD CONSTRAINT "inventory_count_items_ledger_quantity_after_check" CHECK (ledger_quantity_after IS NULL OR ledger_quantity_after >= 0);

ALTER TABLE public."inventory_count_items" ADD CONSTRAINT "inventory_count_items_onsite_allocated_snapshot_check" CHECK (onsite_allocated_snapshot >= 0);

ALTER TABLE public."inventory_count_items" ADD CONSTRAINT "inventory_count_items_pkey" PRIMARY KEY (id);

ALTER TABLE public."inventory_count_items" ADD CONSTRAINT "inventory_count_items_session_id_product_variant_id_invento_key" UNIQUE (session_id, product_variant_id, inventory_type);

ALTER TABLE public."inventory_count_items" ADD CONSTRAINT "inventory_count_items_shortage_quantity_check" CHECK (shortage_quantity >= 0);

ALTER TABLE public."inventory_count_items" ADD CONSTRAINT "inventory_count_items_system_stock_snapshot_check" CHECK (system_stock_snapshot >= 0);

ALTER TABLE public."inventory_count_items" ADD CONSTRAINT "inventory_count_items_version_check" CHECK (version >= 0);

ALTER TABLE public."inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_check" CHECK (status = 'draft'::text AND completed_at IS NULL OR status = 'completed'::text AND completed_at IS NOT NULL);

ALTER TABLE public."inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_name_check" CHECK (length(TRIM(BOTH FROM name)) >= 1 AND length(TRIM(BOTH FROM name)) <= 100);

ALTER TABLE public."inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_pkey" PRIMARY KEY (id);

ALTER TABLE public."inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'completed'::text]));

ALTER TABLE public."inventory_count_shortages" ADD CONSTRAINT "inventory_count_shortages_check" CHECK (resolved_quantity >= 0 AND resolved_quantity <= quantity);

ALTER TABLE public."inventory_count_shortages" ADD CONSTRAINT "inventory_count_shortages_inventory_type_check" CHECK (inventory_type = ANY (ARRAY['sale'::text, 'gift'::text]));

ALTER TABLE public."inventory_count_shortages" ADD CONSTRAINT "inventory_count_shortages_pkey" PRIMARY KEY (id);

ALTER TABLE public."inventory_count_shortages" ADD CONSTRAINT "inventory_count_shortages_quantity_check" CHECK (quantity > 0);

ALTER TABLE public."inventory_count_shortages" ADD CONSTRAINT "inventory_count_shortages_resolved_quantity_check" CHECK (resolved_quantity >= 0 AND resolved_quantity <= quantity);

ALTER TABLE public."inventory_count_shortages" ADD CONSTRAINT "inventory_count_shortages_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'resolved'::text, 'closed'::text]));

ALTER TABLE public."member_admin_notes" ADD CONSTRAINT "member_admin_notes_note_check" CHECK (char_length(note) >= 1 AND char_length(note) <= 1000);

ALTER TABLE public."member_admin_notes" ADD CONSTRAINT "member_admin_notes_pkey" PRIMARY KEY (user_id);

ALTER TABLE public."membership_tiers" ADD CONSTRAINT "membership_tiers_pkey" PRIMARY KEY (role);

ALTER TABLE public."membership_tiers" ADD CONSTRAINT "membership_tiers_professional_price_multiplier_check" CHECK (professional_price_multiplier IS NULL OR professional_price_multiplier > 0::numeric);

ALTER TABLE public."order_adjustments" ADD CONSTRAINT "order_adjustments_adjustment_type_check" CHECK (adjustment_type = ANY (ARRAY['percentage_discount'::text, 'fixed_discount'::text, 'amount_gift'::text, 'quantity_gift'::text, 'free_shipping'::text]));

ALTER TABLE public."order_adjustments" ADD CONSTRAINT "order_adjustments_amount_check" CHECK (amount >= 0::numeric);

ALTER TABLE public."order_adjustments" ADD CONSTRAINT "order_adjustments_gift_check" CHECK ((adjustment_type = ANY (ARRAY['amount_gift'::text, 'quantity_gift'::text])) AND gift_product_id IS NOT NULL AND gift_variant_id IS NOT NULL AND gift_quantity IS NOT NULL AND gift_quantity > 0 AND amount = 0::numeric OR (adjustment_type <> ALL (ARRAY['amount_gift'::text, 'quantity_gift'::text])) AND gift_product_id IS NULL AND gift_variant_id IS NULL AND gift_quantity IS NULL);

ALTER TABLE public."order_adjustments" ADD CONSTRAINT "order_adjustments_pkey" PRIMARY KEY (id);

ALTER TABLE public."order_adjustments" ADD CONSTRAINT "order_adjustments_sort_order_check" CHECK (sort_order >= 0);

ALTER TABLE public."order_admin_notes" ADD CONSTRAINT "order_admin_notes_note_check" CHECK (char_length(note) >= 1 AND char_length(note) <= 1000);

ALTER TABLE public."order_admin_notes" ADD CONSTRAINT "order_admin_notes_pkey" PRIMARY KEY (order_id);

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_allocated_qty_check" CHECK (allocated_qty >= 0);

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_backorder_qty_check" CHECK (backorder_qty >= 0);

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_check" CHECK ((allocated_qty + backorder_qty) <= requested_qty);

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_check1" CHECK (stock_deducted_qty <= allocated_qty);

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_closed_backorder_qty_check" CHECK (closed_backorder_qty >= 0);

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_closed_quantity_check" CHECK ((allocated_qty + backorder_qty + closed_backorder_qty) <= requested_qty);

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_item_index_check" CHECK (item_index >= 0);

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_line_type_check" CHECK (line_type = ANY (ARRAY['merchandise'::text, 'gift'::text]));

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_order_id_item_index_key" UNIQUE (order_id, item_index);

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_pkey" PRIMARY KEY (id);

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_released_qty_check" CHECK (released_qty >= 0);

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_requested_qty_check" CHECK (requested_qty > 0);

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_source_check" CHECK (source = ANY (ARRAY['payment_allocation'::text, 'legacy_snapshot'::text, 'promotion_gift'::text]));

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_state_check" CHECK (state = ANY (ARRAY['allocated'::text, 'partial'::text, 'backordered'::text, 'closed'::text, 'released'::text]));

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_stock_deducted_qty_check" CHECK (stock_deducted_qty >= 0);

ALTER TABLE public."order_payment_attempts" ADD CONSTRAINT "order_payment_attempts_attempt_no_check" CHECK (attempt_no > 0);

ALTER TABLE public."order_payment_attempts" ADD CONSTRAINT "order_payment_attempts_order_id_attempt_no_key" UNIQUE (order_id, attempt_no);

ALTER TABLE public."order_payment_attempts" ADD CONSTRAINT "order_payment_attempts_payment_state_check" CHECK (payment_state = ANY (ARRAY['initiated'::text, 'pending'::text, 'paid'::text, 'failed'::text, 'expired'::text, 'cancelled'::text]));

ALTER TABLE public."order_payment_attempts" ADD CONSTRAINT "order_payment_attempts_pkey" PRIMARY KEY (id);

ALTER TABLE public."order_payment_attempts" ADD CONSTRAINT "order_payment_attempts_provider_order_no_key" UNIQUE (provider_order_no);

ALTER TABLE public."order_payment_authorizations" ADD CONSTRAINT "order_payment_authorizations_pkey" PRIMARY KEY (order_id);

ALTER TABLE public."order_payment_instructions" ADD CONSTRAINT "order_payment_instructions_payment_state_check" CHECK (payment_state = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'expired'::text, 'cancelled'::text]));

ALTER TABLE public."order_payment_instructions" ADD CONSTRAINT "order_payment_instructions_pkey" PRIMARY KEY (order_id);

ALTER TABLE public."orders" ADD CONSTRAINT "orders_assisted_payment_method_check" CHECK (assisted_payment_method = ANY (ARRAY['card'::text, 'atm'::text, 'apple'::text, 'google'::text]));

ALTER TABLE public."orders" ADD CONSTRAINT "orders_fulfillment_method_check" CHECK (fulfillment_method = ANY (ARRAY['delivery'::text, 'onsite_pickup'::text]));

ALTER TABLE public."orders" ADD CONSTRAINT "orders_invoice_company_fields_check" CHECK (invoice_type IS DISTINCT FROM 'company'::text OR NULLIF(btrim(invoice_company_name), ''::text) IS NOT NULL AND NULLIF(btrim(invoice_tax_id), ''::text) IS NOT NULL AND btrim(invoice_tax_id) ~ '^[0-9]{8}$'::text);

ALTER TABLE public."orders" ADD CONSTRAINT "orders_invoice_type_check" CHECK (invoice_type IS NULL OR (invoice_type = ANY (ARRAY['personal'::text, 'company'::text])));

ALTER TABLE public."orders" ADD CONSTRAINT "orders_order_source_check" CHECK (order_source = 'admin_assisted'::text OR (order_source = ANY (ARRAY['online'::text, 'historical_manual'::text])));

ALTER TABLE public."orders" ADD CONSTRAINT "orders_payment_amount_check" CHECK (payment_amount >= 0::numeric);

ALTER TABLE public."orders" ADD CONSTRAINT "orders_payment_amount_consistency_check" CHECK ((payment_amount + shopping_credit_amount::numeric) = total);

ALTER TABLE public."orders" ADD CONSTRAINT "orders_payment_notification_channel_check" CHECK (payment_notification_channel IS NULL OR (payment_notification_channel = ANY (ARRAY['line'::text, 'email'::text])));

ALTER TABLE public."orders" ADD CONSTRAINT "orders_shipment_notification_channel_check" CHECK (shipment_notification_channel IS NULL OR (shipment_notification_channel = ANY (ARRAY['line'::text, 'email'::text])));

ALTER TABLE public."orders" ADD CONSTRAINT "orders_shopping_credit_amount_check" CHECK (shopping_credit_amount >= 0);

ALTER TABLE public."orders" DROP CONSTRAINT "orders_status_check";

ALTER TABLE public."orders" ADD CONSTRAINT "orders_status_check" CHECK (status = ANY (ARRAY['awaiting_confirm'::text, 'unpaid'::text, 'paid'::text, 'preparing'::text, 'ready_for_pickup'::text, 'picked_up'::text, 'shipped'::text, 'delivered'::text, 'returned'::text, 'cancelled'::text]));

ALTER TABLE public."orders" DROP CONSTRAINT "orders_type_check";

ALTER TABLE public."orders" ADD CONSTRAINT "orders_type_check" CHECK (type = ANY (ARRAY['consumer'::text, 'pro'::text, 'instructor'::text, 'distributor'::text, 'staff'::text, 'pending'::text]));

ALTER TABLE public."procurement_addresses" ADD CONSTRAINT "procurement_addresses_address_not_blank" CHECK (btrim(address_text) <> ''::text);

ALTER TABLE public."procurement_addresses" ADD CONSTRAINT "procurement_addresses_pkey" PRIMARY KEY (id);

ALTER TABLE public."procurement_addresses" ADD CONSTRAINT "procurement_addresses_usage_count_check" CHECK (usage_count >= 0);

ALTER TABLE public."product_images" ADD CONSTRAINT "product_images_file_size_check" CHECK (file_size IS NULL OR file_size >= 1 AND file_size <= 5242880);

ALTER TABLE public."product_images" ADD CONSTRAINT "product_images_height_check" CHECK (height IS NULL OR height > 0);

ALTER TABLE public."product_images" ADD CONSTRAINT "product_images_mime_type_check" CHECK (mime_type IS NULL OR (mime_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text])));

ALTER TABLE public."product_images" ADD CONSTRAINT "product_images_pkey" PRIMARY KEY (id);

ALTER TABLE public."product_images" ADD CONSTRAINT "product_images_sort_order_check" CHECK (sort_order >= 0);

ALTER TABLE public."product_images" ADD CONSTRAINT "product_images_storage_path_check" CHECK (btrim(storage_path) <> ''::text AND storage_path !~ '^/'::text AND storage_path ~ '^products/[^/]+/[^/]+$'::text);

ALTER TABLE public."product_images" ADD CONSTRAINT "product_images_storage_path_key" UNIQUE (storage_path);

ALTER TABLE public."product_images" ADD CONSTRAINT "product_images_width_check" CHECK (width IS NULL OR width > 0);

ALTER TABLE public."product_variants" ADD CONSTRAINT "product_variants_gift_inventory_check" CHECK (gift_enabled = true AND active = true AND gift_stock >= 0 AND gift_min_stock >= 0 OR gift_enabled = false AND gift_stock = 0 AND gift_min_stock = 0);

ALTER TABLE public."product_variants" ADD CONSTRAINT "product_variants_pkey" PRIMARY KEY (id);

ALTER TABLE public."product_variants" ADD CONSTRAINT "product_variants_prices_nonnegative" CHECK (price >= 0::numeric AND pro_price >= 0::numeric);

ALTER TABLE public."product_variants" ADD CONSTRAINT "product_variants_procurement_unit_cost_nonnegative" CHECK (procurement_unit_cost_usd IS NULL OR procurement_unit_cost_usd >= 0::numeric);

ALTER TABLE public."product_variants" ADD CONSTRAINT "product_variants_size_not_blank" CHECK (btrim(size) <> ''::text);

ALTER TABLE public."product_variants" ADD CONSTRAINT "product_variants_sku_not_blank" CHECK (btrim(sku) <> ''::text);

ALTER TABLE public."product_variants" ADD CONSTRAINT "product_variants_sort_order_nonnegative" CHECK (sort_order >= 0);

ALTER TABLE public."product_variants" ADD CONSTRAINT "product_variants_stock_check" CHECK (stock IS NULL OR stock >= 0);

ALTER TABLE public."product_variants" ADD CONSTRAINT "product_variants_stock_nonnegative" CHECK (stock >= 0);

ALTER TABLE public."products" ADD CONSTRAINT "distributor_price_multiplier_check" CHECK (distributor_price_multiplier IS NULL OR distributor_price_multiplier > 0::numeric AND distributor_price_multiplier <= 1::numeric AND distributor_price_multiplier = round(distributor_price_multiplier, 3));

ALTER TABLE public."products" ADD CONSTRAINT "instructor_price_multiplier_check" CHECK (instructor_price_multiplier IS NULL OR instructor_price_multiplier > 0::numeric AND instructor_price_multiplier <= 1::numeric AND instructor_price_multiplier = round(instructor_price_multiplier, 3));

ALTER TABLE public."products" ADD CONSTRAINT "products_publication_status_check" CHECK (publication_status = ANY (ARRAY['draft'::text, 'active'::text, 'event_only'::text, 'gift_only'::text, 'archived'::text]));

ALTER TABLE public."products" ADD CONSTRAINT "products_slug_not_blank" CHECK (btrim(slug) <> ''::text);

ALTER TABLE public."products" ADD CONSTRAINT "staff_price_multiplier_check" CHECK (staff_price_multiplier IS NULL OR staff_price_multiplier > 0::numeric AND staff_price_multiplier <= 1::numeric AND staff_price_multiplier = round(staff_price_multiplier, 3));

ALTER TABLE public."professional_application_certificates" ADD CONSTRAINT "professional_application_certific_application_id_sort_order_key" UNIQUE (application_id, sort_order);

ALTER TABLE public."professional_application_certificates" ADD CONSTRAINT "professional_application_certificates_file_size_check" CHECK (file_size >= 1 AND file_size <= 5242880);

ALTER TABLE public."professional_application_certificates" ADD CONSTRAINT "professional_application_certificates_mime_type_check" CHECK (mime_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text]));

ALTER TABLE public."professional_application_certificates" ADD CONSTRAINT "professional_application_certificates_original_name_check" CHECK (char_length(original_name) >= 1 AND char_length(original_name) <= 255);

ALTER TABLE public."professional_application_certificates" ADD CONSTRAINT "professional_application_certificates_pkey" PRIMARY KEY (id);

ALTER TABLE public."professional_application_certificates" ADD CONSTRAINT "professional_application_certificates_sort_order_check" CHECK (sort_order >= 0 AND sort_order <= 2);

ALTER TABLE public."professional_application_certificates" ADD CONSTRAINT "professional_application_certificates_storage_path_check" CHECK (btrim(storage_path) <> ''::text AND storage_path !~ '^/'::text);

ALTER TABLE public."professional_application_certificates" ADD CONSTRAINT "professional_application_certificates_storage_path_key" UNIQUE (storage_path);

ALTER TABLE public."professional_applications" ADD CONSTRAINT "professional_applications_admin_notification_attempts_check" CHECK (admin_notification_attempts >= 0);

ALTER TABLE public."professional_applications" ADD CONSTRAINT "professional_applications_invoice_fields_check" CHECK (NULLIF(btrim(invoice_company_name), ''::text) IS NULL AND NULLIF(btrim(invoice_tax_id), ''::text) IS NULL OR NULLIF(btrim(invoice_company_name), ''::text) IS NOT NULL AND btrim(invoice_tax_id) ~ '^[0-9]{8}$'::text);

ALTER TABLE public."professional_award_evidence" ADD CONSTRAINT "professional_award_evidence_assessment_year_check" CHECK (assessment_year >= 2020 AND assessment_year <= 2200);

ALTER TABLE public."professional_award_evidence" ADD CONSTRAINT "professional_award_evidence_award_number_check" CHECK (char_length(btrim(award_number)) >= 1 AND char_length(btrim(award_number)) <= 100);

ALTER TABLE public."professional_award_evidence" ADD CONSTRAINT "professional_award_evidence_award_number_key_check" CHECK (char_length(award_number_key) >= 1 AND char_length(award_number_key) <= 100);

ALTER TABLE public."professional_award_evidence" ADD CONSTRAINT "professional_award_evidence_award_number_key_key" UNIQUE (award_number_key);

ALTER TABLE public."professional_award_evidence" ADD CONSTRAINT "professional_award_evidence_file_size_check" CHECK (file_size >= 1 AND file_size <= 5242880);

ALTER TABLE public."professional_award_evidence" ADD CONSTRAINT "professional_award_evidence_mime_type_check" CHECK (mime_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text]));

ALTER TABLE public."professional_award_evidence" ADD CONSTRAINT "professional_award_evidence_original_name_check" CHECK (char_length(original_name) >= 1 AND char_length(original_name) <= 255);

ALTER TABLE public."professional_award_evidence" ADD CONSTRAINT "professional_award_evidence_pkey" PRIMARY KEY (id);

ALTER TABLE public."professional_award_evidence" ADD CONSTRAINT "professional_award_evidence_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'void'::text]));

ALTER TABLE public."professional_award_evidence" ADD CONSTRAINT "professional_award_evidence_storage_path_check" CHECK (btrim(storage_path) <> ''::text AND storage_path !~ '^/'::text);

ALTER TABLE public."professional_award_evidence" ADD CONSTRAINT "professional_award_evidence_storage_path_key" UNIQUE (storage_path);

ALTER TABLE public."professional_award_evidence" ADD CONSTRAINT "professional_award_evidence_student_name_check" CHECK (char_length(btrim(student_name)) >= 1 AND char_length(btrim(student_name)) <= 100);

ALTER TABLE public."professional_evidence_entry_windows" ADD CONSTRAINT "professional_evidence_entry_windows_assessment_year_check" CHECK (assessment_year >= 2020 AND assessment_year <= 2200);

ALTER TABLE public."professional_evidence_entry_windows" ADD CONSTRAINT "professional_evidence_entry_windows_pkey" PRIMARY KEY (id);

ALTER TABLE public."professional_evidence_entry_windows" ADD CONSTRAINT "professional_evidence_entry_windows_reason_check" CHECK (char_length(btrim(reason)) >= 1 AND char_length(btrim(reason)) <= 500);

ALTER TABLE public."professional_evidence_entry_windows" ADD CONSTRAINT "professional_evidence_entry_windows_user_id_assessment_year_key" UNIQUE (user_id, assessment_year);

ALTER TABLE public."professional_memberships" ADD CONSTRAINT "professional_memberships_check" CHECK (ended_on IS NULL OR ended_on >= started_on);

ALTER TABLE public."professional_memberships" ADD CONSTRAINT "professional_memberships_pkey" PRIMARY KEY (id);

ALTER TABLE public."professional_memberships" ADD CONSTRAINT "professional_memberships_role_check" CHECK (role = ANY (ARRAY['instructor'::text, 'distributor'::text]));

ALTER TABLE public."professional_quarterly_notices" ADD CONSTRAINT "professional_quarterly_notice_user_id_quarter_start_version_key" UNIQUE (user_id, quarter_start, version);

ALTER TABLE public."professional_quarterly_notices" ADD CONSTRAINT "professional_quarterly_notices_attempt_count_check" CHECK (attempt_count >= 0);

ALTER TABLE public."professional_quarterly_notices" ADD CONSTRAINT "professional_quarterly_notices_channel_check" CHECK (channel IS NULL OR (channel = ANY (ARRAY['line'::text, 'email'::text])));

ALTER TABLE public."professional_quarterly_notices" ADD CONSTRAINT "professional_quarterly_notices_pkey" PRIMARY KEY (id);

ALTER TABLE public."professional_quarterly_notices" ADD CONSTRAINT "professional_quarterly_notices_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text]));

ALTER TABLE public."professional_quarterly_notices" ADD CONSTRAINT "professional_quarterly_notices_version_check" CHECK (version >= 1);

ALTER TABLE public."professional_renewal_applications" ADD CONSTRAINT "professional_renewal_applicat_result_notification_channel_check" CHECK (result_notification_channel IS NULL OR (result_notification_channel = ANY (ARRAY['line'::text, 'email'::text])));

ALTER TABLE public."professional_renewal_applications" ADD CONSTRAINT "professional_renewal_applications_assessment_year_check" CHECK (assessment_year >= 2020 AND assessment_year <= 2200);

ALTER TABLE public."professional_renewal_applications" ADD CONSTRAINT "professional_renewal_applications_b_approved_count_check" CHECK (b_approved_count >= 0);

ALTER TABLE public."professional_renewal_applications" ADD CONSTRAINT "professional_renewal_applications_check" CHECK (renewal_year = (assessment_year + 1));

ALTER TABLE public."professional_renewal_applications" ADD CONSTRAINT "professional_renewal_applications_pkey" PRIMARY KEY (id);

ALTER TABLE public."professional_renewal_applications" ADD CONSTRAINT "professional_renewal_applications_qualification_path_check" CHECK (qualification_path IS NULL OR (qualification_path = ANY (ARRAY['a_quarterly'::text, 'a_annual'::text, 'b_manual'::text])));

ALTER TABLE public."professional_renewal_applications" ADD CONSTRAINT "professional_renewal_applications_role_check" CHECK (role = ANY (ARRAY['instructor'::text, 'distributor'::text]));

ALTER TABLE public."professional_renewal_applications" ADD CONSTRAINT "professional_renewal_applications_status_check" CHECK (status = ANY (ARRAY['submitted'::text, 'pending_review'::text, 'approved'::text, 'rejected'::text]));

ALTER TABLE public."professional_renewal_applications" ADD CONSTRAINT "professional_renewal_applications_user_id_renewal_year_key" UNIQUE (user_id, renewal_year);

ALTER TABLE public."professional_renewal_nonapplications" ADD CONSTRAINT "professional_renewal_nonapplications_assessment_year_check" CHECK (assessment_year >= 2020 AND assessment_year <= 2200);

ALTER TABLE public."professional_renewal_nonapplications" ADD CONSTRAINT "professional_renewal_nonapplications_check" CHECK (renewal_year = (assessment_year + 1));

ALTER TABLE public."professional_renewal_nonapplications" ADD CONSTRAINT "professional_renewal_nonapplications_pkey" PRIMARY KEY (id);

ALTER TABLE public."professional_renewal_nonapplications" ADD CONSTRAINT "professional_renewal_nonapplications_reason_check" CHECK (char_length(btrim(reason)) >= 1 AND char_length(btrim(reason)) <= 500);

ALTER TABLE public."professional_renewal_nonapplications" ADD CONSTRAINT "professional_renewal_nonapplications_role_check" CHECK (role = ANY (ARRAY['instructor'::text, 'distributor'::text]));

ALTER TABLE public."professional_renewal_nonapplications" ADD CONSTRAINT "professional_renewal_nonapplications_user_id_renewal_year_key" UNIQUE (user_id, renewal_year);

ALTER TABLE public."professional_renewal_quarter_snapshots" ADD CONSTRAINT "professional_renewal_quarter_s_application_id_quarter_start_key" UNIQUE (application_id, quarter_start);

ALTER TABLE public."professional_renewal_quarter_snapshots" ADD CONSTRAINT "professional_renewal_quarter_snapsho_offline_sales_amount_check" CHECK (offline_sales_amount >= 0::numeric);

ALTER TABLE public."professional_renewal_quarter_snapshots" ADD CONSTRAINT "professional_renewal_quarter_snapshot_online_sales_amount_check" CHECK (online_sales_amount >= 0::numeric);

ALTER TABLE public."professional_renewal_quarter_snapshots" ADD CONSTRAINT "professional_renewal_quarter_snapshots_calendar_quarter_check" CHECK (calendar_quarter >= 1 AND calendar_quarter <= 4);

ALTER TABLE public."professional_renewal_quarter_snapshots" ADD CONSTRAINT "professional_renewal_quarter_snapshots_effective_days_check" CHECK (effective_days >= 0);

ALTER TABLE public."professional_renewal_quarter_snapshots" ADD CONSTRAINT "professional_renewal_quarter_snapshots_pkey" PRIMARY KEY (id);

ALTER TABLE public."professional_renewal_quarter_snapshots" ADD CONSTRAINT "professional_renewal_quarter_snapshots_quarter_days_check" CHECK (quarter_days >= 89 AND quarter_days <= 92);

ALTER TABLE public."professional_renewal_quarter_snapshots" ADD CONSTRAINT "professional_renewal_quarter_snapshots_sales_amount_check" CHECK (sales_amount >= 0::numeric);

ALTER TABLE public."professional_renewal_quarter_snapshots" ADD CONSTRAINT "professional_renewal_quarter_snapshots_threshold_amount_check" CHECK (threshold_amount >= 0::numeric);

ALTER TABLE public."professional_sales_adjustments" ADD CONSTRAINT "professional_sales_adjustments_amount_check" CHECK (amount >= 0::numeric);

ALTER TABLE public."professional_sales_adjustments" ADD CONSTRAINT "professional_sales_adjustments_pkey" PRIMARY KEY (id);

ALTER TABLE public."professional_sales_adjustments" ADD CONSTRAINT "professional_sales_adjustments_quarter_number_check" CHECK (quarter_number >= 1);

ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_default_invoice_tax_id_format_check" CHECK (default_invoice_tax_id IS NULL OR btrim(default_invoice_tax_id) = ''::text OR btrim(default_invoice_tax_id) ~ '^[0-9]{8}$'::text);

ALTER TABLE public."profiles" DROP CONSTRAINT "profiles_role_check";

ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_role_check" CHECK (role = ANY (ARRAY['consumer'::text, 'pro'::text, 'instructor'::text, 'distributor'::text, 'staff'::text, 'pending'::text]));

ALTER TABLE public."promotion_gift_reservations" ADD CONSTRAINT "promotion_gift_reservations_lifecycle_check" CHECK (status = 'reserved'::text AND consumed_at IS NULL AND released_at IS NULL OR status = 'consumed'::text AND consumed_at IS NOT NULL AND released_at IS NULL OR status = 'released'::text AND released_at IS NOT NULL);

ALTER TABLE public."promotion_gift_reservations" ADD CONSTRAINT "promotion_gift_reservations_order_id_promotion_id_product_v_key" UNIQUE (order_id, promotion_id, product_variant_id);

ALTER TABLE public."promotion_gift_reservations" ADD CONSTRAINT "promotion_gift_reservations_pkey" PRIMARY KEY (id);

ALTER TABLE public."promotion_gift_reservations" ADD CONSTRAINT "promotion_gift_reservations_quantity_check" CHECK (quantity > 0);

ALTER TABLE public."promotion_gift_reservations" ADD CONSTRAINT "promotion_gift_reservations_status_check" CHECK (status = ANY (ARRAY['reserved'::text, 'consumed'::text, 'released'::text]));

ALTER TABLE public."promotion_scopes" ADD CONSTRAINT "promotion_scopes_mode_check" CHECK (mode = ANY (ARRAY['include'::text, 'exclude'::text]));

ALTER TABLE public."promotion_scopes" ADD CONSTRAINT "promotion_scopes_pkey" PRIMARY KEY (id);

ALTER TABLE public."promotion_scopes" ADD CONSTRAINT "promotion_scopes_scope_role_check" CHECK (scope_role = ANY (ARRAY['qualification'::text, 'benefit'::text]));

ALTER TABLE public."promotion_scopes" ADD CONSTRAINT "promotion_scopes_target_check" CHECK ((target_type = ANY (ARRAY['all_regular'::text, 'all_sellable'::text])) AND product_id IS NULL AND product_variant_id IS NULL AND target_value IS NULL OR target_type = 'product'::text AND product_id IS NOT NULL AND product_variant_id IS NULL AND target_value IS NULL OR target_type = 'variant'::text AND product_id IS NULL AND product_variant_id IS NOT NULL AND target_value IS NULL OR (target_type = ANY (ARRAY['category'::text, 'series'::text])) AND product_id IS NULL AND product_variant_id IS NULL AND NULLIF(btrim(target_value), ''::text) IS NOT NULL);

ALTER TABLE public."promotion_scopes" ADD CONSTRAINT "promotion_scopes_target_type_check" CHECK (target_type = ANY (ARRAY['all_regular'::text, 'all_sellable'::text, 'product'::text, 'variant'::text, 'category'::text, 'series'::text]));

ALTER TABLE public."promotions" ADD CONSTRAINT "promotions_activation_type_check" CHECK (activation_type = ANY (ARRAY['automatic'::text, 'coupon_only'::text]));

ALTER TABLE public."promotions" ADD CONSTRAINT "promotions_benefit_type_check" CHECK (benefit_type = ANY (ARRAY['legacy_discount'::text, 'percentage_discount'::text, 'fixed_discount'::text, 'amount_gift'::text, 'quantity_gift'::text]));

ALTER TABLE public."promotions" ADD CONSTRAINT "promotions_discount_order_check" CHECK (discount_order = ANY (ARRAY['rate_then_amount'::text, 'amount_then_rate'::text]));

ALTER TABLE public."promotions" ADD CONSTRAINT "promotions_gift_configuration_check" CHECK ((benefit_type = ANY (ARRAY['amount_gift'::text, 'quantity_gift'::text])) AND threshold_value IS NOT NULL AND gift_variant_id IS NOT NULL AND gift_quantity IS NOT NULL AND gift_quantity > 0 OR (benefit_type <> ALL (ARRAY['amount_gift'::text, 'quantity_gift'::text])) AND gift_variant_id IS NULL AND gift_quantity IS NULL);

ALTER TABLE public."promotions" ADD CONSTRAINT "promotions_repeat_mode_check" CHECK (repeat_mode = ANY (ARRAY['once'::text, 'repeat'::text]));

ALTER TABLE public."promotions" ADD CONSTRAINT "promotions_threshold_basis_check" CHECK (threshold_basis IS NULL OR (threshold_basis = ANY (ARRAY['before_bundle_discount'::text, 'after_bundle_discount'::text])));

ALTER TABLE public."promotions" ADD CONSTRAINT "promotions_threshold_type_check" CHECK ((threshold_type = ANY (ARRAY['amount'::text, 'quantity'::text])) AND (benefit_type <> 'amount_gift'::text OR threshold_type = 'amount'::text) AND (benefit_type <> 'quantity_gift'::text OR threshold_type = 'quantity'::text));

ALTER TABLE public."promotions" ADD CONSTRAINT "promotions_threshold_value_check" CHECK (threshold_value IS NULL OR threshold_value > 0::numeric);

ALTER TABLE public."purchase_order_items" ADD CONSTRAINT "purchase_order_items_cost_nonnegative" CHECK (unit_cost >= 0::numeric AND subtotal_usd >= 0::numeric);

ALTER TABLE public."purchase_order_items" ADD CONSTRAINT "purchase_order_items_currency_usd" CHECK (currency = 'USD'::text);

ALTER TABLE public."purchase_order_items" ADD CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY (id);

ALTER TABLE public."purchase_order_items" ADD CONSTRAINT "purchase_order_items_quantity_positive" CHECK (quantity > 0);

ALTER TABLE public."purchase_order_items" ADD CONSTRAINT "purchase_order_items_unique_variant" UNIQUE (purchase_order_id, product_variant_id);

ALTER TABLE public."purchase_orders" ADD CONSTRAINT "purchase_orders_currency_usd" CHECK (currency = 'USD'::text);

ALTER TABLE public."purchase_orders" ADD CONSTRAINT "purchase_orders_exchange_rate_positive" CHECK (exchange_rate > 0::numeric);

ALTER TABLE public."purchase_orders" ADD CONSTRAINT "purchase_orders_pkey" PRIMARY KEY (id);

ALTER TABLE public."purchase_orders" ADD CONSTRAINT "purchase_orders_po_number_unique" UNIQUE (po_number);

ALTER TABLE public."purchase_orders" ADD CONSTRAINT "purchase_orders_status_valid" CHECK (status = ANY (ARRAY['draft'::text, 'pending'::text, 'ordered'::text, 'shipping'::text, 'received'::text, 'cancelled'::text]));

ALTER TABLE public."purchase_orders" ADD CONSTRAINT "purchase_orders_totals_nonnegative" CHECK (total_usd >= 0::numeric AND total_twd >= 0::numeric);

ALTER TABLE public."shipping_groups" ADD CONSTRAINT "shipping_groups_check" CHECK (status = 'open'::text AND locked_at IS NULL OR status = 'locked'::text AND locked_at IS NOT NULL);

ALTER TABLE public."shipping_groups" ADD CONSTRAINT "shipping_groups_fulfillment_method_check" CHECK (fulfillment_method = 'delivery'::text);

ALTER TABLE public."shipping_groups" ADD CONSTRAINT "shipping_groups_original_order_id_key" UNIQUE (original_order_id);

ALTER TABLE public."shipping_groups" ADD CONSTRAINT "shipping_groups_original_shipping_amount_check" CHECK (original_shipping_amount >= 0);

ALTER TABLE public."shipping_groups" ADD CONSTRAINT "shipping_groups_pkey" PRIMARY KEY (id);

ALTER TABLE public."shipping_groups" ADD CONSTRAINT "shipping_groups_status_check" CHECK (status = ANY (ARRAY['open'::text, 'locked'::text]));

ALTER TABLE public."shopping_credit_accounts" ADD CONSTRAINT "shopping_credit_accounts_available_balance_check" CHECK (available_balance >= 0);

ALTER TABLE public."shopping_credit_accounts" ADD CONSTRAINT "shopping_credit_accounts_pkey" PRIMARY KEY (user_id);

ALTER TABLE public."shopping_credit_accounts" ADD CONSTRAINT "shopping_credit_accounts_reserved_balance_check" CHECK (reserved_balance >= 0);

ALTER TABLE public."shopping_credit_accounts" ADD CONSTRAINT "shopping_credit_accounts_status_check" CHECK (status = ANY (ARRAY['active'::text, 'deletion_pending'::text]));

ALTER TABLE public."shopping_credit_accounts" ADD CONSTRAINT "shopping_credit_accounts_version_check" CHECK (version >= 0);

ALTER TABLE public."shopping_credit_ledger" ADD CONSTRAINT "shopping_credit_ledger_amount_check" CHECK (amount > 0);

ALTER TABLE public."shopping_credit_ledger" ADD CONSTRAINT "shopping_credit_ledger_available_balance_after_check" CHECK (available_balance_after >= 0);

ALTER TABLE public."shopping_credit_ledger" ADD CONSTRAINT "shopping_credit_ledger_check" CHECK ((event_type = ANY (ARRAY['grant'::text, 'refund'::text])) AND available_delta = amount AND reserved_delta = 0 OR event_type = 'debit'::text AND available_delta = (- amount) AND reserved_delta = 0 OR event_type = 'reserve'::text AND available_delta = (- amount) AND reserved_delta = amount OR event_type = 'consume'::text AND available_delta = 0 AND reserved_delta = (- amount) OR event_type = 'release'::text AND available_delta = amount AND reserved_delta = (- amount));

ALTER TABLE public."shopping_credit_ledger" ADD CONSTRAINT "shopping_credit_ledger_event_type_check" CHECK (event_type = ANY (ARRAY['grant'::text, 'debit'::text, 'reserve'::text, 'consume'::text, 'release'::text, 'refund'::text]));

ALTER TABLE public."shopping_credit_ledger" ADD CONSTRAINT "shopping_credit_ledger_internal_note_check" CHECK (internal_note IS NULL OR length(internal_note) <= 500);

ALTER TABLE public."shopping_credit_ledger" ADD CONSTRAINT "shopping_credit_ledger_pkey" PRIMARY KEY (id);

ALTER TABLE public."shopping_credit_ledger" ADD CONSTRAINT "shopping_credit_ledger_reason_code_check" CHECK (length(btrim(reason_code)) >= 1 AND length(btrim(reason_code)) <= 80);

ALTER TABLE public."shopping_credit_ledger" ADD CONSTRAINT "shopping_credit_ledger_request_id_key" UNIQUE (request_id);

ALTER TABLE public."shopping_credit_ledger" ADD CONSTRAINT "shopping_credit_ledger_reserved_balance_after_check" CHECK (reserved_balance_after >= 0);

ALTER TABLE public."shopping_credit_order_reservations" ADD CONSTRAINT "shopping_credit_order_reservations_amount_check" CHECK (amount > 0);

ALTER TABLE public."shopping_credit_order_reservations" ADD CONSTRAINT "shopping_credit_order_reservations_check" CHECK (status = 'reserved'::text AND consumed_at IS NULL AND released_at IS NULL AND refunded_at IS NULL OR status = 'consumed'::text AND consumed_at IS NOT NULL AND released_at IS NULL AND refunded_at IS NULL OR status = 'released'::text AND released_at IS NOT NULL AND consumed_at IS NULL AND refunded_at IS NULL OR status = 'refunded'::text AND consumed_at IS NOT NULL AND refunded_at IS NOT NULL AND released_at IS NULL);

ALTER TABLE public."shopping_credit_order_reservations" ADD CONSTRAINT "shopping_credit_order_reservations_pkey" PRIMARY KEY (order_id);

ALTER TABLE public."shopping_credit_order_reservations" ADD CONSTRAINT "shopping_credit_order_reservations_status_check" CHECK (status = ANY (ARRAY['reserved'::text, 'consumed'::text, 'released'::text, 'refunded'::text]));

ALTER TABLE public."shopping_credit_order_reservations" ADD CONSTRAINT "shopping_credit_order_reservations_version_check" CHECK (version >= 0);

ALTER TABLE public."student_pricing_feature_settings" ADD CONSTRAINT "student_pricing_feature_settings_pkey" PRIMARY KEY (singleton);

ALTER TABLE public."student_pricing_feature_settings" ADD CONSTRAINT "student_pricing_feature_settings_singleton_check" CHECK (singleton);

ALTER TABLE public."student_pricing_feature_settings" ADD CONSTRAINT "student_pricing_feature_settings_version_check" CHECK (version >= 0);

ALTER TABLE public."student_pricing_settings" ADD CONSTRAINT "student_pricing_settings_pkey" PRIMARY KEY (singleton);

ALTER TABLE public."student_pricing_settings" ADD CONSTRAINT "student_pricing_settings_singleton_check" CHECK (singleton);

ALTER TABLE public."student_pricing_settings" ADD CONSTRAINT "student_pricing_settings_student_1_check" CHECK (student_1 > 0::numeric AND student_1 <= 1::numeric AND student_1 = round(student_1, 3));

ALTER TABLE public."student_pricing_settings" ADD CONSTRAINT "student_pricing_settings_student_2_check" CHECK (student_2 > 0::numeric AND student_2 <= 1::numeric AND student_2 = round(student_2, 3));

ALTER TABLE public."student_pricing_settings" ADD CONSTRAINT "student_pricing_settings_version_check" CHECK (version >= 0);

ALTER TABLE public."admin_preferences" ADD CONSTRAINT "admin_preferences_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public."admin_users" ADD CONSTRAINT "admin_users_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public."admin_users" ADD CONSTRAINT "admin_users_role_fkey" FOREIGN KEY (role) REFERENCES backoffice_roles(role) ON UPDATE CASCADE;

ALTER TABLE public."admin_users" ADD CONSTRAINT "admin_users_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public."assisted_order_requests" ADD CONSTRAINT "assisted_order_requests_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public."assisted_order_requests" ADD CONSTRAINT "assisted_order_requests_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT;

ALTER TABLE public."backoffice_role_permissions" ADD CONSTRAINT "backoffice_role_permissions_role_fkey" FOREIGN KEY (role) REFERENCES backoffice_roles(role) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public."coupon_campaign_members" ADD CONSTRAINT "coupon_campaign_members_coupon_campaign_id_fkey" FOREIGN KEY (coupon_campaign_id) REFERENCES coupon_campaigns(id) ON DELETE CASCADE;

ALTER TABLE public."coupon_campaign_members" ADD CONSTRAINT "coupon_campaign_members_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."coupon_campaign_members" ADD CONSTRAINT "coupon_campaign_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE public."coupon_campaigns" ADD CONSTRAINT "coupon_campaigns_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."coupon_campaigns" ADD CONSTRAINT "coupon_campaigns_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."coupon_promotions" ADD CONSTRAINT "coupon_promotions_coupon_campaign_id_fkey" FOREIGN KEY (coupon_campaign_id) REFERENCES coupon_campaigns(id) ON DELETE CASCADE;

ALTER TABLE public."coupon_promotions" ADD CONSTRAINT "coupon_promotions_promotion_id_fkey" FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE RESTRICT;

ALTER TABLE public."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_campaign_id_fkey" FOREIGN KEY (coupon_campaign_id) REFERENCES coupon_campaigns(id) ON DELETE RESTRICT;

ALTER TABLE public."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE public."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."inventory_allocation_events" ADD CONSTRAINT "inventory_allocation_events_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."inventory_allocation_events" ADD CONSTRAINT "inventory_allocation_events_allocation_id_fkey" FOREIGN KEY (allocation_id) REFERENCES order_inventory_allocations(id) ON DELETE CASCADE;

ALTER TABLE public."inventory_allocation_events" ADD CONSTRAINT "inventory_allocation_events_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public."inventory_allocation_events" ADD CONSTRAINT "inventory_allocation_events_product_variant_id_fkey" FOREIGN KEY (product_variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT;

ALTER TABLE public."inventory_count_items" ADD CONSTRAINT "inventory_count_items_counted_by_fkey" FOREIGN KEY (counted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."inventory_count_items" ADD CONSTRAINT "inventory_count_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;

ALTER TABLE public."inventory_count_items" ADD CONSTRAINT "inventory_count_items_product_variant_id_fkey" FOREIGN KEY (product_variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT;

ALTER TABLE public."inventory_count_items" ADD CONSTRAINT "inventory_count_items_session_id_fkey" FOREIGN KEY (session_id) REFERENCES inventory_count_sessions(id) ON DELETE RESTRICT;

ALTER TABLE public."inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_completed_by_fkey" FOREIGN KEY (completed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public."inventory_count_shortages" ADD CONSTRAINT "inventory_count_shortages_allocation_id_fkey" FOREIGN KEY (allocation_id) REFERENCES order_inventory_allocations(id) ON DELETE RESTRICT;

ALTER TABLE public."inventory_count_shortages" ADD CONSTRAINT "inventory_count_shortages_count_item_id_fkey" FOREIGN KEY (count_item_id) REFERENCES inventory_count_items(id) ON DELETE RESTRICT;

ALTER TABLE public."inventory_count_shortages" ADD CONSTRAINT "inventory_count_shortages_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."inventory_count_shortages" ADD CONSTRAINT "inventory_count_shortages_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT;

ALTER TABLE public."inventory_count_shortages" ADD CONSTRAINT "inventory_count_shortages_product_variant_id_fkey" FOREIGN KEY (product_variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT;

ALTER TABLE public."inventory_count_shortages" ADD CONSTRAINT "inventory_count_shortages_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."member_admin_notes" ADD CONSTRAINT "member_admin_notes_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."member_admin_notes" ADD CONSTRAINT "member_admin_notes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE public."order_adjustments" ADD CONSTRAINT "order_adjustments_coupon_campaign_id_fkey" FOREIGN KEY (coupon_campaign_id) REFERENCES coupon_campaigns(id) ON DELETE RESTRICT;

ALTER TABLE public."order_adjustments" ADD CONSTRAINT "order_adjustments_gift_product_id_fkey" FOREIGN KEY (gift_product_id) REFERENCES products(id) ON DELETE RESTRICT;

ALTER TABLE public."order_adjustments" ADD CONSTRAINT "order_adjustments_gift_variant_id_fkey" FOREIGN KEY (gift_variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT;

ALTER TABLE public."order_adjustments" ADD CONSTRAINT "order_adjustments_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE public."order_adjustments" ADD CONSTRAINT "order_adjustments_promotion_id_fkey" FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE RESTRICT;

ALTER TABLE public."order_admin_notes" ADD CONSTRAINT "order_admin_notes_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."order_admin_notes" ADD CONSTRAINT "order_admin_notes_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_coupon_campaign_id_fkey" FOREIGN KEY (coupon_campaign_id) REFERENCES coupon_campaigns(id) ON DELETE RESTRICT;

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_product_variant_id_fkey" FOREIGN KEY (product_variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT;

ALTER TABLE public."order_inventory_allocations" ADD CONSTRAINT "order_inventory_allocations_promotion_id_fkey" FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE RESTRICT;

ALTER TABLE public."order_payment_attempts" ADD CONSTRAINT "order_payment_attempts_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE public."order_payment_authorizations" ADD CONSTRAINT "order_payment_authorizations_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE public."order_payment_instructions" ADD CONSTRAINT "order_payment_instructions_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE public."orders" ADD CONSTRAINT "orders_coupon_campaign_id_fkey" FOREIGN KEY (coupon_campaign_id) REFERENCES coupon_campaigns(id) ON DELETE RESTRICT;

ALTER TABLE public."orders" ADD CONSTRAINT "orders_shipping_group_id_fkey" FOREIGN KEY (shipping_group_id) REFERENCES shipping_groups(id) ON DELETE SET NULL;

ALTER TABLE public."procurement_addresses" ADD CONSTRAINT "procurement_addresses_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

ALTER TABLE public."product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

ALTER TABLE public."professional_application_certificates" ADD CONSTRAINT "professional_application_certificates_application_id_fkey" FOREIGN KEY (application_id) REFERENCES professional_applications(id) ON DELETE CASCADE;

ALTER TABLE public."professional_application_certificates" ADD CONSTRAINT "professional_application_certificates_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public."professional_award_evidence" ADD CONSTRAINT "professional_award_evidence_membership_id_fkey" FOREIGN KEY (membership_id) REFERENCES professional_memberships(id) ON DELETE RESTRICT;

ALTER TABLE public."professional_award_evidence" ADD CONSTRAINT "professional_award_evidence_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."professional_award_evidence" ADD CONSTRAINT "professional_award_evidence_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE public."professional_evidence_entry_windows" ADD CONSTRAINT "professional_evidence_entry_windows_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public."professional_evidence_entry_windows" ADD CONSTRAINT "professional_evidence_entry_windows_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE public."professional_memberships" ADD CONSTRAINT "professional_memberships_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."professional_memberships" ADD CONSTRAINT "professional_memberships_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE public."professional_quarterly_notices" ADD CONSTRAINT "professional_quarterly_notices_supersedes_id_fkey" FOREIGN KEY (supersedes_id) REFERENCES professional_quarterly_notices(id) ON DELETE RESTRICT;

ALTER TABLE public."professional_quarterly_notices" ADD CONSTRAINT "professional_quarterly_notices_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE public."professional_renewal_applications" ADD CONSTRAINT "professional_renewal_applications_membership_id_fkey" FOREIGN KEY (membership_id) REFERENCES professional_memberships(id) ON DELETE RESTRICT;

ALTER TABLE public."professional_renewal_applications" ADD CONSTRAINT "professional_renewal_applications_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."professional_renewal_applications" ADD CONSTRAINT "professional_renewal_applications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE public."professional_renewal_nonapplications" ADD CONSTRAINT "professional_renewal_nonapplications_membership_id_fkey" FOREIGN KEY (membership_id) REFERENCES professional_memberships(id) ON DELETE RESTRICT;

ALTER TABLE public."professional_renewal_nonapplications" ADD CONSTRAINT "professional_renewal_nonapplications_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public."professional_renewal_nonapplications" ADD CONSTRAINT "professional_renewal_nonapplications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE public."professional_renewal_quarter_snapshots" ADD CONSTRAINT "professional_renewal_quarter_snapshots_application_id_fkey" FOREIGN KEY (application_id) REFERENCES professional_renewal_applications(id) ON DELETE CASCADE;

ALTER TABLE public."professional_sales_adjustments" ADD CONSTRAINT "professional_sales_adjustments_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."professional_sales_adjustments" ADD CONSTRAINT "professional_sales_adjustments_membership_id_fkey" FOREIGN KEY (membership_id) REFERENCES professional_memberships(id) ON DELETE CASCADE;

ALTER TABLE public."professional_sales_adjustments" ADD CONSTRAINT "professional_sales_adjustments_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."professional_sales_adjustments" ADD CONSTRAINT "professional_sales_adjustments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE public."promotion_gift_reservations" ADD CONSTRAINT "promotion_gift_reservations_coupon_campaign_id_fkey" FOREIGN KEY (coupon_campaign_id) REFERENCES coupon_campaigns(id) ON DELETE RESTRICT;

ALTER TABLE public."promotion_gift_reservations" ADD CONSTRAINT "promotion_gift_reservations_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE public."promotion_gift_reservations" ADD CONSTRAINT "promotion_gift_reservations_product_variant_id_fkey" FOREIGN KEY (product_variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT;

ALTER TABLE public."promotion_gift_reservations" ADD CONSTRAINT "promotion_gift_reservations_promotion_id_fkey" FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE RESTRICT;

ALTER TABLE public."promotion_scopes" ADD CONSTRAINT "promotion_scopes_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;

ALTER TABLE public."promotion_scopes" ADD CONSTRAINT "promotion_scopes_product_variant_id_fkey" FOREIGN KEY (product_variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT;

ALTER TABLE public."promotion_scopes" ADD CONSTRAINT "promotion_scopes_promotion_id_fkey" FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE;

ALTER TABLE public."promotions" ADD CONSTRAINT "promotions_gift_variant_id_fkey" FOREIGN KEY (gift_variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT;

ALTER TABLE public."purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_variant_fkey" FOREIGN KEY (product_variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT;

ALTER TABLE public."purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE;

ALTER TABLE public."purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."shipping_groups" ADD CONSTRAINT "shipping_groups_original_order_fk" FOREIGN KEY (original_order_id) REFERENCES orders(id) ON DELETE RESTRICT;

ALTER TABLE public."shipping_groups" ADD CONSTRAINT "shipping_groups_refund_ledger_fk" FOREIGN KEY (shipping_refund_ledger_id) REFERENCES shopping_credit_ledger(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs USING btree (action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs USING btree (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs USING btree (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS coupon_campaign_members_user_idx ON public.coupon_campaign_members USING btree (user_id, coupon_campaign_id);

CREATE UNIQUE INDEX IF NOT EXISTS coupon_campaigns_code_unique_idx ON public.coupon_campaigns USING btree (code_normalized);

CREATE INDEX IF NOT EXISTS coupon_campaigns_live_idx ON public.coupon_campaigns USING btree (active, start_at, end_at) WHERE (archived_at IS NULL);

CREATE INDEX IF NOT EXISTS coupon_promotions_campaign_order_idx ON public.coupon_promotions USING btree (coupon_campaign_id, sort_order, id);

CREATE INDEX IF NOT EXISTS coupon_promotions_promotion_idx ON public.coupon_promotions USING btree (promotion_id, coupon_campaign_id);

CREATE INDEX IF NOT EXISTS coupon_redemptions_campaign_status_idx ON public.coupon_redemptions USING btree (coupon_campaign_id, status, expires_at);

CREATE INDEX IF NOT EXISTS coupon_redemptions_guest_usage_idx ON public.coupon_redemptions USING btree (coupon_campaign_id, guest_identity_hash, status) WHERE (guest_identity_hash IS NOT NULL);

CREATE INDEX IF NOT EXISTS coupon_redemptions_user_usage_idx ON public.coupon_redemptions USING btree (coupon_campaign_id, user_id, status) WHERE (user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS instructor_student_audit_member_idx ON public.instructor_student_audit_logs USING btree (student_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS instructor_student_active_instructor_idx ON public.instructor_student_bindings USING btree (instructor_id, created_at) WHERE (ended_at IS NULL);

CREATE INDEX IF NOT EXISTS instructor_student_history_idx ON public.instructor_student_bindings USING btree (student_id, created_at DESC, id);

CREATE UNIQUE INDEX IF NOT EXISTS instructor_student_one_active_student_idx ON public.instructor_student_bindings USING btree (student_id) WHERE (ended_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_inventory_allocation_events_order ON public.inventory_allocation_events USING btree (order_id, created_at, id);

CREATE INDEX IF NOT EXISTS inventory_count_items_session_idx ON public.inventory_count_items USING btree (session_id, id);

CREATE INDEX IF NOT EXISTS inventory_count_items_variant_idx ON public.inventory_count_items USING btree (product_variant_id, inventory_type);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_count_sessions_one_draft_idx ON public.inventory_count_sessions USING btree (status) WHERE (status = 'draft'::text);

CREATE INDEX IF NOT EXISTS inventory_count_shortages_order_idx ON public.inventory_count_shortages USING btree (order_id, status);

CREATE INDEX IF NOT EXISTS inventory_count_shortages_pending_idx ON public.inventory_count_shortages USING btree (inventory_type, product_variant_id, created_at, id) WHERE (status = 'pending'::text);

CREATE INDEX IF NOT EXISTS order_adjustments_coupon_idx ON public.order_adjustments USING btree (coupon_campaign_id, created_at) WHERE (coupon_campaign_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS order_adjustments_order_idx ON public.order_adjustments USING btree (order_id, sort_order, id);

CREATE INDEX IF NOT EXISTS order_adjustments_promotion_idx ON public.order_adjustments USING btree (promotion_id, created_at);

CREATE INDEX IF NOT EXISTS idx_order_inventory_allocations_fifo ON public.order_inventory_allocations USING btree (product_variant_id, priority_at, id) WHERE ((backorder_qty > 0) AND (state = ANY (ARRAY['partial'::text, 'backordered'::text])));

CREATE INDEX IF NOT EXISTS idx_order_inventory_allocations_order ON public.order_inventory_allocations USING btree (order_id, item_index);

CREATE INDEX IF NOT EXISTS order_inventory_allocations_line_type_idx ON public.order_inventory_allocations USING btree (order_id, line_type, item_index);

CREATE INDEX IF NOT EXISTS idx_order_payment_attempts_order_created ON public.order_payment_attempts USING btree (order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_payment_instructions_due ON public.order_payment_instructions USING btree (payment_due_at);

CREATE INDEX IF NOT EXISTS idx_orders_member_paid_at ON public.orders USING btree (user_id, paid_at) WHERE (paid_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_orders_payment_notification_retry ON public.orders USING btree (payment_notification_next_retry_at) WHERE ((payment_notification_sent_at IS NULL) AND (status = ANY (ARRAY['paid'::text, 'preparing'::text, 'shipped'::text, 'delivered'::text])));

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_public_lookup_code ON public.orders USING btree (public_lookup_code);

CREATE INDEX IF NOT EXISTS idx_orders_shipment_notification ON public.orders USING btree (status, shipment_notification_sent_at) WHERE (status = 'shipped'::text);

CREATE INDEX IF NOT EXISTS idx_orders_unpaid_payment_due ON public.orders USING btree (payment_due_at) WHERE (status = ANY (ARRAY['awaiting_confirm'::text, 'unpaid'::text]));

CREATE INDEX IF NOT EXISTS idx_orders_unpaid_payment_reminder ON public.orders USING btree (status, created_at) WHERE ((status = ANY (ARRAY['awaiting_confirm'::text, 'unpaid'::text])) AND ((payment_reminded_at IS NULL) OR (payment_second_reminded_at IS NULL)));

CREATE INDEX IF NOT EXISTS orders_member_source_transaction_date_idx ON public.orders USING btree (user_id, order_source, transaction_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS orders_shipping_group_idx ON public.orders USING btree (shipping_group_id, created_at, id) WHERE (shipping_group_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS procurement_addresses_one_default ON public.procurement_addresses USING btree (is_default) WHERE ((is_default IS TRUE) AND (active IS TRUE));

CREATE UNIQUE INDEX IF NOT EXISTS product_images_one_active_primary ON public.product_images USING btree (product_id) WHERE ((is_primary IS TRUE) AND (active IS TRUE));

CREATE INDEX IF NOT EXISTS product_images_product_order_idx ON public.product_images USING btree (product_id, active DESC, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON public.product_variants USING btree (product_id);

CREATE INDEX IF NOT EXISTS idx_product_variants_product_sort ON public.product_variants USING btree (product_id, active DESC, sort_order, id);

CREATE UNIQUE INDEX IF NOT EXISTS product_variants_one_default_per_product ON public.product_variants USING btree (product_id) WHERE (is_default IS TRUE);

CREATE UNIQUE INDEX IF NOT EXISTS product_variants_product_sku_unique ON public.product_variants USING btree (product_id, lower(sku));

CREATE UNIQUE INDEX IF NOT EXISTS products_asset_key_unique ON public.products USING btree (asset_key);

CREATE INDEX IF NOT EXISTS products_publication_status_idx ON public.products USING btree (publication_status, id);

CREATE INDEX IF NOT EXISTS products_series_active_idx ON public.products USING btree (series, publication_status, active) WHERE (series IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS products_slug_unique ON public.products USING btree (lower(slug));

CREATE INDEX IF NOT EXISTS professional_application_certificates_application_idx ON public.professional_application_certificates USING btree (application_id, sort_order, id);

CREATE INDEX IF NOT EXISTS professional_award_evidence_owner_year_idx ON public.professional_award_evidence USING btree (user_id, assessment_year, status, completed_on);

CREATE INDEX IF NOT EXISTS professional_award_evidence_review_idx ON public.professional_award_evidence USING btree (assessment_year, status, created_at);

CREATE INDEX IF NOT EXISTS idx_professional_memberships_user_started ON public.professional_memberships USING btree (user_id, started_on DESC);

CREATE UNIQUE INDEX IF NOT EXISTS professional_memberships_one_active_per_user ON public.professional_memberships USING btree (user_id) WHERE (ended_on IS NULL);

CREATE INDEX IF NOT EXISTS professional_quarterly_notices_delivery_idx ON public.professional_quarterly_notices USING btree (status, quarter_start, created_at);

CREATE INDEX IF NOT EXISTS professional_renewal_applications_member_idx ON public.professional_renewal_applications USING btree (user_id, assessment_year DESC);

CREATE INDEX IF NOT EXISTS professional_renewal_applications_status_idx ON public.professional_renewal_applications USING btree (renewal_year, status, submitted_at);

CREATE UNIQUE INDEX IF NOT EXISTS professional_sales_adjustments_membership_quarter_start_idx ON public.professional_sales_adjustments USING btree (membership_id, quarter_start);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_line_user_id_key ON public.profiles USING btree (line_user_id) WHERE (line_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS promotion_gift_reservations_order_idx ON public.promotion_gift_reservations USING btree (order_id, status);

CREATE INDEX IF NOT EXISTS promotion_gift_reservations_variant_status_idx ON public.promotion_gift_reservations USING btree (product_variant_id, status, expires_at);

CREATE INDEX IF NOT EXISTS promotion_scopes_promotion_idx ON public.promotion_scopes USING btree (promotion_id, scope_role, mode);

CREATE UNIQUE INDEX IF NOT EXISTS promotion_scopes_unique_target_idx ON public.promotion_scopes USING btree (promotion_id, scope_role, target_type, COALESCE(product_id, 0), COALESCE(product_variant_id, (0)::bigint), COALESCE(target_value, ''::text), mode);

CREATE INDEX IF NOT EXISTS promotions_activation_live_idx ON public.promotions USING btree (activation_type, active, start_at, end_at) WHERE (archived_at IS NULL);

CREATE INDEX IF NOT EXISTS promotions_gift_variant_idx ON public.promotions USING btree (gift_variant_id) WHERE ((gift_variant_id IS NOT NULL) AND (archived_at IS NULL));

CREATE INDEX IF NOT EXISTS purchase_order_items_order_idx ON public.purchase_order_items USING btree (purchase_order_id, sort_order, id);

CREATE INDEX IF NOT EXISTS purchase_orders_created_idx ON public.purchase_orders USING btree (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS shipping_groups_user_status_idx ON public.shipping_groups USING btree (user_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS shopping_credit_ledger_order_event_unique_idx ON public.shopping_credit_ledger USING btree (order_id, event_type) WHERE ((order_id IS NOT NULL) AND (event_type = ANY (ARRAY['reserve'::text, 'consume'::text, 'release'::text, 'refund'::text])));

CREATE INDEX IF NOT EXISTS shopping_credit_ledger_order_idx ON public.shopping_credit_ledger USING btree (order_id, created_at, id) WHERE (order_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS shopping_credit_ledger_user_created_idx ON public.shopping_credit_ledger USING btree (user_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS shopping_credit_shipping_refund_unique_idx ON public.shopping_credit_ledger USING btree (((metadata ->> 'shipping_group_id'::text))) WHERE ((reason_code = 'shipping_refund'::text) AND (metadata ? 'shipping_group_id'::text));

CREATE INDEX IF NOT EXISTS shopping_credit_reservations_user_status_idx ON public.shopping_credit_order_reservations USING btree (user_id, status, updated_at DESC);

ALTER TABLE public."admin_preferences" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."admin_preferences" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."admin_preferences" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."admin_preferences" TO "service_role";

GRANT INSERT,SELECT,UPDATE ON public."admin_preferences" TO "authenticated";

ALTER TABLE public."admin_users" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."admin_users" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."admin_users" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."admin_users" TO "service_role";

ALTER TABLE public."api_rate_limits" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."api_rate_limits" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."api_rate_limits" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."api_rate_limits" TO "service_role";

ALTER TABLE public."assisted_order_requests" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."assisted_order_requests" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."assisted_order_requests" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."assisted_order_requests" TO "service_role";

ALTER TABLE public."audit_logs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."audit_logs" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."audit_logs" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."audit_logs" TO "service_role";

GRANT SELECT ON public."audit_logs" TO "authenticated";

ALTER TABLE public."backoffice_role_permissions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."backoffice_role_permissions" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."backoffice_role_permissions" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."backoffice_role_permissions" TO "service_role";

ALTER TABLE public."backoffice_roles" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."backoffice_roles" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."backoffice_roles" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."backoffice_roles" TO "service_role";

ALTER TABLE public."coupon_campaign_members" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."coupon_campaign_members" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."coupon_campaign_members" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."coupon_campaign_members" TO "service_role";

GRANT DELETE,INSERT,SELECT ON public."coupon_campaign_members" TO "authenticated";

ALTER TABLE public."coupon_campaigns" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."coupon_campaigns" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."coupon_campaigns" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."coupon_campaigns" TO "service_role";

GRANT DELETE,INSERT,SELECT,UPDATE ON public."coupon_campaigns" TO "authenticated";

ALTER TABLE public."coupon_promotions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."coupon_promotions" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."coupon_promotions" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."coupon_promotions" TO "service_role";

GRANT DELETE,INSERT,SELECT,UPDATE ON public."coupon_promotions" TO "authenticated";

ALTER TABLE public."coupon_redemptions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."coupon_redemptions" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."coupon_redemptions" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."coupon_redemptions" TO "service_role";

GRANT SELECT ON public."coupon_redemptions" TO "authenticated";

ALTER TABLE public."instructor_student_audit_logs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."instructor_student_audit_logs" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."instructor_student_audit_logs" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."instructor_student_audit_logs" TO "service_role";

ALTER TABLE public."instructor_student_bindings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."instructor_student_bindings" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."instructor_student_bindings" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."instructor_student_bindings" TO "service_role";

ALTER TABLE public."instructor_student_settings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."instructor_student_settings" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."instructor_student_settings" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."instructor_student_settings" TO "service_role";

ALTER TABLE public."inventory_allocation_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."inventory_allocation_events" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."inventory_allocation_events" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."inventory_allocation_events" TO "service_role";

ALTER TABLE public."inventory_count_items" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."inventory_count_items" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."inventory_count_items" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."inventory_count_items" TO "service_role";

ALTER TABLE public."inventory_count_sessions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."inventory_count_sessions" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."inventory_count_sessions" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."inventory_count_sessions" TO "service_role";

ALTER TABLE public."inventory_count_shortages" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."inventory_count_shortages" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."inventory_count_shortages" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."inventory_count_shortages" TO "service_role";

ALTER TABLE public."member_admin_notes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."member_admin_notes" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."member_admin_notes" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."member_admin_notes" TO "service_role";

ALTER TABLE public."membership_tiers" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."membership_tiers" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."membership_tiers" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT,TRUNCATE ON public."membership_tiers" TO "anon";

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."membership_tiers" TO "service_role";

GRANT SELECT,TRUNCATE ON public."membership_tiers" TO "authenticated";

ALTER TABLE public."order_adjustments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."order_adjustments" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."order_adjustments" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."order_adjustments" TO "service_role";

GRANT SELECT ON public."order_adjustments" TO "authenticated";

ALTER TABLE public."order_admin_notes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."order_admin_notes" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."order_admin_notes" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."order_admin_notes" TO "service_role";

ALTER TABLE public."order_inventory_allocations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."order_inventory_allocations" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."order_inventory_allocations" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."order_inventory_allocations" TO "service_role";

ALTER TABLE public."order_payment_attempts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."order_payment_attempts" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."order_payment_attempts" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."order_payment_attempts" TO "service_role";

ALTER TABLE public."order_payment_authorizations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."order_payment_authorizations" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."order_payment_authorizations" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."order_payment_authorizations" TO "anon";

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."order_payment_authorizations" TO "service_role";

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."order_payment_authorizations" TO "authenticated";

ALTER TABLE public."order_payment_instructions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."order_payment_instructions" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."order_payment_instructions" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."order_payment_instructions" TO "service_role";

ALTER TABLE public."orders" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."orders" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."orders" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."orders" TO "anon";

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."orders" TO "service_role";

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."orders" TO "authenticated";

ALTER TABLE public."procurement_addresses" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."procurement_addresses" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."procurement_addresses" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."procurement_addresses" TO "service_role";

ALTER TABLE public."product_images" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."product_images" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."product_images" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,UPDATE,TRUNCATE ON public."product_images" TO "anon";

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."product_images" TO "service_role";

GRANT DELETE,INSERT,UPDATE,TRUNCATE ON public."product_images" TO "authenticated";

ALTER TABLE public."product_variants" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."product_variants" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."product_variants" FROM PUBLIC,anon,authenticated,service_role;

GRANT TRUNCATE ON public."product_variants" TO "anon";

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."product_variants" TO "service_role";

GRANT INSERT,UPDATE,TRUNCATE ON public."product_variants" TO "authenticated";

ALTER TABLE public."products" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."products" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."products" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,UPDATE,TRUNCATE ON public."products" TO "anon";

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."products" TO "service_role";

GRANT DELETE,INSERT,UPDATE,TRUNCATE ON public."products" TO "authenticated";

ALTER TABLE public."professional_application_certificates" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."professional_application_certificates" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."professional_application_certificates" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."professional_application_certificates" TO "service_role";

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."professional_application_certificates" TO "authenticated";

ALTER TABLE public."professional_applications" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."professional_applications" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."professional_applications" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."professional_applications" TO "anon";

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."professional_applications" TO "service_role";

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."professional_applications" TO "authenticated";

ALTER TABLE public."professional_award_evidence" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."professional_award_evidence" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."professional_award_evidence" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."professional_award_evidence" TO "service_role";

GRANT SELECT ON public."professional_award_evidence" TO "authenticated";

ALTER TABLE public."professional_evidence_entry_windows" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."professional_evidence_entry_windows" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."professional_evidence_entry_windows" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."professional_evidence_entry_windows" TO "service_role";

ALTER TABLE public."professional_memberships" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."professional_memberships" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."professional_memberships" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."professional_memberships" TO "service_role";

GRANT SELECT ON public."professional_memberships" TO "authenticated";

ALTER TABLE public."professional_quarterly_notices" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."professional_quarterly_notices" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."professional_quarterly_notices" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."professional_quarterly_notices" TO "service_role";

GRANT SELECT ON public."professional_quarterly_notices" TO "authenticated";

ALTER TABLE public."professional_renewal_applications" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."professional_renewal_applications" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."professional_renewal_applications" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."professional_renewal_applications" TO "service_role";

GRANT SELECT ON public."professional_renewal_applications" TO "authenticated";

ALTER TABLE public."professional_renewal_nonapplications" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."professional_renewal_nonapplications" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."professional_renewal_nonapplications" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."professional_renewal_nonapplications" TO "service_role";

GRANT SELECT ON public."professional_renewal_nonapplications" TO "authenticated";

ALTER TABLE public."professional_renewal_quarter_snapshots" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."professional_renewal_quarter_snapshots" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."professional_renewal_quarter_snapshots" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."professional_renewal_quarter_snapshots" TO "service_role";

GRANT SELECT ON public."professional_renewal_quarter_snapshots" TO "authenticated";

ALTER TABLE public."professional_sales_adjustments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."professional_sales_adjustments" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."professional_sales_adjustments" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."professional_sales_adjustments" TO "service_role";

ALTER TABLE public."profiles" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."profiles" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."profiles" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."profiles" TO "anon";

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."profiles" TO "service_role";

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."profiles" TO "authenticated";

ALTER TABLE public."promotion_gift_reservations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."promotion_gift_reservations" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."promotion_gift_reservations" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."promotion_gift_reservations" TO "service_role";

GRANT SELECT ON public."promotion_gift_reservations" TO "authenticated";

ALTER TABLE public."promotion_scopes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."promotion_scopes" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."promotion_scopes" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."promotion_scopes" TO "service_role";

GRANT DELETE,INSERT,SELECT,UPDATE ON public."promotion_scopes" TO "authenticated";

ALTER TABLE public."promotions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."promotions" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."promotions" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."promotions" TO "anon";

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."promotions" TO "service_role";

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."promotions" TO "authenticated";

ALTER TABLE public."purchase_order_items" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."purchase_order_items" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."purchase_order_items" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."purchase_order_items" TO "service_role";

ALTER TABLE public."purchase_orders" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."purchase_orders" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."purchase_orders" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."purchase_orders" TO "service_role";

ALTER TABLE public."shipping_groups" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."shipping_groups" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."shipping_groups" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."shipping_groups" TO "service_role";

ALTER TABLE public."shopping_credit_accounts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."shopping_credit_accounts" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."shopping_credit_accounts" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."shopping_credit_accounts" TO "service_role";

ALTER TABLE public."shopping_credit_ledger" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."shopping_credit_ledger" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."shopping_credit_ledger" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."shopping_credit_ledger" TO "service_role";

ALTER TABLE public."shopping_credit_order_reservations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."shopping_credit_order_reservations" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."shopping_credit_order_reservations" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."shopping_credit_order_reservations" TO "service_role";

ALTER TABLE public."student_pricing_feature_settings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."student_pricing_feature_settings" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."student_pricing_feature_settings" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."student_pricing_feature_settings" TO "service_role";

ALTER TABLE public."student_pricing_settings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."student_pricing_settings" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public."student_pricing_settings" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE,INSERT,SELECT,UPDATE,TRUNCATE ON public."student_pricing_settings" TO "service_role";

CREATE POLICY "admin_preferences_insert_own" ON public."admin_preferences" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "admin_preferences_select_own" ON public."admin_preferences" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((user_id = auth.uid()));

CREATE POLICY "admin_preferences_update_own" ON public."admin_preferences" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "audit_logs_select_admin" ON public."audit_logs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_eclado_admin());

CREATE POLICY "coupon_campaign_members_manage" ON public."coupon_campaign_members" AS PERMISSIVE FOR ALL TO "authenticated" USING (has_backoffice_permission('promotions.manage'::text)) WITH CHECK (has_backoffice_permission('promotions.manage'::text));

CREATE POLICY "coupon_campaigns_manage" ON public."coupon_campaigns" AS PERMISSIVE FOR ALL TO "authenticated" USING (has_backoffice_permission('promotions.manage'::text)) WITH CHECK (has_backoffice_permission('promotions.manage'::text));

CREATE POLICY "coupon_promotions_manage" ON public."coupon_promotions" AS PERMISSIVE FOR ALL TO "authenticated" USING (has_backoffice_permission('promotions.manage'::text)) WITH CHECK (has_backoffice_permission('promotions.manage'::text));

CREATE POLICY "coupon_redemptions_select_orders" ON public."coupon_redemptions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (has_backoffice_permission('orders.read'::text));

CREATE POLICY "membership_tiers_select_all" ON public."membership_tiers" AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);

CREATE POLICY "order_adjustments_select_orders" ON public."order_adjustments" AS PERMISSIVE FOR SELECT TO "authenticated" USING (has_backoffice_permission('orders.read'::text));

CREATE POLICY "orders_select_admin" ON public."orders" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_eclado_admin());

CREATE POLICY "orders_select_own" ON public."orders" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((user_id = auth.uid()));

CREATE POLICY "orders_update_admin" ON public."orders" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_eclado_admin()) WITH CHECK (is_eclado_admin());

CREATE POLICY "product_images_delete_admin" ON public."product_images" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_eclado_admin());

CREATE POLICY "product_images_insert_admin" ON public."product_images" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_eclado_admin() AND (EXISTS ( SELECT 1
 FROM products product
 WHERE ((product.id = product_images.product_id) AND (split_part(product_images.storage_path, '/'::text, 1) = 'products'::text) AND (split_part(product_images.storage_path, '/'::text, 2) = (product.asset_key)::text))))));

CREATE POLICY "product_images_select_active" ON public."product_images" AS PERMISSIVE FOR SELECT TO "anon","authenticated" USING (((active IS TRUE) AND (EXISTS ( SELECT 1
 FROM products product
 WHERE ((product.id = product_images.product_id) AND (product.publication_status = 'active'::text))))));

CREATE POLICY "product_images_select_admin" ON public."product_images" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_eclado_admin());

CREATE POLICY "product_images_update_admin" ON public."product_images" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_eclado_admin()) WITH CHECK ((is_eclado_admin() AND (EXISTS ( SELECT 1
 FROM products product
 WHERE ((product.id = product_images.product_id) AND (split_part(product_images.storage_path, '/'::text, 1) = 'products'::text) AND (split_part(product_images.storage_path, '/'::text, 2) = (product.asset_key)::text))))));

CREATE POLICY "product_variants_insert_admin" ON public."product_variants" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (is_eclado_admin());

CREATE POLICY "product_variants_select_active" ON public."product_variants" AS PERMISSIVE FOR SELECT TO "anon","authenticated" USING (((active IS TRUE) AND (EXISTS ( SELECT 1
 FROM products product
 WHERE ((product.id = product_variants.product_id) AND (product.publication_status = 'active'::text))))));

CREATE POLICY "product_variants_select_admin" ON public."product_variants" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_eclado_admin());

CREATE POLICY "product_variants_update_admin" ON public."product_variants" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_eclado_admin()) WITH CHECK (is_eclado_admin());

CREATE POLICY "products_insert_admin" ON public."products" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (is_eclado_admin());

CREATE POLICY "products_select_active" ON public."products" AS PERMISSIVE FOR SELECT TO "anon","authenticated" USING ((publication_status = 'active'::text));

CREATE POLICY "products_select_admin" ON public."products" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_eclado_admin());

CREATE POLICY "products_update_admin" ON public."products" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_eclado_admin()) WITH CHECK (is_eclado_admin());

CREATE POLICY "professional_certificates_select_admin" ON public."professional_application_certificates" AS PERMISSIVE FOR SELECT TO "authenticated" USING (has_backoffice_permission('members.read'::text));

CREATE POLICY "professional_certificates_select_own" ON public."professional_application_certificates" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
 FROM professional_applications application
 WHERE ((application.id = professional_application_certificates.application_id) AND (application.user_id = auth.uid())))));

CREATE POLICY "anyone can insert" ON public."professional_applications" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (true);

CREATE POLICY "professional_applications_select_admin" ON public."professional_applications" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_eclado_admin());

CREATE POLICY "professional_applications_select_own" ON public."professional_applications" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((user_id = auth.uid()));

CREATE POLICY "professional_applications_update_admin" ON public."professional_applications" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_eclado_admin()) WITH CHECK (is_eclado_admin());

CREATE POLICY "professional_award_evidence_select_admin" ON public."professional_award_evidence" AS PERMISSIVE FOR SELECT TO "authenticated" USING (has_backoffice_permission('members.read'::text));

CREATE POLICY "professional_award_evidence_select_own" ON public."professional_award_evidence" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((user_id = auth.uid()));

CREATE POLICY "professional_memberships_select_backoffice" ON public."professional_memberships" AS PERMISSIVE FOR SELECT TO "authenticated" USING (has_backoffice_permission('members.read'::text));

CREATE POLICY "professional_memberships_select_own" ON public."professional_memberships" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((user_id = auth.uid()));

CREATE POLICY "professional_quarterly_notices_select_admin" ON public."professional_quarterly_notices" AS PERMISSIVE FOR SELECT TO "authenticated" USING (has_backoffice_permission('members.read'::text));

CREATE POLICY "professional_quarterly_notices_select_own" ON public."professional_quarterly_notices" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((user_id = auth.uid()));

CREATE POLICY "professional_renewal_applications_select_admin" ON public."professional_renewal_applications" AS PERMISSIVE FOR SELECT TO "authenticated" USING (has_backoffice_permission('members.read'::text));

CREATE POLICY "professional_renewal_applications_select_own" ON public."professional_renewal_applications" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((user_id = auth.uid()));

CREATE POLICY "professional_renewal_nonapplications_select_admin" ON public."professional_renewal_nonapplications" AS PERMISSIVE FOR SELECT TO "authenticated" USING (has_backoffice_permission('members.read'::text));

CREATE POLICY "professional_renewal_snapshots_select_admin" ON public."professional_renewal_quarter_snapshots" AS PERMISSIVE FOR SELECT TO "authenticated" USING (has_backoffice_permission('members.read'::text));

CREATE POLICY "professional_renewal_snapshots_select_own" ON public."professional_renewal_quarter_snapshots" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
 FROM professional_renewal_applications application
 WHERE ((application.id = professional_renewal_quarter_snapshots.application_id) AND (application.user_id = auth.uid())))));

CREATE POLICY "profiles_select_admin" ON public."profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_eclado_admin());

CREATE POLICY "profiles_select_own" ON public."profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((id = auth.uid()));

CREATE POLICY "profiles_update_admin" ON public."profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_eclado_admin()) WITH CHECK (is_eclado_admin());

CREATE POLICY "profiles_update_own" ON public."profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));

CREATE POLICY "promotion_gift_reservations_select_orders" ON public."promotion_gift_reservations" AS PERMISSIVE FOR SELECT TO "authenticated" USING (has_backoffice_permission('orders.read'::text));

CREATE POLICY "promotion_scopes_manage" ON public."promotion_scopes" AS PERMISSIVE FOR ALL TO "authenticated" USING (has_backoffice_permission('promotions.manage'::text)) WITH CHECK (has_backoffice_permission('promotions.manage'::text));

CREATE POLICY "promotions_delete_admin" ON public."promotions" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_eclado_admin());

CREATE POLICY "promotions_insert_admin" ON public."promotions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (is_eclado_admin());

CREATE POLICY "promotions_select_admin" ON public."promotions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_eclado_admin());

CREATE POLICY "promotions_select_live" ON public."promotions" AS PERMISSIVE FOR SELECT TO "anon","authenticated" USING (((active = true) AND (activation_type = 'automatic'::text) AND (archived_at IS NULL) AND (benefit_type = ANY (ARRAY['legacy_discount'::text, 'percentage_discount'::text, 'fixed_discount'::text])) AND ((start_at IS NULL) OR (start_at <= now())) AND ((end_at IS NULL) OR (end_at > now()))));

CREATE POLICY "promotions_update_admin" ON public."promotions" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_eclado_admin()) WITH CHECK (is_eclado_admin());

REVOKE ALL ON FUNCTION public.adjust_inventory_for_order(jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.adjust_inventory_for_order(jsonb,integer) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.adjust_inventory_for_order(jsonb,integer) TO "anon";

GRANT EXECUTE ON FUNCTION public.adjust_inventory_for_order(jsonb,integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.adjust_inventory_for_order(jsonb,integer) TO "service_role";

REVOKE ALL ON FUNCTION public.adjust_member_shopping_credit(uuid,text,bigint,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.adjust_member_shopping_credit(uuid,text,bigint,text,text,uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.adjust_member_shopping_credit(uuid,text,bigint,text,text,uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.allocate_assisted_inventory(text,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.allocate_assisted_inventory(text,jsonb,boolean) TO "service_role";

REVOKE ALL ON FUNCTION public.allocate_backordered_inventory(bigint) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.allocate_backordered_inventory(bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.allocate_backordered_inventory(bigint) TO "service_role";

REVOKE ALL ON FUNCTION public.allocate_inventory_count_gift_shortages(bigint) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.allocate_inventory_count_gift_shortages(bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.allocate_inventory_count_gift_shortages(bigint) TO "service_role";

REVOKE ALL ON FUNCTION public.allocate_inventory_for_paid_order(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.allocate_inventory_for_paid_order(text,jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.apply_student_price(numeric,numeric) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.apply_student_price(numeric,numeric) TO "service_role";

REVOKE ALL ON FUNCTION public.archive_procurement_address(bigint) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.archive_procurement_address(bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.archive_procurement_address(bigint) TO "service_role";

REVOKE ALL ON FUNCTION public.assert_assisted_credit_consent(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.assert_assisted_credit_consent(text) TO "service_role";

REVOKE ALL ON FUNCTION public.assert_instructor_student_admin(boolean) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.assert_instructor_student_admin(boolean) TO "service_role";

REVOKE ALL ON FUNCTION public.assign_guest_order_to_member(text,uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.assign_guest_order_to_member(text,uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.assign_guest_order_to_member(text,uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.assign_shipping_group_to_additional_order() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.assign_shipping_group_to_additional_order() TO "service_role";

REVOKE ALL ON FUNCTION public.assisted_auto_unit_price(uuid,text,products,product_variants,numeric) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.assisted_auto_unit_price(uuid,text,products,product_variants,numeric) TO "service_role";

REVOKE ALL ON FUNCTION public.assisted_coupon_allows_identity(uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.assisted_coupon_allows_identity(uuid,text,uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.assisted_discount_quote(jsonb,text,text,text,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.assisted_discount_quote(jsonb,text,text,text,uuid,boolean) TO "service_role";

REVOKE ALL ON FUNCTION public.assisted_gift_quote(jsonb,text,text,text,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.assisted_gift_quote(jsonb,text,text,text,uuid,boolean) TO "service_role";

REVOKE ALL ON FUNCTION public.audit_log_projection(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.audit_log_projection(text,jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.audit_log_projection_before_member_pricing(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.audit_log_projection_before_member_pricing(text,jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.authorize_assisted_link(text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.authorize_assisted_link(text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.authorize_order_payment_access(text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.authorize_order_payment_access(text,text) TO "anon";

GRANT EXECUTE ON FUNCTION public.authorize_order_payment_access(text,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.authorize_order_payment_access(text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.begin_order_payment_retry(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.begin_order_payment_retry(text) TO "service_role";

REVOKE ALL ON FUNCTION public.calculate_order_shipping(jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.calculate_order_shipping(jsonb) TO "anon";

GRANT EXECUTE ON FUNCTION public.calculate_order_shipping(jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.calculate_order_shipping(jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.cancel_historical_order(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.cancel_historical_order(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.cancel_historical_order(text) TO "service_role";

REVOKE ALL ON FUNCTION public.cancel_member_shopping_credit_deletion(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.cancel_member_shopping_credit_deletion(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.cancel_member_shopping_credit_deletion(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.capture_admin_audit_log() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.capture_admin_audit_log() TO "anon";

GRANT EXECUTE ON FUNCTION public.capture_admin_audit_log() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.capture_admin_audit_log() TO "service_role";

REVOKE ALL ON FUNCTION public.capture_promotion_configuration_audit() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.capture_promotion_configuration_audit() TO "anon";

GRANT EXECUTE ON FUNCTION public.capture_promotion_configuration_audit() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.capture_promotion_configuration_audit() TO "service_role";

REVOKE ALL ON FUNCTION public.claim_order_payment(text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.claim_order_payment(text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.claim_order_payment_notification(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.claim_order_payment_notification(text) TO "service_role";

REVOKE ALL ON FUNCTION public.claim_professional_application_admin_notification(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.claim_professional_application_admin_notification(uuid,uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.claim_professional_quarterly_notices(integer) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.claim_professional_quarterly_notices(integer) TO "service_role";

REVOKE ALL ON FUNCTION public.claim_professional_quarterly_notices_for_quarter(date,integer) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.claim_professional_quarterly_notices_for_quarter(date,integer) TO "service_role";

REVOKE ALL ON FUNCTION public.close_backorders_for_fulfillment(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.close_backorders_for_fulfillment(text) TO "service_role";

REVOKE ALL ON FUNCTION public.close_inventory_count_shortages_on_order_status() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.close_inventory_count_shortages_on_order_status() TO "anon";

GRANT EXECUTE ON FUNCTION public.close_inventory_count_shortages_on_order_status() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.close_inventory_count_shortages_on_order_status() TO "service_role";

REVOKE ALL ON FUNCTION public.complete_inventory_count(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.complete_inventory_count(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.complete_inventory_count(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.complete_order_payment_claim(text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.complete_order_payment_claim(text,text,boolean) TO "anon";

GRANT EXECUTE ON FUNCTION public.complete_order_payment_claim(text,text,boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.complete_order_payment_claim(text,text,boolean) TO "service_role";

REVOKE ALL ON FUNCTION public.complete_order_payment_notification(text,boolean,text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.complete_order_payment_notification(text,boolean,text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.complete_professional_application_admin_notification(uuid,boolean,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.complete_professional_application_admin_notification(uuid,boolean,text) TO "service_role";

REVOKE ALL ON FUNCTION public.confirm_assisted_credit_consent(text,text,bigint) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.confirm_assisted_credit_consent(text,text,bigint) TO "service_role";

REVOKE ALL ON FUNCTION public.consume_order_shopping_credit(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.consume_order_shopping_credit(text) TO "service_role";

REVOKE ALL ON FUNCTION public.consume_rate_limit_internal(text,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.consume_rate_limit_internal(text,text,integer,integer) TO "anon";

GRANT EXECUTE ON FUNCTION public.consume_rate_limit_internal(text,text,integer,integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.consume_rate_limit_internal(text,text,integer,integer) TO "service_role";

REVOKE ALL ON FUNCTION public.consume_service_rate_limit(text,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.consume_service_rate_limit(text,text,integer,integer) TO "anon";

GRANT EXECUTE ON FUNCTION public.consume_service_rate_limit(text,text,integer,integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.consume_service_rate_limit(text,text,integer,integer) TO "service_role";

REVOKE ALL ON FUNCTION public.coupon_campaign_allows_identity(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.coupon_campaign_allows_identity(uuid,text) TO "anon";

GRANT EXECUTE ON FUNCTION public.coupon_campaign_allows_identity(uuid,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.coupon_campaign_allows_identity(uuid,text) TO "service_role";

REVOKE ALL ON FUNCTION public.create_assisted_order(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.create_assisted_order(uuid,jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.create_assisted_order(uuid,jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.create_assisted_order_base_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.create_assisted_order_base_v1(uuid,jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.create_historical_order(uuid,date,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.create_historical_order(uuid,date,jsonb,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.create_historical_order(uuid,date,jsonb,text) TO "service_role";

REVOKE ALL ON FUNCTION public.create_inventory_count(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.create_inventory_count(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.create_inventory_count(text) TO "service_role";

REVOKE ALL ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,jsonb) TO "anon";

GRANT EXECUTE ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint) TO "anon";

GRANT EXECUTE ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint) TO "service_role";

REVOKE ALL ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text) TO "anon";

GRANT EXECUTE ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text) TO "anon";

GRANT EXECUTE ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text) TO "anon";

GRANT EXECUTE ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.create_professional_quarterly_notice_correction(uuid,date,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.create_professional_quarterly_notice_correction(uuid,date,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.create_professional_quarterly_notice_correction(uuid,date,text) TO "service_role";

REVOKE ALL ON FUNCTION public.delete_cancelled_order(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.delete_cancelled_order(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.delete_cancelled_order(text) TO "service_role";

REVOKE ALL ON FUNCTION public.delete_draft_inventory_count(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.delete_draft_inventory_count(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.delete_draft_inventory_count(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.delete_professional_award_evidence(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.delete_professional_award_evidence(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.delete_professional_award_evidence(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.delete_purchase_order(bigint) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.delete_purchase_order(bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.delete_purchase_order(bigint) TO "service_role";

REVOKE ALL ON FUNCTION public.downgrade_professional_renewal_nonapplicant(uuid,integer,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.downgrade_professional_renewal_nonapplicant(uuid,integer,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.downgrade_professional_renewal_nonapplicant(uuid,integer,text) TO "service_role";

REVOKE ALL ON FUNCTION public.end_instructor_student_bindings_on_member_delete() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.end_instructor_student_bindings_on_member_delete() TO "service_role";

REVOKE ALL ON FUNCTION public.enforce_order_creation_rate_limit() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.enforce_order_creation_rate_limit() TO "anon";

GRANT EXECUTE ON FUNCTION public.enforce_order_creation_rate_limit() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.enforce_order_creation_rate_limit() TO "service_role";

REVOKE ALL ON FUNCTION public.enforce_product_variant_default() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.enforce_product_variant_default() TO "anon";

GRANT EXECUTE ON FUNCTION public.enforce_product_variant_default() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.enforce_product_variant_default() TO "service_role";

REVOKE ALL ON FUNCTION public.finalize_professional_renewal_application(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.finalize_professional_renewal_application(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.finalize_professional_renewal_application(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.finalize_professional_renewal_year(integer) FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.get_admin_assisted_link(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_admin_assisted_link(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_admin_assisted_link(text) TO "service_role";

REVOKE ALL ON FUNCTION public.get_admin_assisted_request(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_admin_assisted_request(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_admin_assisted_request(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.get_admin_catalog() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_admin_catalog() TO "anon";

GRANT EXECUTE ON FUNCTION public.get_admin_catalog() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_admin_catalog() TO "service_role";

REVOKE ALL ON FUNCTION public.get_admin_catalog_before_member_pricing() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_admin_catalog_before_member_pricing() TO "service_role";

REVOKE ALL ON FUNCTION public.get_admin_instructor_student_member(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_admin_instructor_student_member(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION public.get_admin_instructor_student_member(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION public.get_admin_inventory_allocations() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_admin_inventory_allocations() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_admin_inventory_allocations() TO "service_role";

REVOKE ALL ON FUNCTION public.get_admin_member_notes() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_admin_member_notes() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_admin_member_notes() TO "service_role";

REVOKE ALL ON FUNCTION public.get_admin_member_pricing() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_admin_member_pricing() TO "anon";

GRANT EXECUTE ON FUNCTION public.get_admin_member_pricing() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_admin_member_pricing() TO "service_role";

REVOKE ALL ON FUNCTION public.get_admin_order_notes() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_admin_order_notes() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_admin_order_notes() TO "service_role";

REVOKE ALL ON FUNCTION public.get_admin_order_payment_details() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_admin_order_payment_details() TO "anon";

GRANT EXECUTE ON FUNCTION public.get_admin_order_payment_details() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_admin_order_payment_details() TO "service_role";

REVOKE ALL ON FUNCTION public.get_admin_order_payment_methods() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_admin_order_payment_methods() TO "anon";

GRANT EXECUTE ON FUNCTION public.get_admin_order_payment_methods() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_admin_order_payment_methods() TO "service_role";

REVOKE ALL ON FUNCTION public.get_admin_professional_quarterly_notices() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_admin_professional_quarterly_notices() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_admin_professional_quarterly_notices() TO "service_role";

REVOKE ALL ON FUNCTION public.get_admin_professional_renewal_roster(integer) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_admin_professional_renewal_roster(integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_admin_professional_renewal_roster(integer) TO "service_role";

REVOKE ALL ON FUNCTION public.get_admin_professional_renewals() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_admin_professional_renewals() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_admin_professional_renewals() TO "service_role";

REVOKE ALL ON FUNCTION public.get_admin_professional_sales() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_admin_professional_sales() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_admin_professional_sales() TO "service_role";

REVOKE ALL ON FUNCTION public.get_admin_shipping_groups() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_admin_shipping_groups() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_admin_shipping_groups() TO "service_role";

REVOKE ALL ON FUNCTION public.get_admin_student_pricing_history() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_admin_student_pricing_history() TO "service_role";

GRANT EXECUTE ON FUNCTION public.get_admin_student_pricing_history() TO "authenticated";

REVOKE ALL ON FUNCTION public.get_admin_student_pricing_settings() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_admin_student_pricing_settings() TO "service_role";

GRANT EXECUTE ON FUNCTION public.get_admin_student_pricing_settings() TO "authenticated";

REVOKE ALL ON FUNCTION public.get_backorder_management_data() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_backorder_management_data() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_backorder_management_data() TO "service_role";

REVOKE ALL ON FUNCTION public.get_coupon_campaign_members(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_coupon_campaign_members(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_coupon_campaign_members(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.get_event_catalog() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_event_catalog() TO "anon";

GRANT EXECUTE ON FUNCTION public.get_event_catalog() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_event_catalog() TO "service_role";

REVOKE ALL ON FUNCTION public.get_event_catalog_before_member_pricing() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_event_catalog_before_member_pricing() TO "service_role";

REVOKE ALL ON FUNCTION public.get_inventory_count_detail(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_inventory_count_detail(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_inventory_count_detail(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.get_inventory_count_gift_shortages() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_inventory_count_gift_shortages() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_inventory_count_gift_shortages() TO "service_role";

REVOKE ALL ON FUNCTION public.get_inventory_count_sessions() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_inventory_count_sessions() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_inventory_count_sessions() TO "service_role";

REVOKE ALL ON FUNCTION public.get_member_shopping_credit(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_member_shopping_credit(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_member_shopping_credit(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.get_my_appendable_shipping_group() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_my_appendable_shipping_group() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_my_appendable_shipping_group() TO "service_role";

REVOKE ALL ON FUNCTION public.get_my_backoffice_access() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_my_backoffice_access() TO "anon";

GRANT EXECUTE ON FUNCTION public.get_my_backoffice_access() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_my_backoffice_access() TO "service_role";

REVOKE ALL ON FUNCTION public.get_my_instructor_students() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_my_instructor_students() TO "service_role";

GRANT EXECUTE ON FUNCTION public.get_my_instructor_students() TO "authenticated";

REVOKE ALL ON FUNCTION public.get_my_professional_renewal() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_my_professional_renewal() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_my_professional_renewal() TO "service_role";

REVOKE ALL ON FUNCTION public.get_my_professional_sales() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_my_professional_sales() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_my_professional_sales() TO "service_role";

REVOKE ALL ON FUNCTION public.get_my_shopping_credit() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_my_shopping_credit() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_my_shopping_credit() TO "service_role";

REVOKE ALL ON FUNCTION public.get_my_student_pricing_context() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_my_student_pricing_context() TO "service_role";

GRANT EXECUTE ON FUNCTION public.get_my_student_pricing_context() TO "authenticated";

REVOKE ALL ON FUNCTION public.get_my_student_product_prices() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_my_student_product_prices() TO "service_role";

GRANT EXECUTE ON FUNCTION public.get_my_student_product_prices() TO "anon";

GRANT EXECUTE ON FUNCTION public.get_my_student_product_prices() TO "authenticated";

REVOKE ALL ON FUNCTION public.get_procurement_management_data() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_procurement_management_data() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_procurement_management_data() TO "service_role";

REVOKE ALL ON FUNCTION public.get_professional_renewal_assessment(uuid,integer,date) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_professional_renewal_assessment(uuid,integer,date) TO "service_role";

REVOKE ALL ON FUNCTION public.get_professional_sales_payload(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_professional_sales_payload(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.get_public_sales_orders() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_public_sales_orders() TO "service_role";

REVOKE ALL ON FUNCTION public.get_public_sales_stats() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_public_sales_stats() TO "anon";

GRANT EXECUTE ON FUNCTION public.get_public_sales_stats() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_public_sales_stats() TO "service_role";

REVOKE ALL ON FUNCTION public.get_storefront_catalog() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_storefront_catalog() TO "anon";

GRANT EXECUTE ON FUNCTION public.get_storefront_catalog() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_storefront_catalog() TO "service_role";

REVOKE ALL ON FUNCTION public.get_storefront_catalog_before_member_pricing() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_storefront_catalog_before_member_pricing() TO "service_role";

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.handle_new_user() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.handle_new_user() TO "anon";

GRANT EXECUTE ON FUNCTION public.handle_new_user() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.handle_new_user() TO "service_role";

REVOKE ALL ON FUNCTION public.has_backoffice_permission(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.has_backoffice_permission(text) TO "anon";

GRANT EXECUTE ON FUNCTION public.has_backoffice_permission(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.has_backoffice_permission(text) TO "service_role";

REVOKE ALL ON FUNCTION public.instructor_student_context(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.instructor_student_context(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.is_eclado_admin() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.is_eclado_admin() TO "anon";

GRANT EXECUTE ON FUNCTION public.is_eclado_admin() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.is_eclado_admin() TO "service_role";

REVOKE ALL ON FUNCTION public.is_eclado_backoffice_user() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.is_eclado_backoffice_user() TO "anon";

GRANT EXECUTE ON FUNCTION public.is_eclado_backoffice_user() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.is_eclado_backoffice_user() TO "service_role";

REVOKE ALL ON FUNCTION public.is_professional_shipping_role(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.is_professional_shipping_role(text) TO "service_role";

REVOKE ALL ON FUNCTION public.is_public_product_image_storage_path(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.is_public_product_image_storage_path(text) TO "anon";

GRANT EXECUTE ON FUNCTION public.is_public_product_image_storage_path(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.is_public_product_image_storage_path(text) TO "service_role";

REVOKE ALL ON FUNCTION public.is_shipping_group_valid_order_status(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.is_shipping_group_valid_order_status(text) TO "service_role";

REVOKE ALL ON FUNCTION public.make_product_slug(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.make_product_slug(text) TO "anon";

GRANT EXECUTE ON FUNCTION public.make_product_slug(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.make_product_slug(text) TO "service_role";

REVOKE ALL ON FUNCTION public.member_pricing_defaults() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.member_pricing_defaults() TO "service_role";

REVOKE ALL ON FUNCTION public.next_purchase_order_number() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.next_purchase_order_number() TO "service_role";

REVOKE ALL ON FUNCTION public.normalize_coupon_campaign_code() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.normalize_coupon_campaign_code() TO "anon";

GRANT EXECUTE ON FUNCTION public.normalize_coupon_campaign_code() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.normalize_coupon_campaign_code() TO "service_role";

REVOKE ALL ON FUNCTION public.open_professional_evidence_entry_window(uuid,integer,timestamp with time zone,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.open_professional_evidence_entry_window(uuid,integer,timestamp with time zone,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.open_professional_evidence_entry_window(uuid,integer,timestamp with time zone,text) TO "service_role";

REVOKE ALL ON FUNCTION public.order_consumes_inventory(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.order_consumes_inventory(text) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.order_consumes_inventory(text) TO "anon";

GRANT EXECUTE ON FUNCTION public.order_consumes_inventory(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.order_consumes_inventory(text) TO "service_role";

REVOKE ALL ON FUNCTION public.order_net_merchandise_amount(numeric,numeric,numeric,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.order_net_merchandise_amount(numeric,numeric,numeric,jsonb,jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.order_reserves_inventory(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.order_reserves_inventory(text) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.order_reserves_inventory(text) TO "anon";

GRANT EXECUTE ON FUNCTION public.order_reserves_inventory(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.order_reserves_inventory(text) TO "service_role";

REVOKE ALL ON FUNCTION public.persist_assisted_benefits(text,jsonb,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.persist_assisted_benefits(text,jsonb,uuid,text) TO "service_role";

REVOKE ALL ON FUNCTION public.prepare_member_shopping_credit_deletion(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.prepare_member_shopping_credit_deletion(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.prepare_member_shopping_credit_deletion(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.prepare_product_variant() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.prepare_product_variant() TO "anon";

GRANT EXECUTE ON FUNCTION public.prepare_product_variant() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.prepare_product_variant() TO "service_role";

REVOKE ALL ON FUNCTION public.prepare_professional_quarterly_notices(date) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.prepare_professional_quarterly_notices(date) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.prepare_professional_quarterly_notices(date) TO "service_role";

REVOKE ALL ON FUNCTION public.prepare_shipping_group_for_order_status() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.prepare_shipping_group_for_order_status() TO "service_role";

REVOKE ALL ON FUNCTION public.prevent_audit_log_mutation() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.prevent_audit_log_mutation() TO "anon";

GRANT EXECUTE ON FUNCTION public.prevent_audit_log_mutation() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.prevent_audit_log_mutation() TO "service_role";

REVOKE ALL ON FUNCTION public.prevent_instructor_student_audit_mutation() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.prevent_instructor_student_audit_mutation() TO "service_role";

REVOKE ALL ON FUNCTION public.prevent_order_adjustment_mutation() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.prevent_order_adjustment_mutation() TO "anon";

GRANT EXECUTE ON FUNCTION public.prevent_order_adjustment_mutation() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.prevent_order_adjustment_mutation() TO "service_role";

REVOKE ALL ON FUNCTION public.prevent_shopping_credit_ledger_mutation() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.prevent_shopping_credit_ledger_mutation() TO "anon";

GRANT EXECUTE ON FUNCTION public.prevent_shopping_credit_ledger_mutation() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.prevent_shopping_credit_ledger_mutation() TO "service_role";

REVOKE ALL ON FUNCTION public.promotion_item_matches_scope(uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.promotion_item_matches_scope(uuid,jsonb,text) TO "anon";

GRANT EXECUTE ON FUNCTION public.promotion_item_matches_scope(uuid,jsonb,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.promotion_item_matches_scope(uuid,jsonb,text) TO "service_role";

REVOKE ALL ON FUNCTION public.protect_assisted_order() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.protect_assisted_order() TO "service_role";

REVOKE ALL ON FUNCTION public.protect_historical_order_identity() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.protect_historical_order_identity() TO "service_role";

REVOKE ALL ON FUNCTION public.protect_order_pricing_snapshot() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.protect_order_pricing_snapshot() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.protect_order_pricing_snapshot() TO "anon";

GRANT EXECUTE ON FUNCTION public.protect_order_pricing_snapshot() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.protect_order_pricing_snapshot() TO "service_role";

REVOKE ALL ON FUNCTION public.protect_order_shipping_group_relationship() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.protect_order_shipping_group_relationship() TO "service_role";

REVOKE ALL ON FUNCTION public.protect_profile_invoice_default_fields() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.protect_profile_invoice_default_fields() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.protect_profile_invoice_default_fields() TO "anon";

GRANT EXECUTE ON FUNCTION public.protect_profile_invoice_default_fields() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.protect_profile_invoice_default_fields() TO "service_role";

REVOKE ALL ON FUNCTION public.protect_profile_salon_fields() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.protect_profile_salon_fields() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.protect_profile_salon_fields() TO "anon";

GRANT EXECUTE ON FUNCTION public.protect_profile_salon_fields() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.protect_profile_salon_fields() TO "service_role";

REVOKE ALL ON FUNCTION public.protect_profile_security_fields() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.protect_profile_security_fields() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.protect_profile_security_fields() TO "anon";

GRANT EXECUTE ON FUNCTION public.protect_profile_security_fields() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.protect_profile_security_fields() TO "service_role";

REVOKE ALL ON FUNCTION public.protect_reserved_gift_inventory() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.protect_reserved_gift_inventory() TO "anon";

GRANT EXECUTE ON FUNCTION public.protect_reserved_gift_inventory() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.protect_reserved_gift_inventory() TO "service_role";

REVOKE ALL ON FUNCTION public.protect_shopping_credit_reservation_identity() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.protect_shopping_credit_reservation_identity() TO "anon";

GRANT EXECUTE ON FUNCTION public.protect_shopping_credit_reservation_identity() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.protect_shopping_credit_reservation_identity() TO "service_role";

REVOKE ALL ON FUNCTION public.quote_assisted_order(jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.quote_assisted_order(jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.quote_assisted_order(jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.quote_order_pricing(jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.quote_order_pricing(jsonb,text,text,text) TO "anon";

GRANT EXECUTE ON FUNCTION public.quote_order_pricing(jsonb,text,text,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.quote_order_pricing(jsonb,text,text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.quote_order_pricing(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.quote_order_pricing(jsonb,text) TO "anon";

GRANT EXECUTE ON FUNCTION public.quote_order_pricing(jsonb,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.quote_order_pricing(jsonb,text) TO "service_role";

REVOKE ALL ON FUNCTION public.quote_order_pricing_discount_v2(jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.quote_order_pricing_discount_v2(jsonb,text,text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.quote_order_pricing_internal_20260916(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.quote_order_pricing_internal_20260916(jsonb,text) TO "service_role";

REVOKE ALL ON FUNCTION public.reconcile_member_shopping_credit(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.reconcile_member_shopping_credit(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.reconcile_member_shopping_credit(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.record_professional_sales_audit(text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.record_professional_sales_audit(text,text,text,jsonb,jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.refund_order_shopping_credit(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.refund_order_shopping_credit(text) TO "service_role";

REVOKE ALL ON FUNCTION public.refund_shipping_group_fee(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.refund_shipping_group_fee(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.release_assisted_inventory(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.release_assisted_inventory(text) TO "service_role";

REVOKE ALL ON FUNCTION public.release_inventory_for_order(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.release_inventory_for_order(text) TO "service_role";

REVOKE ALL ON FUNCTION public.release_order_shopping_credit(text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.release_order_shopping_credit(text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.reserve_order_shopping_credit(uuid,text,bigint) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.reserve_order_shopping_credit(uuid,text,bigint) TO "service_role";

REVOKE ALL ON FUNCTION public.resolve_assisted_payment_claim(text,text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.resolve_assisted_payment_claim(text,text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.resolve_product_price_multiplier(products,text,numeric) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.resolve_product_price_multiplier(products,text,numeric) TO "service_role";

REVOKE ALL ON FUNCTION public.review_professional_award_evidence(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.review_professional_award_evidence(uuid,text,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.review_professional_award_evidence(uuid,text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.review_professional_renewal_application(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.review_professional_renewal_application(uuid,text,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.review_professional_renewal_application(uuid,text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.sanitize_public_order_quote(jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sanitize_public_order_quote(jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.save_coupon_campaign(jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.save_coupon_campaign(jsonb) TO "anon";

GRANT EXECUTE ON FUNCTION public.save_coupon_campaign(jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.save_coupon_campaign(jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.save_discount_promotion(jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.save_discount_promotion(jsonb) TO "anon";

GRANT EXECUTE ON FUNCTION public.save_discount_promotion(jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.save_discount_promotion(jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.save_instructor_student_binding(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.save_instructor_student_binding(uuid,uuid,uuid,text) TO "service_role";

GRANT EXECUTE ON FUNCTION public.save_instructor_student_binding(uuid,uuid,uuid,text) TO "authenticated";

REVOKE ALL ON FUNCTION public.save_member_admin_note(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.save_member_admin_note(uuid,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.save_member_admin_note(uuid,text) TO "service_role";

REVOKE ALL ON FUNCTION public.save_member_pricing(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.save_member_pricing(jsonb,jsonb) TO "anon";

GRANT EXECUTE ON FUNCTION public.save_member_pricing(jsonb,jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.save_member_pricing(jsonb,jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.save_order_invoice_number(text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.save_order_invoice_number(text,text) TO "anon";

GRANT EXECUTE ON FUNCTION public.save_order_invoice_number(text,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.save_order_invoice_number(text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.save_procurement_address(jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.save_procurement_address(jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.save_procurement_address(jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.save_product_images(integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.save_product_images(integer,jsonb) TO "anon";

GRANT EXECUTE ON FUNCTION public.save_product_images(integer,jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.save_product_images(integer,jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.save_product_with_variants(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.save_product_with_variants(jsonb,jsonb) TO "anon";

GRANT EXECUTE ON FUNCTION public.save_product_with_variants(jsonb,jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.save_product_with_variants(jsonb,jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.save_professional_award_evidence(uuid,text,date,text,text,text,text,integer,boolean) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.save_professional_award_evidence(uuid,text,date,text,text,text,text,integer,boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.save_professional_award_evidence(uuid,text,date,text,text,text,text,integer,boolean) TO "service_role";

REVOKE ALL ON FUNCTION public.save_professional_sales_adjustment(uuid,integer,numeric,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.save_professional_sales_adjustment(uuid,integer,numeric,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.save_professional_sales_adjustment(uuid,integer,numeric,text) TO "service_role";

REVOKE ALL ON FUNCTION public.save_professional_sales_adjustment_v2(uuid,date,numeric,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.save_professional_sales_adjustment_v2(uuid,date,numeric,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.save_professional_sales_adjustment_v2(uuid,date,numeric,text) TO "service_role";

REVOKE ALL ON FUNCTION public.save_purchase_order(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.save_purchase_order(jsonb,jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.save_purchase_order(jsonb,jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.save_student_pricing_settings(jsonb,bigint) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.save_student_pricing_settings(jsonb,bigint) TO "service_role";

GRANT EXECUTE ON FUNCTION public.save_student_pricing_settings(jsonb,bigint) TO "authenticated";

REVOKE ALL ON FUNCTION public.search_coupon_members(text,integer) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.search_coupon_members(text,integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.search_coupon_members(text,integer) TO "service_role";

REVOKE ALL ON FUNCTION public.seed_profile_salon_from_application() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.seed_profile_salon_from_application() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.seed_profile_salon_from_application() TO "anon";

GRANT EXECUTE ON FUNCTION public.seed_profile_salon_from_application() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.seed_profile_salon_from_application() TO "service_role";

REVOKE ALL ON FUNCTION public.set_instructor_student_price_type(uuid,text,bigint) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.set_instructor_student_price_type(uuid,text,bigint) TO "service_role";

GRANT EXECUTE ON FUNCTION public.set_instructor_student_price_type(uuid,text,bigint) TO "authenticated";

REVOKE ALL ON FUNCTION public.set_member_role_with_membership(uuid,text,date,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.set_member_role_with_membership(uuid,text,date,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.set_member_role_with_membership(uuid,text,date,text) TO "service_role";

REVOKE ALL ON FUNCTION public.set_order_first_paid_at() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.set_order_first_paid_at() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_order_first_paid_at() TO "anon";

GRANT EXECUTE ON FUNCTION public.set_order_first_paid_at() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.set_order_first_paid_at() TO "service_role";

REVOKE ALL ON FUNCTION public.set_order_payment_amount_defaults() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.set_order_payment_amount_defaults() TO "anon";

GRANT EXECUTE ON FUNCTION public.set_order_payment_amount_defaults() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.set_order_payment_amount_defaults() TO "service_role";

REVOKE ALL ON FUNCTION public.set_order_payment_due_at() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.set_order_payment_due_at() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_order_payment_due_at() TO "anon";

GRANT EXECUTE ON FUNCTION public.set_order_payment_due_at() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.set_order_payment_due_at() TO "service_role";

REVOKE ALL ON FUNCTION public.set_order_public_lookup_code() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.set_order_public_lookup_code() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_order_public_lookup_code() TO "anon";

GRANT EXECUTE ON FUNCTION public.set_order_public_lookup_code() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.set_order_public_lookup_code() TO "service_role";

REVOKE ALL ON FUNCTION public.set_order_shipment_metadata() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.set_order_shipment_metadata() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_order_shipment_metadata() TO "anon";

GRANT EXECUTE ON FUNCTION public.set_order_shipment_metadata() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.set_order_shipment_metadata() TO "service_role";

REVOKE ALL ON FUNCTION public.set_product_publication_status(integer,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.set_product_publication_status(integer,text) TO "anon";

GRANT EXECUTE ON FUNCTION public.set_product_publication_status(integer,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.set_product_publication_status(integer,text) TO "service_role";

REVOKE ALL ON FUNCTION public.set_product_slug_on_insert() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.set_product_slug_on_insert() TO "anon";

GRANT EXECUTE ON FUNCTION public.set_product_slug_on_insert() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.set_product_slug_on_insert() TO "service_role";

REVOKE ALL ON FUNCTION public.set_professional_membership_start(uuid,date) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.set_professional_membership_start(uuid,date) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.set_professional_membership_start(uuid,date) TO "service_role";

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.set_updated_at() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_updated_at() TO "anon";

GRANT EXECUTE ON FUNCTION public.set_updated_at() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.set_updated_at() TO "service_role";

REVOKE ALL ON FUNCTION public.ship_shipping_group(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.ship_shipping_group(uuid,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.ship_shipping_group(uuid,text) TO "service_role";

REVOKE ALL ON FUNCTION public.shipping_group_effective_amount(orders) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.shipping_group_effective_amount(orders) TO "service_role";

REVOKE ALL ON FUNCTION public.student_price_confirmation(jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.student_price_confirmation(jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.student_pricing_multiplier(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.student_pricing_multiplier(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.submit_professional_application(text,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.submit_professional_application(text,text,text,text,text,text) TO "anon";

GRANT EXECUTE ON FUNCTION public.submit_professional_application(text,text,text,text,text,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.submit_professional_application(text,text,text,text,text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.submit_professional_application_with_certificates(text,text,text,text,text,text,uuid,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.submit_professional_application_with_certificates(text,text,text,text,text,text,uuid,jsonb,text,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.submit_professional_application_with_certificates(text,text,text,text,text,text,uuid,jsonb,text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.submit_professional_application_with_certificates(text,text,text,text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.submit_professional_application_with_certificates(text,text,text,text,text,text,uuid,jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.submit_professional_application_with_certificates(text,text,text,text,text,text,uuid,jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.submit_professional_renewal_application() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.submit_professional_renewal_application() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.submit_professional_renewal_application() TO "service_role";

REVOKE ALL ON FUNCTION public.sync_approved_application_invoice_defaults() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sync_approved_application_invoice_defaults() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.sync_approved_application_invoice_defaults() TO "anon";

GRANT EXECUTE ON FUNCTION public.sync_approved_application_invoice_defaults() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.sync_approved_application_invoice_defaults() TO "service_role";

REVOKE ALL ON FUNCTION public.sync_assisted_inventory() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sync_assisted_inventory() TO "service_role";

REVOKE ALL ON FUNCTION public.sync_coupon_redemption_from_order_status() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sync_coupon_redemption_from_order_status() TO "anon";

GRANT EXECUTE ON FUNCTION public.sync_coupon_redemption_from_order_status() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.sync_coupon_redemption_from_order_status() TO "service_role";

REVOKE ALL ON FUNCTION public.sync_gift_reservation_from_order_status() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sync_gift_reservation_from_order_status() TO "anon";

GRANT EXECUTE ON FUNCTION public.sync_gift_reservation_from_order_status() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.sync_gift_reservation_from_order_status() TO "service_role";

REVOKE ALL ON FUNCTION public.sync_inventory_allocation_for_order() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sync_inventory_allocation_for_order() TO "service_role";

REVOKE ALL ON FUNCTION public.sync_inventory_for_order() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sync_inventory_for_order() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.sync_inventory_for_order() TO "anon";

GRANT EXECUTE ON FUNCTION public.sync_inventory_for_order() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.sync_inventory_for_order() TO "service_role";

REVOKE ALL ON FUNCTION public.sync_product_publication_status() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sync_product_publication_status() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.sync_product_publication_status() TO "anon";

GRANT EXECUTE ON FUNCTION public.sync_product_publication_status() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.sync_product_publication_status() TO "service_role";

REVOKE ALL ON FUNCTION public.sync_product_stock_mirror(integer) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sync_product_stock_mirror(integer) TO "service_role";

REVOKE ALL ON FUNCTION public.sync_shipping_group_from_order_status() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sync_shipping_group_from_order_status() TO "service_role";

REVOKE ALL ON FUNCTION public.sync_shopping_credit_from_order_status() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.sync_shopping_credit_from_order_status() TO "service_role";

REVOKE ALL ON FUNCTION public.update_inventory_count_item(bigint,integer,integer) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.update_inventory_count_item(bigint,integer,integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.update_inventory_count_item(bigint,integer,integer) TO "service_role";

REVOKE ALL ON FUNCTION public.update_purchase_order_status(bigint,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.update_purchase_order_status(bigint,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.update_purchase_order_status(bigint,text) TO "service_role";

REVOKE ALL ON FUNCTION public.validate_coupon_promotion_link() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.validate_coupon_promotion_link() TO "anon";

GRANT EXECUTE ON FUNCTION public.validate_coupon_promotion_link() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.validate_coupon_promotion_link() TO "service_role";

REVOKE ALL ON SEQUENCE public."audit_logs_id_seq" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON SEQUENCE public."audit_logs_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."audit_logs_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."audit_logs_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."audit_logs_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."audit_logs_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."audit_logs_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."audit_logs_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."audit_logs_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."audit_logs_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE public."coupon_campaign_members_id_seq" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON SEQUENCE public."coupon_campaign_members_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."coupon_campaign_members_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."coupon_campaign_members_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."coupon_campaign_members_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."coupon_campaign_members_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."coupon_campaign_members_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."coupon_campaign_members_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."coupon_campaign_members_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."coupon_campaign_members_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE public."coupon_promotions_id_seq" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON SEQUENCE public."coupon_promotions_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."coupon_promotions_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."coupon_promotions_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."coupon_promotions_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."coupon_promotions_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."coupon_promotions_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."coupon_promotions_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."coupon_promotions_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."coupon_promotions_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE public."instructor_student_audit_logs_id_seq" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON SEQUENCE public."instructor_student_audit_logs_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."instructor_student_audit_logs_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."instructor_student_audit_logs_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."instructor_student_audit_logs_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."instructor_student_audit_logs_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."instructor_student_audit_logs_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."instructor_student_audit_logs_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."instructor_student_audit_logs_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."instructor_student_audit_logs_id_seq" TO "service_role";

ALTER SEQUENCE public."inventory_allocation_events_id_seq" OWNED BY public."inventory_allocation_events"."id";

REVOKE ALL ON SEQUENCE public."inventory_allocation_events_id_seq" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON SEQUENCE public."inventory_allocation_events_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."inventory_allocation_events_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."inventory_allocation_events_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."inventory_allocation_events_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."inventory_allocation_events_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."inventory_allocation_events_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."inventory_allocation_events_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."inventory_allocation_events_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."inventory_allocation_events_id_seq" TO "service_role";

ALTER SEQUENCE public."inventory_count_items_id_seq" OWNED BY public."inventory_count_items"."id";

REVOKE ALL ON SEQUENCE public."inventory_count_items_id_seq" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON SEQUENCE public."inventory_count_items_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."inventory_count_items_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."inventory_count_items_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."inventory_count_items_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."inventory_count_items_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."inventory_count_items_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."inventory_count_items_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."inventory_count_items_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."inventory_count_items_id_seq" TO "service_role";

ALTER SEQUENCE public."inventory_count_shortages_id_seq" OWNED BY public."inventory_count_shortages"."id";

REVOKE ALL ON SEQUENCE public."inventory_count_shortages_id_seq" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON SEQUENCE public."inventory_count_shortages_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."inventory_count_shortages_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."inventory_count_shortages_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."inventory_count_shortages_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."inventory_count_shortages_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."inventory_count_shortages_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."inventory_count_shortages_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."inventory_count_shortages_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."inventory_count_shortages_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE public."order_adjustments_id_seq" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON SEQUENCE public."order_adjustments_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."order_adjustments_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."order_adjustments_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."order_adjustments_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."order_adjustments_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."order_adjustments_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."order_adjustments_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."order_adjustments_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."order_adjustments_id_seq" TO "service_role";

ALTER SEQUENCE public."order_inventory_allocations_id_seq" OWNED BY public."order_inventory_allocations"."id";

REVOKE ALL ON SEQUENCE public."order_inventory_allocations_id_seq" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON SEQUENCE public."order_inventory_allocations_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."order_inventory_allocations_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."order_inventory_allocations_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."order_inventory_allocations_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."order_inventory_allocations_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."order_inventory_allocations_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."order_inventory_allocations_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."order_inventory_allocations_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."order_inventory_allocations_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE public."procurement_addresses_id_seq" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON SEQUENCE public."procurement_addresses_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."procurement_addresses_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."procurement_addresses_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."procurement_addresses_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."procurement_addresses_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."procurement_addresses_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."procurement_addresses_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."procurement_addresses_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."procurement_addresses_id_seq" TO "service_role";

ALTER SEQUENCE public."product_variants_id_seq" OWNED BY public."product_variants"."id";

REVOKE ALL ON SEQUENCE public."product_variants_id_seq" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON SEQUENCE public."product_variants_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."product_variants_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."product_variants_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."product_variants_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."product_variants_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."product_variants_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."product_variants_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."product_variants_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."product_variants_id_seq" TO "service_role";

ALTER SEQUENCE public."products_id_seq" OWNED BY public."products"."id";

REVOKE ALL ON SEQUENCE public."products_id_seq" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON SEQUENCE public."products_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."products_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."products_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."products_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."products_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."products_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."products_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."products_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."products_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE public."promotion_gift_reservations_id_seq" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON SEQUENCE public."promotion_gift_reservations_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."promotion_gift_reservations_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."promotion_gift_reservations_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."promotion_gift_reservations_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."promotion_gift_reservations_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."promotion_gift_reservations_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."promotion_gift_reservations_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."promotion_gift_reservations_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."promotion_gift_reservations_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE public."promotion_scopes_id_seq" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON SEQUENCE public."promotion_scopes_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."promotion_scopes_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."promotion_scopes_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."promotion_scopes_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."promotion_scopes_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."promotion_scopes_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."promotion_scopes_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."promotion_scopes_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."promotion_scopes_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE public."purchase_order_items_id_seq" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON SEQUENCE public."purchase_order_items_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."purchase_order_items_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."purchase_order_items_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."purchase_order_items_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."purchase_order_items_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."purchase_order_items_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."purchase_order_items_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."purchase_order_items_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."purchase_order_items_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE public."purchase_order_number_seq" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON SEQUENCE public."purchase_order_number_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."purchase_order_number_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."purchase_order_number_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."purchase_order_number_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."purchase_order_number_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."purchase_order_number_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."purchase_order_number_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."purchase_order_number_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."purchase_order_number_seq" TO "service_role";

REVOKE ALL ON SEQUENCE public."purchase_orders_id_seq" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON SEQUENCE public."purchase_orders_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."purchase_orders_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."purchase_orders_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."purchase_orders_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."purchase_orders_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."purchase_orders_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."purchase_orders_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."purchase_orders_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."purchase_orders_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE public."shopping_credit_ledger_id_seq" FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON SEQUENCE public."shopping_credit_ledger_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."shopping_credit_ledger_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."shopping_credit_ledger_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."shopping_credit_ledger_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."shopping_credit_ledger_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."shopping_credit_ledger_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."shopping_credit_ledger_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."shopping_credit_ledger_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."shopping_credit_ledger_id_seq" TO "service_role";

CREATE TRIGGER trg_admin_preferences_updated_at BEFORE UPDATE ON admin_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_audit_admin_users AFTER INSERT OR DELETE OR UPDATE ON admin_users FOR EACH ROW EXECUTE FUNCTION capture_admin_audit_log('user_id');

CREATE TRIGGER trg_prevent_audit_log_mutation BEFORE DELETE OR UPDATE ON audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER trg_audit_coupon_campaign_members AFTER INSERT OR DELETE OR UPDATE ON coupon_campaign_members FOR EACH ROW EXECUTE FUNCTION capture_promotion_configuration_audit();

CREATE TRIGGER trg_audit_coupon_campaigns AFTER INSERT OR DELETE OR UPDATE ON coupon_campaigns FOR EACH ROW EXECUTE FUNCTION capture_promotion_configuration_audit();

CREATE TRIGGER trg_coupon_campaigns_normalize_code BEFORE INSERT OR UPDATE ON coupon_campaigns FOR EACH ROW EXECUTE FUNCTION normalize_coupon_campaign_code();

CREATE TRIGGER trg_audit_coupon_promotions AFTER INSERT OR DELETE OR UPDATE ON coupon_promotions FOR EACH ROW EXECUTE FUNCTION capture_promotion_configuration_audit();

CREATE TRIGGER trg_coupon_promotions_validate BEFORE INSERT OR UPDATE ON coupon_promotions FOR EACH ROW EXECUTE FUNCTION validate_coupon_promotion_link();

CREATE TRIGGER trg_instructor_student_audit_immutable BEFORE DELETE OR UPDATE ON instructor_student_audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_instructor_student_audit_mutation();

CREATE TRIGGER trg_member_admin_notes_updated_at BEFORE UPDATE ON member_admin_notes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_membership_tiers_pricing_audit AFTER UPDATE ON membership_tiers FOR EACH ROW EXECUTE FUNCTION capture_admin_audit_log('role');

CREATE TRIGGER trg_prevent_order_adjustment_mutation BEFORE DELETE OR UPDATE ON order_adjustments FOR EACH ROW EXECUTE FUNCTION prevent_order_adjustment_mutation();

CREATE TRIGGER trg_audit_order_payment_authorizations AFTER INSERT OR DELETE OR UPDATE ON order_payment_authorizations FOR EACH ROW EXECUTE FUNCTION capture_admin_audit_log('order_id');

CREATE TRIGGER trg_assign_shipping_group_to_additional_order BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION assign_shipping_group_to_additional_order();

CREATE TRIGGER trg_assisted_inventory BEFORE INSERT OR UPDATE OF status, items ON orders FOR EACH ROW WHEN (new.order_source = 'admin_assisted'::text) EXECUTE FUNCTION sync_assisted_inventory();

CREATE TRIGGER trg_audit_orders AFTER INSERT OR DELETE OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION capture_admin_audit_log('id');

CREATE TRIGGER trg_close_inventory_count_shortages_on_order_status AFTER UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION close_inventory_count_shortages_on_order_status();

CREATE TRIGGER trg_orders_creation_rate_limit BEFORE INSERT ON orders FOR EACH ROW WHEN (new.order_source <> 'historical_manual'::text) EXECUTE FUNCTION enforce_order_creation_rate_limit();

CREATE TRIGGER trg_orders_first_paid_at BEFORE INSERT OR UPDATE OF status ON orders FOR EACH ROW WHEN (new.order_source <> 'historical_manual'::text) EXECUTE FUNCTION set_order_first_paid_at();

CREATE TRIGGER trg_orders_inventory_allocation_sync BEFORE INSERT OR UPDATE OF status, items ON orders FOR EACH ROW WHEN (new.order_source <> ALL (ARRAY['historical_manual'::text, 'admin_assisted'::text])) EXECUTE FUNCTION sync_inventory_allocation_for_order();

CREATE TRIGGER trg_orders_payment_amount_defaults BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION set_order_payment_amount_defaults();

CREATE TRIGGER trg_orders_payment_due_at BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION set_order_payment_due_at();

CREATE TRIGGER trg_orders_public_lookup_code BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION set_order_public_lookup_code();

CREATE TRIGGER trg_orders_shipment_metadata BEFORE UPDATE OF status, tracking ON orders FOR EACH ROW EXECUTE FUNCTION set_order_shipment_metadata();

CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_prepare_shipping_group_for_order_status BEFORE UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION prepare_shipping_group_for_order_status();

CREATE TRIGGER trg_protect_assisted_order BEFORE INSERT OR DELETE OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION protect_assisted_order();

CREATE TRIGGER trg_protect_historical_order_identity BEFORE INSERT OR DELETE OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION protect_historical_order_identity();

CREATE TRIGGER trg_protect_order_pricing_snapshot BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION protect_order_pricing_snapshot();

CREATE TRIGGER trg_protect_order_shipping_group_relationship BEFORE UPDATE OF shipping_group_id ON orders FOR EACH ROW EXECUTE FUNCTION protect_order_shipping_group_relationship();

CREATE TRIGGER trg_sync_coupon_redemption_from_order_status AFTER UPDATE OF status ON orders FOR EACH ROW WHEN (old.status IS DISTINCT FROM new.status) EXECUTE FUNCTION sync_coupon_redemption_from_order_status();

CREATE TRIGGER trg_sync_gift_reservation_from_order_status AFTER UPDATE OF status ON orders FOR EACH ROW WHEN (old.status IS DISTINCT FROM new.status) EXECUTE FUNCTION sync_gift_reservation_from_order_status();

CREATE TRIGGER trg_sync_shipping_group_from_order_status AFTER UPDATE OF status, shipping_group_id ON orders FOR EACH ROW EXECUTE FUNCTION sync_shipping_group_from_order_status();

CREATE TRIGGER trg_sync_shopping_credit_from_order_status AFTER UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION sync_shopping_credit_from_order_status();

CREATE TRIGGER trg_procurement_addresses_updated_at BEFORE UPDATE ON procurement_addresses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_audit_product_images AFTER INSERT OR DELETE OR UPDATE ON product_images FOR EACH ROW EXECUTE FUNCTION capture_admin_audit_log('id');

CREATE TRIGGER trg_product_images_updated_at BEFORE UPDATE ON product_images FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_audit_product_variants AFTER INSERT OR DELETE OR UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION capture_admin_audit_log('id');

CREATE CONSTRAINT TRIGGER trg_enforce_product_variant_default AFTER INSERT OR DELETE OR UPDATE ON product_variants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_product_variant_default();

CREATE TRIGGER trg_prepare_product_variant BEFORE INSERT OR UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION prepare_product_variant();

CREATE TRIGGER trg_product_variants_updated_at BEFORE UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_protect_reserved_gift_inventory BEFORE UPDATE OF gift_enabled, gift_stock, active ON product_variants FOR EACH ROW EXECUTE FUNCTION protect_reserved_gift_inventory();

CREATE TRIGGER trg_audit_products AFTER INSERT OR DELETE OR UPDATE ON products FOR EACH ROW EXECUTE FUNCTION capture_admin_audit_log('id');

CREATE TRIGGER trg_products_sync_publication_status BEFORE INSERT OR UPDATE ON products FOR EACH ROW EXECUTE FUNCTION sync_product_publication_status();

CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_set_product_slug_on_insert BEFORE INSERT OR UPDATE OF slug ON products FOR EACH ROW EXECUTE FUNCTION set_product_slug_on_insert();

CREATE TRIGGER trg_audit_professional_applications AFTER INSERT OR DELETE OR UPDATE ON professional_applications FOR EACH ROW EXECUTE FUNCTION capture_admin_audit_log('id');

CREATE TRIGGER trg_professional_applications_updated_at BEFORE UPDATE ON professional_applications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_seed_profile_salon_from_application AFTER INSERT ON professional_applications FOR EACH ROW EXECUTE FUNCTION seed_profile_salon_from_application();

CREATE TRIGGER trg_sync_approved_application_invoice_defaults AFTER INSERT OR UPDATE OF status ON professional_applications FOR EACH ROW EXECUTE FUNCTION sync_approved_application_invoice_defaults();

CREATE TRIGGER trg_professional_award_evidence_updated_at BEFORE UPDATE ON professional_award_evidence FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_professional_memberships_updated_at BEFORE UPDATE ON professional_memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_professional_quarterly_notices_updated_at BEFORE UPDATE ON professional_quarterly_notices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_professional_renewal_applications_updated_at BEFORE UPDATE ON professional_renewal_applications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_professional_sales_adjustments_updated_at BEFORE UPDATE ON professional_sales_adjustments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_audit_profiles AFTER INSERT OR DELETE OR UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION capture_admin_audit_log('id');

CREATE TRIGGER trg_end_instructor_student_bindings BEFORE DELETE ON profiles FOR EACH ROW EXECUTE FUNCTION end_instructor_student_bindings_on_member_delete();

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_protect_profile_invoice_default_fields BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION protect_profile_invoice_default_fields();

CREATE TRIGGER trg_protect_profile_salon_fields BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION protect_profile_salon_fields();

CREATE TRIGGER trg_protect_profile_security_fields BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION protect_profile_security_fields();

CREATE TRIGGER trg_audit_promotion_scopes AFTER INSERT OR DELETE OR UPDATE ON promotion_scopes FOR EACH ROW EXECUTE FUNCTION capture_promotion_configuration_audit();

CREATE TRIGGER trg_audit_promotions AFTER INSERT OR DELETE OR UPDATE ON promotions FOR EACH ROW EXECUTE FUNCTION capture_admin_audit_log('id');

CREATE TRIGGER trg_promotions_updated_at BEFORE UPDATE ON promotions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_purchase_orders_updated_at BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_prevent_shopping_credit_ledger_mutation BEFORE DELETE OR UPDATE ON shopping_credit_ledger FOR EACH ROW EXECUTE FUNCTION prevent_shopping_credit_ledger_mutation();

CREATE TRIGGER trg_protect_shopping_credit_reservation_identity BEFORE UPDATE ON shopping_credit_order_reservations FOR EACH ROW EXECUTE FUNCTION protect_shopping_credit_reservation_identity();

DROP TRIGGER IF EXISTS "on_auth_user_created" ON auth."users";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

SELECT setval('public.products_id_seq',GREATEST(coalesce((SELECT max(id) FROM public.products),0)+1,1),false);

DO $$ BEGIN IF (SELECT enabled FROM public.student_pricing_feature_settings WHERE singleton) THEN RAISE EXCEPTION 'Test student pricing must initially remain OFF'; END IF; END $$;

COMMIT;
