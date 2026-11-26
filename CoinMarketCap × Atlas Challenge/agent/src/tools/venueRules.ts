import { MIN_COOLDOWN_SEC, MIN_DEPOSIT_BASE_UNIT } from '../../../lib/risk-rules';

// Venue floors read from the shared rule model, with a safe agent-side fallback for a venue the shared table does not
// list yet (so a missing entry can never become BigInt(undefined) or a zero cooldown).

/** Aster: the order minimum is $5; a deposit below $6 leaves no headroom for the stable swap. */
const FALLBACK_MIN_DEPOSIT: Record<string, string> = { aster: '6000000', derive: '7000000' };

export const minDepositBase = (venue: string): bigint =>
  BigInt((MIN_DEPOSIT_BASE_UNIT as Record<string, string | undefined>)[venue] ?? FALLBACK_MIN_DEPOSIT[venue] ?? '7000000');
export const minCooldownSec = (venue: string): number => (MIN_COOLDOWN_SEC as Record<string, number | undefined>)[venue] ?? 300;
/** Venues the agent moves margin for. A rule saved for any other venue is reported, never run. */
export const ACTIVE_RULE_VENUES = new Set(['aster', 'derive']);
