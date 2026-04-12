require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const { normalizeEmail } = require('../lib/sjuEmail');
const { hashEmailForStorage } = require('../lib/identityAuth');

const prisma = new PrismaClient();

/** 설문 32항 — 유저 1·2: 거의 동일한 성향(아침형·계획·외향적 쪽으로 맞춤) */
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
});

/** `plainEmailForHash`는 시드 스크립트에서만 해시용으로 쓰이며 DB에는 저장되지 않습니다. */
const SEED_IDENTITIES = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    plainEmailForHash: 'seed-match-01@sju.ac.kr',
    mbti: 'INTJ',
    gender: null,
    surveyData: surveySimilarPair(),
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    plainEmailForHash: 'seed-match-02@sju.ac.kr',
    mbti: 'ENFP',
    gender: null,
    surveyData: {
      ...surveySimilarPair(),
      affection: 3,
      trust: 4,
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    plainEmailForHash: 'seed-hardfilter-03@sju.ac.kr',
    mbti: 'ESTP',
    gender: null,
    surveyData: surveyHardFilterA(),
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    plainEmailForHash: 'seed-hardfilter-04@sju.ac.kr',
    mbti: 'ISFJ',
    gender: null,
    surveyData: surveyHardFilterB(),
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    plainEmailForHash: 'seed-random-05@sju.ac.kr',
    mbti: 'INFP',
    gender: null,
    surveyData: surveyRandomMix(),
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
        emailHash,
        trait: {
          create: {
            mbti: row.mbti,
            gender: row.gender,
            surveyData: row.surveyData,
          },
        },
      },
    });
  }

  console.log(`Seed 완료: Identity(+Trait) ${SEED_IDENTITIES.length}건`);
  console.log(ids.join('\n'));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
