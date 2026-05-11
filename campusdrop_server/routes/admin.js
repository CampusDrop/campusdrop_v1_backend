const fs = require('fs');
const express = require('express');
const axios = require('axios');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../lib/prisma');
const {
  adminAuthMiddleware,
  signAdminToken,
  adminJwtExpiresSec,
} = require('../lib/adminAuth');
const { verifyAdminDbCredentials } = require('../lib/adminDbAuth');
const { writeAccessLog } = require('../lib/accessLog');
const {
  runWeeklyBatchMatch,
  loadEligibleTraits,
  parseBirthYearForMatch,
  partnerAgePreferenceFromSurveyData,
} = require('../lib/weeklyBatchMatch');
const {
  getMatchingPeriodStart,
  getMatchingPeriodEnd,
  getHistoricalPartnerIds,
  getUserIdsMatchedInPeriod,
  deleteMatchingsForUsersInPeriod,
} = require('../lib/matchPolicy');
const {
  sendMatchSuccessFriendTalkForAllInPeriod,
  sendMatchFailureFriendTalkForUnmatchedInPeriod,
} = require('../lib/adminMatchFriendTalk');
const { buildSurveySubmissionWindowForApplicationPeriod } = require('../lib/surveyAvailabilityWindow');
const { surveyDataToLifestyleUser } = require('../lib/surveyToLifestyleUser');
const { surveyDataToAvailabilitySlots } = require('../lib/surveyAvailabilitySlots');
const { getMatchingCalculateMatchUrl } = require('../lib/resolveMatchingServiceUrl');
const { normalizeDepartment } = require('../lib/departments');
const { slimMatchReportForDb } = require('../lib/slimMatchReport');
const { areOppositeTraitGenders, normalizeTraitGender, traitGenderLabelKo } = require('../lib/genderPolicy');
const { resolveSchoolProofAbsolutePath } = require('../lib/schoolProofMulter');
const { kstWallClockToUtc, utcToKstSlot } = require('../lib/kstMeetingInstant');
const { signMeetChatQrToken, meetChatQrSecret } = require('../lib/meetChatQr');

const CAFE_NAME_MAX_LEN = 200;
const CAFE_URL_MAX_LEN = 1000;
const CAFE_ADDRESS_MAX_LEN = 500;

/**
 * @param {unknown} body
 * @returns {{ ok: true, value: { name?: string, naverPlaceUrl?: string | null, address?: string | null, isActive?: boolean, displayOrder?: number } } | { ok: false, error: string }}
 */
function parseCafeInput(body, { requireName }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: '요청 본문은 JSON 객체여야 합니다.' };
  }
  const out = {};
  const b = /** @type {Record<string, unknown>} */ (body);

  if ('name' in b) {
    const v = b.name;
    if (typeof v !== 'string') {
      return { ok: false, error: 'name은 문자열이어야 합니다.' };
    }
    const t = v.trim();
    if (t.length === 0) {
      return { ok: false, error: 'name은 비어 있을 수 없습니다.' };
    }
    if (t.length > CAFE_NAME_MAX_LEN) {
      return { ok: false, error: `name은 ${CAFE_NAME_MAX_LEN}자 이하여야 합니다.` };
    }
    out.name = t;
  } else if (requireName) {
    return { ok: false, error: 'name이 필요합니다.' };
  }

  for (const [key, max] of [
    ['naverPlaceUrl', CAFE_URL_MAX_LEN],
    ['naver_place_url', CAFE_URL_MAX_LEN],
    ['address', CAFE_ADDRESS_MAX_LEN],
  ]) {
    if (key in b) {
      const v = b[key];
      if (v === null || v === '') {
        if (key === 'address') out.address = null;
        else out.naverPlaceUrl = null;
        continue;
      }
      if (typeof v !== 'string') {
        return { ok: false, error: `${key}는 문자열이거나 null이어야 합니다.` };
      }
      const t = v.trim();
      if (t.length > max) {
        return { ok: false, error: `${key}는 ${max}자 이하여야 합니다.` };
      }
      if (key === 'address') out.address = t || null;
      else out.naverPlaceUrl = t || null;
    }
  }

  if ('isActive' in b || 'is_active' in b) {
    const v = b.isActive ?? b.is_active;
    if (typeof v !== 'boolean') {
      return { ok: false, error: 'isActive는 boolean이어야 합니다.' };
    }
    out.isActive = v;
  }

  if ('displayOrder' in b || 'display_order' in b) {
    const v = Number(b.displayOrder ?? b.display_order);
    if (!Number.isInteger(v)) {
      return { ok: false, error: 'displayOrder는 정수여야 합니다.' };
    }
    out.displayOrder = v;
  }

  return { ok: true, value: out };
}

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

function slimFriendTalkRsvp(row) {
  if (!row) {
    return null;
  }
  return {
    mondayRsvpUserA: row.mondayRsvpUserA ?? null,
    mondayRsvpUserB: row.mondayRsvpUserB ?? null,
    mondayOutcome: row.mondayOutcome ?? null,
    mondayOutcomeSent: Boolean(row.mondayOutcomeSent),
    mondayOutcomeSentAt: row.mondayOutcomeSentAt ?? null,
    skipDayEveReminder: Boolean(row.skipDayEveReminder),
    dayEveReminderSentAt: row.dayEveReminderSentAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

/** @param {unknown} body */
function periodStartFromAdminRequestBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  const raw = b.periodStart ?? b.period_start;
  if (raw == null || raw === '') {
    return { ok: true, value: getMatchingPeriodStart() };
  }
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) {
    return { ok: false, error: 'periodStart는 유효한 ISO 날짜/시각이어야 합니다.' };
  }
  return { ok: true, value: d };
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_MATCH_TIMEOUT_MS = 5_000;
const DEFAULT_ADMIN_MATCH_WEEKS = 5;
const MAX_ADMIN_MATCH_WEEKS = 52;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

function matchRequestTimeoutMs() {
  const n = Number(process.env.MATCHING_SERVICE_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MATCH_TIMEOUT_MS;
}

function parseMatchWeeks(value) {
  const n = Number(value ?? DEFAULT_ADMIN_MATCH_WEEKS);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_ADMIN_MATCH_WEEKS;
  return Math.min(n, MAX_ADMIN_MATCH_WEEKS);
}

function ageFromBirthYear(value, now = new Date()) {
  if (value === null || value === undefined || value === '') return null;
  const birthYear = Number(value);
  if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > now.getUTCFullYear()) {
    return null;
  }
  return now.getUTCFullYear() - birthYear + 1;
}

function isValidDateOnly(s) {
  if (typeof s !== 'string' || !DATE_ONLY_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function padHour(h) {
  return String(h).padStart(2, '0');
}

function timeSlotFromHours(hourStart, hourEnd) {
  return `${padHour(hourStart)}:00-${padHour(hourEnd)}:00`;
}

function parseQueryHour(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 23) {
    return { ok: false, error: `${name}는 0~23 정수여야 합니다.` };
  }
  return { ok: true, value: n };
}

function normalizeAvailableSlot(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = /** @type {Record<string, unknown>} */ (row);
  const date = typeof r.date === 'string' ? r.date.trim() : '';
  const hourStart = Number(r.hourStart);
  const hourEnd = Number(r.hourEnd);
  if (!isValidDateOnly(date)) return null;
  if (!Number.isInteger(hourStart) || hourStart < 0 || hourStart > 23) return null;
  if (!Number.isInteger(hourEnd) || hourEnd < 0 || hourEnd > 23) return null;
  const diff = (hourEnd - hourStart + 24) % 24;
  if (diff !== 1) return null;
  return { date, hourStart, hourEnd };
}

function normalizeTimeSlotString(value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2})(?::00)?\s*-\s*(\d{1,2})(?::00)?$/);
  if (!m) return null;
  const hourStart = Number(m[1]);
  const hourEnd = Number(m[2]);
  const slot = normalizeAvailableSlot({ date: '2026-01-01', hourStart, hourEnd });
  if (!slot) return null;
  return { hourStart, hourEnd, time_slot: timeSlotFromHours(hourStart, hourEnd) };
}

function parseMatchedSlotInput(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: null };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'matchedSlot은 객체여야 합니다.' };
  }
  const slot = normalizeAvailableSlot(raw);
  if (!slot) {
    return {
      ok: false,
      error:
        'matchedSlot은 { date: YYYY-MM-DD, hourStart: 0~23, hourEnd: 0~23 } 형태의 정확히 1시간 구간이어야 합니다.',
    };
  }

  const row = /** @type {Record<string, unknown>} */ (raw);
  const timeSlot = normalizeTimeSlotString(row.time_slot ?? row.timeSlot);
  if ((row.time_slot !== undefined || row.timeSlot !== undefined) && !timeSlot) {
    return { ok: false, error: 'matchedSlot.time_slot은 "12-13" 또는 "12:00-13:00" 형식이어야 합니다.' };
  }
  if (timeSlot && (timeSlot.hourStart !== slot.hourStart || timeSlot.hourEnd !== slot.hourEnd)) {
    return { ok: false, error: 'matchedSlot.time_slot이 hourStart/hourEnd와 일치하지 않습니다.' };
  }

  return {
    ok: true,
    value: {
      date: slot.date,
      hourStart: slot.hourStart,
      hourEnd: slot.hourEnd,
      time_slot: timeSlotFromHours(slot.hourStart, slot.hourEnd),
    },
  };
}

function legacySlotToAvailableSlot(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = /** @type {Record<string, unknown>} */ (row);
  const date = typeof r.date === 'string' ? r.date.trim() : '';
  const timeSlot = typeof r.time_slot === 'string' ? r.time_slot.trim() : '';
  const m = timeSlot.match(/^([01]\d|2[0-3]):00-([01]\d|2[0-3]):00$/);
  if (!isValidDateOnly(date) || !m) return null;
  return normalizeAvailableSlot({
    date,
    hourStart: Number(m[1]),
    hourEnd: Number(m[2]),
  });
}

