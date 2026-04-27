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

const P1 = {
  meeting_tension: 3,
  weekend_activity: 3,
  lifestyle_pattern: 3,
  fashion_interest: 3,
  hobby_type: 3,
  drinking_preference: 3,
  smoking_status: 'NON_SMOKER',
  tattoo_status: 'NO_TATTOO',
};
const P2 = {
  contact_frequency: 3,
  meeting_frequency: 3,
  date_planning: 3,
  verbal_affection: 3,
  dating_cost: 3,
};
const P3 = {
  opposite_sex_friends: 3,
  jealousy_level: 3,
  intimacy_speed: 3,
  intimacy_openness: 3,
  drinking_on_date: 'ANY',
};
const P4 = {
  political_view: 3,
  faith_depth: 3,
  marriage_view: 3,
  relationship_seriousness: 3,
  work_value: 3,
  spending_habit: 3,
  religion: 'NONE',
};
const P5 = {
  conflict_resolution: 3,
  empathy_level: 3,
  expressing_discomfort: 3,
  reliance_level: 3,
  self_management: 3,
};
const P6 = {
  campus_couple_openness: 3,
  partner_age_preference: ['OLDER', 'SAME_AGE', 'YOUNGER'],
  partner_smoking_tolerance: 3,
  partner_tattoo_tolerance: 3,
  partner_religion_tolerance: 3,
};

/**
 * @param {object} o
 * @param {Partial<typeof P1>} [o.phase1]
 * @param {Partial<typeof P2>} [o.phase2]
 * @param {Partial<typeof P3>} [o.phase3]
 * @param {Partial<typeof P4>} [o.phase4]
 * @param {Partial<typeof P5>} [o.phase5]
 * @param {Partial<typeof P6>} [o.phase6]
 * @param {string} [o.gender]
 */
function surveyV3(o = {}) {
  return {
    surveyAnswers: {
      phase1_lifestyle: { ...P1, ...(o.phase1 || {}) },
      phase2_relationship_views: { ...P2, ...(o.phase2 || {}) },
      phase3_opposite_sex_and_intimacy: { ...P3, ...(o.phase3 || {}) },
      phase4_beliefs_and_values: { ...P4, ...(o.phase4 || {}) },
      phase5_emotion_and_conflict: { ...P5, ...(o.phase5 || {}) },
      phase6_partner_preferences: { ...P6, ...(o.phase6 || {}) },
    },
    gender: o.gender ?? 'male',
    availability: o.availability ?? SAMPLE_AVAILABILITY,
  };
}

/** 설문 — 유저 1·2: 거의 동일한 성향(연락·만남·몰입 쪽으로 맞춤) */
const surveySimilarPair = () =>
  surveyV3({
    phase1: { meeting_tension: 2, lifestyle_pattern: 1, drinking_preference: 3 },
    phase2: { contact_frequency: 4, meeting_frequency: 4, verbal_affection: 4, dating_cost: 3 },
    phase3: { jealousy_level: 2, intimacy_speed: 4, intimacy_openness: 4 },
    phase4: { relationship_seriousness: 4, work_value: 4, religion: 'NONE' },
    phase5: { empathy_level: 5, conflict_resolution: 5 },
    phase6: { campus_couple_openness: 3 },
  });

const surveyHardFilterA = () =>
  surveyV3({
    gender: 'male',
    phase1: {
      meeting_tension: 5,
      weekend_activity: 5,
      lifestyle_pattern: 5,
      fashion_interest: 5,
      hobby_type: 4,
      drinking_preference: 5,
      smoking_status: 'SMOKER',
      tattoo_status: 'NO_TATTOO',
    },
    phase2: {
      contact_frequency: 5,
      meeting_frequency: 5,
      date_planning: 5,
      verbal_affection: 5,
      dating_cost: 5,
    },
    phase3: {
      opposite_sex_friends: 5,
      jealousy_level: 5,
      intimacy_speed: 5,
      intimacy_openness: 5,
      drinking_on_date: 'DRINK',
    },
    phase4: {
      political_view: 5,
      faith_depth: 5,
      marriage_view: 5,
      relationship_seriousness: 5,
      work_value: 5,
      spending_habit: 5,
      religion: 'PROTESTANT',
    },
    phase5: {
      conflict_resolution: 1,
      empathy_level: 2,
      expressing_discomfort: 3,
      reliance_level: 3,
      self_management: 5,
    },
    phase6: {
      campus_couple_openness: 5,
      partner_smoking_tolerance: 1,
      partner_tattoo_tolerance: 3,
      partner_religion_tolerance: 3,
    },
  });

