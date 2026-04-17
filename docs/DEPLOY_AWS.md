# AWS 배포 가이드 (EC2 · SES · campus-drop.com)

Campus Drop API 서버를 **AWS 프리티어**에 가깝게 운영하고, 도메인 **campus-drop.com**을 쓰기 위한 정리입니다. (ALB 등 유료 리소스는 생략 가능)

---

## 1. Docker Compose로 EC2에 배포

**모노레포 루트**(`campusdrop_backend/`)의 `docker-compose.yml`이 Postgres·Redis·Python 매칭·Node API를 한 번에 띄웁니다.

| 구성 | 설명 |
|------|------|
| **Postgres 15 (`db`)** | 볼륨 `postgres_data`, 기본은 **컨테이너 네트워크 전용**(호스트 포트 미개방) |
| **Redis 7 (`redis`)** | AOF, 볼륨 `redis_data` |
| **매칭 API (`matching`)** | `campusdrop_matching/Dockerfile`, 내부 **8000** |
| **Node API (`server`)** | 루트 `Dockerfile.server` 빌드, 호스트 **`3000`**(기본, `SERVER_PUBLISH_PORT`로 변경) |
| **`server` 볼륨 `server_uploads`** | **`/app/uploads`**(학교 증빙 이미지 등) 영속화. 없으면 재배포 후 `GET /api/admin/school-proofs/:id/file` 가 디스크 없음(404)으로 깨짐 |
| **재시작** | `restart: unless-stopped` |
| **헬스체크** | `db` / `redis` / `matching` 건강 후 `server` 기동 |

### 1.1 EC2 준비

- **Ubuntu 22.04 LTS** 등, **Docker Engine + Docker Compose plugin** 설치
- 보안 그룹: **22(SSH)** 만 두고, **80/443**은 나중에 Nginx가 떠 있는 경우에만 열어도 됨 (또는 Nginx만 공개)
- API는 기본적으로 **localhost:3000** 이므로, 외부에 노출하려면 **같은 EC2에 Nginx**를 두고 `proxy_pass http://127.0.0.1:3000` 권장 (ALB 없이 프리티어에 유리)

### 1.2 `.env` (프로덕션)

프로젝트 루트에 `.env`를 두고 `docker compose up -d` 시 자동 로드됩니다.

**Postgres (compose가 읽는 변수)**

| 변수 | 예시 / 설명 |
|------|----------------|
| `POSTGRES_USER` | `campus_admin` (기본값 생략 가능) |
| `POSTGRES_PASSWORD` | **강한 비밀번호** (필수) |
| `POSTGRES_DB` | `campusdrop` (기본값 생략 가능) |

**앱 DB URL (Compose 서비스 이름 `db`)**

```env
DATABASE_URL=postgresql://campus_admin:같은비밀번호@db:5432/campusdrop
```

**Redis**

```env
REDIS_URL=redis://redis:6379
```

