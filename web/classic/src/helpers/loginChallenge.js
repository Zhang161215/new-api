/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

// 上游 rc.36：密码 / OAuth / 微信登录成功后，开了 2FA 或 Passkey 的账户会返回登录挑战
// { require_verification: true, flow_token, expires_at, methods: [{method: '2fa'|'passkey', available}] }，
// 用 /api/user/login/verify（2FA）或 /api/user/login/passkey/begin|finish（Passkey）完成后才拿到 AuthBundle。
// OAuth 回调页拿到挑战时存到 sessionStorage，再回登录页继续验证。

const LOGIN_CHALLENGE_KEY = 'login_verification_challenge';

export function isLoginChallenge(value) {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    value.require_verification === true &&
    typeof value.flow_token === 'string' &&
    value.flow_token.length > 0 &&
    typeof value.expires_at === 'number' &&
    Array.isArray(value.methods) &&
    value.methods.length > 0
  );
}

export function saveLoginChallenge(challenge) {
  try {
    sessionStorage.setItem(LOGIN_CHALLENGE_KEY, JSON.stringify(challenge));
  } catch (e) {}
}

// 取出并删除；过期或格式不对返回 null
export function takeLoginChallenge() {
  let challenge = null;
  try {
    challenge = JSON.parse(sessionStorage.getItem(LOGIN_CHALLENGE_KEY) || 'null');
    sessionStorage.removeItem(LOGIN_CHALLENGE_KEY);
  } catch (e) {
    return null;
  }
  if (!isLoginChallenge(challenge)) return null;
  if (challenge.expires_at * 1000 <= Date.now()) return null;
  return challenge;
}
