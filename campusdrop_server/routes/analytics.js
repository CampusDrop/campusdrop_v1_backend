const express = require('express');
const { prisma } = require('../lib/prisma');
const {
  limits,
  maxEventsPerRequest,
  maxInteractionsPerRequest,
  maxBatchItems,
} = require('../lib/analyticsConstants');
const {
  allowIpAndSession,
  reserveDailyInteractionQuota,
  releaseDailyInteractionQuota,
} = require('../lib/analyticsRateLimit');

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

function optionalUserUuid(req) {
  const h = req.headers['x-user-uuid'];
  if (h === undefined || h === null) return null;
  const v = (Array.isArray(h) ? h[0] : String(h)).trim();
  if (!v) return null;
  return isUuid(v) ? v : null;
}

function clientIp(req) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  return String(ip).slice(0, 128);
}

function truncateStr(s, max) {
  if (typeof s !== 'string') return '';
  return s.length > max ? s.slice(0, max) : s;
}

function parseIso(s) {
  if (s === undefined || s === null) return null;
  if (s instanceof Date) {
    return Number.isNaN(s.getTime()) ? null : s;
  }
  if (typeof s !== 'string') return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.min(1, Math.max(0, x));
}

/**
 * 평면 JSON만 허용(문자열·숫자·불리언·null). 중첩 객체·배열은 제외.
 */
function sanitizeProps(raw, { maxKeys = 40, maxStrLen = 400 } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  let i = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (i >= maxKeys) break;
    if (typeof k !== 'string' || k.length > 80) continue;
    const key = truncateStr(k, 80);
    if (v === null || typeof v === 'number' || typeof v === 'boolean') {
      out[key] = v;
      i += 1;
    } else if (typeof v === 'string') {
      out[key] = truncateStr(v, maxStrLen);
      i += 1;
    }
  }
  return Object.keys(out).length ? out : null;
}

async function upsertSessionLink(sessionId, userUuid) {
  if (!userUuid) return;
  await prisma.analyticsSessionUserLink.upsert({
    where: { sessionId },
    create: { sessionId, userUuid },
    update: { userUuid },
  });
}

async function persistEvents({ sessionId, app, release, clientTs, events, userUuid }) {
  const clientDt = parseIso(clientTs);
  const capped = Array.isArray(events) ? events.slice(0, maxEventsPerRequest) : [];
  const droppedFromCap = Array.isArray(events) ? Math.max(0, events.length - maxEventsPerRequest) : 0;

  const rows = [];
  for (const ev of capped) {
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) continue;
    const name = typeof ev.name === 'string' ? ev.name.trim() : '';
    if (!name) continue;
    const ts = parseIso(ev.ts);
    if (!ts) continue;

    let clientEventId = null;
    const idRaw = ev.event_id ?? ev.client_event_id ?? ev.clientEventId;
    if (idRaw !== undefined && idRaw !== null && String(idRaw).trim()) {
      const idStr = String(idRaw).trim();
      if (isUuid(idStr)) clientEventId = idStr;
    }

    rows.push({
      sessionId,
      userUuid: userUuid || null,
      app: truncateStr(String(app), 64),
      release: release != null && release !== '' ? truncateStr(String(release), 128) : null,
      clientTs: clientDt,
      name: truncateStr(name, 160),
      eventTs: ts,
      props: sanitizeProps(ev.props),
      clientEventId,
    });
  }

  const droppedInvalid = capped.length - rows.length;
  if (userUuid) await upsertSessionLink(sessionId, userUuid);
  if (rows.length > 0) {
    await prisma.analyticsEvent.createMany({ data: rows });
  }
  return {
    accepted: rows.length,
    dropped: droppedFromCap + droppedInvalid,
  };
}

