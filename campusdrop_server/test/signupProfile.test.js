const assert = require('node:assert/strict');
const { parseSignupProfile } = require('../lib/signupProfile');

assert.equal(parseSignupProfile(null).ok, true);

const okPhone = parseSignupProfile({ phone: '010-1234-5678', gender: '남성' });
assert.equal(okPhone.ok, true);
assert.equal(okPhone.phone, '01012345678');

const badPhone = parseSignupProfile({ phone: '02012341234', gender: '남성' });
assert.equal(badPhone.ok, false);

console.log('signupProfile tests ok');
