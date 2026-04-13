# Campus Drop API 명세

Express 기반 서버 (`index.js`). 기본 포트는 환경 변수 `PORT`이며, 미설정 시 **3000**입니다.

| 항목 | 값 |
|------|-----|
| Base URL (로컬) | `http://localhost:{PORT}` |
| 공통 헤더 | `Content-Type: application/json` (본문이 있는 경우) |
| CORS | 전 도메인 허용 (`cors()` 기본) |

### 세션 식별 (`Identity.id`)

이메일 인증 성공 시 발급되는 **`uuid` 값은 DB `Identity` 테이블의 PK(UUID)** 와 동일합니다. 보호 API에서는 아래 헤더로 전달합니다.

| 헤더 | 값 | 필요한 경로 |
|------|-----|----------------|
| `x-user-uuid` | `POST /api/auth/verify-code` 응답의 `uuid` (UUID 문자열) | `/api/survey/*`, `/api/match/*`, `GET /api/auth/pin` |

헤더가 없거나, 해당 UUID의 `Identity`가 없으면 **`401`**:

```json
{ "error": "인증이 만료되었습니다. 다시 이메일 인증을 해주세요." }
```

---

## GET `/`

서버 동작 확인용.

**응답** `200` — `application/json`

```json
{
  "message": "Campus Drop API Server is running!",
  "university": "Sejong University",
  "status": "Online"
}
```

---

## 인증 `/api/auth`

원문 이메일은 DB에 저장되지 않습니다. `verify-code` 성공 시 `Identity`가 없으면 `emailHash`(bcrypt)와 빈 `Trait`로 생성됩니다.

### POST `/api/auth/send-code`

세종대(`@sju.ac.kr`) 이메일로 6자리 인증 코드를 발송합니다. (SMTP 설정 필요) 인증 코드는 서버 메모리에만 보관됩니다.

**요청 본문**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `email` | string | 예 | `@sju.ac.kr`만 허용, 대소문자·공백은 서버에서 정규화 |

**응답**

| HTTP | 본문 |
|------|------|
| `200` | `{ "message": "인증 번호를 발송했습니다." }` |
| `400` | `{ "error": string }` — email 누락/타입 오류, 비 sju 도메인 등 |
| `500` | `{ "error": "인증 메일 발송에 실패했습니다. SMTP 설정을 확인해 주세요." }` — 발송 실패 시 메모리에 올려둔 코드는 제거됨 |

---

### POST `/api/auth/verify-code`

이메일과 코드를 검증하고, 성공 시 코드를 소비한 뒤 `Identity`를 찾거나 생성하고 세션 UUID를 반환합니다.

**요청 본문**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `email` | string | 예 | `@sju.ac.kr` |
| `code` | string | 예 | 6자리 인증 번호 |

**응답**

| HTTP | 본문 |
|------|------|
| `200` | `{ "verified": true, "uuid": string }` — `uuid`는 이후 `x-user-uuid`에 넣을 `Identity.id` |
| `400` | `{ "error": string }` — email/code 누락, 도메인 오류, 만료(`인증 번호가 만료되었습니다...`), 미요청(`유효한 인증 요청이 없습니다...`), 불일치(`인증 번호가 올바르지 않습니다.`) |
| `500` | `{ "error": "인증 처리 중 오류가 발생했습니다." }` |

---

### GET `/api/auth/pin`

카카오 챗봇 연동용 **4자리 PIN** 발급. Redis에 `PIN:{4자리}` → 현재 로그인 `Identity.id`, **TTL 180초(3분)**.

**요청 헤더**

| 헤더 | 필수 |
|------|------|
| `x-user-uuid` | 예 |

**응답**

| HTTP | 본문 |
|------|------|
| `200` | `{ "pin": string, "expiresInSec": 180 }` — `pin`은 4자리 문자열(`0000`~`9999`) |
| `401` | 세션 헤더 오류(위 공통 메시지) |
| `503` | `{ "error": string }` — PIN 충돌 반복 실패 또는 Redis 연결 실패 등 |

---

## 카카오 `/api/kakao`

### POST `/api/kakao/webhook`

카카오 i 오픈빌더 스킬 서버가 호출하는 웹훅. 본문에서 발화를 읽어 **4자리 연속 숫자**를 PIN으로 사용하고, Redis에서 `Identity` UUID를 조회한 뒤 해당 `Identity.kakaoId`를 갱신합니다.

**인증 헤더** — 없음 (카카오 서버에서 호출).

**요청 본문 (스킬 페이로드 요약)**

