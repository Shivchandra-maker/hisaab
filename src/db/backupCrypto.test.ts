import 'fake-indexeddb/auto';
import { isSealed, openBackup, sealBackup } from './backupCrypto';
import { db, exportBackup, importBackup, resetAll, saveAccount, setMeta } from './repo';

describe('H-21: passphrase-protected backups', () => {
  it('encrypts so the file shows nothing, and opens only with the passphrase', async () => {
    const json = JSON.stringify({ app: 'hisaab', version: 1, data: { note: 'Swiggy ₹420 HDFC' } });
    const sealed = await sealBackup(json, 'correct horse');
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain('Swiggy');
    expect(await openBackup(sealed, 'correct horse')).toBe(json);
    await expect(openBackup(sealed, 'wrong')).rejects.toThrow(/Wrong passphrase/);
    expect(isSealed(json)).toBe(false);
  });

  it('H-20: a restore on a new phone brings everything back and reads its SMS again', async () => {
    await resetAll();
    await saveAccount({
      name: 'HDFC',
      kind: 'bank',
      openingBalance: 500_00,
      openingDate: '2026-09-01',
      archived: false,
      sortOrder: 0,
    });
    await setMeta('nativeFilterRead2', 3);
    const text = await sealBackup(JSON.stringify(await exportBackup()), 'pass');
    await resetAll();
    const r = await importBackup(await openBackup(text, 'pass'));
    expect(r.accounts).toBe(1);
    expect((await db.meta.get('onboarded'))?.value).toBe(true);
    expect(await db.meta.get('nativeFilterRead2')).toBeUndefined();
  });
});
