-- Migration: Pricing parameters version management
-- Each row is an immutable version snapshot. The latest active version is used.

create table public.pricing_params (
  id          uuid primary key default gen_random_uuid(),
  version     text unique not null,           -- e.g. "v1.0", "v1.1", "v2.0"
  params      jsonb not null,                 -- full PricingParams JSON
  notes       text,                           -- changelog / reason for update
  is_active   boolean not null default false,  -- only one row should be active
  created_by  text,                           -- who created this version
  created_at  timestamptz default now()
);

create index idx_pricing_params_active on public.pricing_params(is_active) where is_active = true;
create index idx_pricing_params_version on public.pricing_params(version);

-- Seed with v1.0 defaults
insert into public.pricing_params (version, params, notes, is_active, created_by)
values (
  'v1.0',
  '{
    "base_price": {"commercial": 28, "luxury": 31, "house": 200, "factory": 26, "solar": 9.5},
    "complexity_surcharge": {"light": 4, "medium": 6, "heavy": 8},
    "contamination_surcharge": {"dust": 0, "scale": 7, "bird": 4, "mold": 5, "exhaust": 6, "grease": 12},
    "contamination_cap": 15,
    "cleaning_agent_surcharge": {"soft": -1, "standard": 1, "deep": 3},
    "facade_surcharges": {"road_closure": 4, "tight_perimeter": 6, "high_risk_env": 7, "adjacent_trees": 5, "tree_extra": 10},
    "supply_surcharges": {"water_self": 7, "power_self": 7, "rooftop_not_good": 12},
    "floor_multiplier": [{"max_floor": 10, "multiplier": 1.0}, {"max_floor": 20, "multiplier": 1.1}, {"max_floor": 30, "multiplier": 1.3}, {"max_floor": 9999, "multiplier": 1.5}],
    "time_window_multiplier": {"day": 1.0, "weekend": 1.2, "night": 1.5},
    "urgent_multiplier": 1.33,
    "min_order": 15000,
    "quote_max_multiplier": 2.5,
    "version": "v1.0"
  }'::jsonb,
  'Initial pricing parameters (migrated from code defaults)',
  true,
  'system'
);
