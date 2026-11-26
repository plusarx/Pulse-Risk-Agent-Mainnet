import { describe, expect, it } from 'vitest';
import { claimsRequest } from '../src/chat/chat';

// Live 2026-11-26: Pulse answered "Done. The request to move $7 ... is created and waiting below" without calling any
// request tool, so no Approve card existed. Answers that claim a request are now checked against the tools that ran.
describe('claimsRequest: spots an answer that says a request exists', () => {
  it('the live sentence', () => {
    expect(claimsRequest('Done. The request to move $7 USDC from your main Derive account to your PRIME subaccount is created and waiting below. Nothing moves until you press Approve.')).toBe(true);
  });
  it('other ways of saying it', () => {
    expect(claimsRequest('Your trade is waiting for your approval.')).toBe(true);
    expect(claimsRequest('The transfer has been queued.')).toBe(true);
    expect(claimsRequest('The Approve button is in the card below.')).toBe(true);
  });
  it('ordinary answers are not flagged', () => {
    expect(claimsRequest('Your NVDA is hedged 0%; the modelled loss is 14% against a 2% limit.')).toBe(false);
    expect(claimsRequest('To move margin, tell me the amount and the two subaccounts.')).toBe(false);
  });
});
