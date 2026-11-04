// 部署脚本测试：npm run test:infra
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = () => mkdtempSync(join(tmpdir(), 'infra-test-'));

function preflight(envText, ...args) {
  const dir = tmp();
  const env = join(dir, '.env');
  writeFileSync(env, envText);
  chmodSync(env, 0o600);
  const r = spawnSync('bash', [join(ROOT, 'infra/preflight.sh'), '--offline', '--env', env, ...args], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  return { code: r.status, out: r.stdout + r.stderr };
}

const BASE = [
  'JWT_SECRET=0123456789abcdef0123',
  'DATABASE_URL=postgresql://app:app_dev_only@localhost:5432/x',
  'PUBLIC_BASE_URL=http://localhost:3000'
].join('\n');

test('preflight：开发配置通过，模拟模型/连接器只是提醒', () => {
  const r = preflight(BASE + '\n');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /MODEL_PROVIDER=mock/);
  assert.match(r.out, /0 项错误/);
});

test('preflight：缺 JWT_SECRET 报错', () => {
  const r = preflight('DATABASE_URL=x\nPUBLIC_BASE_URL=http://localhost\n');
  assert.equal(r.code, 1);
  assert.match(r.out, /JWT_SECRET 为空/);
});

test('preflight：钉钉 Client Secret 填进 Client ID 时报错，且不打印任何值', () => {
  const secret = 'abcDEF_ghi-JKL123456789_verylongsecretvalue';
  const r = preflight([BASE.replace('http://localhost:3000', 'https://fin.example.com'),
    'CONNECTOR_PROVIDER=dingtalk', 'DINGTALK_NOTIFY_CHANNEL=work_notice',
    `DINGTALK_APP_KEY=${secret}`, 'DINGTALK_APP_SECRET=s3cretvalue', 'DINGTALK_AGENT_ID=12a'].join('\n'));
  assert.equal(r.code, 1);
  assert.match(r.out, /Client ID 含 _ 或 -/);
  assert.match(r.out, /AgentId 应为纯数字/);
  assert.ok(!r.out.includes(secret) && !r.out.includes('s3cretvalue'), '输出中出现了配置值');
});

test('preflight：CorpId 与 Client ID 相同报错', () => {
  const r = preflight([BASE.replace('http://localhost:3000', 'https://fin.example.com'),
    'CONNECTOR_PROVIDER=dingtalk', 'DINGTALK_NOTIFY_CHANNEL=work_notice', 'DINGTALK_CORP_ID=dingabc',
    'DINGTALK_APP_KEY=dingabc', 'DINGTALK_APP_SECRET=longsecret', 'DINGTALK_AGENT_ID=123'].join('\n'));
  assert.equal(r.code, 1);
  assert.match(r.out, /CorpId 与 Client ID 相同/);
});

test('preflight --prod：模拟模型、模拟连接器、隧道地址、开发密码都算错误', () => {
  const r = preflight([BASE.replace('http://localhost:3000', 'https://abc-def.trycloudflare.com'),
    'SEED_OWNER_PASSWORD=owner-dev-123'].join('\n'), '--prod');
  assert.equal(r.code, 1);
  for (const re of [/正式环境还在用模拟模型/, /正式环境不会真的发通知/, /临时隧道地址/, /开发默认密码/]) assert.match(r.out, re);
});

test('preflight：选了未实现的平台报错', () => {
  const r = preflight(BASE + '\nCONNECTOR_PROVIDER=feishu\n');
  assert.equal(r.code, 1);
  assert.match(r.out, /本期未实现/);
});

test('new-project：复制样板、改标识、重置文档', () => {
  const head = spawnSync('git', ['-C', ROOT, 'ls-tree', 'HEAD', 'template/样板说明.md'], { encoding: 'utf8' });
  if (!head.stdout.trim()) return; // 样板文件尚未提交时，git archive 取不到，跳过
  const dir = tmp();
  const dest = join(dir, 'gym-crm');
  const r = spawnSync('bash', [join(ROOT, 'infra/new-project.sh'), dest, '--slug', 'gym-crm', '--tenant', 'gym-demo',
    '--scope', '@gym', '--title', '健身房会员系统'], { encoding: 'utf8' });
  try {
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'gym-crm');
    const api = JSON.parse(readFileSync(join(dest, 'apps/api/package.json'), 'utf8'));
    assert.match(api.name, /^@gym\//);
    const grep = spawnSync('git', ['-C', dest, 'grep', '-lE', 'ecom-finance-app|ecomfin|luye-demo|@efa/', '--',
      ':!docs/样板参考', ':!README.md', ':!CLAUDE.md', ':!template', ':!.claude', ':!infra/new-project.sh', ':!infra/tests'], { encoding: 'utf8' });
    assert.equal(grep.stdout.trim(), '', '仍有样板标识：\n' + grep.stdout);
    assert.ok(existsSync(join(dest, 'docs/客户资料清单.md')));
    assert.ok(existsSync(join(dest, 'docs/样板参考/里程碑报告-M2.md')));
    assert.ok(existsSync(join(dest, 'input/demo/README.md')));
    assert.ok(!existsSync(join(dest, 'docs/screenshots')));
    const claude = readFileSync(join(dest, 'CLAUDE.md'), 'utf8');
    assert.match(claude, /本项目（健身房会员系统）补充规则/);
    assert.doesNotMatch(claude, /电商财务集成系统）补充规则/);
    assert.match(readFileSync(join(dest, 'docs/客户资料清单.md'), 'utf8'), /健身房会员系统上线需提供资料清单/);
    const log = spawnSync('git', ['-C', dest, 'log', '--oneline'], { encoding: 'utf8' });
    assert.match(log.stdout, /从 ecom-finance-app 样板创建 gym-crm/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('new-project：目标目录非空时拒绝覆盖', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'keep.txt'), 'x');
  const r = spawnSync('bash', [join(ROOT, 'infra/new-project.sh'), dir, '--slug', 'abc'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.ok(existsSync(join(dir, 'keep.txt')));
  rmSync(dir, { recursive: true, force: true });
});
