/* 浏览器冒烟测试：登录 → 总览 → 生成 AI 草稿 → 提交 → 老板审核 → 通知。需先启动 API 与种子数据。
 * 用法：BASE_URL=http://localhost:3000 node apps/web/e2e/smoke.js（需要本机已安装 playwright）
 */
const { chromium } = require('playwright');
const SP = process.env.SHOT_DIR || require('node:os').tmpdir();
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PW = { finance: process.env.FINANCE_PASSWORD || 'finance-dev-123', owner: process.env.OWNER_PASSWORD || 'owner-dev-123' };
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE + '/');
  await p.waitForSelector('#login-form');
  await p.screenshot({ path: SP + '/login.png' });
  await p.fill('[name=tenant]', 'luye-demo'); await p.fill('[name=username]', 'finance'); await p.fill('[name=password]', PW.finance);
  await p.click('#login-form button[type=submit]');
  await p.waitForSelector('[data-page=briefing]', { timeout: 30000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: SP + '/overview.png' });
  await p.click('[data-page=briefing]');
  await p.waitForTimeout(1500);
  await p.click('[data-bf=generate]');
  await p.waitForSelector('[data-bf=submit]', { timeout: 30000 });
  await p.screenshot({ path: SP + '/briefing-draft.png', fullPage: true });
  await p.click('[data-bf=submit]');
  await p.waitForTimeout(1500);
  console.log('status after submit:', await p.textContent('.span-8 .panel-head .sub'));
  await p.click('[data-action=logout]');
  await p.waitForSelector('#login-form');
  await p.fill('[name=username]', 'owner'); await p.fill('[name=password]', PW.owner);
  await p.click('#login-form button[type=submit]');
  await p.waitForSelector('[data-page=briefing]', { timeout: 30000 });
  await p.click('[data-page=briefing]');
  await p.waitForSelector('[data-bf=approve]', { timeout: 30000 });
  await p.click('[data-bf=approve]');
  await p.waitForTimeout(2500);
  await p.screenshot({ path: SP + '/briefing-approved.png', fullPage: true });
  console.log('status after approve:', await p.textContent('.span-8 .panel-head .sub'));
  console.log('errors:', errs);
  await b.close();
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1); });
