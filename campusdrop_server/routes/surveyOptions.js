const express = require('express');
const { buildSurveyAvailabilityWindow } = require('../lib/surveyAvailabilityWindow');

const router = express.Router();

/**
 * @openapi
 * /api/survey/availability-window:
 *   get:
 *     tags: [Survey]
 *     summary: 설문 가능 시간 선택용 신청 기간과 다음 주 날짜 목록 조회
 *     responses:
 *       200:
 *         description: 화 00:00~일 18:00 신청 가능 여부와 다음 주 화~일 날짜 목록
 */
router.get('/availability-window', (_req, res) => {
  res.status(200).json(buildSurveyAvailabilityWindow());
});

module.exports = router;
