const express = require('express');
const { resolveFestivalUserFromReq } = require('../lib/requireFestivalUser');

const router = express.Router();

/** GET /api/users/me — 축제 전용 세션(쿠키 또는 헤더) 검증용 */
router.get('/me', async (req, res) => {
  try {
    const u = await resolveFestivalUserFromReq(req);
    if (!u) {
      return res.status(401).json({
        error: '축제 로그인이 필요합니다.',
        code: 'FESTIVAL_AUTH_REQUIRED',
      });
    }
    return res.status(200).json({
      userUuid: u.uuid,
      createdAt: u.createdAt.toISOString(),
    });
  } catch (err) {
    console.error('festival GET /users/me:', err);
    return res.status(500).json({ error: '조회 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
