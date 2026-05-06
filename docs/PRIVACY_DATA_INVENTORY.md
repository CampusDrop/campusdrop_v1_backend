# DB에 저장되는 개인정보·관련 정보 인벤토리

이 문서는 개인정보 처리방침·내부 보안 문서 작성을 위한 **기술적 근거**입니다. 법적 효력이 있는 문구는 법무 검토 후 별도 방침에 반영하십시오.

## 근거 코드·스키마

| 구분 | 경로 |
|------|------|
| PostgreSQL 테이블 정의 | `campusdrop_server/prisma/schema.prisma` |
| 설문 본문·`participantMeta` 정제 | `campusdrop_server/lib/surveyValidation.js` |
| 설문에 부가되는 정규화 필드 | `campusdrop_server/lib/surveySemanticsCatalog.js` |
| 가입 시 프로필(학번·출생연도·성별) | `campusdrop_server/lib/signupProfile.js` |
| 매칭 `matchReport` DB 저장 형태 | `campusdrop_server/lib/slimMatchReport.js` |
| 감사 로그 기록 | `campusdrop_server/lib/accessLog.js`, 각 라우트 |
| 관리자 API가 노출·조회하는 필드 | `campusdrop_server/routes/admin.js` |

---

## 1. DB가 아닌 저장소(처리만 하거나 단기 보관)

| 항목 | 저장 위치 | 비고 |
|------|-----------|------|
| 이메일 인증번호 | 프로세스 메모리 `Map` (`lib/verificationCodes.js`) | PostgreSQL 미저장, 서버 재시작 시 소실 가능 |
| PIN → Identity 매핑(챗봇 연동) | Redis TTL + 선택적으로 `Identity.kakaoLinkPin` | 연동 성공 시 `kakaoLinkPin`은 null로 정리 (`routes/kakao.js`) |
| 매칭 계산 입력 | `campusdrop_matching` HTTP 요청 본문 | 이 레포 기준 별도 사용자 DB 없음; 전송 구간·로그는 인프라 정책에 따름 |

---

## 2. 테이블별 저장 항목

### 2.1 `identities` (테이블명 `identities`)

| 컬럼 | 설명 |
|------|------|
| `id` | 계정 UUID(내부 식별자) |
| `email` | 정규화된 `@sju.ac.kr` 학교 이메일(없을 수 있음) |
| `kakaoId` | 카카오 챗봇/연동 사용자 ID 문자열(없을 수 있음) |
| `kakaoLinkPin` | 챗봇 연동용 4자리 PIN(전역 유일, 연동 후 null 가능) |
| `blockedAt` | 관리자 차단 시각 |
| `schoolProofVerifiedAt` | 학교 증빙 이미지 승인 시각 |
| `imageUuidAccessUntil` | 이메일 없이 이미지 온보딩 시, `x-user-uuid` 접근 허용 만료 시각 |
| `studentId` | 학번 등 문자열(선택, 설문 `participantMeta` 또는 가입 프로필에서 동기화) |
| `birthYear` | 출생연도 등 문자열(선택, 동일 출처) |
| `createdAt` | 가입(레코드 생성) 시각 |

### 2.2 `traits` (테이블명 `traits`)

| 컬럼 | 설명 |
|------|------|
| `id` | `Identity.id`와 동일(FK) |
| `gender` | `male` \| `female`(이성 매칭용) |
| `surveyData` | 검증 통과 설문 전체 JSON(아래 §3) |
| `updatedAt` | 설문 마지막 갱신 시각 |

### 2.3 `matchings` (테이블명 `matchings`)

| 컬럼 | 설명 |
|------|------|
| `id` | 매칭 행 UUID |
| `user_a_id`, `user_b_id` | 매칭된 두 `Identity.id` |
| `score` | 궁합 점수 |
| `matched_at` | 매칭 시각 |
| `period_start` | 주간 매칭 버킷 시작(정책에 따름) |
| `match_report` | `slimMatchReportForDb` 결과 JSON: `{ score, reasons[] }` 한국어 설명 문자열 최대 5개 |

### 2.4 `school_proof_submissions` (테이블명 `school_proof_submissions`)

| 컬럼 | 설명 |
|------|------|
| `id` | 제출 건 UUID |
| `identity_id` | 제출자 `Identity.id` |
| `stored_path` | 서버 디스크 상대 경로(이미지 파일) |
| `mime_type`, `file_size` | 파일 메타 |
| `status` | `pending` \| `approved` \| `rejected` |
| `reviewed_at`, `reviewer_admin_id` | 검토 시각·검토 관리자 |
| `created_at` | 제출 시각 |

### 2.5 `access_logs` (테이블명 `access_logs`)

