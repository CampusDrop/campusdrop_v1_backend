/**
 * Prisma CLI는 cwd 기준 `.env`만 읽는데, 이 레포는 루트 `campusdrop_backend/.env`에
 * DATABASE_URL 등이 있는 경우가 많아서, 아래 순서로 로드한 뒤 prisma를 실행합니다.
 *
 * 순서(뒤가 앞을 덮어씀): 루트 `.env` → `campusdrop_server/.env` → 루트 `.env.local` → `campusdrop_server/.env.local`
 *
 * 원격 RDS만 두고 로컬 PC에서 Studio를 쓰려면 보통 RDS에 직접 붙을 수 없습니다.
 * 그때는 `.env.local`에 로컬 Postgres용 `DATABASE_URL`(예: 127.0.0.1)만 넣어 두면 됩니다.
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const serverRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverRoot, '..');

const files = [
  path.join(repoRoot, '.env'),
  path.join(serverRoot, '.env'),
  path.join(repoRoot, '.env.local'),
  path.join(serverRoot, '.env.local'),
];

for (const p of files) {
  if (fs.existsSync(p)) {
    require('dotenv').config({ path: p, override: true });
  }
}

const prismaArgs = process.argv.slice(2);
if (prismaArgs.length === 0) {
  console.error('Usage: node scripts/prisma-with-repo-root-env.cjs <prisma subcommand ...>');
  console.error('Example: node scripts/prisma-with-repo-root-env.cjs studio');
  process.exit(1);
}

// `prisma validate`는 datasource URL 해석 시 env가 필요하지만, 스키마 문법만 보려면 실제 DB가 없어도 됩니다.
if (prismaArgs[0] === 'validate' && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/prisma_schema_validate_dummy';
}

const prismaBin =
  process.platform === 'win32'
    ? path.join(serverRoot, 'node_modules', '.bin', 'prisma.cmd')
    : path.join(serverRoot, 'node_modules', '.bin', 'prisma');

const result = spawnSync(prismaBin, prismaArgs, {
  cwd: serverRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});

process.exit(result.status === null ? 1 : result.status);
