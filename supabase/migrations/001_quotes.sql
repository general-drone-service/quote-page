-- Migration: Quote Standalone — quotes and drafts tables
-- Independent Supabase project for quote.drone168.com

create table public.quotes (
  id            uuid primary key default gen_random_uuid(),
  quote_code    text unique not null,
  form_data     jsonb not null,
  area_estimate jsonb not null,
  airspace      jsonb,
  building_name text,
  pricing       jsonb not null,
  time_result   jsonb not null,
  line_user_id  text,
  pdf_url       text,
  pdf_sent_at   timestamptz,
  created_at    timestamptz default now(),
  expires_at    timestamptz not null
);

create index idx_quotes_quote_code on public.quotes(quote_code);
create index idx_quotes_line_user_id on public.quotes(line_user_id);

-- Quote drafts (wizard session state)
create table public.quote_drafts (
  id                  uuid primary key default gen_random_uuid(),
  session_id          text unique not null,
  step                integer not null default 0,
  form_data           jsonb,
  area_estimate       jsonb,
  building_polygon    jsonb,
  building_name       text,
  map_screenshot_url  text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index idx_quote_drafts_session on public.quote_drafts(session_id);

-- Storage bucket for quote PDFs (public read)
insert into storage.buckets (id, name, public)
values ('quote-pdfs', 'quote-pdfs', true)
on conflict (id) do nothing;

create policy "Public read access for quote PDFs"
on storage.objects for select
using (bucket_id = 'quote-pdfs');
