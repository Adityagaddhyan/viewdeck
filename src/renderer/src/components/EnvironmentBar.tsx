import { ENV_COLORS, type EnvironmentTier } from '@shared/environment'

/** 3px accent bar across the top of the window, coloured by environment tier (ADR-003). */
export function EnvironmentBar({ tier }: { tier: EnvironmentTier }) {
  return (
    <div
      aria-label={`Environment: ${tier}`}
      className="h-[3px] w-full shrink-0"
      style={{ backgroundColor: ENV_COLORS[tier] }}
    />
  )
}
