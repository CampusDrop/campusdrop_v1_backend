const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;

/**
 * DB에만 저장할 이메일 단방향 해시(bcrypt). 원문 이메일은 호출부에서 즉시 폐기합니다.
 * @param {string} normalizedEmail
 */
async function hashEmailForStorage(normalizedEmail) {
  return bcrypt.hash(normalizedEmail, BCRYPT_ROUNDS);
}

/**
 * 저장된 `emailHash`들과 `bcrypt.compare`로 일치하는 Identity id를 찾습니다.
 * 규모가 커지면 HMAC 기반 blind index 컬럼을 추가해 O(1) 조회로 바꾸는 것을 권장합니다.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} normalizedEmail
 * @returns {Promise<string | null>} identity id (uuid)
 */
async function findIdentityIdByNormalizedEmail(prisma, normalizedEmail) {
  const rows = await prisma.identity.findMany({
    select: { id: true, emailHash: true },
  });
  for (const row of rows) {
    const ok = await bcrypt.compare(normalizedEmail, row.emailHash);
    if (ok) return row.id;
  }
  return null;
}

module.exports = {
  hashEmailForStorage,
  findIdentityIdByNormalizedEmail,
};
