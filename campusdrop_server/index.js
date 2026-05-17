const path = require('path');
// Docker Compose 등에서 이미 주입된 DATABASE_URL은 유지하고, 비어 있을 때만 .env로 채움.
// (컨테이너에 /app/.env 등에 @db URL이 있으면 override:true가 RDS를 덮어써 verify-code가 db:5432로 붙는 문제가 생김)
const dotenvOverride = !process.env.DATABASE_URL;
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), override: dotenvOverride });
require('dotenv').config({ path: path.resolve(__dirname, '.env'), override: dotenvOverride });

const express = require('express');
const cors = require('cors');
const { prisma } = require('./lib/prisma');
const { requireUserUuid } = require('./lib/requireUserUuid');
const { requireImageUuidAccessForSurveyApis } = require('./lib/imageUuidAccess');
const { disconnectRedis } = require('./lib/redis');
const { scheduleMeetingFeedbackFriendTalkCron } = require('./lib/meetingFeedbackFriendTalkCron');
const { scheduleFriendTalkDayEveCron } = require('./lib/friendTalkDayEveCron');
const { scheduleMatchSuccessFriendTalkCron } = require('./lib/matchSuccessFriendTalkCron');
const {
  scheduleFriendGroupAttendanceDeadlineCron,
  scheduleFriendGroupMatchSuccessScheduledSendCron,
} = require('./lib/friendGroupAttendanceJobsCron');
const { schedulePurgeIdentitiesWithoutPhoneCron } = require('./lib/purgeIdentitiesWithoutPhoneCron');
const swaggerUi = require('swagger-ui-express');
const { buildSwaggerSpec } = require('./config/swagger');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = (process.env.HOST || '0.0.0.0').trim();

const trustProxy = (process.env.TRUST_PROXY || '').trim().toLowerCase();
if (trustProxy === '1' || trustProxy === 'true' || trustProxy === 'yes') {
  app.set('trust proxy', 1);
}

const corsAllowedOrigins = new Set([
  'https://campus-drop.com',
  'https://www.campus-drop.com',
  'http://campus-drop.com',
  'http://www.campus-drop.com',
]);
for (const o of (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)) {
  corsAllowedOrigins.add(o);
}
for (const o of (process.env.ADMIN_CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)) {
  corsAllowedOrigins.add(o);
}

// 2. 미들웨어 설정
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (corsAllowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      if (process.env.NODE_ENV !== 'production') {
        try {
          const u = new URL(origin);
          if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
            callback(null, true);
            return;
          }
        } catch (_) {
          /* ignore */
        }
      }
      callback(null, false);
    },
    credentials: true,
  }),
);

const { jsonBodyLimitBytes } = require('./lib/analyticsConstants');
app.use('/api/analytics', express.json({ limit: jsonBodyLimitBytes }), require('./routes/analytics'));
app.use(express.json()); // JSON 데이터 파싱

app.use(
  '/assets',
  express.static(path.join(__dirname, 'assets'), {
    maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  }),
);

const swaggerSpec = buildSwaggerSpec();
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));
app.get('/openapi.json', (req, res) => {
  res.json(swaggerSpec);
});

const { adminAuthMiddleware } = require('./lib/adminAuth');

app.use('/api/admin', require('./routes/admin'));
app.use('/api/admin', adminAuthMiddleware, require('./routes/adminFriendMatch'));
app.use('/api/admin', require('./routes/festivalAdmin'));
app.use('/api/festival', require('./routes/festival'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/auth', require('./routes/schoolProof'));
app.use('/api/kakao', require('./routes/kakao'));
app.use('/api/friend-talk', require('./routes/friendTalkRsvp'));
app.use('/api', require('./routes/testMessage'));
app.use('/api/notify', requireUserUuid, require('./routes/friendTalkNotify'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/landing-like', require('./routes/landingLike'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/survey', require('./routes/surveyOptions'));
app.use('/api/survey', requireUserUuid, requireImageUuidAccessForSurveyApis, require('./routes/survey'));
app.use('/api/survey', requireUserUuid, requireImageUuidAccessForSurveyApis, require('./routes/surveyFriend'));
app.use('/api/match', requireUserUuid, requireImageUuidAccessForSurveyApis, require('./routes/match'));
app.use('/api/meet-chat', require('./routes/meetChat'));

/**
 * @openapi
 * /:
 *   get:
 *     tags: [Health]
 *     summary: 서버 동작 확인
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RootResponse'
 */
app.get('/', (req, res) => {
    res.json({
        message: "Campus Drop API Server is running!",
        university: "Sejong University",
        status: "Online"
    });
});

/**
 * 처리되지 않은 오류는 Express 기본 핸들러로 가면 `<pre>Internal Server Error</pre>` HTML만 내려갑니다.
 * JSON 본문 파싱 실패(SyntaxError)·기타 next(err)도 여기서 통일합니다.
 */
app.use((err, req, res, _next) => {
    if (res.headersSent) {
        _next(err);
        return;
    }

    const rawStatus = err.statusCode ?? err.status;
    const status =
        typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;

    /** express.json / body-parser 가 넘기는 잘못된 JSON (보통 `body` 속성 있음) */
    const isBadJsonBody =
        err instanceof SyntaxError && Object.prototype.hasOwnProperty.call(err, 'body');

    const resolvedStatus = isBadJsonBody ? 400 : status;

    console.error('[express]', req.method, req.originalUrl || req.url, err);

    const dev = process.env.NODE_ENV !== 'production';
    let message;
    if (isBadJsonBody) {
        message = '요청 본문이 올바른 JSON이 아닙니다.';
    } else if (dev) {
        message = err.message || String(err);
    } else if (resolvedStatus >= 500) {
        message = '서버 오류가 발생했습니다.';
    } else {
        message =
            typeof err.message === 'string' && err.message.trim()
                ? err.message
                : '요청을 처리할 수 없습니다.';
    }

    res.status(resolvedStatus).json({
        error: message,
        ...(dev && err.stack ? { stack: String(err.stack) } : {}),
    });
});

// 4. 서버 시작
const server = app.listen(PORT, HOST, () => {
    const advertise =
      (process.env.PUBLIC_API_URL || '').trim().replace(/\/+$/, '') ||
      `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
    console.log(`========================================`);
    console.log(`🚀 Campus Drop 서버가 가동되었습니다!`);
    console.log(`📡 바인딩: http://${HOST}:${PORT}`);
    console.log(`📡 안내 URL: ${advertise}`);
    console.log(`📘 Swagger UI: ${advertise}/api-docs`);
    console.log(`========================================`);

    scheduleMeetingFeedbackFriendTalkCron();
    scheduleFriendTalkDayEveCron();
    scheduleMatchSuccessFriendTalkCron();
    scheduleFriendGroupAttendanceDeadlineCron();
    scheduleFriendGroupMatchSuccessScheduledSendCron();
    schedulePurgeIdentitiesWithoutPhoneCron();
});

async function shutdown() {
    try {
        await disconnectRedis();
    } catch (_) {
        /* ignore */
    }
    await prisma.$disconnect();
    server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);