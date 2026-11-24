/**
 * Environment classification from AWS profile / account naming heuristics.
 *
 * Drives the 3px accent bar and the default read-only state (ADR-003):
 * prod → locked by default, dev/local → unlocked. Anything unknown is treated
 * conservatively: locked, like prod, but shown with a neutral colour.
 */
export type EnvironmentTier = 'prod' | 'staging' | 'dev' | 'unknown'

const RULES: ReadonlyArray<[EnvironmentTier, RegExp]> = [
  // Order matters: "preprod" must classify as staging, not prod.
  ['staging', /(^|[^a-z])(stag(e|ing)?|preprod|uat|qa)([^a-z]|$)/i],
  ['prod', /(^|[^a-z])(prod|production|prd|live)([^a-z]|$)/i],
  ['dev', /(^|[^a-z])(dev|develop|development|local|sandbox|test)([^a-z]|$)/i]
]

const CAUTION: Record<EnvironmentTier, number> = { prod: 3, staging: 2, unknown: 1, dev: 0 }

function classifyOne(hint: string): EnvironmentTier {
  for (const [tier, re] of RULES) if (re.test(hint)) return tier
  return 'unknown'
}

/**
 * Classifies a set of name hints (profile name, account alias, DB identifier).
 * Each hint is classified on its own, and the most cautious result wins, so a
 * "dev" profile pointed at a "prod-db" still frames as prod.
 */
export function classifyEnvironment(...hints: Array<string | undefined | null>): EnvironmentTier {
  const tiers = hints.filter((h): h is string => !!h).map(classifyOne)
  const named = tiers.filter((t) => t !== 'unknown')
  if (named.length === 0) return 'unknown'
  return named.reduce((a, b) => (CAUTION[b] > CAUTION[a] ? b : a))
}

/** Read-only is the default everywhere except clearly non-production tiers. */
export function defaultReadOnly(tier: EnvironmentTier): boolean {
  return tier !== 'dev'
}

/**
 * Default server-side statement timeout per tier: a runaway query on prod is
 * cut off, while dev is unrestricted. Unknown is treated like prod.
 */
export function defaultStatementTimeoutMs(tier: EnvironmentTier): number {
  return tier === 'dev' ? 0 : tier === 'staging' ? 60_000 : 30_000
}

export const ENV_COLORS: Record<EnvironmentTier, string> = {
  prod: '#EF4444',
  staging: '#F59E0B',
  dev: '#10B981',
  unknown: '#52525B'
}
