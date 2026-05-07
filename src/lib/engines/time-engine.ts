// src/lib/engines/time-engine.ts
import type { TimeResult } from "@/lib/types"

export interface TimeEngineInput {
  total_area: number    // m²
  daily_area: number    // m²/day from productivity-engine
}

export function estimateTime(input: TimeEngineInput): TimeResult {
  const safeDaily = Math.max(input.daily_area, 1)   // guard div-by-zero
  const exact = input.total_area / safeDaily
  const days = Math.max(1, Math.ceil(exact))
  return {
    pure_operation_days: exact,
    suggested_days: days,
    total_area: input.total_area,
    daily_area: input.daily_area,
    time_model_version: "v2.0",
  }
}
