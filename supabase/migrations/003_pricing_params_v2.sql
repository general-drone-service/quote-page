-- Migration: Pricing params v2.0 — day-rate productivity model
-- Demote v1.0 and seed v2.0 with the new schema. Old v1.0 row is
-- preserved (is_active = false) for rollback.

update public.pricing_params set is_active = false where is_active = true;

insert into public.pricing_params (version, params, notes, is_active, created_by)
values (
  'v2.0',
  '{
    "daily_rate": 40000,
    "daily_base_area": 1500,
    "building_type_coeff": {"commercial":1.0,"luxury":1.0,"house":0.85,"factory":1.1,"solar":1.3},
    "height_coeff": [
      {"max_floor":10,"coeff":1.00},
      {"max_floor":20,"coeff":0.95},
      {"max_floor":30,"coeff":0.85},
      {"max_floor":9999,"coeff":0.70}
    ],
    "complexity_coeff": {"light":0.98,"medium":0.9,"heavy":0.7},
    "contamination_coeff": {"dust":1.0,"scale":0.85,"mold":0.9,"bird":0.83,"exhaust":0.82,"grease":0.8},
    "cleaning_agent_coeff": {"soft":1.0,"standard":0.95,"deep":0.85},
    "facade_modifiers": {
      "has_recesses":0.85,"is_high_risk":0.75,"adjacent_trees":0.9,
      "water_self_supply":0.85,"power_self_supply":0.9,
      "rooftop_limited":0.8,"rooftop_unavailable":0.6
    },
    "site_modifiers": {
      "region_exposure": {"windward":0.85,"leeward":1.0,"coastal":0.9,"rooftop_open":0.95},
      "crowd_density":   {"low":1.0,"medium":0.95,"high":0.85},
      "near_base_station":0.95,
      "wind_channel_effect":0.85
    },
    "commute_origin": {"lat":25.0495732,"lng":121.5576803,"address":"台北市松山區光復北路11巷46號"},
    "commute": {"fee_per_hour":2000,"daily_fuel_fee":1000,"lodging_per_day":6000,"lodging_threshold_hours":1.5},
    "floor_multiplier": [
      {"max_floor":10,"multiplier":1.00},
      {"max_floor":20,"multiplier":1.05},
      {"max_floor":30,"multiplier":1.12},
      {"max_floor":9999,"multiplier":1.25}
    ],
    "time_window_multiplier": {"day":1.0,"weekend":1.2,"night":1.5},
    "urgent_multiplier": 1.33,
    "min_order": 30000,
    "quote_max_multiplier": 2.5,
    "final_discount": 0.9,
    "version": "v2.0"
  }'::jsonb,
  'Day-rate productivity model + commute/lodging (redesign 2026-05)',
  true,
  'redesign-2026-05'
);
