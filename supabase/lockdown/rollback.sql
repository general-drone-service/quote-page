-- DRO-980 #55 rollback: restores exactly what the catalog showed on 2026-10-19.
-- Run only the section for the part that broke something. Parts are independent.

-- part 1 (005): reopen the six tables and match_knowledge to the API roles
begin;
grant all on table
  public.quotes, public.quote_drafts, public.pricing_params,
  public.knowledge_chunks, public.chat_history, public.bot_pause
to anon, authenticated;
alter table public.quotes           disable row level security;
alter table public.quote_drafts     disable row level security;
alter table public.pricing_params   disable row level security;
alter table public.knowledge_chunks disable row level security;
alter table public.chat_history     disable row level security;
alter table public.bot_pause        disable row level security;
grant execute on function public.match_knowledge(vector, integer, double precision) to public, anon, authenticated;
commit;

-- part 2 (006): remove the audit trail (the log rows are lost; export them first if they matter)
begin;
drop trigger if exists pricing_params_audit on public.pricing_params;
drop trigger if exists pricing_params_touch_updated_at on public.pricing_params;
drop function if exists public.pricing_params_audit_log();
drop function if exists public.pricing_params_touch_updated_at();
drop table if exists public.pricing_params_audit;
alter table public.pricing_params drop column if exists updated_at;
commit;

-- parts 3 and 4 (007): recreate the storage policies (same names, roles PUBLIC, same expressions).
-- Needs the same privilege as 007; otherwise recreate them in Dashboard → Storage → Policies.
begin;
create policy "Public read access for quote PDFs" on storage.objects for select using (bucket_id = 'quote-pdfs');
create policy "cleaning photos: anon insert" on storage.objects for insert with check (bucket_id = 'cleaning-photos');
create policy "cleaning photos: anon update" on storage.objects for update using (bucket_id = 'cleaning-photos');
create policy "cleaning photos: anon delete" on storage.objects for delete using (bucket_id = 'cleaning-photos');
commit;
