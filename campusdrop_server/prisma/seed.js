const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), override: true });

const { PrismaClient } = require('@prisma/client');
const { normalizeEmail } = require('../lib/sjuEmail');
const { hashEmailForStorage } = require('../lib/identityAuth');
const { hashAdminPassword } = require('../lib/adminDbAuth');
const { validateSurveyPayload } = require('../lib/surveyValidation');

/** @param {Record<string, unknown>} raw */
function validatedSurvey(raw) {
  const v = validateSurveyPayload(raw);
  if (!v.ok) {
    throw new Error(`Seed 설문 검증 실패: ${v.error}`);
  }
  return v.data;
}

const prisma = new PrismaClient();

const SAMPLE_AVAILABILITY = [
  { date: '2026-04-20', time_slot: '11:00-12:00' },
  { date: '2026-04-20', time_slot: '14:00-15:00' },
  { date: '2026-04-21', time_slot: '10:00-11:00' },
];

/** 설문 — 유저 1·2: 거의 동일한 성향(아침형·계획·외향적 쪽으로 맞춤) */
const surveySimilarPair = () => ({
  energy: 2,
  weekend: 3,
  pattern: 1,
  trend: 2,
  alcohol: '가끔',
  smoking: '비흡연',
  tattoo: '없음',
  contact: 4,
  meeting: 4,
  planning: 1,
  affection: 4,
  date_expense: 3,
  friends: 4,
  jealousy: 2,
  skinship_speed: 2,
  skinship_limit: '단계적으로',
  date_drinking: 2,
  politics: 3,
  religion_type: '없음',
  religion_intensity: null,
  marriage_view: 3,
  meeting_seriousness: 4,
  job_view: 4,
  spending: 3,
  conflict: 2,
  empathy: 5,
  honesty: 5,
  trust: 5,
  pref_cc: '비슷하면 좋음',
  pref_smoking: '비흡연',
  pref_tattoo: '선호',
  pref_religion: '비슷하면 좋음',
  self_care_habit: '상황에 따라 다름, 컨디션이 좋을 때는 집중 관리하고 바쁠 때는 쉬어감',
  religion_acceptance: '종교 상관없으나 권유는 사절',
  availability: SAMPLE_AVAILABILITY,
  gender: 'male',
});

const surveyHardFilterA = () => ({
  energy: 5,
  weekend: 5,
  pattern: 5,
  trend: 5,
  alcohol: '자주',
  smoking: '흡연',
  tattoo: '있음',
  contact: 5,
  meeting: 5,
  planning: 5,
  affection: 5,
  date_expense: 5,
  friends: 5,
  jealousy: 5,
  skinship_speed: 5,
  skinship_limit: '빠르게',
  date_drinking: 5,
  politics: 5,
  religion_type: '기독교',
  religion_intensity: 5,
  marriage_view: 5,
  meeting_seriousness: 5,
  job_view: 5,
  spending: 5,
  conflict: 1,
  empathy: 2,
  honesty: 3,
  trust: 3,
  pref_cc: '매우 잦게',
  pref_smoking: '비흡연만',
  pref_tattoo: '없음만',
  pref_religion: '무교만',
  self_care_habit:
    '자기관리 중심, 운동과 식단이 일상의 최우선이며 완벽한 자기통제를 선호',
  religion_acceptance: '무조건 무교인 사람만 선호',
  availability: SAMPLE_AVAILABILITY,
  gender: 'male',
});

const surveyHardFilterB = () => ({
  energy: 1,
  weekend: 1,
  pattern: 1,
  trend: 1,
  alcohol: '전혀 안 함',
  smoking: '비흡연',
  tattoo: '없음',
  contact: 1,
  meeting: 1,
  planning: 1,
  affection: 1,
  date_expense: 1,
  friends: 1,
  jealousy: 1,
  skinship_speed: 1,
  skinship_limit: '매우 천천히',
  date_drinking: 1,
  politics: 1,
  religion_type: '없음',
  religion_intensity: null,
  marriage_view: 1,
  meeting_seriousness: 1,
  job_view: 1,
  spending: 1,
  conflict: 5,
  empathy: 5,
  honesty: 5,
  trust: 5,
  pref_cc: '최소한으로',
  pref_smoking: '흡연만',
  pref_tattoo: '있음만',
  pref_religion: '종교 있음만',
  self_care_habit:
    '자유로운 생활 선호, 규칙적인 관리보다는 현재의 편안함과 여유를 즐김',
  religion_acceptance: '같은 종교와 깊은 신앙심 희망',
  availability: SAMPLE_AVAILABILITY,
  gender: 'female',
});