function buildInteractionRows(sessionId, interactions, userUuid) {
  const list = Array.isArray(interactions) ? interactions.slice(0, maxInteractionsPerRequest) : [];
  const droppedFromCap = Array.isArray(interactions)
    ? Math.max(0, interactions.length - maxInteractionsPerRequest)
    : 0;
  const rows = [];
  for (const it of list) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
    const type = typeof it.type === 'string' ? it.type.trim() : '';
    if (!type) continue;
    const ts = parseIso(it.ts);
    if (!ts) continue;
    const x = clamp01(it.x_norm ?? it.xNorm);
    const y = clamp01(it.y_norm ?? it.yNorm);
    if (x === null || y === null) continue;
    const nearestRegion =
      typeof it.nearest_region === 'string'
        ? it.nearest_region.trim()
        : typeof it.nearestRegion === 'string'
          ? it.nearestRegion.trim()
          : '';
    if (!nearestRegion) continue;
    const view = typeof it.view === 'string' ? it.view.trim() : '';
    if (!view) continue;

    rows.push({
      sessionId,
      userUuid: userUuid || null,
      type: truncateStr(type, 64),
      ts,
      xNorm: x,
      yNorm: y,
      nearestRegion: truncateStr(nearestRegion, 200),
      view: truncateStr(view, 120),
    });
  }
  const droppedInvalid = list.length - rows.length;
  return { rows, droppedFromCap, droppedInvalid };
}

async function persistHeartbeat({ sessionId, clientTs, lastMeaningfulActivityAt, visibility, context, userUuid }) {
  const lastAt = parseIso(lastMeaningfulActivityAt);
  if (!lastAt) {
    return { ok: false, error: 'last_meaningful_activity_at이 유효한 ISO8601이어야 합니다.' };
  }
  const clientDt = parseIso(clientTs);
  const vis =
    visibility === undefined || visibility === null
      ? null
      : truncateStr(String(visibility), 48);
  const ctx = sanitizeProps(context);

  const update = {
    lastMeaningfulActivityAt: lastAt,
    visibility: vis,
    context: ctx,
    clientTs: clientDt,
  };
  if (userUuid) update.userUuid = userUuid;

  await prisma.analyticsSessionHeartbeat.upsert({
    where: { sessionId },
    create: {
      sessionId,
      userUuid: userUuid || null,
      lastMeaningfulActivityAt: lastAt,
      visibility: vis,
      context: ctx,
      clientTs: clientDt,
    },
    update,
  });
  if (userUuid) await upsertSessionLink(sessionId, userUuid);
  return { ok: true };
}

async function persistInteractions({ sessionId, interactions, userUuid }) {
  const { rows, droppedFromCap, droppedInvalid } = buildInteractionRows(sessionId, interactions, userUuid);
  if (rows.length === 0) {
    return { accepted: 0, dropped: droppedFromCap + droppedInvalid };
  }

  const reserved = rows.length;
  const dailyOk = await reserveDailyInteractionQuota(sessionId, reserved, limits.interactionsPerSessionPerDay);
  if (!dailyOk) {
    return { accepted: 0, dropped: droppedFromCap + droppedInvalid + rows.length, dailyExceeded: true };
  }

  try {
    if (userUuid) await upsertSessionLink(sessionId, userUuid);
    await prisma.analyticsInteraction.createMany({ data: rows });
  } catch (err) {
    await releaseDailyInteractionQuota(sessionId, reserved);
    throw err;
  }

  return { accepted: rows.length, dropped: droppedFromCap + droppedInvalid };
}

function normalizeBatchItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = raw.kind;
  if (kind !== 'event' && kind !== 'heartbeat' && kind !== 'interaction') return null;
  const inner = raw.payload && typeof raw.payload === 'object' && !Array.isArray(raw.payload) ? raw.payload : raw;
  return { kind, body: inner };
}

