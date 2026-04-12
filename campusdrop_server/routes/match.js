const express = require('express');
const axios = require('axios');
const { prisma } = require('../lib/prisma');
const { getDummyMatchUsers } = require('../lib/matchDummyUsers');
const { surveyDataToLifestyleUser } = require('../lib/surveyToLifestyleUser');
const { getMatchingCalculateMatchUrl } = require('../lib/resolveMatchingServiceUrl');

const router = express.Router();

const DEFAULT_MATCH_TIMEOUT_MS = 5_000;

function matchRequestTimeoutMs() {
  const n = Number(process.env.MATCHING_SERVICE_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MATCH_TIMEOUT_MS;
}

async function postCalculateMatch(body) {
  const url = getMatchingCalculateMatchUrl();
  const { data, status } = await axios.post(url, body, {
    timeout: matchRequestTimeoutMs(),
    headers: { 'Content-Type': 'application/json' },
    validateStatus: () => true,
  });
  if (status < 200 || status >= 300) {
    return { ok: false, status, data, url };
  }
  return { ok: true, data, url };
}

/**
 * @openapi
 * /api/match/test:
 *   get:
 *     tags: [Match]
 *     summary: 더미 5명 순환 매칭 테스트 (Python calculate-match)
 *     security:
 *       - UserUuidAuth: []
 *     responses:
 *       200:
 *         description: 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 description: { type: string }
 *                 pythonUrl: { type: string }
 *                 inputUsers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       mbti: { type: string, nullable: true }
 *                 comparisons:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       user_A:
 *                         type: object
 *                         properties:
 *                           id: { type: string }
 *                           mbti: { type: string, nullable: true }
 *                       user_B:
 *                         type: object
 *                         properties:
 *                           id: { type: string }
 *                           mbti: { type: string, nullable: true }
 *                       match:
 *                         type: object
 *                         description: Python CalculateMatchResponse
 *                         additionalProperties: true
 *       401:
 *         description: 세션 무효
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       502:
 *         description: Python 비정상 응답 또는 네트워크 오류
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/MatchTest502Python'
 *                 - $ref: '#/components/schemas/MatchTest502Network'
 *       500:
 *         description: 기타 서버 오류
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.get('/test', async (req, res) => {
  const users = getDummyMatchUsers();
  const url = getMatchingCalculateMatchUrl();

  const pairs = users.map((_, i) => {
    const a = users[i];
    const b = users[(i + 1) % users.length];
    return { user_A: a, user_B: b };
  });

  try {
    const comparisons = [];

    for (const { user_A: ua, user_B: ub } of pairs) {
      const body = {
        user_A: surveyDataToLifestyleUser(/** @type {Record<string, unknown>} */ (ua.surveyData)),
        user_B: surveyDataToLifestyleUser(/** @type {Record<string, unknown>} */ (ub.surveyData)),
        hard_filter_policy: 'fail',
        penalty_per_hard_violation: 30,
      };

      const py = await postCalculateMatch(body);

      if (!py.ok) {
        return res.status(502).json({
          error: '매칭 서비스가 오류 상태를 반환했습니다.',
          pythonStatus: py.status,
          pythonUrl: py.url,
          pythonBody: py.data,
          failedPair: { user_A_id: ua.id, user_B_id: ub.id },
        });
      }

      comparisons.push({
        user_A: { id: ua.id, mbti: ua.mbti ?? null },
        user_B: { id: ub.id, mbti: ub.mbti ?? null },
        match: py.data,
      });
    }

    return res.status(200).json({
      description: '더미 5명 순환 매칭(인접 쌍 5회). Python POST /calculate-match 응답을 pair별로 포함합니다.',
      pythonUrl: url,
      inputUsers: users.map((u) => ({
        id: u.id,
        mbti: u.mbti ?? null,
      })),
      comparisons,
    });
  } catch (err) {
    console.error('match /test proxy error:', err.message);

    if (axios.isAxiosError(err)) {
      const pyStatus = err.response?.status;
      const pyData = err.response?.data;
      const netCode = err.code || (err.cause && /** @type {NodeJS.ErrnoException} */ (err.cause).code);
      const isRefused = netCode === 'ECONNREFUSED' || /ECONNREFUSED/i.test(String(err.message));

      /** Docker에서 host.docker.internal → LAN IP로 붙을 때, Python이 127.0.0.1 전용이면 거부됨 */
      const hint = isRefused
        ? '호스트에서 Python을 모든 인터페이스에 바인딩하세요. 예: uvicorn app.main:app --host 0.0.0.0 --port 8000 (기본 127.0.0.1만이면 컨테이너·LAN IP 접속이 ECONNREFUSED 됩니다.)'
        : undefined;

      return res.status(502).json({
        error: 'Python 매칭 서비스에 연결할 수 없습니다.',
        pythonUrl: url,
        detail: err.message,
        pythonStatus: pyStatus ?? null,
        pythonBody: pyData ?? null,
        ...(hint ? { hint } : {}),
      });
    }

    return res.status(500).json({ error: '매칭 테스트 처리 중 서버 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/match/request:
 *   post:
 *     tags: [Match]
 *     summary: DB 후보 대비 실시간 최고 점수 매칭 1건 (Python calculate-match 반복)
 *     security:
 *       - UserUuidAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: 본문 없이 `{}` 가능
 *     responses:
 *       200:
 *         description: 최고 점수 상대 1명
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MatchRequestResponse'
 *       400:
 *         description: 본인 설문 없음
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       401:
 *         description: 세션 무효
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       404:
 *         description: 후보 없음
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       500:
 *         description: 후보 조회 실패 또는 루프 내 예외
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       502:
 *         description: Python 연결 실패 또는 유효 결과 없음
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/MatchRequest502Network'
 *                 - $ref: '#/components/schemas/ErrorMessage'
 */
router.post('/request', async (req, res) => {
  const self = req.user;
  const selfSurvey = self.trait?.surveyData;
  if (selfSurvey === null || selfSurvey === undefined || typeof selfSurvey !== 'object') {
    return res.status(400).json({ error: '설문을 먼저 제출해 주세요.' });
  }

  let candidates;
  try {
    candidates = await prisma.identity.findMany({
      where: { id: { not: self.id } },
      include: { trait: true },
    });
  } catch (err) {
    console.error('match /request findMany error:', err);
    return res.status(500).json({ error: '매칭 후보 조회 중 오류가 발생했습니다.' });
  }

  const withSurvey = candidates.filter(
    (c) =>
      c.trait &&
      c.trait.surveyData !== null &&
      c.trait.surveyData !== undefined &&
      typeof c.trait.surveyData === 'object',
  );

  if (withSurvey.length === 0) {
    return res.status(404).json({ error: '매칭할 다른 사용자가 없습니다.' });
  }

  const selfPayload = surveyDataToLifestyleUser(/** @type {Record<string, unknown>} */ (selfSurvey));

  /** @type {{ partnerLabel: string, score: number, report: unknown } | null} */
  let best = null;

  try {
    for (const c of withSurvey) {
      const body = {
        user_A: selfPayload,
        user_B: surveyDataToLifestyleUser(
          /** @type {Record<string, unknown>} */ (c.trait.surveyData),
        ),
        hard_filter_policy: 'fail',
        penalty_per_hard_violation: 30,
      };

      const py = await postCalculateMatch(body);
      if (!py.ok) {
        console.warn('match /request skip candidate (calculate-match non-2xx)', {
          candidateId: c.id,
          status: py.status,
        });
        continue;
      }

      const data = py.data;
      const score = typeof data.final_score === 'number' ? data.final_score : Number(data.final_score);
      if (!Number.isFinite(score)) {
        continue;
      }

      const mbti = c.trait?.mbti && String(c.trait.mbti).trim();
      const partnerLabel = mbti || '상대';

      if (!best || score > best.score) {
        best = {
          partnerLabel,
          score,
          report: data.match_report,
        };
      }
    }
  } catch (err) {
    console.error('match /request error:', err.message);

    if (axios.isAxiosError(err)) {
      const pyStatus = err.response?.status;
      const pyData = err.response?.data;
      const netCode = err.code || (err.cause && /** @type {NodeJS.ErrnoException} */ (err.cause).code);
      const isRefused = netCode === 'ECONNREFUSED' || /ECONNREFUSED/i.test(String(err.message));
      const hint = isRefused
        ? '호스트에서 Python을 모든 인터페이스에 바인딩하세요. 예: uvicorn app.main:app --host 0.0.0.0 --port 8000 (기본 127.0.0.1만이면 컨테이너·LAN IP 접속이 ECONNREFUSED 됩니다.)'
        : undefined;
      return res.status(502).json({
        error: 'Python 매칭 서비스에 연결할 수 없습니다.',
        pythonUrl: getMatchingCalculateMatchUrl(),
        detail: err.message,
        pythonStatus: pyStatus ?? null,
        pythonBody: pyData ?? null,
        ...(hint ? { hint } : {}),
      });
    }

    return res.status(500).json({ error: '매칭 처리 중 서버 오류가 발생했습니다.' });
  }

  if (!best) {
    return res.status(502).json({
      error: '유효한 매칭 결과를 얻지 못했습니다. 매칭 서비스 또는 후보 설문 데이터를 확인해 주세요.',
    });
  }

  return res.status(200).json({
    partnerLabel: best.partnerLabel,
    score: best.score,
    report: best.report,
  });
});

module.exports = router;
