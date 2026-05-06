#!/usr/bin/env node
/**
 * 매칭(Python)·이메일 인증 없이 Node API만 점검합니다.
 *
 * 사전 조건
 * 1) PostgreSQL + Redis 가동, 루트 또는 campusdrop_server 의 .env 에 DATABASE_URL, REDIS_URL 설정
 * 2) MATCHING_SERVICE_URL 은 미설정이어도 됨(이 스크립트는 /api/match 를 호출하지 않음)
 * 3) 다른 터미널에서 API 서버 기동:
 *    cd campusdrop_server && npm start
 *
 * 실행 (서버 기본 http://127.0.0.1:3000):
 *    cd campusdrop_server && npm run smoke
 *    SMOKE_BASE_URL=http://127.0.0.1:3001 npm run smoke
 */

const path = require('path');
const { PrismaClient } = require('@prisma/client');

const serverRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.resolve(serverRoot, '..', '.env') });
require('dotenv').config({ path: path.resolve(serverRoot, '.env'), override: true });

const { normalizeEmail } = require('../lib/sjuEmail');
const { getDummyMatchUsers } = require('../lib/matchDummyUsers');

const BASE = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const SMOKE_UUID = '00000000-0000-4000-8000-00000000dead';
const SMOKE_EMAIL = '123@sju.ac.kr';

function log(step, msg, extra) {
  const line = `[smoke] ${step} ${msg}`;
  if (extra !== undefined) console.log(line, extra);
  else console.log(line);
}

async function fetchJson(method, pathname, { headers = {}, body } = {}) {
  const url = `${BASE}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  const h = { ...headers };
  if (body !== undefined && !h['Content-Type'] && !h['content-type']) {
    h['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { method, headers: h, body });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { _parseError: true, _raw: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function ensureSmokeIdentity(prisma) {
  await prisma.identity.deleteMany({ where: { id: SMOKE_UUID } });
  await prisma.identity.create({
    data: {
      id: SMOKE_UUID,
      email: normalizeEmail(SMOKE_EMAIL),
      privacyPolicyAgreed: true,
      trait: { create: {} },
    },
  });
  log('db', `테스트 Identity 생성 완료 (${SMOKE_UUID})`);
}

async function main() {
  log('0', `BASE = ${BASE}`);

  const prisma = new PrismaClient();
  try {
    const health = await fetchJson('GET', '/');
    assert(health.status === 200, `GET / 기대 200, 실제 ${health.status}`);
    assert(health.json && health.json.status === 'Online', 'GET / 응답에 status: Online 기대');
    log('1', 'GET / OK', health.json);

    await ensureSmokeIdentity(prisma);

    const surveyData = getDummyMatchUsers()[0].surveyData;
    const surveyRes = await fetchJson('POST', '/api/survey/submit', {
      headers: { 'x-user-uuid': SMOKE_UUID },
      body: JSON.stringify({ surveyData }),
    });
    assert(surveyRes.status === 200, `설문 저장 기대 200, 실제 ${surveyRes.status}: ${JSON.stringify(surveyRes.json)}`);
    const pin = surveyRes.json && String(surveyRes.json.pin);
    assert(/^\d{4}$/.test(pin), `설문 응답 PIN 4자리 기대, 실제 ${JSON.stringify(surveyRes.json)}`);
    log('2', 'POST /api/survey/submit OK', surveyRes.json);

    const pinRes = await fetchJson('GET', '/api/auth/pin', {
      headers: { 'x-user-uuid': SMOKE_UUID },
    });
    assert(pinRes.status === 200, `GET /api/auth/pin 기대 200, 실제 ${pinRes.status}: ${JSON.stringify(pinRes.json)}`);
    log('3', 'GET /api/auth/pin OK (설문과 별도 재발급 가능)', pinRes.json);

    const kakaoBody = {
      userRequest: {
        user: { id: 'smoke-kakao-user-1' },
        utterance: `인증번호는 ${pin} 입니다`,
      },
    };
    const kakaoRes = await fetchJson('POST', '/api/kakao/webhook', {
      body: JSON.stringify(kakaoBody),
    });
    assert(kakaoRes.status === 200, `카카오 웹훅 기대 200, 실제 ${kakaoRes.status}`);
    const tpl = kakaoRes.json && kakaoRes.json.template;
    const textOut = tpl && tpl.outputs && tpl.outputs[0] && tpl.outputs[0].simpleText && tpl.outputs[0].simpleText.text;
    assert(typeof textOut === 'string' && textOut.length > 0, `스킬 응답 텍스트 없음: ${JSON.stringify(kakaoRes.json)}`);
    assert(textOut.includes('연동'), `연동 성공 문구 기대, 실제: ${textOut}`);
    log('4', 'POST /api/kakao/webhook OK', { text: textOut });

    const after = await prisma.identity.findUnique({
      where: { id: SMOKE_UUID },
      select: { kakaoId: true },
    });
    assert(after && after.kakaoId === 'smoke-kakao-user-1', `kakaoId 저장 확인 실패: ${JSON.stringify(after)}`);
    log('5', 'DB kakaoId 반영 확인 OK');

    const docsRes = await fetch(`${BASE}/api-docs/`);
    const html = await docsRes.text();
    assert(docsRes.status === 200, `Swagger UI 기대 200, 실제 ${docsRes.status}`);
    assert(html.length > 500, 'Swagger HTML 이 비정상적으로 짧습니다.');
    log('6', 'GET /api-docs/ OK', { htmlLength: html.length });

    console.log('\n[smoke] 전부 통과했습니다. (이메일 인증·/api/match 는 제외)');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  const msg = e && (e.message || String(e));
  const refused =
    e &&
    (e.cause?.code === 'ECONNREFUSED' ||
      e.code === 'ECONNREFUSED' ||
      /fetch failed|ECONNREFUSED/i.test(String(msg)));
  if (refused) {
    console.error('[smoke] API에 연결할 수 없습니다. `campusdrop_server`에서 `npm start` 한 뒤 다시 실행하세요.');
  } else {
    console.error('[smoke] 실패:', msg);
  }
  process.exit(1);
});
