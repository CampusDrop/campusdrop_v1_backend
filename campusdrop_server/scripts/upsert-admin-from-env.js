/**
 * DB `admins.password_hash`를 bcrypt로 다시 씁니다.
 * Prisma Studio 등으로 평문이 들어간 경우 `npm run admin:upsert`로 복구하세요.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), override: true });

const { PrismaClient } = require('@prisma/client');
const { normalizeEmail, isSjuAcKrEmail } = require('../lib/sjuEmail');
const { hashAdminPassword } = require('../lib/adminDbAuth');

async function main() {
  const rawEmail = String(process.env.ADMIN_EMAIL || '').trim();
  const password = String(process.env.ADMIN_PASSWORD || '').trim();
  if (!rawEmail || !password) {
    console.error('ADMIN_EMAIL 과 ADMIN_PASSWORD 가 .env 에 필요합니다.');
    process.exit(1);
  }
  const email = normalizeEmail(rawEmail);
  if (!isSjuAcKrEmail(email)) {
    console.error('ADMIN_EMAIL 은 @sju.ac.kr 형식이어야 합니다.');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const passwordHash = await hashAdminPassword(password);
    await prisma.admin.upsert({
      where: { email },
      create: { email, passwordHash },
      update: { passwordHash },
    });
    console.log('OK: admins 행이 bcrypt password_hash 로 upsert 되었습니다:', email);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
