const path = require('path');

/** OpenAPI 3.0 기본 정의 (paths는 swagger-jsdoc이 라우트 JSDoc에서 병합) */
const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Campus Drop API',
    version: '1.0.0',
    description: '세종대학교 익명 매칭 서비스 API 문서',
  },
  tags: [
    {
      name: 'Admin',
      description:
        '관리자 페이지용 API. 로그인은 DB `admins` 이메일·비밀번호, `POST /api/admin/login` 후 Bearer JWT',
    },
    { name: 'Auth', description: '이메일 인증·세션·증빙·PIN 등' },
    { name: 'Stats', description: '공개 랜딩용 통계(인증 불필요)' },
    { name: 'Landing', description: '랜딩 화면 공개 API(인증 불필요)' },
    {
      name: 'Analytics',
      description:
        '공개 웹앱 행동 분석(인증 불필요). 선택 헤더 `x-user-uuid`는 `components.securitySchemes.UserUuidAuth`와 동일.',
    },
  ],
  components: {
    securitySchemes: {
      UserUuidAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-user-uuid',
        description:
          '`POST /api/auth/verify-code` 응답의 `uuid`(= DB `Identity.id`). 기존 계정은 이메일 재인증으로 같은 `uuid`를 다시 받을 수 있음',
      },
      AdminBearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: '`POST /api/admin/login` 응답의 `token` — 헤더 `Authorization: Bearer <token>`',
      },
    },
    schemas: {
      ErrorMessage: {
        type: 'object',
        properties: { error: { type: 'string' } },
        required: ['error'],
      },
      MessageOk: {
        type: 'object',
        properties: { message: { type: 'string' } },
      },
      SendCodeRequest: {
        type: 'object',
        required: ['email'],
        properties: {
          email: {
            type: 'string',
            description: '@sju.ac.kr 만 허용, 서버에서 정규화',
          },
        },
      },
      VerifyCodeRequest: {
        type: 'object',
        required: ['email', 'code'],
        properties: {
          email: { type: 'string' },
          code: {
            type: 'string',
            description:
              'send-code 직후 저장된 인증 번호(기본 6자리; AUTH_FIXED_VERIFICATION_CODE 사용 시 그 값)',
          },
          privacyPolicyAgreed: {
            type: 'boolean',
            description:
              '개인정보처리방침 동의. **신규 이메일 가입** 또는 **`linkUuid`로 익명 계정에 이메일 연결** 시 반드시 `true`. 기존 계정 이메일 재인증만 할 때는 생략 가능.',
          },
          linkUuid: {
            type: 'string',
            format: 'uuid',
            description:
              '이미 알고 있는 익명 `Identity.id`에 이메일을 붙일 때. `POST /api/auth/complete-anonymous-onboarding` 응답의 `uuid` 등.',
          },
          profile: {
            type: 'object',
            description:
              '선택. 신규 이메일(아직 Identity 없음)일 때만 — `Identity`·`Trait.gender`에 반영 후 설문은 `/api/survey/submit`',
            properties: {
              studentId: { type: 'string' },
              birthYear: { type: 'string' },
              gender: { type: 'string', description: '남성·여성 등(서버에서 male/female로 정규화)' },
            },
          },
        },
      },
      SchoolProofSubmitResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          submission: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              status: { type: 'string', example: 'pending' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
      VerifyCodeResponse: {
        type: 'object',
        required: ['verified'],
        properties: {
          verified: { type: 'boolean', example: true },
          uuid: {
            type: 'string',
            format: 'uuid',
            description:
              '기존 계정 복구·linkUuid 연결·**신규 이메일이면 verify-code 직후 즉시 생성된** `Identity.id`. 이후 `x-user-uuid` 헤더',
          },
          registrationToken: {
            type: 'string',
            description:
              '구 클라이언트만: 예전 서버가 토큰을 준 경우 `POST /api/auth/complete-registration`에 전달. 신규 플로우에서는 생략',
          },
          expiresInSec: {
            type: 'integer',
            description: '`registrationToken`과 함께 쓰이던 TTL(초). 신규 플로우에서는 생략',
          },
        },
      },
      CompleteRegistrationResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          uuid: { type: 'string', format: 'uuid', description: '`x-user-uuid`' },
          pin: { type: 'string', nullable: true },
          expiresInSec: { type: 'integer', nullable: true },
        },
      },
      AnonymousOnboardingResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          uuid: {
            type: 'string',
            format: 'uuid',
            description: '신규 `Identity.id`. 이후 `x-user-uuid` 및 `verify-code`의 `linkUuid`에 사용',
          },
          pin: {
            type: 'string',
            nullable: true,
            description: '카카오 챗봇 연동용 4자리 PIN(Redis 실패·충돌 시 null)',
          },
          expiresInSec: { type: 'integer', nullable: true, description: 'PIN TTL(초). `pin`이 있을 때' },
          imageUuidAccessUntil: {
            type: 'string',
            format: 'date-time',
            description:
              '이미지 전용 세션으로 `/api/survey`·`/api/match` 접근 가능한 시각(UTC ISO). `matchPolicy` 매칭 주 종료까지',
          },
          submission: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              status: { type: 'string', example: 'pending' },
            },
          },
        },
      },
      PinResponse: {
        type: 'object',
        properties: {
          pin: { type: 'string', example: '0421', description: '4자리 (0000~9999)' },
          expiresInSec: { type: 'integer', example: 180 },
        },
      },
      AvailabilitySlot: {
        type: 'object',
        required: ['date', 'time_slot'],
        properties: {
          date: {
            type: 'string',
            format: 'date',
            example: '2026-04-20',
            description: '만남 가능일 YYYY-MM-DD',
          },
          time_slot: {
            type: 'string',
            example: '11:00-12:00',
            description: '해당 날짜의 1시간 구간 (시작-끝, 정확히 60분)',
          },
        },
      },
      SurveySubmitRequest: {
        type: 'object',
        description:
          '`surveyData` 또는 `survey` 중 하나 필수. (1) 레거시: 척도·선호 키를 한 객체에 두고 `availability`는 `{ date, time_slot }[]`. (2) 프론트 패키지: `surveyAnswers`(또는 `answers`)에 척도·선호, `matchAvailability`(availableSlots에 date·hourStart·hourEnd 0~23), `participantMeta`(profile.studentId·birthYear·gender 등, 서버는 email·registrationToken·userUuid 저장 안 함).',
        properties: {
          surveyData: {
            type: 'object',
            additionalProperties: true,
            description:
              '라이프스타일 척도·선호 + `availability` 또는 `matchAvailability`+`surveyAnswers` 패키지',
          },
          survey: { type: 'object', additionalProperties: true },
        },
      },
      SurveySubmitResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          userId: { type: 'string', format: 'uuid', description: 'Trait.id = Identity.id' },
          pin: {
            type: 'string',
            nullable: true,
            description:
              '카카오 챗봇 연동용 4자리 PIN. Redis 발급 실패 시 null — `GET /api/auth/pin`으로 재발급',
          },
          expiresInSec: {
            type: 'integer',
            nullable: true,
            description: 'PIN 유효 시간(초). `pin`이 null이면 null',
          },
        },
      },
      SurveyCurrentResponse: {
        type: 'object',
        properties: {
          userId: { type: 'string', format: 'uuid', description: 'Identity.id = Trait.id' },
          hasSurvey: { type: 'boolean', description: '`Trait.surveyData`가 객체로 저장돼 있으면 true' },
          surveyData: {
            type: 'object',
            nullable: true,
            additionalProperties: true,
            description: 'DB 저장본(검증·정규화 후). 없으면 null',
          },
          gender: { type: 'string', nullable: true, description: '`Trait.gender`' },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: '`Trait.updatedAt`',
          },
        },
      },
      MatchRequestResponse: {
        type: 'object',
        properties: {
          partnerLabel: { type: 'string', description: '상대 성별 라벨(남성/여성) 또는 "상대"' },
          partnerEmail: {
            type: 'string',
            nullable: true,
            description: '상대 `Identity.email`(정규화 @sju.ac.kr). 미저장·구계정이면 null',
          },
          score: { type: 'number', description: 'Python final_score' },
          report: { type: 'object', additionalProperties: true, description: 'Python match_report' },
          periodStart: {
            type: 'string',
            format: 'date-time',
            description: '이번 매칭 주 시작(앵커 주간)',
          },
          periodEnd: {
            type: 'string',
            format: 'date-time',
            description: '이번 매칭 주 끝(다음 주 시작 직전)',
          },
        },
      },
      KakaoSkillResponse: {
        type: 'object',
        description: '카카오 i 오픈빌더 스킬 응답 v2.0',
        properties: {
          version: { type: 'string', example: '2.0' },
          template: {
            type: 'object',
            properties: {
              outputs: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    simpleText: {
                      type: 'object',
                      properties: { text: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      MatchTest502Python: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          pythonStatus: { type: 'integer', nullable: true },
          pythonUrl: { type: 'string' },
          pythonBody: { nullable: true },
          failedPair: {
            type: 'object',
            properties: {
              user_A_id: { type: 'string' },
              user_B_id: { type: 'string' },
            },
          },
        },
      },
      MatchTest502Network: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          pythonUrl: { type: 'string' },
          detail: { type: 'string' },
          pythonStatus: { type: 'integer', nullable: true },
          pythonBody: { nullable: true },
          hint: { type: 'string', description: 'ECONNREFUSED 등일 때 안내' },
        },
      },
      MatchRequest502Network: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          pythonUrl: { type: 'string' },
          detail: { type: 'string' },
          pythonStatus: { type: 'integer', nullable: true },
          pythonBody: { nullable: true },
          hint: { type: 'string' },
        },
      },
      RootResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          university: { type: 'string' },
          status: { type: 'string' },
        },
      },
      AuthMeResponse: {
        type: 'object',
        properties: {
          uuid: { type: 'string', format: 'uuid' },
          email: { type: 'string', nullable: true, description: '@sju.ac.kr 또는 익명 null' },
          kakaoLinkPin: {
            type: 'string',
            nullable: true,
            description: '카카오 챗봇 연동용 4자리 PIN. 연동 완료 후에는 null',
          },
          kakaoLinked: {
            type: 'boolean',
            description: '`kakaoId`가 있으면 true',
          },
          privacyPolicyAgreed: {
            type: 'boolean',
            description: 'DB `Identity.privacy_policy_agreed`',
          },
          profile: {
            type: 'object',
            properties: {
              studentId: { type: 'string', nullable: true },
              birthYear: { type: 'string', nullable: true },
              gender: { type: 'string', nullable: true, description: '설문 UI 정렬용 한글(남성/여성). 없으면 null' },
              genderTrait: {
                type: 'string',
                nullable: true,
                enum: ['male', 'female'],
                description: 'DB Trait.gender',
              },
            },
          },
          participantMeta: {
            type: 'object',
            description: '프론트 설문 패키지 형태 호환 — `profile`은 위와 동일',
            properties: {
              profile: { type: 'object', additionalProperties: true },
            },
          },
          imageUuidAccessUntil: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: '이미지 전용 세션 만료 시각(없으면 null)',
          },
        },
      },
      LogoutResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
          message: { type: 'string' },
        },
      },
      ExcitementCountResponse: {
        type: 'object',
        properties: {
          excitementCount: { type: 'integer', example: 42 },
          description: { type: 'string' },
        },
      },
      LandingLikeGetResponse: {
        type: 'object',
        required: ['likeCount'],
        properties: {
          likeCount: { type: 'integer', example: 1204 },
        },
      },
      LandingLikeIncrementResponse: {
        type: 'object',
        required: ['likeCount'],
        properties: {
          likeCount: { type: 'integer', example: 1205, description: '`POST` 직후 전역 합계' },
        },
      },
      AnalyticsAcceptedResponse: {
        type: 'object',
        properties: {
          accepted: { type: 'integer', description: '저장된 행 수' },
          dropped: {
            type: 'integer',
            description: '배열 상한·스키마 불일치 등으로 버린 항목 수',
          },
        },
      },
      AnalyticsEventsRequest: {
        type: 'object',
        required: ['session_id', 'app', 'events'],
        properties: {
          client_ts: { type: 'string', format: 'date-time', description: '클라이언트 시각(선택)' },
          session_id: { type: 'string', format: 'uuid' },
          app: { type: 'string', example: 'public' },
          release: { type: 'string', description: '배포 버전·커밋 해시(선택)' },
          events: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'ts'],
              properties: {
                name: { type: 'string' },
                ts: { type: 'string', format: 'date-time' },
                props: { type: 'object', additionalProperties: true },
                event_id: {
                  type: 'string',
                  format: 'uuid',
                  description: '선택. 이후 멱등·중복 제거 확장용(현재는 저장만)',
                },
              },
            },
          },
        },
      },
      AnalyticsHeartbeatRequest: {
        type: 'object',
        required: ['session_id', 'last_meaningful_activity_at'],
        properties: {
          session_id: { type: 'string', format: 'uuid' },
          client_ts: { type: 'string', format: 'date-time' },
          last_meaningful_activity_at: { type: 'string', format: 'date-time' },
          visibility: { type: 'string', example: 'visible', description: 'document.visibilityState 정렬' },
          context: {
            type: 'object',
            additionalProperties: true,
            description: '예: view, phase_index, gate_step',
          },
        },
      },
      AnalyticsInteractionItem: {
        type: 'object',
        required: ['type', 'ts', 'x_norm', 'y_norm', 'nearest_region', 'view'],
        properties: {
          type: {
            type: 'string',
            description: 'dead_click | disabled_primary_tap | rage_tap | scroll_overscroll 등',
          },
          ts: { type: 'string', format: 'date-time' },
          x_norm: { type: 'number', minimum: 0, maximum: 1 },
          y_norm: { type: 'number', minimum: 0, maximum: 1 },
          nearest_region: { type: 'string' },
          view: { type: 'string' },
        },
      },
      AnalyticsInteractionRequest: {
        type: 'object',
        required: ['session_id', 'interactions'],
        properties: {
          session_id: { type: 'string', format: 'uuid' },
          client_ts: { type: 'string', format: 'date-time' },
          interactions: {
            type: 'array',
            items: { $ref: '#/components/schemas/AnalyticsInteractionItem' },
          },
        },
      },
      AnalyticsBatchItem: {
        type: 'object',
        required: ['kind'],
        properties: {
          kind: { type: 'string', enum: ['event', 'heartbeat', 'interaction'] },
          payload: {
            type: 'object',
            description: 'kind별 필드는 단일 엔드포인트와 동일. kind 외 필드를 루트에 둬도 됨.',
            additionalProperties: true,
          },
        },
      },
      AnalyticsBatchRequest: {
        type: 'object',
        required: ['items'],
        properties: {
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/AnalyticsBatchItem' },
          },
        },
      },
      AnalyticsBatchResponse: {
        type: 'object',
        properties: {
          results: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
          },
          droppedItems: { type: 'integer', description: 'items 상한(기본 50)으로 잘린 개수' },
        },
      },
      KakaoWebhookRequest: {
        type: 'object',
        description: '오픈빌더 스킬 페이로드(필요 필드만)',
        properties: {
          userRequest: {
            type: 'object',
            properties: {
              utterance: { type: 'string', description: '사용자 발화 (4자리 PIN 포함 가능)' },
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: '카카오 사용자 ID' },
                },
              },
            },
          },
        },
      },
    },
  },
};

const apis = [
  path.join(__dirname, '..', 'index.js'),
  path.join(__dirname, '..', 'routes', 'admin.js'),
  path.join(__dirname, '..', 'routes', 'auth.js'),
  path.join(__dirname, '..', 'routes', 'schoolProof.js'),
  path.join(__dirname, '..', 'routes', 'stats.js'),
  path.join(__dirname, '..', 'routes', 'survey.js'),
  path.join(__dirname, '..', 'routes', 'match.js'),
  path.join(__dirname, '..', 'routes', 'kakao.js'),
  path.join(__dirname, '..', 'routes', 'analytics.js'),
  path.join(__dirname, '..', 'routes', 'landingLike.js'),
];

const swaggerOptions = {
  definition: swaggerDefinition,
  apis,
};

function buildSwaggerSpec() {
  const swaggerJsdoc = require('swagger-jsdoc');
  const publicApiBase = (process.env.PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
  const servers = publicApiBase ? [{ url: publicApiBase }] : [{ url: '/' }];
  return swaggerJsdoc({
    ...swaggerOptions,
    definition: {
      ...swaggerDefinition,
      servers,
    },
  });
}

module.exports = {
  swaggerDefinition,
  swaggerOptions,
  buildSwaggerSpec,
};
