# 랜딩 좋아요 API — 프론트 연동 명세 (단일 참고 문서)

랜딩 **더블탭 등으로 좋아요 수를 올리는** HTTP API만 기술합니다. 브라우저·기기 식별(`clientKey`)은 **없습니다**. 새로고침 후에도 `POST`를 내면 합계가 또 올라갑니다.

---

## 공통

| 항목 | 값 |
|------|-----|
| Base URL | 배포 환경 API 오리진. **슬래시로 끝내지 않음.** |
| 인증 | 없음 |
| `POST` 본문 | 없어도 됨 (`Content-Type: application/json` + `{}` 또는 생략) |
| 오류 | `{ "error": "한글 메시지" }` |

---

## GET `/api/landing-like`

전역 좋아요 합계만 조회합니다.

**응답 `200`**

```json
{
  "likeCount": 1204
}
```

---

## POST `/api/landing-like`

합계를 **1 증가**시킵니다.

**응답 `200`**

```json
{
  "likeCount": 1205
}
```

**응답 `500`:** 서버 오류.

---

## 프론트 유의

- 더블탭 한 번에 `POST`가 **여러 번** 나가면 그만큼 +N 됩니다. 제스처/재시도에 맞게 디바운스하세요.
- “이미 눌렀음” 상태는 서버에 저장하지 않습니다. UI는 로컬 상태로만 채워도 됩니다.

---

## 예시 (fetch)

```javascript
const BASE = 'https://your-api-host';

async function getLandingLikeCount() {
  const res = await fetch(`${BASE}/api/landing-like`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.likeCount;
}

async function incrementLandingLike() {
  const res = await fetch(`${BASE}/api/landing-like`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.likeCount;
}
```

---

| 메서드 | 경로 | 용도 |
|--------|------|------|
| `GET` | `/api/landing-like` | 현재 `likeCount` |
| `POST` | `/api/landing-like` | `likeCount` +1 |