| 경로 | 설명 |
|------|------|
| `userRequest.utterance` | 사용자 발화 문자열 |
| `userRequest.user.id` | 카카오 사용자 ID (문열) |

PIN은 `utterance`에서 공백 제거 후 **첫 `\d{4}`** 와 일치하는 4자리 숫자입니다.

**응답** — HTTP는 항상 **`200`**. 본문은 카카오 스킬 응답 **v2.0** 형태:

```json
{
  "version": "2.0",
  "template": {
    "outputs": [{ "simpleText": { "text": "…" } }]
  }
}
```

성공 시 `text` 예: `챗봇과 계정이 연동되었습니다.`  
PIN 없음/오류/Redis 오류 등도 동일 JSON 형태로 `text`만 달라집니다.

---

## 설문 `/api/survey`

모든 경로에 **`x-user-uuid`** 필요.

### POST `/api/survey/submit`

로그인된 `Identity`에 연결된 **`Trait.surveyData`** 를 갱신합니다. 본문에 **이메일 필드는 없습니다.**

**요청 본문**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `surveyData` 또는 `survey` | object | 예 | 동일 의미. `surveyData ?? survey` |

**설문 객체 (`surveyData`) 규칙 요약**

- 허용 키만 사용 (아래 라이프스타일 키 + `availability` 외 키 불가).
- **척도(1~5 정수)** 및 **문자열 선택지** 구분은 서버 `lib/surveyValidation.js`와 동일.
- 문자열 필드: `alcohol`, `smoking`, `tattoo`, `religion_type`, `skinship_limit`, `pref_cc`, `pref_smoking`, `pref_tattoo`, `pref_religion` — 공백만 있는 문자열 불가.
- 나머지 설문 키는 기본적으로 1~5 정수 (`religion_type`이 `'없음'`이 아닐 때 `religion_intensity` 필수 등 상세 규칙은 검증 로직 참고).
- **`availability`** (필수): 만남 가능 일정 배열. 원소는 `{ "date": "YYYY-MM-DD", "time_slot": "11:00-12:00" }` 형태. `time_slot`은 **정확히 60분**인 구간만 허용(예: `23:00-00:00` 자정 넘김 가능). 최소 1개, 최대 100개. 같은 `date`+`time_slot` 중복은 저장 시 하나로 합쳐지고, 날짜·시간순으로 정렬되어 `Trait.surveyData`에 저장된다. (Python 매칭 점수 계산에는 아직 반영되지 않으며 DB·API 조회용으로만 보관된다.)

**라이프스타일 키 목록 (32개)**

`energy`, `weekend`, `pattern`, `trend`, `alcohol`, `smoking`, `tattoo`, `contact`, `meeting`, `planning`, `affection`, `date_expense`, `friends`, `jealousy`, `skinship_speed`, `skinship_limit`, `date_drinking`, `politics`, `religion_type`, `religion_intensity`, `marriage_view`, `meeting_seriousness`, `job_view`, `spending`, `conflict`, `empathy`, `honesty`, `trust`, **`gender`**(남성/여성, 이성 매칭용), `pref_cc`, `pref_smoking`, `pref_tattoo`, `pref_religion`

**응답**

| HTTP | 본문 |
|------|------|
| `200` | `{ "message", "userId", "pin", "expiresInSec" }` — `userId`는 `Trait.id`(=`Identity.id`). **`pin`**: 카카오 챗봇 연동용 4자리 번호(=`GET /api/auth/pin`과 동일 규칙·Redis TTL). 발급 실패 시 `pin`·`expiresInSec`는 `null`이며 `GET /api/auth/pin`으로 재발급하면 됩니다. |
| `400` | `{ "error": string }` — payload 누락, 검증 실패 메시지 |
| `401` | 세션 헤더 오류 |
| `404` | `{ "error": "사용자를 찾을 수 없습니다." }` |
| `500` | `{ "error": "설문 저장 중 오류가 발생했습니다." }` |

---

## 매칭 `/api/match`

모든 경로에 **`x-user-uuid`** 필요.

### GET `/api/match/test`

고정 더미 5명의 설문을 Python `POST /calculate-match`에 **순환 5쌍**(0–1, 1–2, …, 4–0)으로 각각 위임한 뒤, 결과를 한 번에 JSON으로 반환합니다.

**요청** — 본문 없음.

**성공** `200`

| 필드 | 타입 | 설명 |
|------|------|------|
| `description` | string | 응답 의미 설명 |
| `pythonUrl` | string | 실제로 호출한 Python URL |
| `inputUsers` | array | `{ id, gender }[]` |
| `comparisons` | array | 각 원소: `user_A`, `user_B` — `{ id, gender }`, `match` — Python `CalculateMatchResponse` 본문 |

