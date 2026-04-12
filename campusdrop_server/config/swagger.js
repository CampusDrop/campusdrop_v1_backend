const path = require('path');

/** OpenAPI 3.0 기본 정의 (paths는 swagger-jsdoc이 라우트 JSDoc에서 병합) */
const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Campus Drop API',
    version: '1.0.0',
    description: '세종대학교 익명 매칭 서비스 API 문서',
  },
  components: {
    securitySchemes: {
      UserUuidAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-user-uuid',
        description: '`POST /api/auth/verify-code` 응답의 `uuid` 값 (= DB `Identity.id`)',
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
          code: { type: 'string', description: '6자리 인증 번호' },
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
      SurveySubmitRequest: {
        type: 'object',
        description: '`surveyData` 또는 `survey` 중 하나 필수 (동일 의미, `surveyData ?? survey`)',
        properties: {
          surveyData: { type: 'object', additionalProperties: true },
          survey: { type: 'object', additionalProperties: true },
        },
      },
      SurveySubmitResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          userId: { type: 'string', format: 'uuid', description: 'Trait.id = Identity.id' },
        },
      },
      MatchRequestResponse: {
        type: 'object',
        properties: {
          partnerLabel: { type: 'string', description: '상대 MBTI 또는 "상대"' },
          score: { type: 'number', description: 'Python final_score' },
          report: { type: 'object', additionalProperties: true, description: 'Python match_report' },
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
