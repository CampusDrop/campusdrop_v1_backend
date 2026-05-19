const test = require('node:test');
const assert = require('node:assert/strict');

const { hmacDigestToNumericCode } = require('../lib/festivalBoothHourCode');

test('hmacDigestToNumericCode: 항상 숫자 4자리(0000~9999), 마이너스 없음', () => {
  for (let a = 0; a < 256; a += 1) {
    for (let b = 0; b < 256; b += 17) {
      const code = hmacDigestToNumericCode(Buffer.from([a, b, 0x1c, 0xd1]));
      assert.match(code, /^\d{4}$/, `digest [${a},${b},0x1c,0xd1}] → ${JSON.stringify(code)}`);
    }
  }
});

test('hmacDigestToNumericCode: signed int32 오버플로 시에도 양수 4자리', () => {
  const digest = Buffer.from([0x80, 0x00, 0x00, 0x00]);
  let n = 0;
  for (let i = 0; i < 4; i += 1) {
    n = (n << 8) | digest[i];
  }
  assert.equal(String(n % 10000).padStart(4, '0'), '-3648');

  const code = hmacDigestToNumericCode(digest);
  assert.equal(code, '3648');
  assert.match(code, /^\d{4}$/);
});
