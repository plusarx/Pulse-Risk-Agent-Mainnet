import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// Loads the vendored lighter-go v1.0.13 WASM signer offline (no network) and checks the
// functions we call exist with the argument orders lib/server/lighter.ts relies on.
describe('lighter wasm signer', () => {
  it('generates a key and signs ChangePubKey + CreateOrder offline', async () => {
    const dir = path.join(process.cwd(), 'vendor', 'lighter');
    createRequire(import.meta.url)(path.join(dir, 'wasm_exec.js'));
    const G = globalThis as unknown as Record<string, (...a: unknown[]) => Record<string, string | number | undefined>> & { Go: new () => { importObject: WebAssembly.Imports; run(i: WebAssembly.Instance): Promise<void> } };
    const go = new G.Go();
    const inst = await WebAssembly.instantiate(await WebAssembly.compile(new Uint8Array(await readFile(path.join(dir, 'lighter-signer.wasm')))), go.importObject);
    void go.run(inst);
    const k = G.GenerateAPIKey();
    expect(String(k.publicKey)).toMatch(/^0x[0-9a-f]{80}$/);
    expect(G.CreateClient('', k.privateKey, 304, 4, 12345).error).toBeUndefined();
    const cpk = G.SignChangePubKey(k.publicKey, 0, 1, 4, 12345);
    expect(cpk.error).toBeUndefined();
    expect(String(cpk.messageToSign)).toContain('Register Lighter Account');
    // market id 4095 (> 254) must be accepted by v1.0.13
    const o = G.SignCreateOrder(4095, 1, 1000, 1000000, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 5, 4, 12345);
    expect(o.error).toBeUndefined();
    expect(o.txType).toBe(14);
    expect(JSON.parse(String(o.txInfo)).MarketIndex).toBe(4095);
    // Sub-account creation and same-owner transfer, with the argument orders lib/server/lighter.ts uses.
    const sub = G.SignCreateSubAccount(0, 6, 4, 12345);
    expect(sub.error).toBeUndefined(); expect(sub.txType).toBe(9);
    const tr = G.SignTransfer(12346, 3, 0, 0, 5_000_000, 0, `0x${'00'.repeat(32)}`, 0, 7, 4, 12345);
    expect(tr.error).toBeUndefined(); expect(tr.txType).toBe(12);
    expect(JSON.parse(String(tr.txInfo)).ToAccountIndex).toBe(12346);
    // Secure withdraw, argument order used by withdrawLighter: (asset 3 = USDC, route 0 = perps, amount 1e6, skipNonce, nonce, key, acct).
    const w = G.SignWithdraw(3, 0, 12_500_000, 0, 8, 4, 12345);
    expect(w.error).toBeUndefined(); expect(w.txType).toBe(13);
    expect(w.messageToSign).toBeUndefined(); // no L1 signature: the agent key alone authorises it
    const wi = JSON.parse(String(w.txInfo)) as Record<string, unknown>;
    expect(wi.FromAccountIndex).toBe(12345); expect(wi.AssetIndex).toBe(3); expect(wi.RouteType).toBe(0); expect(wi.Amount).toBe(12_500_000);
    // No destination field at all (fields: FromAccountIndex, ApiKeyIndex, AssetIndex, RouteType, Amount, ExpiredAt, Nonce, …):
    // Lighter can only pay the account's own L1 owner.
    expect(Object.keys(wi).filter((k) => /^To|recipient|address/i.test(k))).toEqual([]);
  }, 30_000);
});