**기타 앱 변수**는 아래 [SES 환경 변수](#2-aws-ses-이메일-발송) 및 `docs/API.md`, `campusdrop_server/config/swagger.js` 서버 URL 정리를 참고하세요.

### 1.3 최초 기동 순서

```bash
cd /path/to/campusdrop_backend
cp .env.example .env   # 값 수정(비밀번호·API 키 등)
docker compose up -d --build
docker compose exec server npx prisma migrate deploy
# 또는 db push만 쓰는 경우: docker compose exec server npx prisma db push
```

### 1.4 도메인 `campus-drop.com` (API)

- **Route 53** 등에서 `api.campus-drop.com` → EC2 **퍼블릭 IP** (또는 Elastic IP) A 레코드
- EC2에서 **Nginx**로 TLS 종료(권장): **ACM은 us-east-1**에서 발급한 인증서를 **CloudFront**에 붙이는 패턴과 달리, **EC2 직결 TLS**는 ACM 인증서를 인스턴스에 직접 붙일 수 없고, **Let’s Encrypt(certbot)** 등이 일반적입니다.
- 또는 **CloudFront** 앞단에 API용 오리진(EC2 Nginx 443)을 두는 구조(설정·비용 복잡)는 별도 검토

---

## 2. AWS SES 이메일 발송

`campusdrop_server/lib/mailer.js`는 기본 **`EMAIL_TRANSPORT` 미설정 또는 `ses`** 일 때 **AWS SES API**(`@aws-sdk/client-sesv2`)로 발송합니다. 로컬에서만 구 SMTP를 쓰려면 **`EMAIL_TRANSPORT=smtp`** 로 두고 기존 `SMTP_*` 변수를 사용하세요.

### 2.1 SES 콘솔 작업

1. **SES** 리전 선택 (예: `ap-northeast-2` — `AWS_REGION`과 동일하게 맞추는 것을 권장)
2. **샌드박스**면 수신자 이메일도 검증 필요 → 프로덕션은 **프로덕션 액세스** 요청
3. **도메인 또는 이메일** ID 검증 (`SES_FROM_EMAIL`으로 쓸 주소/도메인)
4. (선택) **구성 세트(Configuration Set)** 발송 로그·이벤트용

### 2.2 EC2에서 권장: IAM Role

EC2 인스턴스에 **IAM Role**을 붙이고, 정책에 최소한:

- `ses:SendEmail` (또는 `ses:SendRawEmail` 사용 시 해당 권한)
- SESv2 API 사용 시 **`ses:SendEmail`** 이 v2에도 적용되는지 확인 — 실제로는 `ses:SendEmail` / `sesv2:SendEmail` — AWS 문서 기준 **AmazonSesSendingAccess** 관리형 정책으로 시작 후 축소 가능

**액세스 키를 쓰는 경우** (로컬 개발 등): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` 설정. EC2 프로덕션에서는 Role 권장.

### 2.3 환경 변수 목록 (이메일 / SES)

| 변수 | 필수 | 설명 |
|------|------|------|
| `EMAIL_TRANSPORT` | 아니오 | `ses`(기본) 또는 `smtp` |
| `AWS_REGION` | SES 사용 시 **예** | 예: `ap-northeast-2` |
| `SES_FROM_EMAIL` | SES 사용 시 **예** | SES에서 검증된 발신 주소 (예: `noreply@campus-drop.com`) |
| `AWS_ACCESS_KEY_ID` | 조건부 | IAM Role 없이 키로 보낼 때 |
| `AWS_SECRET_ACCESS_KEY` | 조건부 | 위와 함께 |
| `SES_CONFIGURATION_SET` | 아니오 | 구성 세트 이름 (있으면 요청에 포함) |

**`EMAIL_TRANSPORT=smtp` 일 때만**

| 변수 | 필수 |
|------|------|
| `SMTP_HOST` | 예 |
| `SMTP_USER` | 예 |
| `SMTP_PASS` | 예 |
| `SMTP_PORT` | 아니오 (기본 587) |
| `SMTP_SECURE` | 아니오 (`true`/`false`) |
| `SMTP_FROM` | 아니오 (기본 `SMTP_USER`) |

---

## 3. Next.js 프론트 — S3 + CloudFront (`campus-drop.com`)

정적 자산 + CDN 전제입니다. **Next `App Router` 전부 SSR**은 S3만으로는 불가하므로, 아래 중 하나를 선택합니다.

### 3.1 권장: 정적보내기 (`output: 'export'`)

`next.config.js` / `next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
};
export default nextConfig;
```

- `next build` 후 **`out/`** 디렉터리가 생성됩니다.
- **API 주소**는 빌드 타임/런타임에 `https://api.campus-drop.com` 같은 **공개 API 베이스 URL**을 환경 변수로 주입 (`NEXT_PUBLIC_API_BASE` 등)해 클라이언트에서 호출

**S3**

1. 버킷 생성 (예: `campus-drop-web-prod`), **퍼블릭 액세스 차단** 유지
2. `out/` 내용을 버킷 루트에 `aws s3 sync out/ s3://버킷명/ --delete`
3. **CloudFront OAC**(Origin Access Control)로 S3 오리진 잠금 — 퍼블릭 S3 URL로 직접 열리지 않게

**CloudFront**

1. 오리진: 위 S3 버킷
2. **Default root object**: `index.html`
3. **SPA 라우팅**: 403/404를 `index.html`로 리다이렉트하는 **Custom Error Response** (경로 기반 클라이언트 라우팅용)
4. **Alternate domain name (CNAME)**: `campus-drop.com`, `www.campus-drop.com` 등
5. **ACM 인증서**: 반드시 **us-east-1** 리전에서 발급(CloudFront 제약) 후 CloudFront 배포에 연결

**Route 53**

- `campus-drop.com` A/AAAA **Alias** → CloudFront 배포

**CORS**

- API 서버(`Express`)에서 `cors()`에 **`https://campus-drop.com`** 출처를 허용하도록 설정하는 것을 권장 (현재 코드가 전체 허용이면, 프로덕션에서는 제한 권장)

### 3.2 SSR·API Route가 필요한 경우

S3+CloudFront만으로는 Next 서버가 없으므로 **별도 호스팅**이 필요합니다.

- **Vercel** / **ECS Fargate** / **EC2에서 `next start`** 등으로 API·SSR을 돌리고, 마케팅 페이지만 S3에 두는 **하이브리드**도 흔합니다.

---

## 4. 체크리스트 요약

| 항목 | 확인 |
|------|------|
| EC2 | Docker, 루트 `.env`, `docker compose up -d --build` |
| DB | `DATABASE_URL`(`db:5432`), `prisma migrate deploy` |
| Redis | `REDIS_URL`, PIN·웹훅 |
| 매칭 | `MATCHING_SERVICE_URL`(기본 `http://matching:8000`) |
| 메일 | SES 검증 + `SES_FROM_EMAIL`, `AWS_REGION`, IAM |
| 도메인 | `api.*` → EC2(+Nginx), `campus-drop.com` → CloudFront |
| 보안 그룹 | DB/Redis·matching은 기본 내부망만 사용; API만 Nginx/ALB로 노출 |

문서는 구현 시점의 저장소 기준이며, AWS 콘솔 UI 변경 시 공식 문서를 함께 확인하세요.
