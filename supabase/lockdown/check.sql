-- DRO-980 #55 post-check for migrations 005–007. Read-only, needs no key.
-- Raises one error listing every gap; prints NOTICE 'lockdown check OK' when all four parts are in place.
-- Before the migrations it is expected to fail.
do $$
declare
  t text;
  r text;
  p text;
  gaps text[] := '{}';
begin
  -- part 1: six tables closed to the API roles, still open to the service role
  foreach t in array array['quotes','quote_drafts','pricing_params','knowledge_chunks','chat_history','bot_pause'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      gaps := gaps || (t || ': RLS off');
    end if;
    foreach r in array array['anon','authenticated'] loop
      if has_table_privilege(r, 'public.' || t, 'select,insert,update,delete,truncate') then
        gaps := gaps || (t || ': ' || r || ' still has a table privilege');
      end if;
    end loop;
    -- one privilege per call: a comma list means "any of them"
    foreach p in array array['select','insert','update','delete'] loop
      if not has_table_privilege('service_role', 'public.' || t, p) then
        gaps := gaps || (t || ': service_role lost ' || p);
      end if;
    end loop;
  end loop;
  foreach r in array array['anon','authenticated'] loop
    if has_function_privilege(r, 'public.match_knowledge(vector, integer, double precision)', 'execute') then
      gaps := gaps || ('match_knowledge: ' || r || ' can execute');
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.match_knowledge(vector, integer, double precision)', 'execute') then
    gaps := gaps || 'match_knowledge: service_role cannot execute'::text;
  end if;

  -- part 2: audit trail
  if to_regclass('public.pricing_params_audit') is null then
    gaps := gaps || 'pricing_params_audit missing'::text;
  else
    foreach r in array array['anon','authenticated'] loop
      if has_table_privilege(r, 'public.pricing_params_audit', 'select,insert,update,delete,truncate') then
        gaps := gaps || ('pricing_params_audit: ' || r || ' has a privilege');
      end if;
    end loop;
    if has_table_privilege('service_role', 'public.pricing_params_audit', 'insert,update,delete,truncate') then
      gaps := gaps || 'pricing_params_audit: service_role can write'::text;
    end if;
    if not has_table_privilege('service_role', 'public.pricing_params_audit', 'select') then
      gaps := gaps || 'pricing_params_audit: service_role cannot read'::text;
    end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_sequence_privilege(r, pg_get_serial_sequence('public.pricing_params_audit', 'id'), 'usage,select,update') then
        gaps := gaps || ('pricing_params_audit sequence: ' || r || ' has a privilege');
      end if;
      if has_function_privilege(r, 'public.pricing_params_audit_log()', 'execute') then
        gaps := gaps || ('pricing_params_audit_log: ' || r || ' can execute');
      end if;
    end loop;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'pricing_params' and column_name = 'updated_at' and is_nullable = 'NO') then
    gaps := gaps || 'pricing_params.updated_at missing or nullable'::text;
  end if;
  -- each trigger must exist, be enabled and call its own function
  foreach p in array array['pricing_params_audit','pricing_params_touch_updated_at'] loop
    if not exists (select 1 from pg_trigger
                   where tgrelid = 'public.pricing_params'::regclass and tgname = p and not tgisinternal
                     and tgenabled <> 'D'
                     and tgfoid = to_regprocedure('public.' || case p when 'pricing_params_audit' then 'pricing_params_audit_log' else p end || '()')) then
      gaps := gaps || ('trigger ' || p || ' missing, disabled or calling the wrong function');
    end if;
  end loop;

  -- parts 3 and 4: storage policies gone
  foreach p in array array['Public read access for quote PDFs','cleaning photos: anon insert','cleaning photos: anon update','cleaning photos: anon delete'] loop
    if exists (select 1 from pg_policy where polrelid = 'storage.objects'::regclass and polname = p) then
      gaps := gaps || ('storage policy still present: ' || p);
    end if;
  end loop;
  if not (select public from storage.buckets where id = 'quote-pdfs') then
    gaps := gaps || 'quote-pdfs is no longer public: customer links would break'::text;
  end if;

  if cardinality(gaps) > 0 then
    raise exception 'lockdown check failed: %', array_to_string(gaps, '; ');
  end if;
  raise notice 'lockdown check OK';
end $$;
