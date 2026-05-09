const { prisma } = require('./prisma');

const adjectives = [
  '부지런한', '게으른', '엉뚱한', '소심한', '용감한', '똑똑한', '명랑한', '까칠한', '다정한', '시크한',
  '행복한', '신난', '우울한', '심심한', '화가난', '깜짝놀란', '수줍은', '장난스러운', '호기심많은', '씩씩한',
  '느긋한', '재빠른', '멍한', '활기찬', '조용한', '시끄러운', '새침한', '듬직한', '앙증맞은', '매력적인',
  '우당탕탕', '반항적인', '느릿느릿한', '폴짝뛰는', '사뿐사뿐한', '의기양양한', '당황한', '평온한', '설레는', '짜릿한',
  '포동포동한', '통통한', '날쌘', '느릿한', '졸린', '배고픈', '반짝이는', '꼬질꼬질한', '푹신한', '귀여운',
  '노란', '까만', '황금빛', '줄무늬', '솜털보송한', '맑은', '투명한', '화려한', '조그만', '커다란',
  '뚱뚱한', '홀쭉한', '동그란', '길쭉한', '은은한', '짙은', '눈부신', '화사한', '상큼한', '촉촉한',
  '달콤한', '향기로운', '끈적한', '달달한', '꿀맛나는', '새콤달콤한', '달착지근한', '고소한', '진득한', '부드러운',
  '윙윙대는', '바쁘게움직이는', '춤추는', '길잃은', '바람타는', '하늘나는', '꿀빠는', '꽃찾는', '집지키는', '정찰하는',
  '낮잠자는', '꿈꾸는', '헤매는', '여행하는', '봄날의', '아침의', '햇살받은', '꽃향기나는', '이슬맺힌', '숲속의',
];

const bioNouns = [
  '꿀벌', '일벌', '여왕벌', '수벌', '호박벌', '땅벌', '말벌', '장수말벌', '쌍살벌', '가위벌',
  '목수벌', '꽃벌', '잎벌', '청벌', '뒤영벌', '꼬마벌', '병정벌', '정찰벌', '유모벌', '아기벌',
  '나비', '호랑나비', '흰나비', '무당벌레', '반딧불이', '풍뎅이', '장수풍뎅이', '사슴벌레', '하늘소', '딱정벌레',
  '잠자리', '물잠자리', '개미', '일개미', '여왕개미', '메뚜기', '여치', '귀뚜라미', '사마귀', '매미',
  '쿼카', '미어캣', '친칠라', '하늘다람쥐', '슈가글라이더', '카피바라', '페럿', '북극여우', '수리부엉이', '물총새',
  '곰', '반달곰', '불곰', '북극곰', '아기곰', '오소리', '벌꿀오소리', '벌새', '다람쥐', '청설모',
  '토끼', '산토끼', '여우', '붉은여우', '사막여우', '사슴', '아기사슴', '고라니', '너구리', '레서판다',
  '수달', '해달', '고양이', '강아지', '병아리', '오리', '참새', '뱁새', '까치', '올빼미',
  '부엉이', '펭귄', '물개', '돌고래', '고래', '거북이', '고슴도치', '햄스터', '알파카', '기린',
  '코끼리', '호랑이', '사자', '표범', '치타', '원숭이', '코알라', '캥거루', '판다', '꿀돼지',
];

const DEFAULT_MAX_RETRY = 5;
const DEFAULT_FORCE_SUFFIX_RETRY = 30;

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildRandomNickname() {
  return `${pickRandom(adjectives)} ${pickRandom(bioNouns)}`;
}

/**
 * 기존 "형용사명사" / "형용사명사#1234" 형태의 닉네임에 띄어쓰기를 끼워 넣는다.
 * - 형용사 사전과 prefix-longest-match로 경계를 찾음.
 * - `#1234` suffix가 있으면 보존.
 * - 매칭 실패(사용자 임의 닉네임 등)는 null 반환 → 호출부가 그대로 두거나 재발급 결정.
 *
 * @param {string} nickname
 * @returns {string | null}
 */
