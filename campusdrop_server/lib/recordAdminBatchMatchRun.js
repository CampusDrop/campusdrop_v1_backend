const { prisma } = require('./prisma');

/**
 * 배치 매칭 실행 1회당 1행(성공·스킵·에러). 관리자 대시보드 KPI·이력용.
 * @param {{
 *   matchType: string,
 *   periodStart: Date,
 *   startedAt: Date,
 *   finishedAt: Date,
 *   status: 'success' | 'skipped' | 'error',
 *   pairCount?: number,
 *   eligibleCount?: number,
 *   batchTraitsCount?: number,
 *   skipReason?: string | null,
 *   errorMessage?: string | null,
 *   actorType: string,
 *   actorId?: string | null,
 *   metadata?: import('@prisma/client').Prisma.InputJsonValue,
 * }} p
 */
async function recordAdminBatchMatchRun(p) {
  try {
    await prisma.adminBatchMatchRun.create({
      data: {
        matchType: p.matchType,
        periodStart: p.periodStart,
        startedAt: p.startedAt,
        finishedAt: p.finishedAt,
        status: p.status,
        pairCount: p.pairCount ?? 0,
        eligibleCount: p.eligibleCount ?? 0,
        batchTraitsCount: p.batchTraitsCount ?? 0,
        skipReason: p.skipReason ?? null,
        errorMessage: p.errorMessage ?? null,
        actorType: p.actorType,
        actorId: p.actorId ?? null,
        metadata: p.metadata ?? undefined,
      },
    });
  } catch (err) {
    console.error('[recordAdminBatchMatchRun]', err);
  }
}

module.exports = { recordAdminBatchMatchRun };