const surveyRandomMix = () => ({
  energy: 4,
  weekend: 1,
  pattern: 3,
  trend: 5,
  alcohol: '월 1회',
  smoking: '전자담배만',
  tattoo: '작은 것만',
  contact: 3,
  meeting: 2,
  planning: 4,
  affection: 2,
  date_expense: 4,
  friends: 3,
  jealousy: 4,
  skinship_speed: 3,
  skinship_limit: '상의 후',
  date_drinking: 2,
  politics: 2,
  religion_type: '불교',
  religion_intensity: 3,
  marriage_view: 4,
  meeting_seriousness: 2,
  job_view: 2,
  spending: 5,
  conflict: 3,
  empathy: 3,
  honesty: 4,
  trust: 2,
  pref_cc: '상대에 맞춤',
  pref_smoking: '상관없음',
  pref_tattoo: '상관없음',
  pref_religion: '상관없음',
  self_care_habit: '자기관리 철저, 주 3회 이상 꾸준한 운동과 규칙적인 생활 루틴을 유지함',
  religion_acceptance: '상대 신념 존중 및 가끔 동행',
  availability: SAMPLE_AVAILABILITY,
  gender: 'male',
});

/** `plainEmailForHash` → 정규화 후 `Identity.email`·`emailHash`에 반영. */
const SEED_IDENTITIES = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    plainEmailForHash: '1@sju.ac.kr',
    gender: 'male',
    surveyData: validatedSurvey(surveySimilarPair()),
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    plainEmailForHash: '2@sju.ac.kr',
    gender: 'female',
    surveyData: validatedSurvey({
      ...surveySimilarPair(),
      affection: 3,
      trust: 4,
      gender: 'female',
    }),
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    plainEmailForHash: '3@sju.ac.kr',
    gender: 'male',
    surveyData: validatedSurvey(surveyHardFilterA()),
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    plainEmailForHash: '4@sju.ac.kr',
    gender: 'female',
    surveyData: validatedSurvey(surveyHardFilterB()),
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    plainEmailForHash: '5@sju.ac.kr',
    gender: 'male',
    surveyData: validatedSurvey(surveyRandomMix()),
  },
];

async function main() {
  const ids = SEED_IDENTITIES.map((r) => r.id);

  await prisma.identity.deleteMany({
    where: { id: { in: ids } },
  });

  for (const row of SEED_IDENTITIES) {
    const normalized = normalizeEmail(row.plainEmailForHash);
    const emailHash = await hashEmailForStorage(normalized);
    await prisma.identity.create({
      data: {
        id: row.id,
        email: normalized,
        emailHash,
        privacyPolicyAgreed: true,
        trait: {
          create: {
            gender: row.gender,
            surveyData: row.surveyData,
          },
        },
      },
    });
  }

  console.log(`Seed 완료: Identity(+Trait) ${SEED_IDENTITIES.length}건`);
  console.log(ids.join('\n'));

  const seedAdminEmail = String(process.env.ADMIN_EMAIL || '').trim();
  const seedAdminPassword = String(process.env.ADMIN_PASSWORD || '').trim();
  if (seedAdminEmail && seedAdminPassword) {
    const adminEmail = normalizeEmail(seedAdminEmail);
    const passwordHash = await hashAdminPassword(seedAdminPassword);
    await prisma.admin.upsert({
      where: { email: adminEmail },
      create: { email: adminEmail, passwordHash },
      update: { passwordHash },
    });
    console.log(`Seed: 관리자 계정 upsert 완료 (${adminEmail})`);
  } else {
    console.log('Seed: ADMIN_EMAIL·ADMIN_PASSWORD 없음 — Admin 테이블 스킵');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
