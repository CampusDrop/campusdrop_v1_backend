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
  ],
  components: {
    securitySchemes: {
      UserUuidAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-user-uuid',
        description: '`POST /api/auth/verify-code` 응답의 `uuid` 값 (= DB `Identity.id`)',
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
        },
      },
      VerifyCodeResponse: {
        type: 'object',
        properties: {
          verified: { type: 'boolean', example: true },
          uuid: {
            type: 'string',
            format: 'uuid',
            description: '세션 식별자 — 이후 `x-user-uuid` 헤더',
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
          '`surveyData` 또는 `survey` 중 하나 필수. 설문 본문에 `gender`(남성/여성, 이성 매칭용) 및 `availability`(만남 가능 시간 목록) 포함.',
        properties: {
          surveyData: {
            type: 'object',
            additionalProperties: true,
            description:
              '라이프스타일 척도·선호 + `availability`: `{ date, time_slot }[]` (time_slot 예: 11:00-12:00)',
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