function insertSpaceIntoLegacyNickname(nickname) {
  if (typeof nickname !== 'string') {
    return null;
  }
  const trimmed = nickname.trim();
  if (trimmed === '' || trimmed.includes(' ')) {
    return null;
  }
  const hashIdx = trimmed.indexOf('#');
  const head = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;
  const tail = hashIdx >= 0 ? trimmed.slice(hashIdx) : '';

  const sortedByLenDesc = [...adjectives].sort((a, b) => b.length - a.length);
  for (const adj of sortedByLenDesc) {
    if (adj.length > 0 && head.length > adj.length && head.startsWith(adj)) {
      return `${adj} ${head.slice(adj.length)}${tail}`;
    }
  }
  return null;
}

function random4Digits() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

function isNicknameUniqueViolation(err) {
  if (!err || err.code !== 'P2002') {
    return false;
  }
  if (!Array.isArray(err.meta?.target)) {
    return false;
  }
  return err.meta.target.includes('nickname');
}

/**
 * DB 중복을 확인하며 고유 닉네임을 생성한다.
 * - reservedNicknames: 같은 작업 단위(요청/마이그레이션) 내부에서 중복을 미리 차단하기 위한 메모리 락.
 * - maxRetry 초과 시 #1234 suffix를 붙여 공간을 확장해 고유성을 강제한다.
 */
async function generateUniqueNickname({
  prismaClient = prisma,
  reservedNicknames = new Set(),
  maxRetry = DEFAULT_MAX_RETRY,
} = {}) {
  let tryCount = 0;

  while (tryCount < maxRetry) {
    tryCount += 1;
    const candidate = buildRandomNickname();
    if (reservedNicknames.has(candidate)) {
      continue;
    }

    const exists = await prismaClient.identity.findUnique({
      where: { nickname: candidate },
      select: { id: true },
    });
    if (!exists) {
      reservedNicknames.add(candidate);
      return candidate;
    }
  }

  for (let i = 0; i < DEFAULT_FORCE_SUFFIX_RETRY; i += 1) {
    const forced = `${buildRandomNickname()}#${random4Digits()}`;
    if (reservedNicknames.has(forced)) {
      continue;
    }
    const exists = await prismaClient.identity.findUnique({
      where: { nickname: forced },
      select: { id: true },
    });
    if (!exists) {
      reservedNicknames.add(forced);
      return forced;
    }
  }

  throw new Error('고유 닉네임 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.');
}

async function assignNicknameWithRetry(tx, identityId, reservedNicknames, maxAssignRetry = 5) {
  let tries = 0;
  while (tries < maxAssignRetry) {
    tries += 1;
    const nickname = await generateUniqueNickname({
      prismaClient: tx,
      reservedNicknames,
    });
    try {
      await tx.identity.update({
        where: { id: identityId },
        data: { nickname },
      });
      return nickname;
    } catch (err) {
      if (!isNicknameUniqueViolation(err)) {
        throw err;
      }
      reservedNicknames.delete(nickname);
    }
  }
  throw new Error(`identity(${identityId}) 닉네임 업데이트 재시도 초과`);
}

/**
 * 기존 유저 닉네임 마이그레이션.
 * - 닉네임 없는 유저(또는 legacy 기본값)를 배치로 읽어온다.
 * - 각 배치를 트랜잭션으로 처리해 부분 실패를 줄인다.
 * - reservedNicknames Set으로 마이그레이션 진행 중 충돌을 선제 차단한다.
 */
async function migrateExistingUsersNicknames({
  prismaClient = prisma,
  batchSize = 100,
  legacyDefaultNicknames = [],
} = {}) {
  const existing = await prismaClient.identity.findMany({
    where: { NOT: { nickname: null } },
    select: { nickname: true },
  });
  const reservedNicknames = new Set(
    existing
      .map((row) => (row.nickname || '').trim())
      .filter(Boolean),
  );

  let migratedCount = 0;

  for (;;) {
    const targets = await prismaClient.identity.findMany({
      where: {
        OR: [
          { nickname: null },
          { nickname: '' },
          ...(legacyDefaultNicknames.length > 0
            ? [{ nickname: { in: legacyDefaultNicknames } }]
            : []),
        ],
      },
      select: { id: true },
      take: batchSize,
      orderBy: { createdAt: 'asc' },
    });

    if (targets.length === 0) {
      break;
    }

    await prismaClient.$transaction(async (tx) => {
      for (const user of targets) {
        await assignNicknameWithRetry(tx, user.id, reservedNicknames);
      }
    });

    migratedCount += targets.length;
  }

  return { migratedCount };
}

