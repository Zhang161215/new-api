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

/**
 * 在线充值前展示的说明与协议（站点用户协议的精简版）。
 * 完整条款仍以《用户协议》《隐私政策》为准。
 */
export const DEFAULT_TOPUP_AGREEMENT = `**一、服务说明**

1. 充值为购买本站 **虚拟额度**（用于 API 调用等服务）。支付成功后，额度计入您的账户余额。
2. 额度 **仅限购买者本人使用**。禁止转售、出租、分发、共享账号或 API Key，禁止以任何形式向第三方提供本站调用能力。
3. 在线支付成功后，系统将按活动规则赠送 **抽奖次数**（默认每笔 +1，以当时活动说明为准）。抽奖奖品以兑换码发放，中奖后请到本页兑换入账。

**二、虚拟商品与退款**

4. 充值额度、抽奖次数及抽奖所得均为虚拟商品，**到账后原则上不支持退款、提现或转让**。
5. 因平台原因导致支付成功但额度未到账的，请保留订单号并联系客服核查处理。

**三、使用规范**

6. 禁止用于违反法律法规的用途；禁止滥用、压力测试、绕过限制或利用系统漏洞。
7. 违规的，平台可采取限制调用、中止服务、封禁账号等措施，且 **不予退款**。

**四、其他**

8. 本说明未尽事宜，适用本站《用户协议》与《隐私政策》。
9. 点击「同意并继续」即视为您已阅读并同意上述内容。平台可在公告后调整活动与本说明，已完成的充值不受影响。
`;

export const TOPUP_AGREEMENT_SKIP_KEY = 'synai996.topup.agreement.skip';

export function isTopupAgreementSkipped() {
  try {
    return localStorage.getItem(TOPUP_AGREEMENT_SKIP_KEY) === '1';
  } catch (e) {
    return false;
  }
}

export function setTopupAgreementSkipped(skip = true) {
  try {
    if (skip) {
      localStorage.setItem(TOPUP_AGREEMENT_SKIP_KEY, '1');
    } else {
      localStorage.removeItem(TOPUP_AGREEMENT_SKIP_KEY);
    }
  } catch (e) {
    // ignore quota / private mode
  }
}
