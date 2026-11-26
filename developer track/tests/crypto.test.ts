import { describe, expect, it, beforeAll } from 'vitest';

beforeAll(() => { process.env.KEYSTORE_SECRET = 'test-secret-test-secret-test-secret-0123'; });

describe('keystore encryption', () => {
  it('round-trips and binds AAD', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/server/crypto');
    const blob = encryptSecret('0xdeadbeef', 'lighter|mainnet|0xabc');
    expect(blob).not.toContain('deadbeef');
    expect(decryptSecret(blob, 'lighter|mainnet|0xabc')).toBe('0xdeadbeef');
    expect(() => decryptSecret(blob, 'lighter|mainnet|0xother')).toThrow(); // can't move a key to another wallet
  });
});
