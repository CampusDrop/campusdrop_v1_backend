const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '.env'), override: true });

const express = require('express');
const cors = require('cors');
const { prisma } = require('./lib/prisma');
const { requireUserUuid } = require('./lib/requireUserUuid');
const { disconnectRedis } = require('./lib/redis');
const cron = require('node-cron');
const swaggerUi = require('swagger-ui-express');
const { runWeeklyBatchMatch } = require('./lib/weeklyBatchMatch');
const { buildSwaggerSpec } = require('./config/swagger');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = (process.env.HOST || '0.0.0.0').trim();

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
app.use(express.json()); // JSON 데이터 파싱

const swaggerSpec = buildSwaggerSpec();
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/kakao', require('./routes/kakao'));
app.use('/api/survey', requireUserUuid, require('./routes/survey'));
app.use('/api/match', requireUserUuid, require('./routes/match'));

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

    cron.schedule(
        '0 18 * * 1',
        () => {
            runWeeklyBatchMatch().catch((e) => console.error('[cron] weekly batch match:', e));
        },
        { timezone: 'Asia/Seoul' },
    );
    console.log('[cron] 매주 월요일 18:00 (Asia/Seoul) 배치 매칭 스케줄 등록됨');
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