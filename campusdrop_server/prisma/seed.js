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

/** 설문 — 유저 1·2: 거의 동일한 성향(아침형·정리·외향적 쪽으로 맞춤) */
const surveySimilarPair = () => ({
  energy: 2,
  sleep_habit: 3,
  morning_night: 1,
  cleanliness: 1,
  spending_style: 2,
  meal_style: 3,
  smoking: '비흡연',
  drinking_freq: '가끔',
  exercise: 3,
  caffeine: 3,
  screen_time: 3,
  social_battery: 4,
  humor_importance: 5,
  conflict_style: '바로 솔직하게 풀고 싶어요',
  text_call_pref: '상황에 따라 달라요',
  reply_speed: 5,
  religion_type: '없음',
  religion_intensity: null,
  politics_importance: 3,
  family_plan_view: 3,
  meet_frequency: 4,
  date_cost_split: 3,
  commitment: 4,
  public_affection: 4,
  alone_time_need: 2,
  campus_date: 3,
  study_together: 4,
  age_gap: 3,
  feedback_opt_in: '예',
  availability: SAMPLE_AVAILABILITY,
  gender: 'male',
});

const surveyHardFilterA = () => ({
  energy: 5,
  sleep_habit: 2,
  morning_night: 5,
  cleanliness: 5,
  spending_style: 5,
  meal_style: 4,
  smoking: '흡연',
  drinking_freq: '자주',
  exercise: 5,
  caffeine: 4,
  screen_time: 5,
  social_battery: 5,
  humor_importance: 2,
  conflict_style: '갈등은 피하고 기분이 풀리면 이야기해요',
  text_call_pref: '긴 통화도 좋아요',
  reply_speed: 3,
  religion_type: '기독교',
  religion_intensity: 5,
  politics_importance: 5,
  family_plan_view: 5,
  meet_frequency: 5,
  date_cost_split: 5,
  commitment: 5,
  public_affection: 5,
  alone_time_need: 5,
  campus_date: 5,
  study_together: 5,
  age_gap: 5,
  feedback_opt_in: '예',
  availability: SAMPLE_AVAILABILITY,
  gender: 'male',
});

const surveyHardFilterB = () => ({
  energy: 1,
  sleep_habit: 4,
  morning_night: 1,
  cleanliness: 1,
  spending_style: 1,
  meal_style: 2,
  smoking: '비흡연',
  drinking_freq: '전혀 안 함',
  exercise: 1,
  caffeine: 1,
  screen_time: 1,
  social_battery: 1,
  humor_importance: 5,
  conflict_style: '바로 솔직하게 풀고 싶어요',
  text_call_pref: '문자가 더 편해요',
  reply_speed: 5,
  religion_type: '없음',
  religion_intensity: null,
  politics_importance: 1,
  family_plan_view: 1,
  meet_frequency: 1,
  date_cost_split: 1,
  commitment: 1,
  public_affection: 1,
  alone_time_need: 1,
  campus_date: 1,
  study_together: 1,
  age_gap: 1,
  feedback_opt_in: '아니오',
  availability: SAMPLE_AVAILABILITY,
  gender: 'female',
});

const surveyRandomMix = () => ({
  energy: 4,
  sleep_habit: 2,
  morning_night: 3,
  cleanliness: 4,
  spending_style: 5,
  meal_style: 3,
  smoking: '전자담배만',
  drinking_freq: '월 1회',
  exercise: 3,
  caffeine: 4,
  screen_time: 3,
  social_battery: 3,
  humor_importance: 3,
  conflict_style: '상대 흐름에 맞추는 편이에요',
  text_call_pref: '짧은 통화도 괜찮아요',
  reply_speed: 4,
  religion_type: '불교',
  religion_intensity: 3,
  politics_importance: 2,
  family_plan_view: 4,
  meet_frequency: 2,
  date_cost_split: 4,
  commitment: 2,
  public_affection: 2,
  alone_time_need: 4,
  campus_date: 1,
  study_together: 2,
  age_gap: 3,
  feedback_opt_in: '예',
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
      public_affection: 3,
      commitment: 4,
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