/**
 * 신규 가입 서비스 레이어 예시.
 * - 트랜잭션 내부에서 닉네임을 생성하고 insert 한다.
 * - 동시 가입으로 유니크 충돌(P2002 nickname)이 나면 재시도한다.
 */
async function registerNewUser(createData, { prismaClient = prisma, maxRetry = 5 } = {}) {
  const reservedNicknames = new Set();

  let tries = 0;
  while (tries < maxRetry) {
    tries += 1;
    try {
      return await prismaClient.$transaction(async (tx) => {
        const nickname = await generateUniqueNickname({
          prismaClient: tx,
          reservedNicknames,
        });
        return tx.identity.create({
          data: {
            ...createData,
            nickname,
          },
        });
      });
    } catch (err) {
      if (!isNicknameUniqueViolation(err)) {
        throw err;
      }
    }
  }

  throw new Error('신규 가입 닉네임 생성 재시도 횟수를 초과했습니다.');
}

/**
 * 띄어쓰기 없는 기존 닉네임을 "형용사 명사" 형태로 일괄 보정.
 * - 사전 기반 split이 가능한 닉네임만 update.
 * - update 시 P2002(unique 충돌) 발생하면 새 닉네임을 재발급해서 보정.
 * - 사전 매칭 실패는 건드리지 않음(사용자 임의 닉네임 보호).
 */
async function addSpaceToExistingNicknames({
  prismaClient = prisma,
  batchSize = 100,
} = {}) {
  const existingWithSpace = await prismaClient.identity.findMany({
    where: { nickname: { contains: ' ' } },
    select: { nickname: true },
  });
  const reservedNicknames = new Set(
    existingWithSpace.map((row) => (row.nickname || '').trim()).filter(Boolean),
  );

  let migratedCount = 0;
  let regeneratedCount = 0;
  let skippedCount = 0;
  let lastId = null;

  for (;;) {
    const targets = await prismaClient.identity.findMany({
      where: {
        AND: [
          { nickname: { not: null } },
          { NOT: { nickname: { contains: ' ' } } },
          ...(lastId ? [{ id: { gt: lastId } }] : []),
        ],
      },
      select: { id: true, nickname: true },
      take: batchSize,
      orderBy: { id: 'asc' },
    });

    if (targets.length === 0) {
      break;
    }

    for (const row of targets) {
      lastId = row.id;
      const split = insertSpaceIntoLegacyNickname(row.nickname);
      if (!split) {
        skippedCount += 1;
        continue;
      }
      if (reservedNicknames.has(split)) {
        const regenerated = await prismaClient.$transaction(async (tx) => {
          return assignNicknameWithRetry(tx, row.id, reservedNicknames);
        });
        regeneratedCount += 1;
        reservedNicknames.add(regenerated);
        continue;
      }
      try {
        await prismaClient.identity.update({
          where: { id: row.id },
          data: { nickname: split },
        });
        reservedNicknames.add(split);
        migratedCount += 1;
      } catch (err) {
        if (!isNicknameUniqueViolation(err)) {
          throw err;
        }
        const regenerated = await prismaClient.$transaction(async (tx) => {
          return assignNicknameWithRetry(tx, row.id, reservedNicknames);
        });
        regeneratedCount += 1;
        reservedNicknames.add(regenerated);
      }
    }
  }

  return { migratedCount, regeneratedCount, skippedCount };
}

module.exports = {
  adjectives,
  bioNouns,
  generateUniqueNickname,
  migrateExistingUsersNicknames,
  addSpaceToExistingNicknames,
  insertSpaceIntoLegacyNickname,
  registerNewUser,
  isNicknameUniqueViolation,
};
