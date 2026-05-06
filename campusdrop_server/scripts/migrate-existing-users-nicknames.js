require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { prisma } = require('../lib/prisma');
const { migrateExistingUsersNicknames } = require('../lib/nickname');

async function main() {
  const batchSize = Number(process.env.NICKNAME_MIGRATION_BATCH_SIZE || 100);
  const legacyDefaultsRaw = String(process.env.LEGACY_DEFAULT_NICKNAMES || '').trim();
  const legacyDefaultNicknames = legacyDefaultsRaw
    ? legacyDefaultsRaw.split(',').map((v) => v.trim()).filter(Boolean)
    : [];

  const result = await migrateExistingUsersNicknames({
    prismaClient: prisma,
    batchSize,
    legacyDefaultNicknames,
  });

  console.log('[nickname-migration] done:', result);
}

main()
  .catch((err) => {
    console.error('[nickname-migration] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
