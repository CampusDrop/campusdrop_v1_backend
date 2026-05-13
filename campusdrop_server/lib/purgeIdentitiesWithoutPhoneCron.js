const cron = require('node-cron');
const { prisma } = require('./prisma');

const DELETE_CHUNK = 500;

/**
 * `phone_encrypted`가 없는 계정과 연관된 비-FK 테이블 행을 정리한 뒤 `Identity`를 삭제합니다.
 * (대부분의 관계는 Prisma `onDelete: Cascade`로 함께 제거됩니다.)
 * @returns {Promise<{ candidateCount: number; deletedCount: number }>}
 */
async function runPurgeIdentitiesWithoutPhoneJob() {
  const victims = await prisma.identity.findMany({
    where: {
      OR: [{ phoneEncrypted: null }, { phoneEncrypted: '' }],
    },
    select: { id: true },
  });
  const ids = victims.map((v) => v.id);
  if (ids.length === 0) {
    console.log('[purgeIdentitiesWithoutPhoneCron] 전화번호 없음 계정 없음 — 건너뜀');
    return { candidateCount: 0, deletedCount: 0 };
  }

  let deletedCount = 0;
  for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
    const slice = ids.slice(i, i + DELETE_CHUNK);
    const res = await prisma.$transaction(async (tx) => {
      await tx.friendTalkRsvpLink.deleteMany({ where: { identityId: { in: slice } } });
      await tx.analyticsSessionUserLink.deleteMany({ where: { userUuid: { in: slice } } });
      return tx.identity.deleteMany({ where: { id: { in: slice } } });
    });
    deletedCount += res.count;
  }

  console.log(
    `[purgeIdentitiesWithoutPhoneCron] 전화번호 없는 계정 삭제 완료: ${deletedCount}건 (후보 ${ids.length}명)`,
  );
  return { candidateCount: ids.length, deletedCount };
}

/** 매일 00:00 KST — `IDENTITY_WITHOUT_PHONE_PURGE_CRON_DISABLED` 로 끌 수 있음 */
function schedulePurgeIdentitiesWithoutPhoneCron() {
  const off = String(process.env.IDENTITY_WITHOUT_PHONE_PURGE_CRON_DISABLED || '')
    .trim()
    .toLowerCase();
  if (off === '1' || off === 'true' || off === 'yes') {
    console.log(
      '[purgeIdentitiesWithoutPhoneCron] IDENTITY_WITHOUT_PHONE_PURGE_CRON_DISABLED 로 등록 생략',
    );
    return;
  }

  cron.schedule(
    '0 0 * * *',
    () => {
      runPurgeIdentitiesWithoutPhoneJob().catch((err) =>
        console.error('[purgeIdentitiesWithoutPhoneCron] job error', err),
      );
    },
    { timezone: 'Asia/Seoul' },
  );
  console.log(
    '[purgeIdentitiesWithoutPhoneCron] 등록됨: 매일 00:00 Asia/Seoul — phone_encrypted 없는 Identity 삭제',
  );
}

module.exports = {
  schedulePurgeIdentitiesWithoutPhoneCron,
  runPurgeIdentitiesWithoutPhoneJob,
};
