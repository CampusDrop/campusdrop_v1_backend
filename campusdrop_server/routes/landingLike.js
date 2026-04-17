const express = require('express');
const { prisma } = require('../lib/prisma');

const router = express.Router();

const DEFAULT_KEY = 'default';

async function ensureDefaultCounter(db) {
  await db.landingLikeCounter.upsert({
    where: { key: DEFAULT_KEY },
    create: { key: DEFAULT_KEY, likeCount: 0 },
    update: {},
  });
}

/**
 * @openapi
 * /api/landing-like:
 *   get:
 *     tags: [Landing]
 *     summary: 랜딩 좋아요 합계 조회
 *     responses:
 *       200:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LandingLikeGetResponse'
 *       500:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *   post:
 *     tags: [Landing]
 *     summary: 랜딩 좋아요 +1 (더블탭 등)
 *     description: |
 *       전역 합계를 1 올립니다. 기기·브라우저 식별 없음 — 새로고침 후에도 동일하게 호출하면 또 증가합니다.
 *     responses:
 *       200:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LandingLikeIncrementResponse'
 *       500:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.get('/', async (req, res) => {
  try {
    await ensureDefaultCounter(prisma);

    const counter = await prisma.landingLikeCounter.findUnique({
      where: { key: DEFAULT_KEY },
    });
    const likeCount = counter ? counter.likeCount : 0;

    return res.status(200).json({ likeCount });
  } catch (err) {
    console.error('landing-like GET:', err);
    return res.status(500).json({ error: '좋아요 조회 중 오류가 발생했습니다.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const row = await prisma.$transaction(async (tx) => {
      await ensureDefaultCounter(tx);
      return tx.landingLikeCounter.update({
        where: { key: DEFAULT_KEY },
        data: { likeCount: { increment: 1 } },
      });
    });

    return res.status(200).json({ likeCount: row.likeCount });
  } catch (err) {
    console.error('landing-like POST:', err);
    return res.status(500).json({ error: '좋아요 반영 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