| 컬럼 | 설명 |
|------|------|
| `actor_type` | 예: `user_session`, `admin`, `system`/`job` 등 |
| `actor_id` | 불투명 식별자(세션 시 사용자 UUID, 관리자 로그인 시 관리자 UUID 등) |
| `action` | 예: `AUTH_SESSION_VALIDATE`, `TRAIT_SURVEY_UPDATE`, `ADMIN_USER_DETAIL` |
| `resource` | 예: `Trait:<uuid>`, `Identity:<uuid>`, HTTP 메서드+경로 |
| `ip`, `user_agent` | 접속 단서 |
| `metadata` | JSON(액션별 상이, 아래 §4) |
| `created_at` | 기록 시각 |

스키마 주석상 원칙: **원문 이메일·카카오 ID는 로그에 넣지 말 것**.

### 2.6 `admins` (테이블명 `admins`)

| 컬럼 | 설명 |
|------|------|
| `id` | 관리자 UUID |
| `email` | 로그인용 이메일(정규화 문자열) |
| `password_hash` | 비밀번호 해시 |
| `created_at`, `updated_at` | 메타 |

---

## 3. `Trait.surveyData` JSON 구조(검증 통과 시 저장)

### 3.1 매칭·분석용 척도·선택지 키

- **정수 척도(대부분 1~5):** `energy`, `weekend`, `pattern`, `trend`, `contact`, `meeting`, `planning`, `affection`, `date_expense`, `friends`, `jealousy`, `skinship_speed`, `politics`, `marriage_view`, `meeting_seriousness`, `job_view`, `spending`, `conflict`, `empathy`, `honesty`, `trust`, `gender`(정규화 후 `male`/`female`)
- **`religion_intensity`:** 종교 유형이 없음에 가까우면 null 가능
- **문자열 또는 1~5 정수(필드별):** `alcohol`, `skinship_limit`, `date_drinking`
- **문자열 선택지:** `smoking`, `tattoo`, `religion_type`, `pref_cc`, `pref_smoking`, `pref_tattoo`, `pref_religion`

### 3.2 일정(만남 가능 시간)

- **`availability`:** `{ "date": "YYYY-MM-DD", "time_slot": "HH:MM-HH:MM" }` 배열, 유효 슬롯 최대 100개
- **`matchAvailability`:** 클라이언트가 보낸 원본 객체(있으면 그대로 포함)

### 3.3 `participantMeta`(서버가 저장하는 부분만)

`email`, `uuid`, `registrationToken` 등은 저장하지 않음.

- **`profile`:** `studentId`, `birthYear`, `gender`(문자열, 있으면)
- **`verificationMethod`:** 문자열(있으면)
- **`skippedPreSurveyViaCookie`:** 불리언(있으면)

### 3.4 서버가 설문 저장 시 부가하는 필드

- **`surveySchemaVersion`:** 카탈로그 버전 번호
- **`matchProfile`:** 흡연/타투/종교 코드·라벨, 파트너 선호 단계(`tier`)·라벨 등 정규화 요약

### 3.5 민감정보 가능성(법무·PM 검토용)

아래는 **개인정보보호법상 민감정보 해당 여부**를 법무가 판단해야 하는 후보입니다. 방침·동의 문구에 반드시 반영할지 결정이 필요합니다.

- 종교: `religion_type`, `religion_intensity`, `pref_religion`, `matchProfile.religion`
- 정치·사회 성향: `politics`
- 건강·신체 관련 성향: `smoking`, `tattoo`, `alcohol`, `date_drinking`, `skinship_speed`, `skinship_limit`, 관련 `pref_*`
- 성생활에 준하는 정보로 해석될 수 있는 응답: 스킨십·연애 진지도 등 축
- 노동·결혼 관련 가치관: `marriage_view`, `job_view` 등

---

## 4. AccessLog 기록 정합성(코드 감사 결과)

다음은 `writeAccessLog` 호출을 기준으로 한 **DB `access_logs` 적재 내용**입니다. 방침에 “어떤 활동이 로그에 남는지”를 쓸 때 참고하십시오.

### 4.1 일반 사용자·세션

| action | actor_type | actor_id | resource / metadata 요약 |
|--------|------------|----------|----------------------------|
| `AUTH_SESSION_VALIDATE` | `user_session` | Identity UUID | `GET/POST …` + `metadata.path` |
| `TRAIT_SURVEY_UPDATE` | `user_session` | Identity UUID | `Trait:<uuid>`, metadata null |
| `AUTH_SIGNUP_COMPLETE` | `user_session` | Identity UUID | `POST /api/auth/complete-registration`, `metadata.hasImage` |
| `AUTH_ANONYMOUS_ONBOARDING_COMPLETE` | `user_session` | Identity UUID | 익명 온보딩 경로, `metadata.submissionId`, `metadata.identityId`(actor와 중복) |

### 4.2 배치·시스템

