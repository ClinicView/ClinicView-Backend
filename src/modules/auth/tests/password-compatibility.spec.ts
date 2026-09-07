import * as bcrypt from 'bcrypt';

describe('bcrypt dependency compatibility', () => {
  // Generated with bcrypt 5.1.1 from a synthetic, non-account password.
  const legacyHash = '$2b$04$1lZo6gpkN4zzmSbhtHw5cu3B5.twdj18z7oWibyyl.qyEAQ8t9BVK';

  it('verifies existing hashes without requiring password resets', async () => {
    await expect(
      bcrypt.compare('ClinicView-synthetic-compatibility-only', legacyHash),
    ).resolves.toBe(true);
    await expect(bcrypt.compare('incorrect-password', legacyHash)).resolves.toBe(false);
  });

  it('hashes and verifies new passwords with the existing API', async () => {
    const password = 'Synthetic-password-with-acentos-áé-2026';
    const hash = await bcrypt.hash(password, 4);
    await expect(bcrypt.compare(password, hash)).resolves.toBe(true);
    expect(bcrypt.getRounds(hash)).toBe(4);
  });
});