function dedupeAndSortAvailableSlots(slots) {
  const seen = new Set();
  const out = [];
  for (const slot of slots) {
    const n = normalizeAvailableSlot(slot);
    if (!n) continue;
    const key = `${n.date}|${n.hourStart}|${n.hourEnd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  out.sort((a, b) => {
    const c = a.date.localeCompare(b.date);
    if (c !== 0) return c;
    return a.hourStart - b.hourStart || a.hourEnd - b.hourEnd;
  });
  return out;
}

function matchAvailabilityForResponse(surveyData) {
  if (!surveyData || typeof surveyData !== 'object' || Array.isArray(surveyData)) {
    return { availableSlots: [] };
  }
  const data = /** @type {Record<string, unknown>} */ (surveyData);
  const ma = data.matchAvailability;
  if (ma && typeof ma === 'object' && !Array.isArray(ma)) {
    const raw = /** @type {Record<string, unknown>} */ (ma).availableSlots;
    if (Array.isArray(raw)) {
      const availableSlots = dedupeAndSortAvailableSlots(raw);
      if (availableSlots.length > 0) return { availableSlots };
    }
  }
  const legacySlots = surveyDataToAvailabilitySlots(data)
    .map(legacySlotToAvailableSlot)
    .filter(Boolean);
  return { availableSlots: dedupeAndSortAvailableSlots(legacySlots) };
}

function hasRequestedSlot(surveyData, slot) {
  return matchAvailabilityForResponse(surveyData).availableSlots.some(
    (s) =>
      s.date === slot.date &&
      s.hourStart === slot.hourStart &&
      s.hourEnd === slot.hourEnd,
  );
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
 * `Trait.surveyData`에서 만남 가능 시간만 꺼내 목록 응답용으로 사용한다.
 * @param {unknown} surveyData
 * @returns {{ availability: unknown[] | null, matchAvailability: Record<string, unknown> | null }}
 */
function meetingAvailabilityFromSurveyData(surveyData) {
  if (
    surveyData === null ||
    surveyData === undefined ||
    typeof surveyData !== 'object' ||
    Array.isArray(surveyData)
  ) {
    return { availability: null, matchAvailability: null };
  }
  const o = /** @type {Record<string, unknown>} */ (surveyData);
  const av = o.availability;
  const ma = o.matchAvailability;
  return {
    availability: Array.isArray(av) ? av : null,
    matchAvailability:
      ma !== undefined && ma !== null && typeof ma === 'object' && !Array.isArray(ma)
        ? /** @type {Record<string, unknown>} */ (ma)
        : null,
  };
}

/**
 * @openapi
 * /api/admin/login:
 *   post:
 *     tags: [Admin]
 *     summary: 관리자 로그인 (DB `admins` 테이블 이메일·비밀번호) → JWT
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 description: DB에 등록된 @sju.ac.kr 관리자 이메일
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: JWT 발급
 *       401:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       503:
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (email === undefined || email === null || email === '') {
    return res.status(400).json({ error: 'email이 필요합니다.' });
  }
  if (typeof email !== 'string') {
    return res.status(400).json({ error: 'email은 문자열이어야 합니다.' });
  }
  if (password === undefined || password === null || password === '') {
    return res.status(400).json({ error: 'password가 필요합니다.' });
  }
  if (typeof password !== 'string') {
    return res.status(400).json({ error: 'password는 문자열이어야 합니다.' });
  }

  let adminCount;
  try {
    adminCount = await prisma.admin.count();
  } catch (err) {
    console.error('admin login count error:', err);
    return res.status(503).json({
      error:
        '관리자 테이블을 사용할 수 없습니다. `npx prisma db push` 후 `npm run db:seed`로 계정을 넣었는지 확인해 주세요.',
    });
  }
  if (adminCount === 0) {
    return res.status(503).json({
      error:
        '등록된 관리자 계정이 없습니다. `.env`에 ADMIN_EMAIL·ADMIN_PASSWORD를 두고 `npm run db:seed`를 실행해 주세요.',
    });
  }

  const check = await verifyAdminDbCredentials(prisma, email, password);
  if (!check.ok) {
    if (check.reason === 'invalid_email') {
      return res.status(400).json({ error: '세종대 이메일(@sju.ac.kr) 형식만 허용됩니다.' });
    }
    if (check.reason === 'db_error') {
      return res.status(500).json({ error: '로그인 확인 중 오류가 발생했습니다.' });
    }
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }

  let token;
  try {
    token = signAdminToken(check.admin.id);
  } catch (err) {
    console.error('admin login sign error:', err);
    return res.status(503).json({
      error: '관리자 토큰을 발급할 수 없습니다. ADMIN_JWT_SECRET(16자 이상) 또는 ADMIN_PASSWORD(JWT 파생용)를 설정해 주세요.',
    });
  }

  await writeAccessLog({
    actorType: 'admin',
    actorId: check.admin.id,
    action: 'ADMIN_LOGIN',
    resource: 'POST /api/admin/login',
    ip: req.ip || null,
    userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
    metadata: null,
  });

  return res.status(200).json({
    token,
    tokenType: 'Bearer',
    expiresInSec: adminJwtExpiresSec(),
  });
});

router.use(adminAuthMiddleware);

/**
 * @openapi
 * /api/admin/cafes:
 *   get:
 *     tags: [Admin]
 *     summary: 매칭 카페 마스터 목록 (활성·비활성 모두)
 *     description: |
 *       `displayOrder` 오름차순, 동률은 `createdAt` 오름차순. 배치 매칭은 `isActive=true`인 카페만 사용합니다.
 *     security:
 *       - AdminBearerAuth: []
 */
router.get('/cafes', async (req, res) => {
  try {
    const cafes = await prisma.cafe.findMany({
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        naverPlaceUrl: true,
        address: true,
        isActive: true,
        displayOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_LIST_CAFES',
      resource: 'GET /api/admin/cafes',
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { count: cafes.length },
    });

    return res.status(200).json({ total: cafes.length, cafes });
  } catch (err) {
    console.error('admin GET /cafes error:', err);
    return res.status(500).json({ error: '카페 목록 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/cafes:
 *   post:
 *     tags: [Admin]
 *     summary: 매칭 카페 등록
 *     description: |
 *       `name`은 유니크. `displayOrder`는 라운드로빈 우선순위(오름차순). 생략 시 0.
 *     security:
 *       - AdminBearerAuth: []
 */
router.post('/cafes', async (req, res) => {
  const parsed = parseCafeInput(req.body, { requireName: true });
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }
  const v = parsed.value;
  try {
    const created = await prisma.cafe.create({
      data: {
        name: v.name,
        naverPlaceUrl: v.naverPlaceUrl ?? null,
        address: v.address ?? null,
        isActive: v.isActive ?? true,
        displayOrder: v.displayOrder ?? 0,
      },
      select: {
        id: true,
        name: true,
        naverPlaceUrl: true,
        address: true,
        isActive: true,
        displayOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_CAFE_CREATE',
      resource: `Cafe:${created.id}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { name: created.name, displayOrder: created.displayOrder },
    });

    return res.status(201).json({ cafe: created });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: '같은 이름의 카페가 이미 존재합니다.' });
    }
    console.error('admin POST /cafes error:', err);
    return res.status(500).json({ error: '카페 등록 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/cafes/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: 매칭 카페 부분 수정 (이름·URL·주소·displayOrder·isActive)
 *     security:
 *       - AdminBearerAuth: []
 */
router.patch('/cafes/:id', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ error: '유효한 카페 UUID가 아닙니다.' });
  }
  const parsed = parseCafeInput(req.body, { requireName: false });
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }
  if (Object.keys(parsed.value).length === 0) {
    return res.status(400).json({ error: '수정할 필드를 하나 이상 보내 주세요.' });
  }

  try {
    const updated = await prisma.cafe.update({
      where: { id },
      data: parsed.value,
      select: {
        id: true,
        name: true,
        naverPlaceUrl: true,
        address: true,
        isActive: true,
        displayOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_CAFE_UPDATE',
      resource: `Cafe:${id}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { keys: Object.keys(parsed.value) },
    });

    return res.status(200).json({ cafe: updated });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return res.status(404).json({ error: '카페를 찾을 수 없습니다.' });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: '같은 이름의 카페가 이미 존재합니다.' });
    }
    console.error('admin PATCH /cafes/:id error:', err);
    return res.status(500).json({ error: '카페 수정 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/cafes/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: 매칭 카페 삭제 (사용 중이면 기본 거부, `?force=1`로 강제)
 *     description: |
 *       이미 매칭에 배정된 카페면 기본은 400이며, `?force=1`을 주면 매칭 행의 `cafe_id`만 NULL로 끊어지고
 *       `meeting_venue_name` 스냅샷은 보존됩니다. 일반적으로는 비활성화(`isActive=false`)를 권장합니다.
 *     security:
 *       - AdminBearerAuth: []
 */
router.delete('/cafes/:id', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ error: '유효한 카페 UUID가 아닙니다.' });
  }
  const force = ['1', 'true', 'yes'].includes(String(req.query.force || '').toLowerCase());

  try {
    const usedCount = await prisma.matching.count({ where: { cafeId: id } });
    if (usedCount > 0 && !force) {
      return res.status(400).json({
        error: `이 카페에 배정된 매칭이 ${usedCount}건 있어 삭제할 수 없습니다. \`?force=1\`로 강제 삭제하면 매칭의 카페 연결만 해제되고 이름은 보존됩니다. 일반적으로는 isActive=false 비활성화를 권장합니다.`,
        usedCount,
      });
    }

    await prisma.cafe.delete({ where: { id } });

    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_CAFE_DELETE',
      resource: `Cafe:${id}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { force, usedCount },
    });

    return res.status(200).json({
      message: '카페가 삭제되었습니다.',
      id,
      detachedMatchingCount: force ? usedCount : 0,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return res.status(404).json({ error: '카페를 찾을 수 없습니다.' });
    }
    console.error('admin DELETE /cafes/:id error:', err);
    return res.status(500).json({ error: '카페 삭제 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: 모든 유저(Identity) 목록 (만남 가능 시간 `availability`·`matchAvailability` 포함)
 *     security:
 *       - AdminBearerAuth: []
 */
router.get('/users', async (req, res) => {
  const limitRaw = req.query.limit;
  const offsetRaw = req.query.offset;
  const limit = Math.min(Math.max(Number(limitRaw ?? 100) || 100, 1), 500);
  const offset = Math.max(Number(offsetRaw ?? 0) || 0, 0);

  try {
    const [total, rows] = await prisma.$transaction([
      prisma.identity.count(),
      prisma.identity.findMany({
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          nickname: true,
          email: true,
          kakaoId: true,
          blockedAt: true,
          schoolProofVerifiedAt: true,
          studentId: true,
          birthYear: true,
          department: true,
          createdAt: true,
          trait: {
            select: {
              surveyData: true,
              surveySubmittedAt: true,
              updatedAt: true,
              gender: true,
            },
          },
        },
      }),
    ]);

    const users = rows.map((row) => {
      const { availability, matchAvailability } = meetingAvailabilityFromSurveyData(
        row.trait?.surveyData,
      );
      return {
        id: row.id,
        nickname: row.nickname ?? null,
        email: row.email,
        /** `email`이 있으면 학교 이메일이 연결된 것으로 간주(증빙만 올리고 이메일 미연결 계정은 null) */
        emailVerified: Boolean(row.email),
        schoolImageVerified: Boolean(row.schoolProofVerifiedAt),
        schoolProofVerifiedAt: row.schoolProofVerifiedAt,
        studentId: row.studentId,
        birthYear: row.birthYear,
        department: row.department,
        kakaoLinked: Boolean(row.kakaoId && String(row.kakaoId).trim()),
        blockedAt: row.blockedAt,
        createdAt: row.createdAt,
        hasSurvey:
          row.trait &&
          row.trait.surveyData !== null &&
          row.trait.surveyData !== undefined &&
          typeof row.trait.surveyData === 'object',
        surveyUpdatedAt: row.trait?.updatedAt ?? null,
        surveySubmittedAt: row.trait?.surveySubmittedAt ?? null,
        gender: row.trait?.gender ?? null,
        availability,
        matchAvailability,
      };
    });

    await writeAccessLog({
      actorType: 'admin',
      actorId: null,
      action: 'ADMIN_LIST_USERS',
      resource: `GET /api/admin/users?limit=${limit}&offset=${offset}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { total, returned: users.length },
    });

    return res.status(200).json({ total, limit, offset, users });
  } catch (err) {
    console.error('admin GET /users error:', err);
    return res.status(500).json({ error: '유저 목록 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/surveys:
 *   get:
 *     tags: [Admin]
 *     summary: 모든 설문(Trait) 응답
 *     security:
 *       - AdminBearerAuth: []
 */
router.get('/surveys', async (req, res) => {
  const limitRaw = req.query.limit;
  const offsetRaw = req.query.offset;
  const limit = Math.min(Math.max(Number(limitRaw ?? 100) || 100, 1), 500);
  const offset = Math.max(Number(offsetRaw ?? 0) || 0, 0);

  try {
    const [total, traits] = await prisma.$transaction([
      prisma.trait.count(),
      prisma.trait.findMany({
        orderBy: { updatedAt: 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          gender: true,
          surveyData: true,
          surveySubmittedAt: true,
          updatedAt: true,
          identity: {
            select: { blockedAt: true, createdAt: true, kakaoId: true },
          },
        },
      }),
    ]);

    await writeAccessLog({
      actorType: 'admin',
      actorId: null,
      action: 'ADMIN_LIST_SURVEYS',
      resource: `GET /api/admin/surveys?limit=${limit}&offset=${offset}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { total, returned: traits.length },
    });

    return res.status(200).json({
      total,
      limit,
      offset,
      surveys: traits.map((t) => ({
        userId: t.id,
        gender: t.gender,
        surveyData: t.surveyData,
        surveySubmittedAt: t.surveySubmittedAt,
        updatedAt: t.updatedAt,
        identity: t.identity,
      })),
    });
  } catch (err) {
    console.error('admin GET /surveys error:', err);
    return res.status(500).json({ error: '설문 목록 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/matches:
 *   get:
 *     tags: [Admin]
 *     summary: DB에 저장된 매칭(주간 배치 등) 현황
 *     description: |
 *       각 행에 `userAEmail`·`userBEmail`(`Identity.email`, 없으면 null), 성별, 카카오 연동 식별자,
 *       배치 시 저장된 `matchReport`(Python `match_report` JSON, 없으면 null) 포함.
 *       기본은 최근 5개 매칭 주(현재 주 포함, `periodStart` 또는 레거시 `matchedAt` 구간).
 *       `weeks`로 최근 N주(1~52)를 지정할 수 있고, `includeAll=1`이면 전체 이력.
 *     security:
 *       - AdminBearerAuth: []
 */
router.get('/matches', async (req, res) => {
  const limitRaw = req.query.limit;
  const offsetRaw = req.query.offset;
  const limit = Math.min(Math.max(Number(limitRaw ?? 200) || 200, 1), 1000);
  const offset = Math.max(Number(offsetRaw ?? 0) || 0, 0);

  const includeAll = ['1', 'true', 'yes'].includes(String(req.query.includeAll || '').toLowerCase());
  const weeks = parseMatchWeeks(req.query.weeks);
  const currentPeriodStart = getMatchingPeriodStart();
  const ps = new Date(currentPeriodStart.getTime() - (weeks - 1) * MS_PER_WEEK);
  const pe = getMatchingPeriodEnd(currentPeriodStart);
  const where = includeAll
    ? {}
    : {
        OR: [
          { periodStart: { gte: ps, lt: pe } },
          {
            AND: [{ periodStart: null }, { matchedAt: { gte: ps, lt: pe } }],
          },
        ],
      };

  try {
    const [total, matchings] = await prisma.$transaction([
      prisma.matching.count({ where }),
      prisma.matching.findMany({
        where,
        orderBy: { matchedAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          userA: {
            select: {
              id: true,
              nickname: true,
              email: true,
              kakaoId: true,
              kakaoLinkPin: true,
              trait: { select: { gender: true } },
            },
          },
          userB: {
            select: {
              id: true,
              nickname: true,
              email: true,
              kakaoId: true,
              kakaoLinkPin: true,
              trait: { select: { gender: true } },
            },
          },
          cafe: { select: { id: true, name: true, isActive: true, naverPlaceUrl: true } },
          friendTalkRsvp: {
            select: {
              mondayRsvpUserA: true,
              mondayRsvpUserB: true,
              mondayOutcome: true,
              mondayOutcomeSent: true,
              mondayOutcomeSentAt: true,
              skipDayEveReminder: true,
              dayEveReminderSentAt: true,
              updatedAt: true,
            },
          },
        },
      }),
    ]);

    await writeAccessLog({
      actorType: 'admin',
      actorId: null,
      action: 'ADMIN_LIST_MATCHES',
      resource: `GET /api/admin/matches?limit=${limit}&offset=${offset}&includeAll=${includeAll ? 1 : 0}&weeks=${weeks}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { total, returned: matchings.length, weeks: includeAll ? null : weeks },
    });

    return res.status(200).json({
      total,
      limit,
      offset,
      includeAll,
      weeks: includeAll ? null : weeks,
      periodStart: includeAll ? null : ps.toISOString(),
      periodEnd: includeAll ? null : pe.toISOString(),
      matches: matchings.map((m) => ({
        id: m.id,
        userAId: m.userAId,
        userBId: m.userBId,
        userANickname: m.userA?.nickname ?? null,
        userBNickname: m.userB?.nickname ?? null,
        userAEmail: m.userA?.email ?? null,
        userBEmail: m.userB?.email ?? null,
        userAGender: normalizeTraitGender(m.userA?.trait?.gender) ?? null,
        userBGender: normalizeTraitGender(m.userB?.trait?.gender) ?? null,
        userAGenderLabel: traitGenderLabelKo(m.userA?.trait?.gender) || null,
        userBGenderLabel: traitGenderLabelKo(m.userB?.trait?.gender) || null,
        userAKakaoId: m.userA?.kakaoId ?? null,
        userBKakaoId: m.userB?.kakaoId ?? null,
        userAKakaoLinkPin: m.userA?.kakaoLinkPin ?? null,
        userBKakaoLinkPin: m.userB?.kakaoLinkPin ?? null,
        userAKakaoLinked: Boolean(m.userA?.kakaoId && String(m.userA.kakaoId).trim()),
        userBKakaoLinked: Boolean(m.userB?.kakaoId && String(m.userB.kakaoId).trim()),
        score: m.score,
        matchedAt: m.matchedAt,
        periodStart: m.periodStart ?? null,
        meetingStartsAt: m.meetingStartsAt ?? null,
        meetingVenueName: m.meetingVenueName ?? null,
        cafeId: m.cafeId ?? null,
        cafe: m.cafe ?? null,
        friendTalkRsvp: slimFriendTalkRsvp(m.friendTalkRsvp),
        matchReport: m.matchReport ?? null,
      })),
    });
  } catch (err) {
    console.error('admin GET /matches error:', err);
    return res.status(500).json({ error: '매칭 목록 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/matches/unmatched:
 *   get:
 *     tags: [Admin]
 *     summary: 이번 매칭 주기에 `matchings`에 없는 설문 완료 유저
 *     description: |
 *       배치와 동일 기준(설문 JSON 보유·차단 아님) 중, 현재 주기 `matchings`에 한 번도 안 올라간 유저.
 *       `GET /api/admin/matches`와 동일한 주기 정의(`periodStart` / 레거시 `matchedAt` 구간).
 *     security:
 *       - AdminBearerAuth: []
 */
router.get('/matches/unmatched', async (req, res) => {
  const ps = getMatchingPeriodStart();
  const pe = getMatchingPeriodEnd(ps);
  const submissionWindow = buildSurveySubmissionWindowForApplicationPeriod(ps);

  try {
    const [eligible, matchedIds] = await Promise.all([
      loadEligibleTraits({ periodStart: ps }),
      getUserIdsMatchedInPeriod(prisma, ps),
    ]);

    const unmatched = eligible.filter((t) => !matchedIds.has(t.id));

    const users = unmatched.map((t) => ({
      id: t.id,
      identityId: t.id,
      nickname: t.identity?.nickname ?? null,
      email: t.identity?.email ?? null,
      kakaoId: t.identity?.kakaoId ?? null,
      kakaoLinked: Boolean(t.identity?.kakaoId && String(t.identity.kakaoId).trim()),
      createdAt: t.identity?.createdAt ?? null,
      gender: normalizeTraitGender(t.gender) ?? null,
      genderLabel: traitGenderLabelKo(t.gender) || null,
      surveySubmittedAt: t.surveySubmittedAt ?? null,
      surveyUpdatedAt: t.updatedAt ?? null,
      matchAvailability: matchAvailabilityForResponse(t.surveyData),
    }));

    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_LIST_MATCH_UNMATCHED',
      resource: 'GET /api/admin/matches/unmatched',
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: {
        eligibleCount: eligible.length,
        matchedInPeriodCount: matchedIds.size,
        unmatchedCount: users.length,
      },
    });

    return res.status(200).json({
      periodStart: ps.toISOString(),
      periodEnd: pe.toISOString(),
      submissionWindow,
      eligibleCount: eligible.length,
      matchedInPeriodCount: matchedIds.size,
      unmatchedCount: users.length,
      users,
    });
  } catch (err) {
    console.error('admin GET /matches/unmatched error:', err);
    return res.status(500).json({ error: '미매칭 유저 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/matches/slot-candidates:
 *   get:
 *     tags: [Admin]
 *     summary: 기준 여성의 특정 가능 시간에 매칭 가능한 남성 후보와 점수 조회
 *     description: |
 *       `identityId`는 여성 Identity UUID여야 하며, 현재 매칭 주기 미매칭·비차단·설문 완료 사용자만 대상으로 한다.
 *       후보는 요청 슬롯을 가진 남성 미매칭 사용자이며, Python `calculate-match`에 `hard_rules_scope=religion_only`를 넘겨
 *       종교 하드만 적용하고(동일 학과·나이·흡연 등은 점수·소프트만 반영), 점수 내림차순으로 전부 반환한다.
 *     security:
 *       - AdminBearerAuth: []
 */
router.get('/matches/slot-candidates', async (req, res) => {
  const identityId = String(req.query.identityId ?? req.query.id ?? '').trim();
  const date = String(req.query.date ?? '').trim();
  const hs = parseQueryHour(req.query.hourStart, 'hourStart');
  const he = parseQueryHour(req.query.hourEnd, 'hourEnd');

  if (!isUuid(identityId)) {
    return res.status(400).json({ error: 'identityId는 유효한 Identity UUID여야 합니다.' });
  }
  if (!isValidDateOnly(date)) {
    return res.status(400).json({ error: 'date는 YYYY-MM-DD 형식의 유효한 날짜여야 합니다.' });
  }
  if (!hs.ok) {
    return res.status(400).json({ error: hs.error });
  }
  if (!he.ok) {
    return res.status(400).json({ error: he.error });
  }
  const slot = { date, hourStart: hs.value, hourEnd: he.value };
  if ((slot.hourEnd - slot.hourStart + 24) % 24 !== 1) {
    return res.status(400).json({ error: 'hourStart/hourEnd는 정확히 1시간 구간이어야 합니다.' });
  }

  const periodStart = getMatchingPeriodStart();
  const submissionWindow = buildSurveySubmissionWindowForApplicationPeriod(periodStart);

  try {
    const [eligible, matchedIds, historicalPartnerIds] = await Promise.all([
      loadEligibleTraits({ periodStart }),
      getUserIdsMatchedInPeriod(prisma, periodStart),
      getHistoricalPartnerIds(prisma, identityId),
    ]);

    const base = eligible.find((t) => t.id === identityId);
    if (!base) {
      return res.status(404).json({
        error: '기준 유저를 찾을 수 없거나 설문 미완료/차단 상태입니다.',
      });
    }
    const baseGender = normalizeTraitGender(base.gender);
    if (baseGender !== 'female') {
      return res.status(400).json({ error: 'slot-candidates의 기준 유저는 여성만 허용됩니다.' });
    }
    if (matchedIds.has(base.id)) {
      return res.status(400).json({ error: '기준 유저는 이미 이번 매칭 주기에 매칭되었습니다.' });
    }
    if (!hasRequestedSlot(base.surveyData, slot)) {
      return res.status(400).json({ error: '기준 유저의 가능 시간에 요청한 슬롯이 없습니다.' });
    }

    const candidatesRaw = eligible.filter((t) => {
      if (t.id === base.id) return false;
      if (matchedIds.has(t.id)) return false;
      if (historicalPartnerIds.has(t.id)) return false;
      if (normalizeTraitGender(t.gender) !== 'male') return false;
      return hasRequestedSlot(t.surveyData, slot);
    });

    const candidates = [];
    const baseProfile = surveyDataToLifestyleUser(
      /** @type {Record<string, unknown>} */ (base.surveyData),
    );
    const baseDeptNorm = normalizeDepartment(base.identity?.department);
    const baseBirthYear = parseBirthYearForMatch(base.identity?.birthYear);
    const baseAgePrefs = partnerAgePreferenceFromSurveyData(base.surveyData);

    for (const cand of candidatesRaw) {
      const candidateProfile = surveyDataToLifestyleUser(
        /** @type {Record<string, unknown>} */ (cand.surveyData),
      );
      const candDeptNorm = normalizeDepartment(cand.identity?.department);
      const candBirthYear = parseBirthYearForMatch(cand.identity?.birthYear);
      const candAgePrefs = partnerAgePreferenceFromSurveyData(cand.surveyData);
      const baseIsUserA = base.id.localeCompare(cand.id) <= 0;
      // 슬롯 일치는 Node에서만 본다. Python은 `hard_rules_scope=religion_only`로 종교 하드만 차단·availability는 미전달.
      const body = baseIsUserA
        ? {
            user_A: baseProfile,
            user_B: candidateProfile,
            department_a: baseDeptNorm,
            department_b: candDeptNorm,
            birth_year_a: baseBirthYear,
            birth_year_b: candBirthYear,
            partner_age_preference_a: baseAgePrefs,
            partner_age_preference_b: candAgePrefs,
            gender_a: 'female',
            gender_b: 'male',
            hard_rules_scope: 'religion_only',
          }
        : {
            user_A: candidateProfile,
            user_B: baseProfile,
            department_a: candDeptNorm,
            department_b: baseDeptNorm,
            birth_year_a: candBirthYear,
            birth_year_b: baseBirthYear,
            partner_age_preference_a: candAgePrefs,
            partner_age_preference_b: baseAgePrefs,
            gender_a: 'male',
            gender_b: 'female',
            hard_rules_scope: 'religion_only',
          };

      const py = await postCalculateMatch(body);
      if (!py.ok) {
        return res.status(502).json({
          error: '매칭 서비스가 오류 상태를 반환했습니다.',
          pythonStatus: py.status,
          pythonUrl: py.url,
          pythonBody: py.data,
          failedCandidate: { identityId: cand.id },
        });
      }

      const score = Number(py.data?.final_score);
      if (py.data?.match_status !== 'ok' || !Number.isFinite(score)) {
        continue;
      }
      const report = slimMatchReportForDb(score, py.data?.match_report);
      candidates.push({
        identityId: cand.id,
        id: cand.id,
        nickname: cand.identity?.nickname ?? null,
        email: cand.identity?.email ?? null,
        gender: 'male',
        genderLabel: traitGenderLabelKo(cand.gender) || '남성',
        birthYear: cand.identity?.birthYear ?? null,
        department: cand.identity?.department ?? null,
        age: ageFromBirthYear(cand.identity?.birthYear),
        kakaoId: cand.identity?.kakaoId ?? null,
        kakaoLinkPin: cand.identity?.kakaoLinkPin ?? null,
        kakaoLinked: Boolean(cand.identity?.kakaoId && String(cand.identity.kakaoId).trim()),
        surveySubmittedAt: cand.surveySubmittedAt ?? null,
        score: Math.round(score * 100) / 100,
        reasons: Array.isArray(report?.reasons) ? report.reasons : [],
        matchAvailability: matchAvailabilityForResponse(cand.surveyData),
      });
    }

    candidates.sort((a, b) => b.score - a.score || a.identityId.localeCompare(b.identityId));

    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_MATCH_SLOT_CANDIDATES',
      resource: 'GET /api/admin/matches/slot-candidates',
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: {
        identityId: base.id,
        slot,
        candidateCount: candidates.length,
      },
    });

    return res.status(200).json({
      periodStart: periodStart.toISOString(),
      submissionWindow,
      baseUser: {
        identityId: base.id,
        id: base.id,
        nickname: base.identity?.nickname ?? null,
        gender: 'female',
        genderLabel: traitGenderLabelKo(base.gender) || '여성',
        email: base.identity?.email ?? null,
      },
      slot,
      candidates,
    });
  } catch (err) {
    console.error('admin GET /matches/slot-candidates error:', err);
    if (axios.isAxiosError(err)) {
      return res.status(502).json({
        error: 'Python 매칭 서비스에 연결할 수 없습니다.',
        pythonUrl: getMatchingCalculateMatchUrl(),
        detail: err.message,
        pythonStatus: err.response?.status ?? null,
        pythonBody: err.response?.data ?? null,
      });
    }
    return res.status(500).json({ error: '시간대별 후보 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/matches/{id}/meet-details:
 *   patch:
 *     tags: [Admin]
 *     summary: 소개팅 채팅용 약속 시각·장소명 설정
 *     security:
 *       - AdminBearerAuth: []
 */
router.patch('/matches/:id/meet-details', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ error: '유효한 매칭 UUID가 아닙니다.' });
  }

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  /** @type {Record<string, unknown>} */
  const data = {};

  if ('meetingVenueName' in body || 'meeting_venue_name' in body) {
    const v = body.meetingVenueName ?? body.meeting_venue_name;
    if (v === null) {
      data.meetingVenueName = null;
    } else if (typeof v === 'string') {
      const t = v.trim();
      data.meetingVenueName = t.length > 0 ? t.slice(0, 200) : null;
    } else {
      return res.status(400).json({ error: 'meetingVenueName은 문자열이거나 null이어야 합니다.' });
    }
  }

  if ('meetingStartsAt' in body || 'meeting_starts_at' in body) {
    const v = body.meetingStartsAt ?? body.meeting_starts_at;
    if (v === null || v === '') {
      data.meetingStartsAt = null;
    } else {
      const d = new Date(String(v));
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: 'meetingStartsAt는 유효한 ISO-8601 날짜여야 합니다.' });
      }
      data.meetingStartsAt = d;
    }
  }

  // cafeId가 들어오면 카페 존재 여부 확인 후 venueName을 동시에 동기화. null은 카페 해제.
  if ('cafeId' in body || 'cafe_id' in body) {
    const v = body.cafeId ?? body.cafe_id;
    if (v === null || v === '') {
      data.cafeId = null;
    } else {
      if (typeof v !== 'string' || !isUuid(v)) {
        return res.status(400).json({ error: 'cafeId는 유효한 UUID여야 합니다.' });
      }
      const cafe = await prisma.cafe.findUnique({ where: { id: v }, select: { id: true, name: true } });
      if (!cafe) {
        return res.status(404).json({ error: '카페를 찾을 수 없습니다.' });
      }
      data.cafeId = cafe.id;
      // 본문에 meetingVenueName이 함께 오지 않았으면 카페 이름으로 자동 동기화.
      if (!('meetingVenueName' in body) && !('meeting_venue_name' in body)) {
        data.meetingVenueName = cafe.name;
      }
    }
  }

  if (Object.keys(data).length === 0) {
    return res
      .status(400)
      .json({ error: 'meetingStartsAt, meetingVenueName, cafeId 중 하나 이상을 보내 주세요.' });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // meetingStartsAt이 본문에 명시된 경우, 동일 트랜잭션에서 matchReport.matchedSlot도
      // KST 슬롯 기준으로 동기화한다 — 관리자 콘솔이 matchedSlot으로 시간대 칸을 잡기 때문.
      if ('meetingStartsAt' in data) {
        const current = await tx.matching.findUnique({
          where: { id },
          select: { matchReport: true },
        });
        if (!current) {
          throw Object.assign(new Error('MATCHING_NOT_FOUND'), { code: 'MATCHING_NOT_FOUND' });
        }
        const baseReport =
          current.matchReport && typeof current.matchReport === 'object' && !Array.isArray(current.matchReport)
            ? { .../** @type {Record<string, unknown>} */ (current.matchReport) }
            : null;

        if (data.meetingStartsAt === null) {
          if (baseReport && 'matchedSlot' in baseReport) {
            delete baseReport.matchedSlot;
            data.matchReport = baseReport;
          }
        } else {
          const slot = utcToKstSlot(data.meetingStartsAt);
          if (slot) {
            const next = baseReport ?? { score: 0, reasons: [] };
            next.matchedSlot = {
              date: slot.date,
              hourStart: slot.hourStart,
              hourEnd: slot.hourEnd,
              time_slot: slot.time_slot,
            };
            data.matchReport = next;
          }
        }
      }

      return tx.matching.update({
        where: { id },
        data,
        select: {
          id: true,
          userAId: true,
          userBId: true,
          meetingStartsAt: true,
          meetingVenueName: true,
          cafeId: true,
          cafe: { select: { id: true, name: true, isActive: true } },
          friendTalkRsvp: {
            select: {
              mondayRsvpUserA: true,
              mondayRsvpUserB: true,
              mondayOutcome: true,
              mondayOutcomeSent: true,
              mondayOutcomeSentAt: true,
              skipDayEveReminder: true,
              dayEveReminderSentAt: true,
              updatedAt: true,
            },
          },
          matchReport: true,
        },
      });
    });

    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_MATCH_MEET_DETAILS',
      resource: `Matching:${id}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { keys: Object.keys(data) },
    });

    return res.status(200).json({
      match: {
        ...updated,
        friendTalkRsvp: slimFriendTalkRsvp(updated.friendTalkRsvp),
      },
    });
  } catch (err) {
    if (err && err.code === 'MATCHING_NOT_FOUND') {
      return res.status(404).json({ error: '매칭을 찾을 수 없습니다.' });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return res.status(404).json({ error: '매칭을 찾을 수 없습니다.' });
    }
    console.error('admin PATCH /matches/:id/meet-details:', err);
    return res.status(500).json({ error: '매칭 정보 갱신 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/matches/reassign-venue:
 *   post:
 *     tags: [Admin]
 *     summary: 특정 시간(KST date+hour) 슬롯의 매칭 카페를 일괄 교체
 *     description: |
 *       본문 `{ date: 'YYYY-MM-DD', hourStart: 0~23, toCafeId, fromCafeId? }`.
 *       KST 벽시계로 해석한 `meeting_starts_at` 시각이 정확히 일치하는 매칭을 일괄 update.
 *       `fromCafeId`가 주어지면 해당 카페에 배정된 매칭만, 없으면 슬롯 전체를 대상으로 한다.
 *       `meeting_venue_name`은 `toCafeId`의 현재 이름으로 동기화. 응답에는 변경된 매칭 ID 배열 + 카운트.
 *     security:
 *       - AdminBearerAuth: []
 */
router.post('/matches/reassign-venue', async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const date = typeof body.date === 'string' ? body.date.trim() : '';
  if (!isValidDateOnly(date)) {
    return res.status(400).json({ error: 'date는 YYYY-MM-DD 형식의 유효한 날짜여야 합니다.' });
  }
  const hs = parseQueryHour(body.hourStart ?? body.hour_start, 'hourStart');
  if (!hs.ok) {
    return res.status(400).json({ error: hs.error });
  }
  const toCafeId = String(body.toCafeId ?? body.to_cafe_id ?? '').trim();
  if (!isUuid(toCafeId)) {
    return res.status(400).json({ error: 'toCafeId는 유효한 카페 UUID여야 합니다.' });
  }
  let fromCafeId = null;
  if (body.fromCafeId !== undefined && body.fromCafeId !== null && body.fromCafeId !== ''
      || body.from_cafe_id !== undefined && body.from_cafe_id !== null && body.from_cafe_id !== '') {
    const v = String(body.fromCafeId ?? body.from_cafe_id).trim();
    if (!isUuid(v)) {
      return res.status(400).json({ error: 'fromCafeId는 유효한 카페 UUID여야 합니다.' });
    }
    fromCafeId = v;
  }

  const meetingStartsAt = kstWallClockToUtc(date, hs.value);
  if (!meetingStartsAt) {
    return res.status(400).json({ error: 'date·hourStart로 유효한 KST 시각을 만들 수 없습니다.' });
  }

  try {
    const toCafe = await prisma.cafe.findUnique({
      where: { id: toCafeId },
      select: { id: true, name: true, isActive: true },
    });
    if (!toCafe) {
      return res.status(404).json({ error: 'toCafeId에 해당하는 카페를 찾을 수 없습니다.' });
    }

    const where = {
      meetingStartsAt,
      ...(fromCafeId ? { cafeId: fromCafeId } : {}),
    };

    const targets = await prisma.matching.findMany({
      where,
      select: { id: true, cafeId: true, meetingVenueName: true },
    });

    if (targets.length === 0) {
      return res.status(200).json({
        updatedCount: 0,
        updatedIds: [],
        message: '대상 매칭이 없습니다.',
        slot: { date, hourStart: hs.value, meetingStartsAt: meetingStartsAt.toISOString() },
      });
    }

    await prisma.matching.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data: { cafeId: toCafe.id, meetingVenueName: toCafe.name },
    });

    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_MATCH_BULK_REASSIGN_VENUE',
      resource: `Cafe:${toCafe.id}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: {
        slot: { date, hourStart: hs.value, meetingStartsAt: meetingStartsAt.toISOString() },
        fromCafeId,
        toCafeId: toCafe.id,
        updatedCount: targets.length,
        sampleMatchIds: targets.slice(0, 50).map((t) => t.id),
      },
    });

    return res.status(200).json({
      updatedCount: targets.length,
      updatedIds: targets.map((t) => t.id),
      slot: { date, hourStart: hs.value, meetingStartsAt: meetingStartsAt.toISOString() },
      toCafe: { id: toCafe.id, name: toCafe.name, isActive: toCafe.isActive },
      fromCafeId,
    });
  } catch (err) {
    console.error('admin POST /matches/reassign-venue error:', err);
    return res.status(500).json({ error: '카페 일괄 교체 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/matches/{id}/chat-messages:
 *   get:
 *     tags: [Admin]
 *     summary: 소개팅 QR 채팅 메시지 전체 이력 (시간 제한 없음)
 *     security:
 *       - AdminBearerAuth: []
 */
router.get('/matches/:id/chat-messages', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ error: '유효한 매칭 UUID가 아닙니다.' });
  }

  let limit = Number(req.query.limit);
  if (!Number.isFinite(limit)) limit = 500;
  limit = Math.min(Math.max(Math.trunc(limit), 1), 2000);

  try {
    const matchRow = await prisma.matching.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!matchRow) {
      return res.status(404).json({ error: '매칭을 찾을 수 없습니다.' });
    }

    const items = await prisma.meetingChatMessage.findMany({
      where: { matchingId: id },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        matchingId: true,
        senderId: true,
        body: true,
        createdAt: true,
      },
    });

    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_MATCH_CHAT_MESSAGES_LIST',
      resource: `Matching:${id}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { count: items.length, limit },
    });

    return res.status(200).json({
      matchingId: id,
      messages: items.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('admin GET /matches/:id/chat-messages:', err);
    return res.status(500).json({ error: '채팅 메시지 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/matches/{id}/meet-chat-qr-token:
 *   get:
 *     tags: [Admin]
 *     summary: 소개팅 채팅 페이지용 서명 QR 토큰 발급
 *     security:
 *       - AdminBearerAuth: []
 */
router.get('/matches/:id/meet-chat-qr-token', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ error: '유효한 매칭 UUID가 아닙니다.' });
  }

  if (!meetChatQrSecret()) {
    return res.status(503).json({
      error: 'MEET_CHAT_QR_SECRET 환경 변수를 설정한 뒤 QR 토큰을 발급할 수 있습니다.',
    });
  }

  try {
    const row = await prisma.matching.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!row) {
      return res.status(404).json({ error: '매칭을 찾을 수 없습니다.' });
    }

    const qrToken = signMeetChatQrToken(id);
    if (!qrToken) {
      return res.status(503).json({ error: 'QR 토큰을 생성하지 못했습니다.' });
    }

    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_MATCH_MEET_CHAT_QR',
      resource: `Matching:${id}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: {},
    });

    return res.status(200).json({
      matchingId: id,
      qrToken,
    });
  } catch (err) {
    console.error('admin GET /matches/:id/meet-chat-qr-token:', err);
    return res.status(500).json({ error: 'QR 토큰 발급 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/matches/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: 매칭 1건 삭제 (`matchings.id`)
 *     description: 잘못된 짝 등 운영 판단 시 행만 제거. 이후 동일 쌍은 배치·실시간에서 다시 매칭될 수 있음.
 *     security:
 *       - AdminBearerAuth: []
 */
router.delete('/matches/:id', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ error: '유효한 매칭 UUID가 아닙니다.' });
  }

  try {
    const row = await prisma.matching.findUnique({
      where: { id },
      select: { id: true, userAId: true, userBId: true },
    });
    if (!row) {
      return res.status(404).json({ error: '매칭을 찾을 수 없습니다.' });
    }

    await prisma.matching.delete({ where: { id } });

    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_MATCH_DELETE',
      resource: `Matching:${id}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { userAId: row.userAId, userBId: row.userBId },
    });

    return res.status(200).json({
      message: '매칭이 삭제되었습니다.',
      deleted: {
        id: row.id,
        userAId: row.userAId,
        userBId: row.userBId,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return res.status(404).json({ error: '매칭을 찾을 수 없습니다.' });
    }
    console.error('admin DELETE /matches/:id error:', err);
    return res.status(500).json({ error: '매칭 삭제 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/matches/batch-run:
 *   post:
 *     tags: [Admin]
 *     summary: 배치 매칭 수동 실행 (Python batch-match → DB 저장)
 *     security:
 *       - AdminBearerAuth: []
 */
router.post('/matches/batch-run', async (req, res) => {
  try {
    const result = await runWeeklyBatchMatch({
      actorType: 'admin',
      actorId: req.admin.adminId,
      requestIp: req.ip || null,
      requestUserAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('admin POST /matches/batch-run:', err);
    return res.status(502).json({
      error: '배치 매칭 실행에 실패했습니다. 매칭 서비스 URL·로그를 확인해 주세요.',
      detail: err && err.message ? String(err.message) : undefined,
    });
  }
});

/**
 * 매칭 성공 쌍에게 7번(참석 확인) 친구톡 일괄 발송. 본문·버튼은 DB 일시·장소 기준.
 * 본문: `periodStart`(선택, 기본 현재 매칭 주)에 속한 모든 `matchings` 행.
 */
router.post('/friend-talk/send-match-success', async (req, res) => {
  try {
    const parsed = periodStartFromAdminRequestBody(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }
    const result = await sendMatchSuccessFriendTalkForAllInPeriod({
      periodStart: parsed.value,
    });
    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_FRIEND_TALK_MATCH_SUCCESS',
      resource: 'friend-talk',
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: {
        sent: result.sent,
        failedCount: result.failed.length,
        matchingCount: result.matchingCount,
        periodStart: result.periodStart,
      },
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('admin POST /friend-talk/send-match-success:', err);
    return res.status(500).json({ error: '친구톡 발송 처리 중 오류가 발생했습니다.' });
  }
});

/**
 * 이번 주 설문 제출·미매칭자에게 미매칭 안내 친구톡 일괄 발송.
 */
router.post('/friend-talk/send-match-failure', async (req, res) => {
  try {
    const parsed = periodStartFromAdminRequestBody(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }
    const result = await sendMatchFailureFriendTalkForUnmatchedInPeriod({
      periodStart: parsed.value,
    });
    if (!result.ok) {
      return res.status(500).json({ error: result.error });
    }
    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_FRIEND_TALK_MATCH_FAILURE',
      resource: 'friend-talk',
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: {
        sent: result.sent,
        skipped: result.skipped,
        failedCount: result.failed.length,
        eligibleCount: result.eligibleCount,
        periodStart: result.periodStart,
      },
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('admin POST /friend-talk/send-match-failure:', err);
    return res.status(500).json({ error: '친구톡 발송 처리 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/matches/force:
 *   post:
 *     tags: [Admin]
 *     summary: 두 유저 강제 매칭 (운영자 지정, `matchings` 1건 생성)
 *     description: |
 *       남성·여성(이성) 쌍만 허용. `Trait.gender`가 비어 있으면 본문 `genderA`·`genderB`(각각 userA·userB의 `male`/`female` 또는 남성/여성 표기)로 넘기면 저장 후 매칭한다.
 *       DB에 이미 성별이 있는데 본문 값이 다르면 400.
 *
 *       **약속 시각(요일·시간):** 별도 `weekday` 필드는 없고, 달력 날짜로 요일이 정해진다.
 *       - `meetingStartsAt`(또는 `meeting_starts_at`)에 ISO-8601 시각을 주면 그 값이 `matchings.meeting_starts_at`에 저장되며, 비어 있지 않으면 **이 값이 우선**이다.
 *       - 그렇지 않고 `matchedSlot`(또는 `matched_slot`)을 주면 `{ date: YYYY-MM-DD, hourStart, hourEnd }` 정확히 1시간 구간으로 검증한 뒤, 해당 날짜·`hourStart`를 **KST 벽시계**로 해석해 `meeting_starts_at`을 채운다. 선택적으로 `time_slot`/`timeSlot` 문자열로 `hourStart`/`hourEnd`와 교차 검증 가능.
 *       **장소:** `meetingVenueName`(또는 `meeting_venue_name`) 문자열 최대 200자 → `matchings.meeting_venue_name`. 클라이언트의 소개팅 채팅 등에서 방 제목 등으로 사용된다.
 *
 *       `matchedSlot`을 넘기면 `match_report` JSON에 `matchedSlot`이 함께 저장된다(넘기지 않으면 `match_report`는 생략 가능). `meetingStartsAt`만 넣고 슬롯을 생략해도 DB 시각만으로 일정·채팅 창 유도가 가능하다.
 *     security:
 *       - AdminBearerAuth: []
 */
router.post('/matches/force', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const userAId = body.userAId ?? body.user_a_id;
  const userBId = body.userBId ?? body.user_b_id;
  const scoreRaw = body.score;
  const genderAIn = body.genderA ?? body.gender_a ?? body.userA_gender;
  const genderBIn = body.genderB ?? body.gender_b ?? body.userB_gender;
  const matchedSlotRaw = body.matchedSlot ?? body.matched_slot;

  if (!isUuid(String(userAId)) || !isUuid(String(userBId))) {
    return res.status(400).json({ error: 'userAId·userBId는 유효한 UUID여야 합니다.' });
  }
  const a = String(userAId);
  const b = String(userBId);
  if (a === b) {
    return res.status(400).json({ error: '서로 다른 두 유저를 지정해 주세요.' });
  }

  let score = 0;
  if (scoreRaw !== undefined && scoreRaw !== null && scoreRaw !== '') {
    const n = Number(scoreRaw);
    if (!Number.isFinite(n)) {
      return res.status(400).json({ error: 'score는 숫자여야 합니다.' });
    }
    score = n;
  }

  const matchedSlotParsed = parseMatchedSlotInput(matchedSlotRaw);
  if (!matchedSlotParsed.ok) {
    return res.status(400).json({ error: matchedSlotParsed.error });
  }
  const matchedSlot = matchedSlotParsed.value;

  let meetingStartsAt = null;
  const msRaw = body.meetingStartsAt ?? body.meeting_starts_at;
  if (msRaw !== undefined && msRaw !== null && String(msRaw).trim() !== '') {
    const d = new Date(String(msRaw));
    if (Number.isNaN(d.getTime())) {
      return res.status(400).json({ error: 'meetingStartsAt는 유효한 ISO-8601 날짜여야 합니다.' });
    }
    meetingStartsAt = d;
  } else if (matchedSlot) {
    meetingStartsAt = kstWallClockToUtc(matchedSlot.date, matchedSlot.hourStart);
  }

  let meetingVenueName = null;
  const venueIn = body.meetingVenueName ?? body.meeting_venue_name;
  if (venueIn !== undefined && venueIn !== null) {
    if (typeof venueIn !== 'string') {
      return res.status(400).json({ error: 'meetingVenueName은 문자열이어야 합니다.' });
    }
    const t = venueIn.trim();
    meetingVenueName = t.length > 0 ? t.slice(0, 200) : null;
  }

  // cafeId가 들어오면 카페 존재 확인. meetingVenueName이 본문에 없으면 카페 이름으로 자동 설정.
  let cafeId = null;
  const cafeIdIn = body.cafeId ?? body.cafe_id;
  if (cafeIdIn !== undefined && cafeIdIn !== null && cafeIdIn !== '') {
    if (typeof cafeIdIn !== 'string' || !isUuid(cafeIdIn)) {
      return res.status(400).json({ error: 'cafeId는 유효한 UUID여야 합니다.' });
    }
    const cafeRow = await prisma.cafe.findUnique({
      where: { id: cafeIdIn },
      select: { id: true, name: true },
    });
    if (!cafeRow) {
      return res.status(404).json({ error: 'cafeId에 해당하는 카페를 찾을 수 없습니다.' });
    }
    cafeId = cafeRow.id;
    if (venueIn === undefined) {
      meetingVenueName = cafeRow.name;
    }
  }

  try {
    const [identA, identB] = await prisma.$transaction([
      prisma.identity.findUnique({
        where: { id: a },
        select: { id: true, blockedAt: true },
      }),
      prisma.identity.findUnique({
        where: { id: b },
        select: { id: true, blockedAt: true },
      }),
    ]);

    if (!identA || !identB) {
      return res.status(404).json({ error: '존재하지 않는 유저가 포함되어 있습니다.' });
    }
    if (identA.blockedAt || identB.blockedAt) {
      return res.status(400).json({ error: '차단된 계정은 강제 매칭할 수 없습니다.' });
    }

    const everMatched = await prisma.matching.findFirst({
      where: {
        OR: [
          { userAId: a, userBId: b },
          { userAId: b, userBId: a },
        ],
      },
      select: { id: true },
    });
    if (everMatched) {
      return res.status(400).json({
        error: '이 두 유저는 과거에 한 번이라도 매칭된 적이 있어 강제 매칭을 할 수 없습니다.',
      });
    }

    const traitsPair = await prisma.trait.findMany({
      where: { id: { in: [a, b] } },
      select: { id: true, gender: true, surveyData: true },
    });
    if (traitsPair.length < 2) {
      return res.status(400).json({
        error: '두 유저 모두 Trait(설문) 레코드가 있어야 강제 매칭할 수 있습니다.',
      });
    }
    const rowA = traitsPair.find((t) => t.id === a);
    const rowB = traitsPair.find((t) => t.id === b);
    if (!rowA || !rowB) {
      return res.status(400).json({
        error: '두 유저 모두 Trait(설문) 레코드가 있어야 강제 매칭할 수 있습니다.',
      });
    }

    const fromTraitA = normalizeTraitGender(rowA.gender);
    const fromTraitB = normalizeTraitGender(rowB.gender);
    const fromBodyA = normalizeTraitGender(genderAIn);
    const fromBodyB = normalizeTraitGender(genderBIn);

    if (fromTraitA && fromBodyA && fromTraitA !== fromBodyA) {
      return res.status(400).json({
        error:
          'genderA(또는 gender_a)가 DB의 Trait.gender와 다릅니다. 확인하거나 본문에서 성별 필드를 생략하세요.',
      });
    }
    if (fromTraitB && fromBodyB && fromTraitB !== fromBodyB) {
      return res.status(400).json({
        error:
          'genderB(또는 gender_b)가 DB의 Trait.gender와 다릅니다. 확인하거나 본문에서 성별 필드를 생략하세요.',
      });
    }

    const finalA = fromTraitA || fromBodyA;
    const finalB = fromTraitB || fromBodyB;
    if (!finalA) {
      return res.status(400).json({
        error:
          '첫 번째 유저(userAId)의 성별이 Trait에 없습니다. 설문을 제출하거나 본문에 genderA(예: male, female, 남성, 여성)를 넣어 주세요.',
      });
    }
    if (!finalB) {
      return res.status(400).json({
        error:
          '두 번째 유저(userBId)의 성별이 Trait에 없습니다. 설문을 제출하거나 본문에 genderB를 넣어 주세요.',
      });
    }
    if (!areOppositeTraitGenders(finalA, finalB)) {
      return res.status(400).json({
        error: '강제 매칭은 남성·여성(이성) 쌍만 허용됩니다. 성별 조합을 확인해 주세요.',
      });
    }

    const periodStart = getMatchingPeriodStart();
    const match = await prisma.$transaction(async (tx) => {
      const patchTraitGender = async (userId, row, g) => {
        const prevSd = row.surveyData;
        const mergedSd =
          prevSd !== null && typeof prevSd === 'object' && !Array.isArray(prevSd)
            ? { ...prevSd, gender: g }
            : undefined;
        await tx.trait.update({
          where: { id: userId },
          data: {
            gender: g,
            ...(mergedSd !== undefined ? { surveyData: mergedSd } : {}),
          },
        });
      };

      const needWriteA = normalizeTraitGender(rowA.gender) !== finalA;
      const needWriteB = normalizeTraitGender(rowB.gender) !== finalB;
      if (needWriteA) await patchTraitGender(a, rowA, finalA);
      if (needWriteB) await patchTraitGender(b, rowB, finalB);

      await deleteMatchingsForUsersInPeriod(tx, periodStart, [a, b]);
      return tx.matching.create({
        data: {
          userAId: a,
          userBId: b,
          score,
          periodStart,
          meetingStartsAt,
          meetingVenueName,
          cafeId,
          ...(matchedSlot
            ? { matchReport: { score: Math.round(score * 100) / 100, reasons: [], matchedSlot } }
            : {}),
        },
      });
    });

    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_FORCE_MATCH',
      resource: `Matching:${match.id}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: {
        userAId: a,
        userBId: b,
        score,
        genderA: finalA,
        genderB: finalB,
        matchedSlot,
        meetingStartsAt: meetingStartsAt ? meetingStartsAt.toISOString() : null,
        meetingVenueName,
        cafeId,
      },
    });

    return res.status(201).json({
      message: '강제 매칭이 등록되었습니다.',
      match: {
        id: match.id,
        userAId: match.userAId,
        userBId: match.userBId,
        score: match.score,
        matchedAt: match.matchedAt,
        genderA: finalA,
        genderB: finalB,
        matchedSlot,
        meetingStartsAt: match.meetingStartsAt ?? null,
        meetingVenueName: match.meetingVenueName ?? null,
        cafeId: match.cafeId ?? null,
        matchReport: match.matchReport ?? null,
      },
      meetChatQrToken: signMeetChatQrToken(match.id),
    });
  } catch (err) {
    console.error('admin POST /matches/force:', err);
    return res.status(500).json({ error: '강제 매칭 저장 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/users/{id}:
 *   get:
 *     tags: [Admin]
 *     summary: 특정 유저 상세 + 설문
 *     security:
 *       - AdminBearerAuth: []
 */
router.get('/users/:id', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ error: '유효한 UUID가 아닙니다.' });
  }

  try {
    const row = await prisma.identity.findUnique({
      where: { id },
      include: {
        trait: true,
        schoolProofSubmissions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            status: true,
            mimeType: true,
            fileSize: true,
            createdAt: true,
            reviewedAt: true,
          },
        },
      },
    });

    if (!row) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    await writeAccessLog({
      actorType: 'admin',
      actorId: null,
      action: 'ADMIN_USER_DETAIL',
      resource: `Identity:${id}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: null,
    });

    return res.status(200).json({
      user: {
        id: row.id,
        nickname: row.nickname ?? null,
        email: row.email,
        emailVerified: Boolean(row.email),
        schoolImageVerified: Boolean(row.schoolProofVerifiedAt),
        schoolProofVerifiedAt: row.schoolProofVerifiedAt,
        studentId: row.studentId,
        birthYear: row.birthYear,
        department: row.department,
        kakaoLinkPin: row.kakaoLinkPin ?? null,
        kakaoLinked: Boolean(row.kakaoId && String(row.kakaoId).trim()),
        blockedAt: row.blockedAt,
        createdAt: row.createdAt,
      },
      schoolProofSubmissions: row.schoolProofSubmissions ?? [],
      trait: row.trait
        ? {
            id: row.trait.id,
            gender: row.trait.gender,
            surveyData: row.trait.surveyData,
            updatedAt: row.trait.updatedAt,
          }
        : null,
    });
  } catch (err) {
    console.error('admin GET /users/:id error:', err);
    return res.status(500).json({ error: '사용자 상세 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/users/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: 유저 삭제 또는 차단
 *     description: |
 *       JSON 본문 `action`: `delete`(기본) — Identity 및 연쇄 삭제(Trait).
 *       `block` — `blockedAt` 설정만(PII·설문 유지, API 이용 불가).
 *     security:
 *       - AdminBearerAuth: []
 */
router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ error: '유효한 UUID가 아닙니다.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const action = String(body.action || 'delete').toLowerCase();
  if (action !== 'delete' && action !== 'block') {
    return res.status(400).json({ error: 'action은 delete 또는 block 이어야 합니다.' });
  }

  try {
    const exists = await prisma.identity.findUnique({
      where: { id },
      select: { id: true, blockedAt: true },
    });
    if (!exists) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    if (action === 'block') {
      const updated = await prisma.identity.update({
        where: { id },
        data: { blockedAt: new Date() },
        select: { id: true, blockedAt: true },
      });

      await writeAccessLog({
        actorType: 'admin',
        actorId: null,
        action: 'ADMIN_USER_BLOCK',
        resource: `Identity:${id}`,
        ip: req.ip || null,
        userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
        metadata: { blockedAt: updated.blockedAt },
      });

      return res.status(200).json({
        message: '사용자가 차단되었습니다.',
        action: 'block',
        user: updated,
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.matching.deleteMany({
        where: {
          OR: [{ userAId: id }, { userBId: id }],
        },
      });
      await tx.identity.delete({ where: { id } });
    });

    await writeAccessLog({
      actorType: 'admin',
      actorId: null,
      action: 'ADMIN_USER_DELETE',
      resource: `Identity:${id}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: null,
    });

    return res.status(200).json({ message: '사용자가 삭제되었습니다.', action: 'delete', id });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    console.error('admin DELETE /users/:id error:', err);
    return res.status(500).json({ error: '사용자 삭제/차단 처리 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/school-proofs:
 *   get:
 *     tags: [Admin]
 *     summary: 학교 증빙 이미지 제출 목록 (기본 status=pending)
 *     description: |
 *       `complete-anonymous-onboarding` 등 설문 전에만 올린 증빙도 동일 `pending` 큐에 포함됩니다.
 *       `userEmail`이 null이면 이메일 미연동(이미지 가입) 유저입니다. `hasSurvey`로 설문 저장 여부를 구분할 수 있습니다.
 *     security:
 *       - AdminBearerAuth: []
 */
router.get('/school-proofs', async (req, res) => {
  const statusRaw = String(req.query.status || 'pending').toLowerCase();
  const allowed = new Set(['pending', 'approved', 'rejected', 'all']);
  if (!allowed.has(statusRaw)) {
    return res.status(400).json({
      error: 'status는 pending, approved, rejected, all 중 하나여야 합니다.',
    });
  }
  const limitRaw = req.query.limit;
  const offsetRaw = req.query.offset;
  const limit = Math.min(Math.max(Number(limitRaw ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(offsetRaw ?? 0) || 0, 0);
  const where = statusRaw === 'all' ? {} : { status: statusRaw };

  try {
    const [total, rows] = await prisma.$transaction([
      prisma.schoolProofSubmission.count({ where }),
      prisma.schoolProofSubmission.findMany({
        where,
        orderBy: { createdAt: statusRaw === 'pending' ? 'asc' : 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          identityId: true,
          status: true,
          mimeType: true,
          fileSize: true,
          createdAt: true,
          reviewedAt: true,
          identity: {
            select: {
              email: true,
              schoolProofVerifiedAt: true,
              imageUuidAccessUntil: true,
              studentId: true,
              department: true,
              trait: { select: { surveyData: true } },
            },
          },
        },
      }),
    ]);

    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_LIST_SCHOOL_PROOFS',
      resource: `GET /api/admin/school-proofs?status=${statusRaw}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { total, returned: rows.length },
    });

    return res.status(200).json({
      total,
      limit,
      offset,
      status: statusRaw,
      submissions: rows.map((r) => {
        const sd = r.identity?.trait?.surveyData;
        const hasSurvey = Boolean(
          sd !== null && sd !== undefined && typeof sd === 'object' && !Array.isArray(sd),
        );
        const until = r.identity?.imageUuidAccessUntil;
        return {
          id: r.id,
          identityId: r.identityId,
          userEmail: r.identity?.email ?? null,
          studentId: r.identity?.studentId ?? null,
          department: r.identity?.department ?? null,
          hasSurvey,
          imageUuidAccessUntil:
            until && !Number.isNaN(new Date(until).getTime()) ? new Date(until).toISOString() : null,
          status: r.status,
          mimeType: r.mimeType,
          fileSize: r.fileSize,
          createdAt: r.createdAt,
          reviewedAt: r.reviewedAt,
          identitySchoolProofVerifiedAt: r.identity?.schoolProofVerifiedAt ?? null,
        };
      }),
    });
  } catch (err) {
    console.error('admin GET /school-proofs error:', err);
    return res.status(500).json({ error: '증빙 목록 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/school-proofs/{id}/file:
 *   get:
 *     tags: [Admin]
 *     summary: 제출 이미지 바이너리 (관리자 전용)
 *     security:
 *       - AdminBearerAuth: []
 */
router.get('/school-proofs/:id/file', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ error: '유효한 UUID가 아닙니다.' });
  }

  try {
    const row = await prisma.schoolProofSubmission.findUnique({
      where: { id },
      select: { id: true, storedPath: true, mimeType: true },
    });
    if (!row) {
      return res.status(404).json({ error: '제출을 찾을 수 없습니다.' });
    }

    const abs = resolveSchoolProofAbsolutePath(row);
    if (!abs) {
      console.warn('admin school-proof file missing', {
        submissionId: row.id,
        storedPath: row.storedPath,
      });
      return res.status(404).json({
        error: '파일이 디스크에 없습니다.',
        submissionId: row.id,
        storedPath: row.storedPath,
        hint:
          '컨테이너 재배포 시 /app/uploads 가 비영구면 파일이 유실됩니다. docker-compose server 볼륨(server_uploads:/app/uploads) 적용 후 재업로드가 필요할 수 있습니다.',
      });
    }

    await writeAccessLog({
      actorType: 'admin',
      actorId: req.admin.adminId,
      action: 'ADMIN_SCHOOL_PROOF_FILE_VIEW',
      resource: `SchoolProofSubmission:${id}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: null,
    });

    res.setHeader('Content-Type', row.mimeType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store');
    const stream = fs.createReadStream(abs);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({ error: '파일 읽기에 실패했습니다.' });
      }
    });
    stream.pipe(res);
  } catch (err) {
    console.error('admin GET /school-proofs/:id/file error:', err);
    return res.status(500).json({ error: '파일 제공 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/school-proofs/{id}/approve:
 *   post:
 *     tags: [Admin]
 *     summary: 증빙 승인 (동일 유저의 다른 pending 제출은 자동 거절, Identity.schoolProofVerifiedAt 설정)
 *     security:
 *       - AdminBearerAuth: []
 */
router.post('/school-proofs/:id/approve', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ error: '유효한 UUID가 아닙니다.' });
  }
  const adminId = req.admin.adminId;
  const now = new Date();

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const sub = await tx.schoolProofSubmission.findUnique({
        where: { id },
        select: { id: true, identityId: true, status: true },
      });
      if (!sub) {
        return { kind: 'not_found' };
      }
      if (sub.status !== 'pending') {
        return { kind: 'not_pending', status: sub.status };
      }

      await tx.schoolProofSubmission.updateMany({
        where: {
          identityId: sub.identityId,
          status: 'pending',
          NOT: { id: sub.id },
        },
        data: {
          status: 'rejected',
          reviewedAt: now,
          reviewerAdminId: adminId,
        },
      });

      await tx.schoolProofSubmission.update({
        where: { id: sub.id },
        data: {
          status: 'approved',
          reviewedAt: now,
          reviewerAdminId: adminId,
        },
      });

      await tx.identity.update({
        where: { id: sub.identityId },
        data: { schoolProofVerifiedAt: now },
      });

      return { kind: 'ok', identityId: sub.identityId };
    });

    if (outcome.kind === 'not_found') {
      return res.status(404).json({ error: '제출을 찾을 수 없습니다.' });
    }
    if (outcome.kind === 'not_pending') {
      return res.status(400).json({ error: `이미 처리된 제출입니다 (${outcome.status}).` });
    }

    await writeAccessLog({
      actorType: 'admin',
      actorId: adminId,
      action: 'ADMIN_SCHOOL_PROOF_APPROVE',
      resource: `SchoolProofSubmission:${id}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { identityId: outcome.identityId },
    });

    return res.status(200).json({
      message: '이미지 인증이 승인되었습니다.',
      submissionId: id,
      identityId: outcome.identityId,
      schoolProofVerifiedAt: now.toISOString(),
    });
  } catch (err) {
    console.error('admin POST /school-proofs/:id/approve error:', err);
    return res.status(500).json({ error: '승인 처리 중 오류가 발생했습니다.' });
  }
});

/**
 * @openapi
 * /api/admin/school-proofs/{id}/reject:
 *   post:
 *     tags: [Admin]
 *     summary: 증빙 거절 (pending 만)
 *     security:
 *       - AdminBearerAuth: []
 */
router.post('/school-proofs/:id/reject', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ error: '유효한 UUID가 아닙니다.' });
  }
  const adminId = req.admin.adminId;
  const now = new Date();

  try {
    const sub = await prisma.schoolProofSubmission.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!sub) {
      return res.status(404).json({ error: '제출을 찾을 수 없습니다.' });
    }
    if (sub.status !== 'pending') {
      return res.status(400).json({ error: `이미 처리된 제출입니다 (${sub.status}).` });
    }

    await prisma.schoolProofSubmission.update({
      where: { id },
      data: {
        status: 'rejected',
        reviewedAt: now,
        reviewerAdminId: adminId,
      },
    });

    await writeAccessLog({
      actorType: 'admin',
      actorId: adminId,
      action: 'ADMIN_SCHOOL_PROOF_REJECT',
      resource: `SchoolProofSubmission:${id}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: null,
    });

    return res.status(200).json({ message: '제출이 거절 처리되었습니다.', submissionId: id });
  } catch (err) {
    console.error('admin POST /school-proofs/:id/reject error:', err);
    return res.status(500).json({ error: '거절 처리 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
