require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { prisma } = require('../lib/prisma');
const { addSpaceToExistingNicknames } = require('../lib/nickname');

async function main() {
  const batchSize = Number(process.env.NICKNAME_MIGRATION_BATCH_SIZE || 100);

  const result = await addSpaceToExistingNicknames({
    prismaClient: prisma,
    batchSize,
  });

  console.log('[nickname-add-space] done:', result);
}

main()
  .catch((err) => {
    console.error('[nickname-add-space] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