Python 요청 본문에는 항상 `hard_filter_policy: "fail"`, `penalty_per_hard_violation: 30` 이 포함됩니다.

**오류** `401` — 세션 헤더 오류.

**오류** `502`

| 경우 | 본문 예시 |
|------|-----------|
| Python이 2xx 외 상태 | `error`, `pythonStatus`, `pythonUrl`, `pythonBody`, `failedPair` |
| 네트워크/연결 실패 | `error`, `pythonUrl`, `detail`, `pythonStatus`, `pythonBody`, 필요 시 `hint` (`ECONNREFUSED` 등) |

**오류** `500` — 예상치 못한 서버 예외.

---

### POST `/api/match/request`

인증된 유저(`x-user-uuid` = `Identity.id`)의 `Trait.surveyData`를 기준으로, DB에 설문이 있는 **다른** `Identity`들 가운데 **이성(남성·여성)** 인 후보만 골라 Python `POST /calculate-match`를 **후보마다 순차 호출**한 뒤, **가장 높은 `final_score`** 인 상대 한 명만 반환합니다. 본인 `Trait.gender`가 남/여로 없으면 `400`입니다.

**요청** — 본문 없어도 됨 (`{}` 가능). `Content-Type: application/json` 권장.

**응답**

| HTTP | 본문 |
|------|------|
| `200` | `{ "partnerLabel": string, "score": number, "report": object }` — `partnerLabel`은 상대 성별 라벨(`남성`/`여성`, 비어 있으면 `"상대"`), `report`는 DB에 저장되는 슬림 요약(`score`·`reasons`) |
| `400` | `{ "error": "설문을 먼저 제출해 주세요." }` — 본인 `surveyData` 없음, 또는 성별 미기입(이성 매칭 불가) |
| `401` | 세션 헤더 오류 |
| `404` | 후보 없음 — `매칭할 다른 사용자가 없습니다.`, 이성 조건 불충족, 과거 매칭 이력만 남은 경우 등 |
| `500` | `{ "error": "매칭 후보 조회 중 오류가 발생했습니다." }` 등 |
| `502` | Python 오류 또는 `유효한 매칭 결과를 얻지 못했습니다...` (모든 후보 호출이 비정상이거나 점수 없음) |

---

## 백그라운드 작업 (HTTP 아님)

서버 기동 시 **`node-cron`** 으로 등록됩니다.

| 항목 | 값 |
|------|-----|
| 스케줄 | 매주 **월요일 18:00** (`0 18 * * 1`) |
| 타임존 | **`Asia/Seoul`** |
| 동작 | `lib/weeklyBatchMatch.js` — `Trait`에 설문이 있는 유저를 모아 Python **`POST {origin}{MATCHING_BATCH_PATH}`** (기본 `/batch-match`)에 일괄 전송 → 응답 쌍을 DB **`matchings`** 테이블에 저장 → `kakaoId`가 있는 유저에 알림톡 **Mock** 호출 (`lib/kakaoAlimtalk.js`) |

---

## 환경 변수 (`.env` 등)

| 변수 | 설명 |
|------|------|
| `PORT` | HTTP 포트 (기본 3000) |
| `DATABASE_URL` | PostgreSQL (Prisma) |
| `REDIS_URL` | Redis 연결 URL (기본 `redis://127.0.0.1:6379`) — PIN·카카오 웹훅에 사용 |
| `MATCHING_SERVICE_URL` | Python 베이스 URL. 비우면 Docker/LAN 등 (`lib/resolveMatchingServiceUrl.js`) |
| `MATCHING_CALCULATE_PATH` | 베이스만 있을 때 `/calculate-match` 대신 쓸 경로 (기본 `/calculate-match`) |
| `MATCHING_SERVICE_TIMEOUT_MS` | 단일 매칭 axios 타임아웃(ms). 미설정 시 **5000** |
| `MATCHING_BATCH_PATH` | 배치 매칭 경로 (기본 `/batch-match`). 배치 URL은 **항상 `MATCHING_SERVICE_URL`의 origin + 이 경로** |
| `MATCHING_BATCH_TIMEOUT_MS` | 배치 axios 타임아웃(ms). 미설정 시 **120000** |

---

## 버전 및 변경

명세는 저장소의 `routes/*.js`, `index.js`, `lib/*.js` 구현과 일치하도록 유지합니다. 엔드포인트 추가·변경 시 본 문서를 함께 수정하는 것을 권장합니다.
