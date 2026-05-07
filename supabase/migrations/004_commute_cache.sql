-- Migration: Commute cache for Google Distance Matrix results
-- Cache key: rounded (lat, lng) at 4 decimal precision (~10m). 24h TTL.

create table public.commute_cache (
  id              uuid primary key default gen_random_uuid(),
  destination_lat numeric not null,
  destination_lng numeric not null,
  one_way_hours   numeric not null,
  google_response jsonb not null,
  created_at      timestamptz default now(),
  expires_at      timestamptz default (now() + interval '24 hours')
);

create index idx_commute_cache_destination on public.commute_cache (
  round(destination_lat, 4),
  round(destination_lng, 4)
);
create index idx_commute_cache_expires on public.commute_cache (expires_at);
