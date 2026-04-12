const { prisma } = require('./prisma');

/**
 * 감사 로그 기록. 실패해도 본 요청은 진행(로깅만 베스트 에포트).
 * @param {{ actorType: string, actorId?: string | null, action: string, resource?: string | null, ip?: string | null, userAgent?: string | null, metadata?: object | null }} data
 */
async function writeAccessLog(data) {
  try {
    await prisma.accessLog.create({ data });
  } catch (err) {
    console.error('writeAccessLog failed:', err);
  }
}

module.exports = { writeAccessLog };
