/* 把 src/ 下的 HTML/CSS/JS 内联成一个可双击打开的单文件 HTML。
 * 用法：node build/build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const OUT_NAME = '电商财务集成管理系统.html';

let html = readFileSync(join(src, 'index.html'), 'utf8');

// 内联样式
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/, (_, p) => {
  const css = readFileSync(join(src, p), 'utf8');
  return '<style>\n' + css + '\n</style>';
});

// 内联脚本
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, p) => {
  const js = readFileSync(join(src, p), 'utf8').replace(/<\/script/gi, '<\\/script');
  return '<script>\n' + js + '\n</script>';
});

if (/<script src=/.test(html) || /<link rel="stylesheet"/.test(html)) {
  throw new Error('仍有未内联的外部资源');
}

const banner = '<!-- 电商财务集成管理系统（演示版）· 单文件离线运行 · 生成于 ' + new Date().toISOString().slice(0, 10) + ' -->\n';
html = banner + html;

writeFileSync(join(root, OUT_NAME), html);
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', OUT_NAME), html);

const size = statSync(join(root, OUT_NAME)).size;
const hash = createHash('sha256').update(readFileSync(join(root, OUT_NAME))).digest('hex').slice(0, 12);
console.log(`built ${OUT_NAME}: ${(size / 1024).toFixed(1)} KB, sha256:${hash}`);
