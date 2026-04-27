const express = require('express');
const { departmentPayload } = require('../lib/departments');

const router = express.Router();

/**
 * @openapi
 * /api/departments:
 *   get:
 *     tags: [Survey]
 *     summary: 프로필 학과 선택지 조회
 *     responses:
 *       200:
 *         description: 단과대별 학과 목록
 */
router.get('/', (_req, res) => {
  res.status(200).json(departmentPayload());
});

module.exports = router;
