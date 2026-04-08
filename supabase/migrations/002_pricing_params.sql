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
    "base_price": {"commercial": 13, "luxury": 14, "house": 200, "factory": 22, "solar": 9.5},
    "complexity_surcharge": {"light": -1, "medium": 5, "heavy": 8},
    "contamination_surcharge": {"dust": 0, "scale": 3.5, "bird": 1.5, "mold": 1.5, "exhaust": 2, "grease": 5},
    "contamination_cap": 8,
    "cleaning_agent_surcharge": {"soft": -1, "standard": 1, "deep": 2.5},
    "facade_surcharges": {"road_closure": 2, "tight_perimeter": 3, "high_risk_env": 3.5, "adjacent_trees": 2.5, "tree_extra": 5},
    "supply_surcharges": {"water_self": 3.5, "power_self": 3.5, "rooftop_not_good": 6},
    "floor_multiplier": [{"max_floor": 10, "multiplier": 1.0}, {"max_floor": 20, "multiplier": 1.05}, {"max_floor": 30, "multiplier": 1.12}, {"max_floor": 9999, "multiplier": 1.25}],
    "time_window_multiplier": {"day": 1.0, "weekend": 1.2, "night": 1.5},
    "urgent_multiplier": 1.33,
    "min_order": 30000,
    "quote_max_multiplier": 2.5,
    "final_discount": 0.9,
    "version": "v1.0"
  }'::jsonb,
  'Initial pricing parameters (migrated from code defaults)',
  true,
  'system'
);