/**
 * @openapi
 * /api/analytics/events:
 *   post:
 *     tags: [Analytics]
 *     summary: 공개 앱 분석 이벤트 배치 수집 (인증 불필요)
 *     description: |
 *       본문 최대 크기·`events` 최대 개수는 서버 환경 변수로 제한됩니다(기본 약 512KiB, 200건).
 *       초과 분은 잘리며 `dropped`에 반영됩니다. 선택 헤더 `x-user-uuid`로 세션-유저 연결을 기록할 수 있습니다.
 *     parameters:
 *       - in: header
 *         name: x-user-uuid
 *         required: false
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AnalyticsEventsRequest'
 *     responses:
 *       202:
 *         description: Accepted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AnalyticsAcceptedResponse'
 *       400:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       429:
 *         description: 레이트 리밋
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.post('/events', async (req, res) => {
  const userUuid = optionalUserUuid(req);
  const ip = clientIp(req);
  const body = req.body ?? {};
  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
  if (!isUuid(sessionId)) {
    return res.status(400).json({ error: 'session_id는 UUID 형식이어야 합니다.' });
  }
  const ok = await allowIpAndSession(
    'events',
    ip,
    sessionId,
    limits.eventsPerIpPerWindow,
    limits.eventsPerSessionPerWindow,
  );
  if (!ok) {
    return res.status(429).json({ error: '요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.' });
  }
  if (typeof body.app !== 'string' || !body.app.trim()) {
    return res.status(400).json({ error: 'app은 비어 있지 않은 문자열이어야 합니다.' });
  }
  if (!Array.isArray(body.events)) {
    return res.status(400).json({ error: 'events는 배열이어야 합니다.' });
  }

  try {
    const { accepted, dropped } = await persistEvents({
      sessionId,
      app: body.app,
      release: body.release,
      clientTs: body.client_ts,
      events: body.events,
      userUuid,
    });
    return res.status(202).json({ accepted, dropped });
  } catch (err) {
    console.error('analytics events:', err);
    return res.status(500).json({ error: '이벤트 저장 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/analytics/heartbeat:
 *   post:
 *     tags: [Analytics]
 *     summary: 이탈(10분 무활동) 분석용 세션 하트비트 UPSERT
 *     description: |
 *       `analytics_session_heartbeats` 테이블에 세션당 1행으로 갱신합니다. 집계 시 `idle_threshold_minutes=10` 등과 조합해 코호트를 뽑을 수 있습니다.
 *     parameters:
 *       - in: header
 *         name: x-user-uuid
 *         required: false
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AnalyticsHeartbeatRequest'
 *     responses:
 *       202:
 *         description: Accepted
 *       400:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       429:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.post('/heartbeat', async (req, res) => {
  const userUuid = optionalUserUuid(req);
  const ip = clientIp(req);
  const body = req.body ?? {};
  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
  if (!isUuid(sessionId)) {
    return res.status(400).json({ error: 'session_id는 UUID 형식이어야 합니다.' });
  }
  const ok = await allowIpAndSession(
    'heartbeat',
    ip,
    sessionId,
    limits.heartbeatPerIpPerWindow,
    limits.heartbeatPerSessionPerWindow,
  );
  if (!ok) {
    return res.status(429).json({ error: '요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.' });
  }

  try {
    const r = await persistHeartbeat({
      sessionId,
      clientTs: body.client_ts,
      lastMeaningfulActivityAt: body.last_meaningful_activity_at,
      visibility: body.visibility,
      context: body.context,
      userUuid,
    });
    if (!r.ok) {
      return res.status(400).json({ error: r.error });
    }
    return res.status(202).json({ ok: true });
  } catch (err) {
    console.error('analytics heartbeat:', err);
    return res.status(500).json({ error: '하트비트 저장 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/analytics/interaction:
 *   post:
 *     tags: [Analytics]
 *     summary: dead click·rage tap 등 고밀도 상호작용 수집
 *     description: |
 *       IP·세션 창 단위 레이트 리밋과 세션·UTC일 기준 상호작용 개수 상한이 있습니다. `x_norm`/`y_norm`은 0~1로 클램프됩니다.
 *     parameters:
 *       - in: header
 *         name: x-user-uuid
 *         required: false
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AnalyticsInteractionRequest'
 *     responses:
 *       202:
 *         description: Accepted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AnalyticsAcceptedResponse'
 *       400:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       429:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.post('/interaction', async (req, res) => {
  const userUuid = optionalUserUuid(req);
  const ip = clientIp(req);
  const body = req.body ?? {};
  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
  if (!isUuid(sessionId)) {
    return res.status(400).json({ error: 'session_id는 UUID 형식이어야 합니다.' });
  }
  const ok = await allowIpAndSession(
    'interaction',
    ip,
    sessionId,
    limits.interactionPerIpPerWindow,
    limits.interactionPerSessionPerWindow,
  );
  if (!ok) {
    return res.status(429).json({ error: '요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.' });
  }
  if (!Array.isArray(body.interactions)) {
    return res.status(400).json({ error: 'interactions는 배열이어야 합니다.' });
  }

  try {
    const { accepted, dropped, dailyExceeded } = await persistInteractions({
      sessionId,
      interactions: body.interactions,
      userUuid,
    });
    if (dailyExceeded) {
      return res.status(429).json({ error: '세션당 일일 상호작용 수집 한도를 초과했습니다.' });
    }
    return res.status(202).json({ accepted, dropped });
  } catch (err) {
    console.error('analytics interaction:', err);
    return res.status(500).json({ error: '상호작용 저장 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/analytics/batch:
 *   post:
 *     tags: [Analytics]
 *     summary: event·heartbeat·interaction 통합 배치 (단일 엔드포인트 선호 시)
 *     description: |
 *       `items` 최대 개수(기본 50) 제한. 모든 항목은 **동일한 session_id**를 사용해야 합니다. 상호작용은 검증된 행 수만큼 일일 쿼터를 선점한 뒤, 실제 저장량에 맞춰 미사용분을 Redis에서 되돌립니다.
 *     parameters:
 *       - in: header
 *         name: x-user-uuid
 *         required: false
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AnalyticsBatchRequest'
 *     responses:
 *       202:
 *         description: Accepted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AnalyticsBatchResponse'
 *       400:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       429:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.post('/batch', async (req, res) => {
  const userUuid = optionalUserUuid(req);
  const ip = clientIp(req);
  const body = req.body ?? {};
  if (!Array.isArray(body.items)) {
    return res.status(400).json({ error: 'items는 배열이어야 합니다.' });
  }

  const itemsIn = body.items.slice(0, maxBatchItems);
  const droppedItems = Math.max(0, body.items.length - maxBatchItems);

  const normalized = [];
  for (const raw of itemsIn) {
    const n = normalizeBatchItem(raw);
    if (n) normalized.push(n);
  }
  if (normalized.length === 0) {
    return res.status(400).json({ error: '유효한 kind(event|heartbeat|interaction)를 가진 항목이 필요합니다.' });
  }

  let batchSessionId = '';
  for (const n of normalized) {
    const sid = typeof n.body.session_id === 'string' ? n.body.session_id.trim() : '';
    if (!isUuid(sid)) {
      return res.status(400).json({ error: '각 항목에 유효한 session_id(UUID)가 필요합니다.' });
    }
    if (!batchSessionId) batchSessionId = sid;
    else if (batchSessionId !== sid) {
      return res.status(400).json({ error: 'batch 요청의 모든 항목은 동일한 session_id를 사용해야 합니다.' });
    }
  }

  const batchOk = await allowIpAndSession(
    'batch',
    ip,
    batchSessionId,
    limits.batchPerIpPerWindow,
    limits.batchPerSessionPerWindow,
  );
  if (!batchOk) {
    return res.status(429).json({ error: '요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.' });
  }

  const results = [];
  let totalInteractions = 0;
  for (const n of normalized) {
    if (n.kind === 'interaction' && Array.isArray(n.body.interactions)) {
      const { rows } = buildInteractionRows(batchSessionId, n.body.interactions, userUuid);
      totalInteractions += rows.length;
    }
  }

  if (totalInteractions > 0) {
    const dailyOk = await reserveDailyInteractionQuota(
      batchSessionId,
      totalInteractions,
      limits.interactionsPerSessionPerDay,
    );
    if (!dailyOk) {
      return res.status(429).json({ error: '세션당 일일 상호작용 수집 한도를 초과했습니다.' });
    }
  }

  const reservedInteractions = totalInteractions;
  let interactionAcceptedSum = 0;
  try {
    for (const n of normalized) {
      if (n.kind === 'event') {
        const sid = typeof n.body.session_id === 'string' ? n.body.session_id.trim() : '';
        if (!isUuid(sid)) {
          results.push({ kind: 'event', error: 'session_id가 UUID가 아닙니다.' });
          continue;
        }
        if (typeof n.body.app !== 'string' || !n.body.app.trim()) {
          results.push({ kind: 'event', error: 'app이 필요합니다.' });
          continue;
        }
        if (!Array.isArray(n.body.events)) {
          results.push({ kind: 'event', error: 'events 배열이 필요합니다.' });
          continue;
        }
        const r = await persistEvents({
          sessionId: sid,
          app: n.body.app,
          release: n.body.release,
          clientTs: n.body.client_ts,
          events: n.body.events,
          userUuid,
        });
        results.push({ kind: 'event', accepted: r.accepted, dropped: r.dropped });
      } else if (n.kind === 'heartbeat') {
        const sid = typeof n.body.session_id === 'string' ? n.body.session_id.trim() : '';
        if (!isUuid(sid)) {
          results.push({ kind: 'heartbeat', error: 'session_id가 UUID가 아닙니다.' });
          continue;
        }
        const r = await persistHeartbeat({
          sessionId: sid,
          clientTs: n.body.client_ts,
          lastMeaningfulActivityAt: n.body.last_meaningful_activity_at,
          visibility: n.body.visibility,
          context: n.body.context,
          userUuid,
        });
        if (!r.ok) {
          results.push({ kind: 'heartbeat', error: r.error });
        } else {
          results.push({ kind: 'heartbeat', ok: true });
        }
      } else if (n.kind === 'interaction') {
        const sid = typeof n.body.session_id === 'string' ? n.body.session_id.trim() : '';
        if (!Array.isArray(n.body.interactions)) {
          results.push({ kind: 'interaction', error: 'interactions 배열이 필요합니다.' });
          continue;
        }
        const r = await persistInteractionsNoDaily({
          sessionId: sid,
          interactions: n.body.interactions,
          userUuid,
        });
        interactionAcceptedSum += r.accepted;
        results.push({ kind: 'interaction', accepted: r.accepted, dropped: r.dropped });
      }
    }
  } catch (err) {
    if (reservedInteractions > 0) {
      await releaseDailyInteractionQuota(batchSessionId, reservedInteractions - interactionAcceptedSum);
    }
    console.error('analytics batch:', err);
    return res.status(500).json({ error: '배치 처리 중 오류가 발생했습니다.' });
  }

  if (reservedInteractions > 0) {
    await releaseDailyInteractionQuota(batchSessionId, reservedInteractions - interactionAcceptedSum);
  }

  return res.status(202).json({ results, droppedItems });
});

/** 배치에서 일일 쿼터를 선차감한 뒤 호출 — DB에만 기록 */
async function persistInteractionsNoDaily({ sessionId, interactions, userUuid }) {
  const { rows, droppedFromCap, droppedInvalid } = buildInteractionRows(sessionId, interactions, userUuid);
  if (rows.length === 0) {
    return { accepted: 0, dropped: droppedFromCap + droppedInvalid };
  }
  if (userUuid) await upsertSessionLink(sessionId, userUuid);
  await prisma.analyticsInteraction.createMany({ data: rows });
  return { accepted: rows.length, dropped: droppedFromCap + droppedInvalid };
}

module.exports = router;
