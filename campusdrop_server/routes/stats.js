const express = require('express');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../lib/prisma');

const router = express.Router();

/**
 * @openapi
 * /api/stats/excitement-count:
 *   get:
 *     tags: [Stats]
 *     summary: 랜딩용 — 설문 데이터가 있는 계정 수(대략적 활성 지표)
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ExcitementCountResponse'
 *       500:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.get('/excitement-count', async (req, res) => {
  try {
    const rows = await prisma.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::int AS c
      FROM traits
      WHERE survey_data IS NOT NULL
    `);
    const excitementCount = Array.isArray(rows) && rows[0] ? Number(rows[0].c) : 0;
    return res.status(200).json({
      excitementCount,
      description: '설문을 한 번이라도 저장한 사용자 수(Trait.survey_data IS NOT NULL)',
    });
  } catch (err) {
    console.error('stats excitement-count:', err);
    return res.status(500).json({ error: '통계 조회 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
