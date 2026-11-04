import * as fs from 'node:fs';
import * as path from 'node:path';

/** 前端页面与后端使用同一份核算/导入代码：两处副本必须逐字节一致，防止口径分叉 */
const shared = ['engine.js', 'data.js', 'importer.js', 'templates.js', 'xlsx.js'];
const legacy = path.join(__dirname, '..', 'legacy', 'src');
const web = path.join(__dirname, '..', '..', '..', 'apps', 'web', 'src');

describe('前后端核算代码一致', () => {
  it.each(shared)('%s', (f) => {
    expect(fs.readFileSync(path.join(web, f), 'utf8')).toBe(fs.readFileSync(path.join(legacy, f), 'utf8'));
  });
});
