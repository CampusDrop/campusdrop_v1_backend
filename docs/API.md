# Campus Drop API 명세

Express 서버 진입점: `campusdrop_server/index.js`. 기본 포트는 환경 변수 `PORT`, 미설정 시 **3000**. 바인드 호스트는 `HOST`(기본 `0.0.0.0`).

| 항목 | 값 |
|------|------|
| Base URL (로컬) | `http://localhost:{PORT}` |
| OpenAPI JSON | `GET /openapi.json` |
| Swagger UI | `GET /api-docs` (HTML UI, 브라우저용) |
| 정적 파일 | `GET /assets/*` — `campusdrop_server/assets` (로그인 메일 로고 등; 프로덕션에서 캐시 `max-age` 적용) |
| JSON 본문(일반 라우트) | `Content-Type: application/json` 권장 |
| 분석 전용 바디 상한 | `/api/analytics/*` 만 `ANALYTICS_JSON_BODY_MAX_BYTES`(기본 **512KiB**) |
| 엔드포인트 색인 | [HTTP 경로 일람](#http-경로-일람) |

### CORS

`index.js` 기준: 프로덕션에서는 `CORS_ORIGINS`·`ADMIN_CORS_ORIGINS`·고정 도메인(`campus-drop.com` 등)과 **로컬호스트**만 허용합니다. 그 외 Origin은 거절됩니다. `credentials: true`입니다.

---

## 목차

1. [공통: 인증·오류](#공통-인증오류)
2. [GET `/`](#get-)
3. [인증 `/api/auth`](#인증-apiauth)
4. [앱 분석 `/api/analytics`](#앱-분석-apianalytics)
5. [통계 `/api/stats`](#통계-apistats)
6. [랜딩 좋아요 `/api/landing-like`](#랜딩-좋아요-apilanding-like)
7. [카카오 `/api/kakao`](#카카오-apikakao)
8. [설문 `/api/survey`](#설문-apisurvey)
9. [매칭 `/api/match`](#매칭-apimatch)
10. [관리자 `/api/admin`](#관리자-apiadmin)
11. [백그라운드 작업 (HTTP 아님)](#백그라운드-작업-http-아님)
12. [환경 변수](#환경-변수)
13. [HTTP 경로 일람](#http-경로-일람)
14. [변경 이력](#변경-이력)

---

## 공통: 인증·오류

### `Identity.id` 세션 (`x-user-uuid`)

`POST /api/auth/verify-code` 등으로 받은 **`uuid`는 DB `identities.id`(UUID)** 와 동일합니다. 아래 API에서 헤더로 넘깁니다.

| 헤더 | 값 | 필요한 경로 |
|------|-----|----------------|
| `x-user-uuid` | 위 UUID 문자열 | `GET /api/auth/pin`, `GET /api/auth/me`, `POST /api/auth/school-proof`, `GET /api/auth/school-proof/status`, `/api/survey/*`, `/api/match/*` |

`x-user-uuid`가 없거나 UUID 형식이 아니거나, 해당 `Identity`가 없으면 **`401`**:

```json
{
  "error": "인증이 만료되었습니다. 다시 이메일 인증을 해주세요."
}
```

차단 계정(`blockedAt` 설정)이면 **`403`**:

```json
{
  "error": "이 계정은 이용이 제한되었습니다. 문의가 필요하면 운영팀에 연락해 주세요."
}
```

### 관리자 JWT

`POST /api/admin/login` 이후 **`Authorization: Bearer <JWT>`** (`/api/admin`의 로그인 제외 전 경로).

인증 실패 **`401`** 예:

```json
{
  "error": "관리자 인증이 필요합니다. Bearer 토큰을 보내 주세요."
}
```

```json
{
  "error": "유효하지 않거나 만료된 관리자 토큰입니다."
}
```

### 설문·매칭: 이미지 세션 만료

`Identity.imageUuidAccessUntil`이 과거이면 **`403`** (`code` 포함):

```json
{
  "error": "이미지 가입 세션 유효 기간이 지났습니다. 학교 이메일(@sju.ac.kr) 인증 후 설문·매칭 기능을 이용해 주세요.",
  "code": "IMAGE_UUID_ACCESS_EXPIRED",
  "accessExpiredAt": "2026-04-20T09:00:00.000Z"
}
```

### 범용 오류 본문

대부분의 `4xx`/`5xx`는 다음 형태입니다.

```json
{
  "error": "사람이 읽을 수 있는 한국어 메시지"
}
```

---

## GET `/`

**요약:** 서버 동작 확인.

**인증:** 없음.

**응답 `200`**

```json
{
  "message": "Campus Drop API Server is running!",
  "university": "Sejong University",
  "status": "Online"
}
```

---

## 인증 `/api/auth`

원문 이메일은 DB에 저장하지 않습니다. `verify-code` 성공 시 신규면 `emailHash`와 `Trait`를 생성합니다. `privacyPolicyAgreed`는 DB `privacy_policy_agreed`에 저장됩니다.

### 개인정보처리방침 동의 (`privacyPolicyAgreed`)

| 엔드포인트 | 본문 형식 | 규칙 |
|------------|-----------|------|
| `POST /api/auth/verify-code` | JSON | 신규 `Identity` 생성 또는 `linkUuid`로 익명에 이메일 연결 시 **`privacyPolicyAgreed: true` 필수**. 기존 이메일로 **재인증만** 할 때는 생략 가능. |
| `POST /api/auth/complete-registration` | `multipart/form-data` | **`privacyPolicyAgreed` 필수**, `true` / `"true"` / `"1"`(대소문자 무관). `false`면 `400`. |
| `POST /api/auth/complete-anonymous-onboarding` | 위와 동일 | 위와 동일. |
| `GET /api/auth/me` | — | 응답에 `privacyPolicyAgreed` 포함. |

---

### POST `/api/auth/send-code`

**요약:** `@sju.ac.kr`로 6자리 인증 코드 발송(메모리 보관). `AUTH_FIXED_VERIFICATION_CODE`가 설정되면 메일은 생략되고 해당 코드가 사용됩니다.

**인증:** 없음.

**요청 `200` 예시**

```json
{
  "email": "student@sju.ac.kr"
}
```

**응답 `200`**

```json
{
  "message": "인증 번호를 발송했습니다."
}
```

**응답 `400` 예시**

```json
{
  "error": "email이 필요합니다."
}
```

```json
{
  "error": "세종대학교 이메일(@sju.ac.kr)만 인증할 수 있습니다."
}
```

**응답 `500`**

```json
{
  "error": "인증 메일 발송에 실패했습니다. 이메일(SES/SMTP) 환경 변수를 확인해 주세요."
}
```

---

### POST `/api/auth/verify-code`

**요약:** 이메일·코드 검증 후 `uuid` 반환. 신규 가입·`linkUuid` 연결 시 동의 필수. 설문은 **`POST /api/survey/submit`** 권장. `complete-registration` / `registrationToken` 은 **구 클라이언트**용.

**인증:** 없음.

**요청 — 신규 가입 예시**

```json
{
  "email": "student@sju.ac.kr",
  "code": "123456",
  "privacyPolicyAgreed": true,
  "profile": {
    "studentId": "25123456",
    "birthYear": "2003",
    "gender": "여성"
  }
}
```

**요청 — 기존 이메일 재인증(동의 생략 가능)**

```json
{
  "email": "student@sju.ac.kr",
  "code": "123456"
}
```

**요청 — 익명 계정에 이메일 연결 (`linkUuid`)**

```json
{
  "email": "student@sju.ac.kr",
  "code": "123456",
  "linkUuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "privacyPolicyAgreed": true
}
```

**응답 `200`**

```json
{
  "verified": true,
  "uuid": "550e8400-e29b-41d4-a716-446655440000"
}
```

**응답 `400` 예시**

```json
{
  "error": "인증 번호가 만료되었습니다. 다시 요청해 주세요."
}
```

```json
{
  "error": "유효한 인증 요청이 없습니다. 인증 번호를 다시 요청해 주세요."
}
```

```json
{
  "error": "인증 번호가 올바르지 않습니다."
}
```

```json
{
  "error": "linkUuid는 유효한 UUID 형식이어야 합니다."
}
```

```json
{
  "error": "개인정보처리방침에 동의해야 가입할 수 있습니다."
}
```

```json
{
  "error": "개인정보처리방침에 동의해야 학교 이메일을 연결할 수 있습니다."
}
```

```json
{
  "error": "연결할 세션(UUID)을 찾을 수 없습니다."
}
```

```json
{
  "error": "이 세션에는 이미 이메일이 연결되어 있습니다. linkUuid 없이 인증해 주세요."
}
```

```json
{
  "error": "해당 학교 이메일은 다른 계정에서 이미 사용 중입니다. 해당 계정으로 로그인해 주세요."
}
```

**응답 `403` (`linkUuid` 대상이 차단됨)**

```json
{
  "error": "이 계정은 이용이 제한되었습니다. 문의가 필요하면 운영팀에 연락해 주세요."
}
```

**응답 `503` (DB 연결 실패 등)**

```json
{
  "error": "데이터베이스에 연결할 수 없습니다. .env의 DATABASE_URL을 확인한 뒤 서버를 재시작해 주세요. 인증 메일 발송(send-code)은 DB를 쓰지 않아 정상일 수 있습니다."
}
```

**응답 `500`**

```json
{
  "error": "인증 처리 중 오류가 발생했습니다."
}
```

---

### POST `/api/auth/logout`

**요약:** 서버에 저장된 세션 토큰 없음. 클라이언트가 `x-user-uuid` 삭제용으로 호출 가능.

**인증:** 없음.

**요청 본문:** 없음.

**응답 `200`**

```json
{
  "ok": true,
  "message": "서버에 저장된 로그인 토큰은 없습니다. 클라이언트에서 x-user-uuid(또는 이를 둔 쿠키)를 삭제하면 로그아웃됩니다."
}
```

---

### GET `/api/auth/pin`

**요약:** 카카오 챗봇 연동용 4자리 PIN (Redis TTL 기본 180초).

**인증:** `x-user-uuid` 필수.

**응답 `200`**

```json
{
  "pin": "4829",
  "expiresInSec": 180
}
```

**응답 `404`**

```json
{
  "error": "계정을 찾을 수 없습니다."
}
```

**응답 `503` 예시**

```json
{
  "error": "PIN 발급에 실패했습니다. 잠시 후 다시 시도해 주세요."
}
```

```json
{
  "error": "PIN을 발급할 수 없습니다. Redis(REDIS_URL)와 데이터베이스 연결을 확인해 주세요."
}
```

---

### GET `/api/auth/me`

**요약:** 현재 세션의 이메일·프로필 요약.

**인증:** `x-user-uuid` 필수.

**응답 `200`**

```json
{
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "email": "student@sju.ac.kr",
  "profile": {
    "studentId": "25123456",
    "birthYear": "2003",
    "gender": "여성",
    "genderTrait": "female"
  },
  "participantMeta": {
    "profile": {
      "studentId": "25123456",
      "birthYear": "2003",
      "gender": "여성",
      "genderTrait": "female"
    }
  },
  "privacyPolicyAgreed": true,
  "imageUuidAccessUntil": null
}
```

익명·이메일 미연결 계정이면 `email`은 `null`, `imageUuidAccessUntil`에 ISO 시각이 올 수 있습니다.

---

### POST `/api/auth/complete-registration`

**요약:** **구 클라이언트** 가입 완료. `registrationToken` + `privacyPolicyAgreed` 필수. 설문 `survey`(선택, JSON **문자열** 또는 객체 파싱 가능) 또는 설문 생략 시 `profile`(선택). 이미지 `image`(선택). 신규 플로우는 `verify-code` 후 `POST /api/survey/submit` 사용.

**인증:** 없음.

**본문:** `multipart/form-data`

| 필드 | 필수 | 설명 |
|------|------|------|
| `registrationToken` | 예 | 서버가 발급한 JWT 형태 가입 토큰 |
| `privacyPolicyAgreed` | 예 | `true` / `"true"` / `"1"` |
| `survey` | 아니오 | 설문 전체 JSON **문자열** (`validateSurveyPayload` 동일 규칙) |
| `profile` | 아니오 | 설문 없을 때 `studentId`, `birthYear`, `gender` 등 JSON 문자열 |
| `image` | 아니오 | 증빙 이미지 파일 (`image` 단일 필드) |

**`survey`에 넣는 JSON 예시** (`Content-Type`은 multipart이므로, 필드 값으로 아래 JSON을 **이스케이프한 문자열**로 보냄)

```json
{
  "energy": 2,
  "weekend": 3,
  "pattern": 1,
  "trend": 2,
  "alcohol": "가끔",
  "smoking": "비흡연",
  "tattoo": "없음",
  "contact": 4,
  "meeting": 4,
  "planning": 1,
  "affection": 4,
  "date_expense": 3,
  "friends": 4,
  "jealousy": 2,
  "skinship_speed": 2,
  "skinship_limit": "단계적으로",
  "date_drinking": 2,
  "politics": 3,
  "religion_type": "없음",
  "marriage_view": 3,
  "meeting_seriousness": 4,
  "job_view": 4,
  "spending": 3,
  "conflict": 2,
  "empathy": 5,
  "honesty": 5,
  "trust": 5,
  "gender": "남성",
  "pref_cc": "비슷하면 좋음",
  "pref_smoking": "비흡연",
  "pref_tattoo": "선호",
  "pref_religion": "비슷하면 좋음",
  "self_care_habit": "상황에 따라 다름, 컨디션이 좋을 때는 집중 관리하고 바쁠 때는 쉬어감",
  "availability": [
    { "date": "2026-04-20", "time_slot": "11:00-12:00" }
  ]
}
```

**응답 `201`**

```json
{
  "message": "가입이 완료되었습니다.",
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "pin": "0042",
  "expiresInSec": 180
}
```

`pin` / `expiresInSec`는 Redis 실패 시 `null`일 수 있습니다.

**응답 `409`**

```json
{
  "error": "이미 가입된 이메일입니다. 로그인(verify-code)으로 세션을 받아 주세요."
}
```

**응답 `503` (토큰 검증 설정 없음)**

```json
{
  "error": "가입 토큰 검증을 할 수 없습니다. AUTH_REGISTRATION_JWT_SECRET(16자 이상) 또는 ADMIN_JWT_SECRET·ADMIN_PASSWORD를 설정해 주세요."
}
```

**응답 `401` (가입 토큰 무효)**

```json
{
  "error": "유효하지 않거나 만료된 가입 토큰입니다. 이메일 인증을 다시 진행해 주세요."
}
```

---

### POST `/api/auth/complete-anonymous-onboarding`

**요약:** 이메일 없이 **이미지 증빙 필수** + 선택 설문 또는 `profile`. 성공 시 `uuid` = `x-user-uuid`, `imageUuidAccessUntil` 부여.

**인증:** 없음.

**본문:** `multipart/form-data`

| 필드 | 필수 | 설명 |
|------|------|------|
| `image` | 예 | 증빙 이미지 단일 파일 |
| `privacyPolicyAgreed` | 예 | `complete-registration` 과 동일 |
| `survey` | 아니오 | 설문 JSON 문자열(규칙 동일). 생략 시 `profile` 권장 |
| `profile` | 아니오 | 설문 없을 때 JSON 문자열 |

**응답 `201`**

```json
{
  "message": "제출이 저장되었습니다. 관리자 검토 후 증빙이 승인되면 이미지 인증이 완료됩니다.",
  "uuid": "660e8400-e29b-41d4-a716-446655440001",
  "pin": "9912",
  "expiresInSec": 180,
  "imageUuidAccessUntil": "2026-04-27T14:59:59.999Z",
  "submission": {
    "id": "770e8400-e29b-41d4-a716-446655440002",
    "status": "pending"
  }
}
```

**응답 `400` (이미지 누락)**

```json
{
  "error": "multipart 필드 image(단일 파일)가 필요합니다."
}
```

---

### POST `/api/auth/school-proof`

**요약:** 로그인 사용자의 학교 증빙 **추가** 제출(`pending`). 최초 익명 1차 제출은 `complete-anonymous-onboarding` 사용.

**인증:** `x-user-uuid` 필수.

**본문:** `multipart/form-data`, 필드 `image`(파일) 필수.

**응답 `201`**

```json
{
  "message": "제출이 저장되었습니다. 관리자 검토 후 승인되면 이미지 인증이 완료됩니다.",
  "submission": {
    "id": "880e8400-e29b-41d4-a716-446655440003",
    "status": "pending",
    "createdAt": "2026-04-17T12:00:00.000Z"
  }
}
```

---

### GET `/api/auth/school-proof/status`

**요약:** 이메일 연결 여부·이미지 인증(관리자 승인) 여부·최근 제출 요약.

**인증:** `x-user-uuid` 필수.

**응답 `200`**

```json
{
  "emailVerified": true,
  "schoolImageVerified": false,
  "schoolProofVerifiedAt": null,
  "latestSubmission": {
    "id": "880e8400-e29b-41d4-a716-446655440003",
    "status": "pending",
    "createdAt": "2026-04-17T12:00:00.000Z"
  }
}
```

`latestSubmission`이 없으면 `null`입니다.

---

## 앱 분석 `/api/analytics`

인증 **불필요**. 선택 헤더 `x-user-uuid`(형식이 올바른 UUID일 때만 연결에 사용).

제한(기본값, 환경 변수로 변경 가능):

- JSON 본문 최대 **512KiB** (`/api/analytics`만).
- `events` 최대 **200**건/요청, `interactions` **100**건, `batch.items` **50**건.
- IP·세션 창 단위 레이트 리밋 및 상호작용 일일 한도(기본 **8000**/세션/UTC일).

### POST `/api/analytics/events`

**요청 예시**

```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "app": "campusdrop-web",
  "release": "1.0.0",
  "client_ts": "2026-04-17T12:00:00.000Z",
  "events": [
    {
      "name": "page_view",
      "ts": "2026-04-17T12:00:01.000Z",
      "props": {
        "path": "/survey",
        "ok": true
      },
      "event_id": "660e8400-e29b-41d4-a716-446655440001"
    }
  ]
}
```

**응답 `202`**

```json
{
  "accepted": 1,
  "dropped": 0
}
```

**응답 `400`**

```json
{
  "error": "session_id는 UUID 형식이어야 합니다."
}
```

**응답 `429`**

```json
{
  "error": "요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요."
}
```

---

### POST `/api/analytics/heartbeat`

**요청 예시**

```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "client_ts": "2026-04-17T12:05:00.000Z",
  "last_meaningful_activity_at": "2026-04-17T12:04:30.000Z",
  "visibility": "visible",
  "context": {
    "route": "/match",
    "idle_probe": 1
  }
}
```

**응답 `202`**

```json
{
  "ok": true
}
```

**응답 `400`**

```json
{
  "error": "last_meaningful_activity_at이 유효한 ISO8601이어야 합니다."
}
```

---

### POST `/api/analytics/interaction`

**요청 예시**

```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "interactions": [
    {
      "type": "dead_click",
      "ts": "2026-04-17T12:06:00.000Z",
      "x_norm": 0.42,
      "y_norm": 0.18,
      "nearest_region": "header_logo",
      "view": "landing_home"
    }
  ]
}
```

**응답 `202`**

```json
{
  "accepted": 1,
  "dropped": 0
}
```

**응답 `429` (일일 상호작용 한도)**

```json
{
  "error": "세션당 일일 상호작용 수집 한도를 초과했습니다."
}
```

---

### POST `/api/analytics/batch`

**요약:** `event` / `heartbeat` / `interaction` 혼합. **모든 항목 동일 `session_id`**.

**요청 예시**

```json
{
  "items": [
    {
      "kind": "event",
      "payload": {
        "session_id": "550e8400-e29b-41d4-a716-446655440000",
        "app": "campusdrop-web",
        "events": [
          {
            "name": "click_cta",
            "ts": "2026-04-17T12:07:00.000Z"
          }
        ]
      }
    },
    {
      "kind": "heartbeat",
      "payload": {
        "session_id": "550e8400-e29b-41d4-a716-446655440000",
        "last_meaningful_activity_at": "2026-04-17T12:07:10.000Z"
      }
    }
  ]
}
```

**응답 `202`**

```json
{
  "results": [
    { "kind": "event", "accepted": 1, "dropped": 0 },
    { "kind": "heartbeat", "ok": true }
  ],
  "droppedItems": 0
}
```

항목 처리 실패 시 해당 원소에 `"error": "..."` 가 포함될 수 있습니다.

---

## 통계 `/api/stats`

### GET `/api/stats/excitement-count`

**요약:** `Trait.survey_data IS NOT NULL` 인 행 수.

**응답 `200`**

```json
{
  "excitementCount": 128,
  "description": "설문을 한 번이라도 저장한 사용자 수(Trait.survey_data IS NOT NULL)"
}
```

---

## 랜딩 좋아요 `/api/landing-like`

**요약:** 전역 좋아요 수만 `landing_like_counters` 한 줄(`key` = `default`)에 둡니다. **`POST`마다 +1**이며, 클라이언트·브라우저 식별은 하지 않습니다. 새로고침 후에도 같은 방식으로 호출하면 또 올라갑니다.

**인증:** 없음.

### GET `/api/landing-like`

**응답 `200`**

```json
{
  "likeCount": 1204
}
```

---

### POST `/api/landing-like`

**요약:** 합계 **+1**. 본문 없음(`{}` 또는 빈 본문 가능).

**응답 `200`**

```json
{
  "likeCount": 1205
}
```

**응답 `500`:** 서버 오류 시 `{ "error": "..." }`.

---

## 카카오 `/api/kakao`

### POST `/api/kakao/webhook`

**요약:** 오픈빌더 스킬. HTTP는 **항상 `200`**, 본문은 카카오 스킬 JSON.

**인증:** 없음.

**요청 예시 (카카오 스킬 페이로드 일부)**

```json
{
  "userRequest": {
    "utterance": "내 PIN은 4829 야",
    "user": {
      "id": "kakao-channel-user-12345"
    }
  }
}
```

**응답 예시 (연동 성공)**

```json
{
  "version": "2.0",
  "template": {
    "outputs": [
      {
        "simpleText": {
          "text": "챗봇과 계정이 연동되었습니다."
        }
      }
    ]
  }
}
```

**응답 예시 (PIN 없음)**

```json
{
  "version": "2.0",
  "template": {
    "outputs": [
      {
        "simpleText": {
          "text": "4자리 PIN 번호를 입력해 주세요."
        }
      }
    ]
  }
}
```

---

## 설문 `/api/survey`

**인증:** `x-user-uuid` 필수. 이메일이 비어 있으면 `imageUuidAccessUntil` 유효 기간 내에만 허용(라우트 내부 `403` 메시지 참고).

### GET `/api/survey/me`

**요약:** 현재 헤더 UUID(`Identity.id`)에 연결된 **`Trait.surveyData`** 를 그대로 돌려줍니다. 설문을 한 번도 저장하지 않았으면 `hasSurvey: false`, `surveyData: null`입니다.

**접근 조건:** `POST /api/survey/submit` 과 동일 — 학교 이메일(`@sju.ac.kr`)이 연결되어 있거나, `imageUuidAccessUntil` 이 아직 유효해야 합니다. 그렇지 않으면 아래와 같은 **`403`** (이미지 전용 세션 만료는 전역 미들웨어에서 `IMAGE_UUID_ACCESS_EXPIRED`).

**응답 `200`**

```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "hasSurvey": true,
  "surveyData": {
    "surveyAnswers": {},
    "gender": "male",
    "availability": []
  },
  "gender": "male",
  "updatedAt": "2026-04-10T08:00:00.000Z"
}
```

(`surveyData`는 실제 DB에 들어 있는 설문 JSON입니다. `Trait` 행이 없으면 `hasSurvey` false, `surveyData`·`gender`·`updatedAt` 은 null.)

### POST `/api/survey/submit`

**요청 루트:** `surveyData` 또는 `survey` 중 하나에 객체 (`surveyData ?? survey`).

**접근 거부 `403` (이메일도 없고 이미지 세션도 무효)**

```json
{
  "error": "설문은 학교 이메일(@sju.ac.kr) 인증을 완료한 뒤 제출하거나, 이미지 가입 세션 유효 기간(`imageUuidAccessUntil`) 내에 제출해 주세요."
}
```

**요청 예시 — 레거시(한 객체 + `availability`)**

```json
{
  "surveyData": {
    "energy": 2,
    "weekend": 3,
    "pattern": 1,
    "trend": 2,
    "alcohol": "가끔",
    "smoking": "비흡연",
    "tattoo": "없음",
    "contact": 4,
    "meeting": 4,
    "planning": 1,
    "affection": 4,
    "date_expense": 3,
    "friends": 4,
    "jealousy": 2,
    "skinship_speed": 2,
    "skinship_limit": "단계적으로",
    "date_drinking": 2,
    "politics": 3,
    "religion_type": "없음",
    "marriage_view": 3,
    "meeting_seriousness": 4,
    "job_view": 4,
    "spending": 3,
    "conflict": 2,
    "empathy": 5,
    "honesty": 5,
    "trust": 5,
    "gender": "남성",
    "pref_cc": "비슷하면 좋음",
    "pref_smoking": "비흡연",
    "pref_tattoo": "선호",
    "pref_religion": "비슷하면 좋음",
    "self_care_habit": "상황에 따라 다름, 컨디션이 좋을 때는 집중 관리하고 바쁠 때는 쉬어감",
    "availability": [
      { "date": "2026-04-20", "time_slot": "11:00-12:00" }
    ]
  }
}
```

**요청 예시 — 프론트 패키지 (`surveyAnswers` + `matchAvailability`)**

```json
{
  "surveyData": {
    "surveyAnswers": {
      "energy": 2,
      "weekend": 3,
      "pattern": 1,
      "trend": 2,
      "alcohol": "가끔",
      "smoking": "비흡연",
      "tattoo": "없음",
      "contact": 4,
      "meeting": 4,
      "planning": 1,
      "affection": 4,
      "date_expense": 3,
      "friends": 4,
      "jealousy": 2,
      "skinship_speed": 2,
      "skinship_limit": "단계적으로",
      "date_drinking": 2,
      "politics": 3,
      "religion_type": "없음",
      "marriage_view": 3,
      "meeting_seriousness": 4,
      "job_view": 4,
      "spending": 3,
      "conflict": 2,
      "empathy": 5,
      "honesty": 5,
      "trust": 5,
      "gender": "남성",
      "pref_cc": "비슷하면 좋음",
      "pref_smoking": "비흡연",
      "pref_tattoo": "선호",
      "pref_religion": "비슷하면 좋음",
      "self_care_habit": "상황에 따라 다름, 컨디션이 좋을 때는 집중 관리하고 바쁠 때는 쉬어감"
    },
    "matchAvailability": {
      "availableSlots": [
        { "date": "2026-04-20", "hourStart": 11, "hourEnd": 12 }
      ]
    },
    "participantMeta": {
      "profile": {
        "studentId": "25123456",
        "birthYear": "2003",
        "gender": "남성"
      }
    }
  }
}
```

**원시 HTTP 요청 예시 (요청줄 + 헤더 + JSON 본문)** — 아래는 프론트 패키지 제출을 **한 덩어리**로 보낼 때의 형식입니다. `Host`는 배포 환경에 맞게 바꿉니다.

`self_care_habit` 등 문자열 필드는 **`config/surveySemantics.v1.json`에 등록된 문구**만 통과합니다. 예시에서는 등록 문구로 넣었습니다(`"보통"`만 단독으로내면 `400`이 날 수 있음).

```http
POST /api/survey/submit HTTP/1.1
Host: api.example.com
Content-Type: application/json
x-user-uuid: 550e8400-e29b-41d4-a716-446655440000

{
  "surveyData": {
    "surveyAnswers": {
      "energy": 3,
      "weekend": 4,
      "pattern": 2,
      "trend": 3,
      "alcohol": "가끔",
      "smoking": "비흡연",
      "tattoo": "없음",
      "contact": 3,
      "meeting": 4,
      "planning": 2,
      "affection": 3,
      "date_expense": 2,
      "friends": 3,
      "jealousy": 2,
      "skinship_speed": 3,
      "skinship_limit": "2",
      "date_drinking": "상관없음",
      "politics": 3,
      "religion_type": "없음",
      "marriage_view": 3,
      "meeting_seriousness": 4,
      "job_view": 3,
      "spending": 2,
      "conflict": 3,
      "empathy": 4,
      "honesty": 5,
      "trust": 4,
      "gender": "여성",
      "pref_cc": "상관없음",
      "pref_smoking": "비흡연만",
      "pref_tattoo": "없음만",
      "pref_religion": "상관없음",
      "self_care_habit": "최소한의 관리, 건강을 위해 가벼운 산책이나 식단 조절 정도만 실천함"
    },
    "matchAvailability": {
      "availableSlots": [
        { "date": "2026-04-20", "hourStart": 11, "hourEnd": 12 }
      ]
    },
    "participantMeta": {
      "profile": {
        "studentId": "2020123456",
        "birthYear": "2002",
        "gender": "여성"
      },
      "verificationMethod": "email"
    }
  }
}
```

`x-user-uuid`는 `verify-code` 등으로 받은 **`Identity.id`** 와 같아야 합니다. 루트에 `survey` 키를 써도 동작은 동일합니다(`surveyData ?? survey`).

문자열 선택지·척도·하드/소프트 규칙의 단일 진실 소스: 루트 **`config/surveySemantics.v1.json`**, 검증 구현: **`campusdrop_server/lib/surveyValidation.js`**. 성공 시 서버가 `surveySchemaVersion`, `matchProfile` 등을 덮어써 저장합니다.

**응답 `200`**

```json
{
  "message": "설문 결과가 저장되었습니다.",
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "pin": "1024",
  "expiresInSec": 180
}
```

**응답 `400` (본문 누락)**

```json
{
  "error": "surveyData 또는 survey 본문이 필요합니다. (프론트 설문 패키지: surveyAnswers·matchAvailability·participantMeta 등 포함 가능)"
}
```

**응답 `404`**

```json
{
  "error": "사용자를 찾을 수 없습니다."
}
```

---

## 매칭 `/api/match`

**인증:** `x-user-uuid` 필수. 이미지 세션 만료 규칙은 설문과 동일.

### GET `/api/match/test`

**요약:** 더미 5명 순환 쌍으로 Python `POST /calculate-match` 호출 결과를 묶어 반환.

**응답 `200` (구조 예시 — `comparisons[].match`는 Python 응답 전체)**

```json
{
  "description": "더미 5명 순환 매칭(인접 쌍 5회). Python POST /calculate-match 응답을 pair별로 포함합니다.",
  "pythonUrl": "http://127.0.0.1:8000/calculate-match",
  "inputUsers": [
    { "id": "user0@sju.ac.kr", "email": null, "gender": "male" }
  ],
  "comparisons": [
    {
      "user_A": { "id": "user0@sju.ac.kr", "email": null, "gender": "male" },
      "user_B": { "id": "user1@sju.ac.kr", "email": null, "gender": "female" },
      "match": {
        "final_score": 68.2,
        "match_status": "ok",
        "group_a_score": 75.0,
        "group_b_penalty": 6.8,
        "match_report": {
          "summary_text": "두 사용자의 응답이 전반적으로 잘 맞습니다.",
          "reasons_numbered_ko": ["1) 라이프스타일 패턴이 유사합니다."]
        }
      }
    }
  ]
}
```

`match` 객체의 필드명·`match_report` 내부는 **`campusdrop_matching/app/schemas.py` 의 `CalculateMatchResponse`** 및 실제 `match_report` 생성 로직과 일치합니다(위 값은 예시).

**응답 `502` (Python HTTP 오류)**

```json
{
  "error": "매칭 서비스가 오류 상태를 반환했습니다.",
  "pythonStatus": 500,
  "pythonUrl": "http://127.0.0.1:8000/calculate-match",
  "pythonBody": {},
  "failedPair": {
    "user_A_id": "user0@sju.ac.kr",
    "user_B_id": "user1@sju.ac.kr"
  }
}
```

**응답 `502` (연결 실패, `hint` 선택)**

```json
{
  "error": "Python 매칭 서비스에 연결할 수 없습니다.",
  "pythonUrl": "http://127.0.0.1:8000/calculate-match",
  "detail": "connect ECONNREFUSED 127.0.0.1:8000",
  "pythonStatus": null,
  "pythonBody": null,
  "hint": "호스트에서 Python을 모든 인터페이스에 바인딩하세요. 예: uvicorn app.main:app --host 0.0.0.0 --port 8000 (기본 127.0.0.1만이면 컨테이너·LAN IP 접속이 ECONNREFUSED 됩니다.)"
}
```

---

### POST `/api/match/request`

**요약:** 동일 주기 풀에 대해 Python `batch-match`와 동일한 전역 매칭 후, 본인이 속한 쌍을 찾아 DB `matchings`에 저장하고 응답.

**요청 본문:** 생략 가능. `{}` 허용.

```json
{}
```

**응답 `200` (`report`는 `slimMatchReportForDb` 적용 후 형태)**

```json
{
  "partnerLabel": "여성",
  "partnerEmail": "partner@sju.ac.kr",
  "score": 72.5,
  "report": {
    "score": 72.5,
    "reasons": [
      "라이프스타일 패턴이 비슷합니다.",
      "만남 가능 시간이 겹칩니다."
    ]
  },
  "periodStart": "2026-04-13T00:00:00.000Z",
  "periodEnd": "2026-04-20T00:00:00.000Z"
}
```

`partnerEmail`은 상대 `Identity.email`이 없으면 `null`입니다. `report`는 Python `match_report`가 없거나 슬림화 결과가 없으면 `null`일 수 있습니다.

**응답 `400`**

```json
{
  "error": "설문을 먼저 제출해 주세요."
}
```

```json
{
  "error": "이성 매칭을 위해 설문에 남성/여성 성별이 필요합니다. 설문을 다시 제출해 주세요."
}
```

**응답 `404` 예시**

```json
{
  "error": "매칭할 다른 사용자가 없습니다."
}
```

```json
{
  "error": "이성(남성·여성) 조건에 맞는 매칭 후보가 없습니다."
}
```

```json
{
  "error": "전역 매칭에서 짝이 되지 않았습니다. (인원·하드 필터·과거 매칭 제약 등으로 이번 주기에 배정되지 않았을 수 있습니다.)"
}
```

```json
{
  "error": "매칭 점수 50점 이상인 상대가 없습니다."
}
```

(마지막 문구의 임계값은 `lib/matchPolicy.js` 의 `MIN_MATCH_SCORE`와 동일.)

**응답 `502` (Python 연결 실패)** — `GET /api/match/test` 의 네트워크 오류 예시와 유사한 JSON.

---

## 관리자 `/api/admin`

### POST `/api/admin/login`

**인증:** 없음.

**요청**

```json
{
  "email": "admin@sju.ac.kr",
  "password": "your-admin-password"
}
```

**응답 `200`**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "tokenType": "Bearer",
  "expiresInSec": 28800
}
```

**응답 `401`**

```json
{
  "error": "아이디 또는 비밀번호가 올바르지 않습니다."
}
```

**응답 `503` 예시**

```json
{
  "error": "등록된 관리자 계정이 없습니다. `.env`에 ADMIN_EMAIL·ADMIN_PASSWORD를 두고 `npm run db:seed`를 실행해 주세요."
}
```

---

이하 **`Authorization: Bearer <token>`** 필수.

### GET `/api/admin/users`

**쿼리:** `limit`(기본 100, 최대 500), `offset`(기본 0).

각 유저에 `Trait.surveyData`에 저장된 만남 가능 시간을 함께 반환합니다. 설문이 없거나 필드가 없으면 `null`입니다.

- **`availability`:** `{ "date": "YYYY-MM-DD", "time_slot": "HH:MM-HH:MM" }[]` (정규화 저장분, 전체 슬롯).
- **`matchAvailability`:** 제출 시 클라이언트가 보낸 객체가 있으면 그대로(예: `availableSlots`). 없으면 `null`.

**응답 `200`**

```json
{
  "total": 1200,
  "limit": 100,
  "offset": 0,
  "users": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "student@sju.ac.kr",
      "emailVerified": true,
      "schoolImageVerified": false,
      "schoolProofVerifiedAt": null,
      "studentId": "25123456",
      "birthYear": "2003",
      "kakaoLinked": false,
      "blockedAt": null,
      "createdAt": "2026-04-01T00:00:00.000Z",
      "hasSurvey": true,
      "surveyUpdatedAt": "2026-04-10T08:00:00.000Z",
      "gender": "male",
      "availability": [
        { "date": "2026-04-20", "time_slot": "11:00-12:00" },
        { "date": "2026-04-20", "time_slot": "14:00-15:00" }
      ],
      "matchAvailability": {
        "availableSlots": [
          {
            "date": "2026-04-20",
            "hourStart": 11,
            "hourEnd": 12
          }
        ]
      }
    }
  ]
}
```

---

### GET `/api/admin/users/:id`

**응답 `200`**

```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "student@sju.ac.kr",
    "emailVerified": true,
    "schoolImageVerified": true,
    "schoolProofVerifiedAt": "2026-04-05T10:00:00.000Z",
    "studentId": "25123456",
    "birthYear": "2003",
    "kakaoLinked": true,
    "blockedAt": null,
    "createdAt": "2026-04-01T00:00:00.000Z"
  },
  "schoolProofSubmissions": [
    {
      "id": "880e8400-e29b-41d4-a716-446655440003",
      "status": "approved",
      "mimeType": "image/jpeg",
      "fileSize": 245678,
      "createdAt": "2026-04-02T09:00:00.000Z",
      "reviewedAt": "2026-04-05T10:00:00.000Z"
    }
  ],
  "trait": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "gender": "male",
    "surveyData": {},
    "updatedAt": "2026-04-10T08:00:00.000Z"
  }
}
```

(`surveyData`는 실제 저장된 설문 JSON 객체입니다.)

---

### DELETE `/api/admin/users/:id`

**본문:** JSON. `action`: `"delete"`(기본) 또는 `"block"`.

**차단 요청**

```json
{
  "action": "block"
}
```

**응답 `200` (차단)**

```json
{
  "message": "사용자가 차단되었습니다.",
  "action": "block",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "blockedAt": "2026-04-17T12:00:00.000Z"
  }
}
```

**삭제 응답 `200`**

```json
{
  "message": "사용자가 삭제되었습니다.",
  "action": "delete",
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

### GET `/api/admin/surveys`

**쿼리:** `limit`(기본 100, 최대 500), `offset`.

**응답 `200`**

```json
{
  "total": 800,
  "limit": 100,
  "offset": 0,
  "surveys": [
    {
      "userId": "550e8400-e29b-41d4-a716-446655440000",
      "gender": "male",
      "surveyData": {},
      "updatedAt": "2026-04-10T08:00:00.000Z",
      "identity": {
        "blockedAt": null,
        "createdAt": "2026-04-01T00:00:00.000Z",
        "kakaoId": "kakao-123"
      }
    }
  ]
}
```

---

### GET `/api/admin/matches`

**쿼리:** `limit`(기본 200, 최대 1000), `offset`, `includeAll`(`1`/`true`/`yes` 이면 주기 필터 없음).

**응답 `200` (현재 주기 필터 시)**

```json
{
  "total": 3,
  "limit": 200,
  "offset": 0,
  "includeAll": false,
  "periodStart": "2026-04-13T00:00:00.000Z",
  "periodEnd": "2026-04-20T00:00:00.000Z",
  "matches": [
    {
      "id": "990e8400-e29b-41d4-a716-446655440004",
      "userAId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "userBId": "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
      "userAEmail": "a@sju.ac.kr",
      "userBEmail": "b@sju.ac.kr",
      "score": 80.5,
      "matchedAt": "2026-04-14T18:00:05.000Z",
      "periodStart": "2026-04-13T00:00:00.000Z",
      "matchReport": {
        "score": 80.5,
        "reasons": ["요약 이유 1", "요약 이유 2"]
      }
    }
  ]
}
```

---

### GET `/api/admin/matches/unmatched`

**응답 `200`**

```json
{
  "periodStart": "2026-04-13T00:00:00.000Z",
  "periodEnd": "2026-04-20T00:00:00.000Z",
  "eligibleCount": 42,
  "matchedInPeriodCount": 20,
  "unmatchedCount": 2,
  "users": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "solo@sju.ac.kr",
      "kakaoLinked": false,
      "createdAt": "2026-04-02T00:00:00.000Z",
      "gender": "male",
      "surveyUpdatedAt": "2026-04-09T12:00:00.000Z"
    }
  ]
}
```

---

### DELETE `/api/admin/matches/:id`

**응답 `200`**

```json
{
  "message": "매칭이 삭제되었습니다.",
  "deleted": {
    "id": "990e8400-e29b-41d4-a716-446655440004",
    "userAId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    "userBId": "bbbbbbbb-cccc-dddd-eeee-ffffffffffff"
  }
}
```

---

### POST `/api/admin/matches/batch-run`

**본문:** 없음.

**응답 `200` (성공)**

```json
{
  "skipped": false,
  "userCount": 40,
  "eligibleSurveyCount": 55,
  "pairCount": 18
}
```

**응답 `200` (스킵 — 설문 유저 2명 미만)**

```json
{
  "skipped": true,
  "reason": "not_enough_users",
  "count": 1
}
```

**응답 `200` (스킵 — 남/여 이진 성별 부족)**

```json
{
  "skipped": true,
  "reason": "not_enough_binary_gender_users",
  "count": 1,
  "eligibleSurveyCount": 5
}
```

**응답 `502`**

```json
{
  "error": "배치 매칭 실행에 실패했습니다. 매칭 서비스 URL·로그를 확인해 주세요.",
  "detail": "BATCH_MATCH_HTTP_500"
}
```

---

### POST `/api/admin/matches/force`

**요약:** 운영자 지정 이성 1건 `matchings` 생성.

**요청 예시**

```json
{
  "userAId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "userBId": "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
  "score": 70,
  "genderA": "male",
  "genderB": "female"
}
```

(`genderA`/`genderB`는 Trait에 성별이 없을 때만 필요할 수 있습니다. `user_a_id` 등 스네이크 케이스 별칭도 허용.)

**응답 `201`**

```json
{
  "message": "강제 매칭이 등록되었습니다.",
  "match": {
    "id": "aa0e8400-e29b-41d4-a716-446655440005",
    "userAId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    "userBId": "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
    "score": 70,
    "matchedAt": "2026-04-17T12:30:00.000Z",
    "genderA": "male",
    "genderB": "female"
  }
}
```

---

### GET `/api/admin/school-proofs`

**쿼리:** `status` = `pending` \| `approved` \| `rejected` \| `all`(기본 `pending`), `limit`(기본 50, 최대 200), `offset`.

**응답 `200`**

```json
{
  "total": 4,
  "limit": 50,
  "offset": 0,
  "status": "pending",
  "submissions": [
    {
      "id": "880e8400-e29b-41d4-a716-446655440003",
      "identityId": "550e8400-e29b-41d4-a716-446655440000",
      "userEmail": "student@sju.ac.kr",
      "status": "pending",
      "mimeType": "image/jpeg",
      "fileSize": 245678,
      "createdAt": "2026-04-17T09:00:00.000Z",
      "reviewedAt": null,
      "identitySchoolProofVerifiedAt": null
    }
  ]
}
```

---

### GET `/api/admin/school-proofs/:id/file`

**응답:** **JSON이 아님** — `Content-Type`은 저장된 `mimeType`(기본 `application/octet-stream`), 바디는 이미지 바이너리 스트림.

---

### POST `/api/admin/school-proofs/:id/approve`

**응답 `200`**

```json
{
  "message": "이미지 인증이 승인되었습니다.",
  "submissionId": "880e8400-e29b-41d4-a716-446655440003",
  "identityId": "550e8400-e29b-41d4-a716-446655440000",
  "schoolProofVerifiedAt": "2026-04-17T13:00:00.000Z"
}
```

---

### POST `/api/admin/school-proofs/:id/reject`

**응답 `200`**

```json
{
  "message": "제출이 거절 처리되었습니다.",
  "submissionId": "880e8400-e29b-41d4-a716-446655440003"
}
```

---

## 백그라운드 작업 (HTTP 아님)

| 항목 | 값 |
|------|------|
| 스케줄 | 매주 **월요일 18:00** (`0 18 * * 1`), 타임존 **`Asia/Seoul`** |
| 동작 | `lib/weeklyBatchMatch.js` — Python `POST {origin}{MATCHING_BATCH_PATH}`(기본 `/batch-match`) → `matchings` 저장 → 카카오 알림톡 Mock |

---

## 환경 변수

루트 `.env.example` 과 코드 기준. 생략 시 기본값은 구현을 따릅니다.

| 변수 | 설명 |
|------|------|
| `PORT` | HTTP 포트 (기본 3000) |
| `HOST` | 바인드 주소 (기본 `0.0.0.0`) |
| `PUBLIC_API_URL` | 로그·이메일 등에 쓰는 공개 API 베이스 URL(선택). 비우면 서버 로그에 바인딩 URL 안내 |
| `TRUST_PROXY` | `1`/`true`/`yes` 이면 `express` `trust proxy` 1 — 리버스 프록시 뒤 IP·분석 레이트리밋용 |
| `DATABASE_URL` | PostgreSQL (Prisma) |
| `REDIS_URL` | Redis (PIN·카카오 웹훅). 기본 `redis://127.0.0.1:6379` |
| `MATCHING_SERVICE_URL` | Python 베이스 URL (`lib/resolveMatchingServiceUrl.js`) |
| `MATCHING_CALCULATE_PATH` | 기본 `/calculate-match` |
| `MATCHING_SERVICE_TIMEOUT_MS` | 단일 매칭 타임아웃(ms), 기본 **5000** |
| `MATCHING_BATCH_PATH` | 기본 `/batch-match` |
| `MATCHING_BATCH_TIMEOUT_MS` | 기본 **120000** |
| `CORS_ORIGINS` | 쉼표 구분 추가 허용 Origin |
| `ADMIN_CORS_ORIGINS` | 관리자 콘솔 등 추가 Origin |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | 관리자 계정 시드·로그인 (`npm run db:seed` 등) |
| `ADMIN_JWT_SECRET` / `ADMIN_JWT_EXPIRES_SEC` | 관리자 JWT 서명·만료(초, 기본 28800) |
| `AUTH_REGISTRATION_JWT_SECRET` / `AUTH_REGISTRATION_JWT_EXPIRES_SEC` | 가입 완료 JWT (`complete-registration` 등) |
| `AUTH_FIXED_VERIFICATION_CODE` | 설정 시 항상 해당 코드만 유효, 메일 생략(개발 전용) |
| `EMAIL_TRANSPORT`·`SMTP_*` / `SES_*` | 인증 메일 발송 (`campusdrop_server/lib/mailer` 등) |
| `EMAIL_LOGO_URL` | 메일 HTML 로고 URL(비우면 `PUBLIC_API_URL` + `/assets/logo.png` 등) |
| `SCHOOL_PROOF_MAX_BYTES` | 학교 증빙 업로드 최대 크기(바이트, 기본 5MB) |
| `ANALYTICS_JSON_BODY_MAX_BYTES` | `/api/analytics/*` JSON 본문 상한(기본 512KiB) |
| `ANALYTICS_MAX_EVENTS_PER_REQUEST` 등 | 분석 API 한도·레이트리밋(`.env.example` 주석 참고) |

---

## HTTP 경로 일람

`campusdrop_server/index.js` 및 `routes/*.js` 기준(미들웨어는 **굵게**). 명세 본문은 아래 각 절을 따릅니다.

### 서버·문서

| 메서드 | 경로 | 인증 | 비고 |
|--------|------|------|------|
| `GET` | `/` | 없음 | 헬스 |
| `GET` | `/openapi.json` | 없음 | OpenAPI 3.0 JSON |
| `GET` | `/api-docs` | 없음 | Swagger UI |
| `GET` | `/assets/*` | 없음 | 정적 파일 |

### `/api/analytics`

| 메서드 | 경로 | 인증 | 비고 |
|--------|------|------|------|
| `POST` | `/api/analytics/events` | 없음 | 본문 상한 `ANALYTICS_JSON_BODY_MAX_BYTES` |
| `POST` | `/api/analytics/heartbeat` | 없음 | 동일 |
| `POST` | `/api/analytics/interaction` | 없음 | 동일 |
| `POST` | `/api/analytics/batch` | 없음 | 동일 |

### `/api/auth` (`routes/auth.js` + `authOnboarding.js` + `schoolProof.js`)

| 메서드 | 경로 | 인증 | 비고 |
|--------|------|------|------|
| `POST` | `/api/auth/send-code` | 없음 | |
| `POST` | `/api/auth/verify-code` | 없음 | |
| `POST` | `/api/auth/logout` | 없음 | |
| `GET` | `/api/auth/pin` | **`x-user-uuid`** | |
| `GET` | `/api/auth/me` | **`x-user-uuid`** | |
| `POST` | `/api/auth/complete-registration` | 없음 | `multipart/form-data` |
| `POST` | `/api/auth/complete-anonymous-onboarding` | 없음 | `multipart/form-data` |
| `POST` | `/api/auth/school-proof` | **`x-user-uuid`** | `multipart/form-data` |
| `GET` | `/api/auth/school-proof/status` | **`x-user-uuid`** | |

### 기타 공개 API

| 메서드 | 경로 | 인증 | 비고 |
|--------|------|------|------|
| `POST` | `/api/kakao/webhook` | 없음 | 카카오 스킬 |
| `GET` | `/api/stats/excitement-count` | 없음 | |
| `GET` | `/api/landing-like` | 없음 | 전역 `likeCount` |
| `POST` | `/api/landing-like` | 없음 | 합계 +1 |

### `/api/survey` (`index.js`에서 **`requireUserUuid`** + **`requireImageUuidAccessForSurveyApis`**)

| 메서드 | 경로 | 인증 | 비고 |
|--------|------|------|------|
| `GET` | `/api/survey/me` | **`x-user-uuid`** | 이미지 세션 만료 시 `403` 가능 |
| `POST` | `/api/survey/submit` | **`x-user-uuid`** | 동일 |

### `/api/match` (설문과 동일 미들웨어)

| 메서드 | 경로 | 인증 | 비고 |
|--------|------|------|------|
| `GET` | `/api/match/test` | **`x-user-uuid`** | Python `calculate-match` 프록시 |
| `POST` | `/api/match/request` | **`x-user-uuid`** | Python `batch-match` 동일 로직 |

### `/api/admin` (로그인 제외 **`Authorization: Bearer`**)

| 메서드 | 경로 | 인증 | 비고 |
|--------|------|------|------|
| `POST` | `/api/admin/login` | 없음 | |
| `GET` | `/api/admin/users` | Bearer | |
| `GET` | `/api/admin/users/:id` | Bearer | |
| `DELETE` | `/api/admin/users/:id` | Bearer | |
| `GET` | `/api/admin/surveys` | Bearer | |
| `GET` | `/api/admin/matches` | Bearer | |
| `GET` | `/api/admin/matches/unmatched` | Bearer | |
| `DELETE` | `/api/admin/matches/:id` | Bearer | |
| `POST` | `/api/admin/matches/batch-run` | Bearer | |
| `POST` | `/api/admin/matches/force` | Bearer | |
| `GET` | `/api/admin/school-proofs` | Bearer | |
| `GET` | `/api/admin/school-proofs/:id/file` | Bearer | 이미지 바이너리 |
| `POST` | `/api/admin/school-proofs/:id/approve` | Bearer | |
| `POST` | `/api/admin/school-proofs/:id/reject` | Bearer | |

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-04-18 | 랜딩 좋아요: 전역 `POST /api/landing-like` +1·`GET` 조회만(`clientKey`/토글·`landing_like_client_toggles` 제거). [HTTP 경로 일람](#http-경로-일람)·상단 표·환경 변수 보강. |
| 2026-04-17 | 전 엔드포인트를 구현(`routes/*.js`, `index.js`)과 정합되도록 통합. 요청·응답 예시 JSON 보강. CORS·`POST /api/match/request` 응답 필드(`periodStart`/`periodEnd`)·관리자·분석·온보딩 API 반영. |
| 2026-04-16 | `privacy_policy_agreed` / `privacyPolicyAgreed` 도입. `verify-code`, `complete-registration`, `complete-anonymous-onboarding`, `GET /api/auth/me` 반영. |

명세와 구현이 어긋나면 **코드가 우선**이며, 변경 시 본 문서를 함께 갱신합니다.