| action | 비고 |
|--------|------|
| (배치 매칭 완료 시) | `weeklyBatchMatch.js`: `metadata`에 `pairCount`, `userCount`, `eligibleSurveyCount`, `pythonUrl`, `periodStart` 등 |

### 4.3 관리자

| action | actor_id | metadata |
|--------|----------|----------|
| `ADMIN_LOGIN` | 관리자 UUID | null |
| `ADMIN_LIST_USERS` | **null** | `total`, `returned` |
| `ADMIN_LIST_SURVEYS` | **null** | `total`, `returned` |
| `ADMIN_LIST_MATCHES` | **null** | `total`, `returned` |
| `ADMIN_LIST_MATCH_UNMATCHED` | 관리자 UUID | 집계 수 |
| `ADMIN_MATCH_DELETE` | 관리자 UUID | `userAId`, `userBId` |
| `ADMIN_FORCE_MATCH` | 관리자 UUID | 사용자 UUID 쌍, 점수, 성별 |
| `ADMIN_USER_DETAIL` | **null** | null |
| `ADMIN_USER_BLOCK` | **null** | `blockedAt` |
| `ADMIN_USER_DELETE` | **null** | null |
| `ADMIN_LIST_SCHOOL_PROOFS` | 관리자 UUID | `total`, `returned` |
| `ADMIN_SCHOOL_PROOF_FILE_VIEW` | 관리자 UUID | null |
| `ADMIN_SCHOOL_PROOF_APPROVE` | 관리자 UUID | `identityId` |
| `ADMIN_SCHOOL_PROOF_REJECT` | 관리자 UUID | null |

**정합성 이슈(운영·방침 반영 시 선택):**

- 다수 관리자 액션에서 `actor_id`가 **null**입니다. 사고 조사 시 **어느 관리자 토큰**으로 호출했는지 로그만으로는 부족할 수 있어, `adminAuthMiddleware`가 넣는 `req.admin.adminId`를 일관되게 `actor_id`에 넣는 개선을 검토할 수 있습니다.
- 스키마 주석과 같이 **이메일·카카오 ID 원문은 로그 metadata에 넣지 않는** 현재 구현은 방침의 “로그 최소화” 서술과 정합합니다.

---

## 5. 관리자 API를 통한 개인정보 접근(응답에 실리는 데이터)

관리자 JWT 하에 다음이 가능합니다(요약).

- **`GET /api/admin/users`:** 이메일, 학번·출생연도, `kakaoId` 존재 여부·차단·증빙 승인 시각, `trait.surveyData` 전체, 성별 등
- **`GET /api/admin/surveys`:** 모든 설문 JSON 및 연결 `Identity` 일부 필드
- **`GET /api/admin/users/:id`:** 단일 사용자 이메일·학번·출생연도·설문 전체·증빙 제출 메타(이미지 URL은 경로 기반이며 파일 스트림은 별도 엔드포인트)
- **학교 증빙 파일:** 스트리밍 조회 시 `ADMIN_SCHOOL_PROOF_FILE_VIEW` 로그

개인정보 처리방침에는 **관리자 콘솔 접근·증빙 이미지 검토 목적·접근 권한**을 명시하는 것이 좋습니다.

---

## 6. 제3자·처리 위탁 후보(법무/PM 체크리스트)

아래는 방침에 넣기 전 **계약·고지 필요 여부**를 법무가 확인해야 하는 항목입니다.

- [ ] **카카오:** 챗봇 연동 시 `kakaoId` 저장, 알림톡 등(`weeklyBatchMatch` 등에서 `kakaoId` 사용)
- [ ] **이메일 발송(SMTP/SES 등):** 인증번호 발송 시 이메일 주소 처리
- [ ] **매칭 마이크로서비스(Python):** 설문에서 추출한 수치·가용 시간을 HTTP로 전송하는지, 전송 데이터 범위·로그 보관
- [ ] **Redis:** PIN 매핑 TTL, 운영사·리전
- [ ] **호스팅·DB 백업:** 저장 위치, 재해 복구 시 접근 주체

---

## 7. 보관 기간·파기(법무/PM 체크리스트)

코드베이스만으로는 **자동 파기 기간**이 고정되어 있지 않을 수 있습니다. 방침에는 다음을 확정해 기재하는 것이 좋습니다.

- [ ] 탈퇴·차단 시 `Identity` 삭제 API와 실제 파기 범위(연쇄 삭제: Trait, Matching, SchoolProof 등)
- [ ] `access_logs` 보관 기간 및 삭제 주기
- [ ] 증빙 이미지 파일 디스크 보관 기간(거절·승인 후)
- [ ] `matchings`·`match_report` 보관 기간

---

## 8. 문서 유지보수

스키마나 `surveyValidation.js`의 `ALL_KEYS`가 바뀌면 이 문서의 §2~§3을 동기화하십시오.
