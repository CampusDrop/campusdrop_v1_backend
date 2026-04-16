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
