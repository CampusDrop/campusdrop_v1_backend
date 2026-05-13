const assert = require('node:assert/strict');
const {
  parseSignupProfile,
  VERIFY_CODE_PROFILE_PHONE_INVALID,
  VERIFY_CODE_PROFILE_REQUIRED,
} = require('../lib/signupProfile');

assert.equal(parseSignupProfile(null).ok, true);

const okPhone = parseSignupProfile({ phone: '010-1234-5678', gender: '남성' });
assert.equal(okPhone.ok, true);
assert.equal(okPhone.phone, '01012345678');

const badPhone = parseSignupProfile({ phone: '02012341234', gender: '남성' });
assert.equal(badPhone.ok, false);
assert.equal(String(badPhone.error), VERIFY_CODE_PROFILE_PHONE_INVALID);

const reqMiss = parseSignupProfile(null, { phoneRequired: true });
assert.equal(reqMiss.ok, false);
assert.ok(String(reqMiss.error).includes('profile.phone'));

const reqEmpty = parseSignupProfile({}, { phoneRequired: true });
assert.equal(reqEmpty.ok, false);
assert.equal(reqEmpty.error, VERIFY_CODE_PROFILE_REQUIRED);

const reqOk = parseSignupProfile({ phone: '01098765432' }, { phoneRequired: true });
assert.equal(reqOk.ok, true);

console.log('signupProfile tests ok');