const surveyHardFilterB = () =>
  surveyV3({
    gender: 'female',
    phase1: {
      meeting_tension: 1,
      weekend_activity: 1,
      lifestyle_pattern: 1,
      fashion_interest: 1,
      hobby_type: 2,
      drinking_preference: 1,
      smoking_status: 'NON_SMOKER',
      tattoo_status: 'NO_TATTOO',
    },
    phase2: {
      contact_frequency: 1,
      meeting_frequency: 1,
      date_planning: 1,
      verbal_affection: 1,
      dating_cost: 1,
    },
    phase3: {
      opposite_sex_friends: 1,
      jealousy_level: 1,
      intimacy_speed: 1,
      intimacy_openness: 1,
      drinking_on_date: 'NO_DRINK',
    },
    phase4: {
      political_view: 1,
      faith_depth: 3,
      marriage_view: 1,
      relationship_seriousness: 1,
      work_value: 1,
      spending_habit: 1,
      religion: 'NONE',
    },
    phase5: {
      conflict_resolution: 5,
      empathy_level: 5,
      expressing_discomfort: 5,
      reliance_level: 5,
      self_management: 1,
    },
    phase6: {
      campus_couple_openness: 1,
      partner_smoking_tolerance: 3,
      partner_tattoo_tolerance: 3,
      partner_religion_tolerance: 3,
    },
  });

const surveyRandomMix = () =>
  surveyV3({
    gender: 'male',
    phase1: {
      meeting_tension: 4,
      weekend_activity: 3,
      lifestyle_pattern: 3,
      fashion_interest: 5,
      hobby_type: 3,
      drinking_preference: 2,
      smoking_status: 'SMOKER',
      tattoo_status: 'NO_TATTOO',
    },
    phase2: {
      contact_frequency: 3,
      meeting_frequency: 2,
      date_planning: 4,
      verbal_affection: 2,
      dating_cost: 4,
    },
    phase3: {
      opposite_sex_friends: 3,
      jealousy_level: 4,
      intimacy_speed: 2,
      intimacy_openness: 2,
      drinking_on_date: 'ANY',
    },
    phase4: {
      political_view: 2,
      faith_depth: 3,
      marriage_view: 4,
      relationship_seriousness: 2,
      work_value: 2,
      spending_habit: 5,
      religion: 'BUDDHIST',
    },
    phase5: {
      conflict_resolution: 3,
      empathy_level: 3,
      expressing_discomfort: 4,
      reliance_level: 4,
      self_management: 3,
    },
    phase6: {
      campus_couple_openness: 1,
      partner_smoking_tolerance: 3,
      partner_tattoo_tolerance: 3,
      partner_religion_tolerance: 3,
    },
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
    surveyData: validatedSurvey(
      surveyV3({
        gender: 'female',
        phase1: { meeting_tension: 2, lifestyle_pattern: 1, drinking_preference: 3 },
        phase2: { contact_frequency: 4, meeting_frequency: 4, verbal_affection: 3, dating_cost: 3 },
        phase3: { jealousy_level: 2, intimacy_speed: 4, intimacy_openness: 4 },
        phase4: { relationship_seriousness: 4, work_value: 4, religion: 'NONE' },
        phase5: { empathy_level: 5, conflict_resolution: 5 },
        phase6: { campus_couple_openness: 3 },
      }),
    ),
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
