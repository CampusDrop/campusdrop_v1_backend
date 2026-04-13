const bcrypt = require('bcryptjs');
const { normalizeEmail, isSjuAcKrEmail } = require('./sjuEmail');

const BCRYPT_ROUNDS = 12;

/**
 * @param {string} plainPassword
 */
async function hashAdminPassword(plainPassword) {
  return bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} emailRaw
 * @param {string} passwordPlain
 * @returns {Promise<{ ok: true, admin: { id: string, email: string } } | { ok: false, reason: 'invalid_email' | 'mismatch' | 'db_error' }>}
 */
async function verifyAdminDbCredentials(prisma, emailRaw, passwordPlain) {
  if (typeof emailRaw !== 'string' || typeof passwordPlain !== 'string') {
    return { ok: false, reason: 'mismatch' };
  }
  const email = normalizeEmail(emailRaw);
  if (!email || !isSjuAcKrEmail(email)) {
    return { ok: false, reason: 'invalid_email' };
  }

  try {
    const admin = await prisma.admin.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });
    if (!admin) {
      return { ok: false, reason: 'mismatch' };
    }
    const match = await bcrypt.compare(passwordPlain, admin.passwordHash);
    if (!match) {
      return { ok: false, reason: 'mismatch' };
    }
    return { ok: true, admin: { id: admin.id, email: admin.email } };
  } catch (err) {
    console.error('verifyAdminDbCredentials:', err);
    return { ok: false, reason: 'db_error' };
  }
}

module.exports = {
  hashAdminPassword,
  verifyAdminDbCredentials,
};
