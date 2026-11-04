/**
 * charts.js — 零依赖 SVG 图表模块
 * ---------------------------------------------------------------------------
 * 设计约定（给界面层/后续维护者）：
 *  1. 全部是纯函数：输入普通 JS 对象，返回一段 SVG 字符串，调用方把字符串
 *     插入自己的容器即可（模块本身不碰页面）。
 *  2. 不访问 DOM、window（仅在文件末尾为浏览器挂 window.Charts）、不引第三方库。
 *  3. 背景透明、全部文字使用 <text>、不输出 <style> 标签、不使用 <foreignObject>。
 *  4. 颜色一律是带 fallback 的 CSS 变量（如 var(--chart-1, #2F6B5E)），
 *     字号与线宽用 SVG 属性。字体继承 var(--font-num, ui-sans-serif)。
 *  5. 每个数据点都带原生 <title> tooltip；所有用户文本都经过 escapeXml。
 *  6. 空数据或全 0 时返回一张可正常显示的"暂无数据"占位图，绝不抛异常。
 *
 * 可访问性 / 响应式：所有图表统一 viewBox + width="100%" +
 * preserveAspectRatio="xMidYMid meet" + role="img" + <title>。
 */

'use strict';

/* =========================================================================
 * 常量与主题
 * ========================================================================= */

// 默认画布宽度（高度由各图参数控制）。图表最终按 100% 宽度等比缩放。
const DEFAULT_WIDTH = 640;

// 字体：数值优先用等宽数字，整体继承页面字体，取不到时退回系统无衬线字体。
const FONT_STACK = 'var(--font-num, ui-sans-serif)';

// 中性色 / 语义色（全部带 fallback，打印时仍保持克制的暖灰调）。
const C = {
  text: 'var(--chart-text, #3F3B34)',
  muted: 'var(--chart-muted, #8A8478)',
  faint: 'var(--chart-faint, #B4AC9F)',
  grid: 'var(--chart-grid, #E7E2D8)',
  axis: 'var(--chart-axis, #CFC7B8)',
  track: 'var(--chart-track, #F1EDE4)',
  surface: 'var(--chart-surface, #FFFFFF)',
  onAccent: 'var(--chart-on-accent, #FFFFFF)',
  // 语义色不复用序列色板的位置，避免宿主把 --chart-6 定义成蓝色后，
  // 瀑布图的"减少"也变成蓝色。宿主可按需覆盖 --chart-positive 等变量。
  pos: 'var(--chart-positive, #2F6B5E)',
  neg: 'var(--chart-negative, #A45A52)',
  start: 'var(--chart-start, #8A6A5A)',
  total: 'var(--chart-total, #5B7C99)',
};

// 图表主色板：偏印刷的绿 / 赭 / 蓝灰 / 棕 / 鼠尾草 / 砖红。
const PALETTE = [
  'var(--chart-1, #2F6B5E)',
  'var(--chart-2, #C08A44)',
  'var(--chart-3, #5B7C99)',
  'var(--chart-4, #8A6A5A)',
  'var(--chart-5, #7C8B6F)',
  'var(--chart-6, #A45A52)',
  'var(--chart-7, #6B5B7B)',
  'var(--chart-8, #4F7A7A)',
];

/* =========================================================================
 * 基础工具
 * ========================================================================= */

/** HTML/XML 转义；中文原样保留，只处理会破坏标记的 5 个字符。 */
function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 坐标保留 2 位小数，顺便挡掉 NaN / Infinity，保证 SVG 合法。 */
function num(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.round(n * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 通用标签拼装器：属性全部转义，children 为已生成的安全标记。 */
function el(tag, attributes, children) {
  let out = '<' + tag;
  if (attributes) {
    for (const key of Object.keys(attributes)) {
      const value = attributes[key];
      if (value === undefined || value === null || value === false) continue;
      out += ' ' + key + '="' + escapeXml(value) + '"';
    }
  }
  if (children === undefined || children === null || children === '') return out + '/>';
  return out + '>' + children + '</' + tag + '>';
}

function titleEl(text) {
  return el('title', {}, escapeXml(text));
}

/** 数字文本（用于坐标轴、标签、tooltip 的默认格式）。 */
function textEl(x, y, content, options) {
  const o = options || {};
  const attrs = { x: num(x), y: num(y) };
  if (o.anchor) attrs['text-anchor'] = o.anchor;
  attrs['font-size'] = num(o.size == null ? 10 : o.size);
  if (o.weight) attrs['font-weight'] = o.weight;
  if (o.cls) attrs.class = o.cls;
  if (o.transform) attrs.transform = o.transform;
  let style = 'fill:' + (o.fill || C.text);
  if (o.opacity != null) style += ';opacity:' + num(o.opacity);
  attrs.style = style;
  return el('text', attrs, escapeXml(content == null ? '' : content));
}

function rectEl(x, y, width, height, options) {
  const o = options || {};
  const attrs = {
    x: num(x),
    y: num(y),
    width: num(Math.max(0, width)),
    height: num(Math.max(0, height)),
  };
  if (o.rx != null) attrs.rx = num(o.rx);
  if (o.ry != null) attrs.ry = num(o.ry);
  if (o.cls) attrs.class = o.cls;
  let style = 'fill:' + (o.fill || 'none');
  if (o.fillOpacity != null) style += ';fill-opacity:' + num(o.fillOpacity);
  if (o.stroke) {
    style += ';stroke:' + o.stroke;
    style += ';stroke-width:' + num(o.strokeWidth == null ? 1 : o.strokeWidth);
  }
  if (o.dash) attrs['stroke-dasharray'] = o.dash;
  if (o.attrs) Object.assign(attrs, o.attrs);
  attrs.style = style;
  return el('rect', attrs, o.title ? titleEl(o.title) : null);
}

function lineEl(x1, y1, x2, y2, options) {
  const o = options || {};
  const attrs = { x1: num(x1), y1: num(y1), x2: num(x2), y2: num(y2) };
  if (o.cls) attrs.class = o.cls;
  if (o.dash) attrs['stroke-dasharray'] = o.dash;
  let style = 'stroke:' + (o.stroke || C.grid);
  style += ';stroke-width:' + num(o.width == null ? 1 : o.width);
  if (o.opacity != null) style += ';opacity:' + num(o.opacity);
  attrs.style = style;
  return el('line', attrs);
}

function circleEl(cx, cy, r, options) {
  const o = options || {};
  const attrs = { cx: num(cx), cy: num(cy), r: num(Math.max(0, r)) };
  if (o.cls) attrs.class = o.cls;
  if (o.attrs) Object.assign(attrs, o.attrs);
  let style = 'fill:' + (o.fill || C.pos);
  if (o.fillOpacity != null) style += ';fill-opacity:' + num(o.fillOpacity);
  if (o.stroke) {
    style += ';stroke:' + o.stroke;
    style += ';stroke-width:' + num(o.strokeWidth == null ? 1 : o.strokeWidth);
  }
  if (o.opacity != null) style += ';opacity:' + num(o.opacity);
  attrs.style = style;
  return el('circle', attrs, o.title ? titleEl(o.title) : null);
}

function pathEl(d, options) {
  const o = options || {};
  const attrs = { d };
  if (o.cls) attrs.class = o.cls;
  if (o.fillRule) attrs['fill-rule'] = o.fillRule;
  let style = 'fill:' + (o.fill || 'none');
  if (o.fillOpacity != null) style += ';fill-opacity:' + num(o.fillOpacity);
  if (o.stroke) {
    style += ';stroke:' + o.stroke;
    style += ';stroke-width:' + num(o.strokeWidth == null ? 1 : o.strokeWidth);
    style += ';stroke-linecap:' + (o.linecap || 'round');
    style += ';stroke-linejoin:' + (o.linejoin || 'round');
  }
  if (o.opacity != null) style += ';opacity:' + num(o.opacity);
  if (o.attrs) Object.assign(attrs, o.attrs);
  attrs.style = style;
  return el('path', attrs, o.title ? titleEl(o.title) : null);
}

/* =========================================================================
 * 数值格式
 * ========================================================================= */

/** 默认数值格式：千分位，最多 2 位小数，去掉无意义的小数尾零。 */
function formatNumber(value) {  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '0';
  const sign = n < 0 ? '-' : '';
  const rounded = Math.round(Math.abs(n) * 100) / 100;
  let raw = String(rounded);
  if (/e/i.test(raw)) raw = rounded.toFixed(2);
  const parts = raw.split('.');
  const grouped = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + grouped + (parts[1] ? '.' + parts[1] : '');
}

/** 紧凑金额：12.4万 / 1.2亿 / 9,999。 */
function formatCompact(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  const trim = (s) => s.replace(/\.0$/, '');
  if (abs >= 1e8) return trim((n / 1e8).toFixed(1)) + '亿';
  if (abs >= 1e4) return trim((n / 1e4).toFixed(1)) + '万';
  return formatNumber(n);
}

function pickFormatter(fn) {
  return typeof fn === 'function' ? fn : formatNumber;
}

function formatSigned(value, formatter) {
  const str = String(formatter(value));
  return value > 0 && !/^[+＋]/.test(str) ? '+' + str : str;
}

/* =========================================================================
 * 文本度量 / 截断（不依赖浏览器测量，纯计算即可保持纯函数）
 * ========================================================================= */

function charWidth(ch, fontSize) {
  const code = ch.codePointAt(0);
  if (code >= 0x2e80) return fontSize; // 中日韩文字 / emoji 近似全角
  if (/[0-9]/.test(ch)) return fontSize * 0.56;
  if (/[A-Z]/.test(ch)) return fontSize * 0.64;
  if (/[a-z]/.test(ch)) return fontSize * 0.52;
  return fontSize * 0.4;
}

function textWidth(text, fontSize) {
  let width = 0;
  for (const ch of Array.from(String(text == null ? '' : text))) width += charWidth(ch, fontSize);
  return width;
}

/** 按估算宽度截断，超出部分用省略号表示。 */
function truncateToWidth(text, maxWidth, fontSize) {
  const full = String(text == null ? '' : text);
  if (textWidth(full, fontSize) <= maxWidth) return full;
  const chars = Array.from(full);
  let out = '';
  let width = 0;
  const limit = Math.max(fontSize, maxWidth - fontSize);
  for (const ch of chars) {
    const w = charWidth(ch, fontSize);
    if (width + w > limit) break;
    out += ch;
    width += w;
  }
  return out + '…';
}

function truncateChars(text, maxChars) {
  const chars = Array.from(String(text == null ? '' : text));
  if (chars.length <= maxChars) return chars.join('');
  return chars.slice(0, Math.max(1, maxChars - 1)).join('') + '…';
}

/* =========================================================================
 * 颜色安全校验
 * 颜色可能来自设置/数据，直接拼进 style 有注入风险，只接受安全形态。
 * ========================================================================= */

const COLOR_RE = /^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20}|(?:rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)|var\(--[A-Za-z0-9_-]+(?:\s*,\s*(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20}))?\)|transparent)$/;

function chartColor(index) {
  const i = ((Number(index) || 0) % PALETTE.length + PALETTE.length) % PALETTE.length;
  return PALETTE[i];
}

function safeColor(color, fallbackIndex) {
  const raw = color == null ? '' : String(color).trim();
  if (raw && COLOR_RE.test(raw)) return raw;
  return chartColor(fallbackIndex || 0);
}

/* =========================================================================
 * 刻度与坐标
 * ========================================================================= */

function niceStep(raw) {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const f = raw / base;
  let mult;
  if (f <= 1) mult = 1;
  else if (f <= 2) mult = 2;
  else if (f <= 2.5) mult = 2.5;
  else if (f <= 5) mult = 5;
  else mult = 10;
  return mult * base;
}

function growNiceStep(step) {
  const exp = Math.floor(Math.log10(step));
  const base = Math.pow(10, exp);
  const f = step / base;
  if (f < 1.5) return 2 * base;
  if (f < 2.25) return 2.5 * base;
  if (f < 3.75) return 5 * base;
  if (f < 7.5) return 10 * base;
  return 20 * base;
}

/**
 * 生成"好看"的线性刻度：
 *  - 固定返回 tickCount 个刻度（含首尾），便于 yTicks=4 的约定；
 *  - includeZero 时保证 0 在值域内（柱图/瀑布图的基线要求）；
 *  - 对全正/全负数据尽量不跨越 0，避免无意义的空白区域。
 */
function buildScale(minValue, maxValue, tickCount, options) {
  const o = options || {};
  const count = clamp(Math.round(Number(tickCount) || 4), 2, 8);
  const intervals = count - 1;

  let lo = Number.isFinite(minValue) ? Number(minValue) : 0;
  let hi = Number.isFinite(maxValue) ? Number(maxValue) : 0;
  if (hi < lo) {
    const tmp = lo;
    lo = hi;
    hi = tmp;
  }

  let dataSpan = hi - lo;
  if (!(dataSpan > 0)) {
    const pad = Math.abs(hi) * 0.25 || 1;
    lo -= pad;
    hi += pad;
    dataSpan = hi - lo;
  }

  const includeZero = !!o.includeZero;
  let pLo = lo - dataSpan * 0.06;
  let pHi = hi + dataSpan * 0.12;
  if (includeZero) {
    // 柱图/瀑布图必须含 0 基线：全正数据底部贴 0，全负数据顶部贴 0，
    // 跨 0 数据才向两侧留白，避免出现无意义的负刻度。
    pLo = lo < 0 ? Math.min(0, pLo) : 0;
    pHi = hi > 0 ? Math.max(0, pHi) : 0;
  }

  let step = niceStep((pHi - pLo) / intervals);
  let dLo;
  let dHi;

  if (pLo >= 0) {
    if (includeZero) {
      // 全正数据 + 强制 0 基线：底部贴 0，向上取整。
      dLo = 0;
      step = niceStep(Math.max(pHi, 1e-9) / intervals);
      dHi = step * intervals;
      for (let guard = 0; guard < 8 && dHi < pHi - 1e-9; guard++) {
        step = growNiceStep(step);
        dHi = step * intervals;
      }
    } else {
      // 全正折线：围绕数据中点对称取整，不给负数轴。
      const center = (pLo + pHi) / 2;
      dLo = center - (step * intervals) / 2;
      dHi = center + (step * intervals) / 2;
      if (dLo < 0) {
        dLo = 0;
        dHi = step * intervals;
        for (let guard = 0; guard < 8 && dHi < pHi - 1e-9; guard++) {
          step = growNiceStep(step);
          dHi = step * intervals;
        }
      }
    }
  } else if (pHi <= 0) {
    // 全负数据：顶部贴 0，向下取整。
    dHi = 0;
    step = niceStep(Math.max(-pLo, 1e-9) / intervals);
    dLo = -(step * intervals);
    for (let guard = 0; guard < 8 && dLo > pLo + 1e-9; guard++) {
      step = growNiceStep(step);
      dLo = -(step * intervals);
    }
  } else {
    // 跨 0 数据：对称展开，0 自然落在值域内。
    const center = (pLo + pHi) / 2;
    dLo = center - (step * intervals) / 2;
    dHi = center + (step * intervals) / 2;
  }

  // 兜底：任何情况下数据都不能跑出坐标轴。
  for (let guard = 0; guard < 12 && (dLo > lo + 1e-9 || dHi < hi - 1e-9); guard++) {
    step = growNiceStep(step);
    if (dLo === 0) dHi = step * intervals;
    else if (dHi === 0) dLo = -(step * intervals);
    else {
      const center = (dLo + dHi) / 2;
      dLo = center - (step * intervals) / 2;
      dHi = center + (step * intervals) / 2;
    }
  }

  const decimals = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)) + 1);
  const clean = (v) => {
    const r = Number(v.toFixed(decimals));
    return Object.is(r, -0) ? 0 : r;
  };
  const ticks = [];
  for (let i = 0; i < count; i++) ticks.push(clean(dLo + step * i));

  return { lo: ticks[0], hi: ticks[ticks.length - 1], step, ticks };
}

/** 值 → y 坐标的线性映射。 */
function makeY(scale, top, plotHeight) {
  const span = scale.hi - scale.lo || 1;
  return (value) => top + ((scale.hi - value) / span) * plotHeight;
}

/** y 轴（网格 + 标签 + 0 轴）通用渲染。 */
function renderYAxis(scale, format, geom, prefix) {
  const { left, top, plotWidth, plotHeight } = geom;
  const y = makeY(scale, top, plotHeight);
  let out = '';
  for (const tick of scale.ticks) {
    const yy = y(tick);
    out += lineEl(left, yy, left + plotWidth, yy, {
      stroke: C.grid,
      width: 1,
      cls: prefix + '-grid',
    });
    out += textEl(left - 8, yy + 3.4, String(format(tick)), {
      anchor: 'end',
      size: 9.5,
      fill: C.muted,
      cls: prefix + '-ytick',
    });
  }
  if (scale.lo < 0 && scale.hi > 0) {
    const zeroY = y(0);
    out += lineEl(left, zeroY, left + plotWidth, zeroY, {
      stroke: C.axis,
      width: 1.2,
      cls: prefix + '-zero',
    });
  }
  return out;
}

function axisLeftMargin(scale, format, minWidth) {
  const widest = scale.ticks.reduce((max, tick) => {
    return Math.max(max, textWidth(format(tick), 9.5));
  }, 0);
  return clamp(12 + widest + 8, minWidth == null ? 40 : minWidth, 104);
}

/* =========================================================================
 * 图例与通用注释
 * ========================================================================= */

function seriesLegend(series, x, y, maxWidth, prefix) {
  let out = '';
  let cursor = x;
  let shown = 0;
  for (const item of series) {
    const name = truncateToWidth(item.name, 92, 9.5);
    const itemWidth = 12 + textWidth(name, 9.5) + 16;
    if (cursor + itemWidth > x + maxWidth && shown > 0) break;
    out += circleEl(cursor + 3.5, y - 3.2, 3.4, {
      fill: item.color,
      cls: prefix + '-legend-dot',
    });
    out += textEl(cursor + 11, y, name, {
      size: 9.5,
      fill: C.text,
      cls: prefix + '-legend-text',
    });
    cursor += itemWidth;
    shown++;
  }
  if (shown < series.length) {
    out += textEl(cursor + 2, y, '+' + (series.length - shown), {
      size: 9,
      fill: C.muted,
      cls: prefix + '-legend-more',
    });
  }
  return out;
}

/* =========================================================================
 * 根节点 / 占位
 * ========================================================================= */

function renderSvg(options) {
  const o = options || {};
  const width = Math.max(20, Number(o.width) || DEFAULT_WIDTH);
  const height = Math.max(20, Number(o.height) || 120);
  const label = String(o.label == null ? '图表' : o.label);
  const attrs = {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 ' + num(width) + ' ' + num(height),
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': label,
    'data-chart': o.type || 'chart',
    style: 'font-family:' + FONT_STACK + ';font-variant-numeric:tabular-nums',
  };
  if (o.empty) attrs['data-empty'] = 'true';
  const children = titleEl(label) + (o.children || '');
  return el('svg', attrs, children);
}

function placeholder(width, height, message, type) {
  const w = Math.max(40, Number(width) || DEFAULT_WIDTH);
  const h = Math.max(40, Number(height) || 140);
  const msg = message || '暂无数据';
  const fontSize = clamp(h * 0.14, 9, 13);
  const children =
    rectEl(1, 1, w - 2, h - 2, {
      rx: 8,
      fill: 'none',
      stroke: C.grid,
      strokeWidth: 1,
      dash: '4 5',
      cls: 'empty-box',
    }) +
    textEl(w / 2, h / 2 + fontSize * 0.35, msg, {
      anchor: 'middle',
      size: fontSize,
      fill: C.muted,
      cls: 'empty-text',
    });
  return renderSvg({
    width: w,
    height: h,
    type: type || 'empty',
    label: msg + '（图表占位）',
    empty: true,
    children,
  });
}

function allNearZero(values) {
  return values.every((v) => !Number.isFinite(v) || Math.abs(v) < 1e-9);
}

function hashId(text) {
  let hash = 2166136261;
  const str = String(text);
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/* =========================================================================
 * 1. 折线图
 * ========================================================================= */

/**
 * 折线图（可带渐变面积）。
 * @param {object} options
 * @param {Array<{name: string, color?: string, points: Array<number|null>}>} options.series 系列，points 与 xLabels 等长
 * @param {string[]} options.xLabels x 轴标签
 * @param {number} [options.height=220] 画布高度（viewBox 高度）
 * @param {(value:number)=>string} [options.valueFormat] 数值格式，默认千分位
 * @param {boolean} [options.showArea=true] 是否显示渐变面积
 * @param {number} [options.yTicks=4] y 轴刻度数量
 * @returns {string} SVG 字符串；空数据/全 0 时返回占位图
 */
function lineChart(options) {
  const opt = options || {};
  const xLabels = Array.isArray(opt.xLabels) ? opt.xLabels : [];
  const rawSeries = Array.isArray(opt.series) ? opt.series : [];
  const height = clamp(Number(opt.height) || 220, 140, 640);
  const formatter = pickFormatter(opt.valueFormat);
  const showArea = opt.showArea !== false;
  const tickCount = clamp(Number(opt.yTicks) || 4, 2, 6);

  const series = rawSeries
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      name: item.name == null ? '系列' + (index + 1) : String(item.name),
      color: safeColor(item.color, index),
      points: (Array.isArray(item.points) ? item.points : []).map(finiteOrNull),
    }))
    .filter((item) => item.points.length > 0);

  const maxLen = series.reduce((max, item) => Math.max(max, item.points.length), 0);
  const n = Math.max(xLabels.length, maxLen);
  const values = series.flatMap((item) => item.points).filter((v) => v !== null);

  if (!series.length || n === 0 || !values.length || allNearZero(values)) {
    return placeholder(DEFAULT_WIDTH, height, '暂无数据', 'line');
  }

  const xLabelAt = (index) => {
    if (index < xLabels.length && xLabels[index] != null && String(xLabels[index]) !== '') {
      return String(xLabels[index]);
    }
    return '第' + (index + 1) + '点';
  };

  let minValue = Math.min(...values);
  let maxValue = Math.max(...values);
  const scale = buildScale(minValue, maxValue, tickCount, { includeZero: minValue < 0 });
  const left = axisLeftMargin(scale, formatter);
  const right = 20;
  const top = 38; // 顶部留一行图例
  const bottom = 30;
  const W = DEFAULT_WIDTH;
  const plotWidth = W - left - right;
  const plotHeight = height - top - bottom;
  const y = makeY(scale, top, plotHeight);

  const xAt = (index) => {
    if (n <= 1) return left + plotWidth / 2;
    return left + (plotWidth * index) / (n - 1);
  };

  // x 轴标签过多时隔几个显示，最后一帧始终保留。
  const labelWidths = Array.from({ length: n }, (_, i) => textWidth(xLabelAt(i), 10));
  const widestLabel = Math.max(20, ...labelWidths);
  const maxLabels = Math.max(2, Math.floor(plotWidth / Math.max(36, widestLabel + 20)));
  const labelStep = Math.max(1, Math.ceil(n / maxLabels));
  const wanted = [];
  for (let i = 0; i < n; i += labelStep) wanted.push(i);
  if (n - 1 >= 0 && wanted[wanted.length - 1] !== n - 1) wanted.push(n - 1);
  if (wanted.length > 1) {
    const lastGap = wanted[wanted.length - 1] - wanted[wanted.length - 2];
    if (lastGap < Math.max(1, labelStep * 0.55)) wanted.splice(wanted.length - 2, 1);
  }
  const wantedSet = new Set(wanted);

  let defs = '';
  let body = '';
  let areaBody = '';
  let seriesBody = '';

  // 图例
  body += seriesLegend(series, left, 17, W - left - right, 'lc');

  // 网格与坐标轴
  body += renderYAxis(scale, formatter, { left, top, plotWidth, plotHeight }, 'lc');

  // 面积基线：0 在值域内则贴 0，否则贴到图底/图顶。
  let areaBaseValue;
  if (scale.lo <= 0 && scale.hi >= 0) areaBaseValue = 0;
  else areaBaseValue = scale.lo;
  const baseY = y(areaBaseValue);

  for (let index = 0; index < series.length; index++) {
    const item = series[index];
    const gradientId = 'lc-area-' + hashId(item.name + '|' + item.color + '|' + item.points.join(','));
    if (showArea) {
      defs += el(
        'linearGradient',
        { id: gradientId, x1: '0', y1: '0', x2: '0', y2: '1' },
        el('stop', { offset: '0%', style: 'stop-color:' + item.color + ';stop-opacity:0.26' }) +
          el('stop', { offset: '100%', style: 'stop-color:' + item.color + ';stop-opacity:0.02' })
      );
    }

    // 折线：遇到 null 断点则重新 M。
    let d = '';
    let areaD = '';
    let started = false;
    let runStart = null;
    let runLast = null;
    for (let i = 0; i < n; i++) {
      const value = i < item.points.length ? item.points[i] : null;
      if (value === null) {
        if (showArea && runStart !== null && runLast !== null && runLast > runStart) {
          areaD += ' M ' + num(xAt(runStart)) + ' ' + num(baseY);
          for (let k = runStart; k <= runLast; k++) {
            const v = item.points[k];
            if (v === null) continue;
            areaD += ' L ' + num(xAt(k)) + ' ' + num(y(v));
          }
          areaD += ' L ' + num(xAt(runLast)) + ' ' + num(baseY) + ' Z';
        }
        started = false;
        runStart = null;
        runLast = null;
        continue;
      }
      const xx = xAt(i);
      const yy = y(value);
      d += (started ? ' L ' : ' M ') + num(xx) + ' ' + num(yy);
      started = true;
      if (runStart === null) runStart = i;
      runLast = i;
    }
    if (showArea && runStart !== null && runLast !== null && runLast > runStart) {
      areaD += ' M ' + num(xAt(runStart)) + ' ' + num(baseY);
      for (let k = runStart; k <= runLast; k++) {
        const v = item.points[k];
        if (v === null) continue;
        areaD += ' L ' + num(xAt(k)) + ' ' + num(y(v));
      }
      areaD += ' L ' + num(xAt(runLast)) + ' ' + num(baseY) + ' Z';
    }

    if (showArea && areaD) {
      areaBody += pathEl(areaD, {
        cls: 'lc-area',
        fill: 'url(#' + gradientId + ')',
        attrs: { 'data-series': index },
      });
    }
    if (d) {
      seriesBody += pathEl(d, {
        cls: 'lc-line',
        fill: 'none',
        stroke: item.color,
        strokeWidth: 2,
        attrs: { 'data-series': index, 'data-points': item.points.filter((v) => v !== null).length },
      });
    }

    // 数据点：每个点一个带原生 tooltip 的圆点。
    for (let i = 0; i < n; i++) {
      const value = i < item.points.length ? item.points[i] : null;
      if (value === null) continue;
      seriesBody += circleEl(xAt(i), y(value), 2.7, {
        cls: 'lc-point',
        fill: C.surface,
        stroke: item.color,
        strokeWidth: 1.7,
        title: item.name + ' · ' + xLabelAt(i) + '：' + formatter(value),
        attrs: { 'data-series': index, 'data-index': i, 'data-value': num(value) },
      });
    }

    // 末端数值标注。
    let lastIndex = -1;
    for (let i = item.points.length - 1; i >= 0; i--) {
      if (item.points[i] !== null) {
        lastIndex = i;
        break;
      }
    }
    if (lastIndex >= 0) {
      const px = xAt(lastIndex);
      const py = y(item.points[lastIndex]);
      const anchor = px > W - right - 56 ? 'end' : 'start';
      const labelX = anchor === 'end' ? px - 8 : px + 8;
      const labelY = py - top < 18 ? py + 16 : py - 8;
      seriesBody += textEl(labelX, labelY, formatter(item.points[lastIndex]), {
        anchor,
        size: 10,
        weight: 600,
        fill: item.color,
        cls: 'lc-endlabel',
      });
    }
  }

  // 面积统一垫在折线与数据点下方，避免后画的面积遮住前一条线。
  body += areaBody + seriesBody;

  // x 轴文字（末项过长时改为右对齐，避免被 viewBox 裁切）
  for (let i = 0; i < n; i++) {
    if (!wantedSet.has(i)) continue;
    const labelText = truncateToWidth(xLabelAt(i), 90, 10);
    const labelWidth = textWidth(labelText, 10);
    let labelX = xAt(i);
    let anchor = 'middle';
    if (labelX + labelWidth / 2 > W - 2) {
      labelX = W - 4;
      anchor = 'end';
    } else if (labelX - labelWidth / 2 < 2) {
      labelX = 4;
      anchor = 'start';
    }
    body += textEl(labelX, height - 10, labelText, {
      anchor,
      size: 10,
      fill: C.muted,
      cls: 'lc-xlabel',
    });
  }

  // 画布最底部一条浅浅的基线，增强"轴"的存在感。
  body += lineEl(left, top + plotHeight, left + plotWidth, top + plotHeight, {
    stroke: C.axis,
    width: 1,
    cls: 'lc-baseline',
  });

  const names = series.map((item) => item.name).join('、');
  const label = '折线图：' + names + '，' + n + ' 个数据点';

  return renderSvg({
    width: W,
    height,
    type: 'line',
    label,
    children: (defs ? el('defs', {}, defs) : '') + body,
  });
}

/* =========================================================================
 * 2. 堆叠柱状图
 * ========================================================================= */

/**
 * 堆叠柱状图，支持负值向下堆叠，并在柱顶显示合计。
 * @param {object} options
 * @param {string[]} options.categories 分类标签
 * @param {Array<{name: string, color?: string, values: Array<number|null>}>} options.series
 * @param {number} [options.height=240]
 * @param {(value:number)=>string} [options.valueFormat]
 * @param {boolean} [options.showTotals=true] 是否显示顶部合计
 * @param {number} [options.yTicks=4]
 * @returns {string} SVG 字符串
 */
function stackedBarChart(options) {
  const opt = options || {};
  const rawCategories = Array.isArray(opt.categories) ? opt.categories : [];
  const rawSeries = Array.isArray(opt.series) ? opt.series : [];
  const height = clamp(Number(opt.height) || 240, 160, 640);
  const formatter = pickFormatter(opt.valueFormat);
  const showTotals = opt.showTotals !== false;
  const tickCount = clamp(Number(opt.yTicks) || 4, 2, 6);

  const maxLen = rawSeries.reduce((max, item) => {
    return Math.max(max, item && Array.isArray(item.values) ? item.values.length : 0);
  }, 0);
  const n = Math.max(rawCategories.length, maxLen);

  const series = rawSeries
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      name: item.name == null ? '系列' + (index + 1) : String(item.name),
      color: safeColor(item.color, index),
      values: (Array.isArray(item.values) ? item.values : []).map(finiteOrNull),
    }));

  const allValues = series.flatMap((item) => item.values).filter((v) => v !== null);
  if (!n || !series.length || !allValues.length || allNearZero(allValues)) {
    return placeholder(DEFAULT_WIDTH, height, '暂无数据', 'stacked-bar');
  }

  // 每列正/负堆叠合计，用于确定值域和合计标签位置。
  const posSum = new Array(n).fill(0);
  const negSum = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (const item of series) {
      const value = item.values[i];
      if (value === null || value === undefined) continue;
      if (value >= 0) posSum[i] += value;
      else negSum[i] += value;
    }
  }
  const totals = posSum.map((value, index) => value + negSum[index]);

  let dataMin = Math.min(0, ...negSum);
  let dataMax = Math.max(0, ...posSum);
  if (dataMin === 0 && dataMax === 0) {
    return placeholder(DEFAULT_WIDTH, height, '暂无数据', 'stacked-bar');
  }

  const scale = buildScale(dataMin, dataMax, tickCount, { includeZero: true });
  const left = axisLeftMargin(scale, formatter);
  const right = 18;
  const top = 40; // 图例 + 合计标签
  const bottom = 34;
  const W = DEFAULT_WIDTH;
  const plotWidth = W - left - right;
  const plotHeight = height - top - bottom;
  const y = makeY(scale, top, plotHeight);
  const band = plotWidth / n;
  const barWidth = Math.min(46, Math.max(8, band * 0.58));
  const zeroY = y(0);

  let body = '';
  body += seriesLegend(series, left, 18, W - left - right, 'sb');
  body += renderYAxis(scale, formatter, { left, top, plotWidth, plotHeight }, 'sb');

  for (let i = 0; i < n; i++) {
    const cx = left + band * (i + 0.5);
    const barX = cx - barWidth / 2;
    let positiveBase = 0;
    let negativeBase = 0;
    let column = '';

    for (let s = 0; s < series.length; s++) {
      const item = series[s];
      const value = item.values[i];
      if (value === null || value === undefined) continue;
      if (value === 0) continue; // 0 高度没有可交互区域，略过
      const isPositive = value >= 0;
      const baseValue = isPositive ? positiveBase : negativeBase;
      const nextValue = baseValue + value;
      const yTop = y(Math.max(baseValue, nextValue));
      const yBottom = y(Math.min(baseValue, nextValue));
      const h = Math.max(0, yBottom - yTop);
      column += rectEl(barX, yTop, barWidth, h, {
        rx: 1.5,
        fill: item.color,
        fillOpacity: 0.94,
        cls: 'sb-seg',
        title:
          String(rawCategories[i] == null ? '第' + (i + 1) + '项' : rawCategories[i]) +
          ' · ' + item.name + '：' + formatter(value),
        attrs: {
          'data-col': i,
          'data-series': s,
          'data-value': num(value),
          'data-height': num(h),
        },
      });
      if (isPositive) positiveBase = nextValue;
      else negativeBase = nextValue;
    }

    const total = totals[i];
    if (showTotals) {
      let labelY;
      if (total >= 0) labelY = Math.max(top + 10, y(posSum[i]) - 6);
      else labelY = Math.min(top + plotHeight - 2, y(negSum[i]) + 13);
      column += textEl(cx, labelY, formatter(total), {
        anchor: 'middle',
        size: 9.5,
        weight: 600,
        fill: total >= 0 ? C.text : C.neg,
        cls: 'sb-total',
      });
    }

    body += el('g', { class: 'sb-col', 'data-col': i, 'data-total': num(total) }, column);
  }

  // 0 轴线（renderYAxis 已画，但柱图基线再强调一次；与网格线重合时也安全）
  body += lineEl(left, zeroY, left + plotWidth, zeroY, {
    stroke: C.axis,
    width: 1.2,
    cls: 'sb-baseline',
  });

  // 分类标签：统一水平放置，过长时截断（避免旋转标签被画布裁切）。
  const labelFont = 9.5;
  for (let i = 0; i < n; i++) {
    const raw = rawCategories[i] == null ? '第' + (i + 1) + '项' : String(rawCategories[i]);
    const cx = left + band * (i + 0.5);
    body += textEl(cx, height - 10, truncateToWidth(raw, band - 4, labelFont), {
      anchor: 'middle',
      size: labelFont,
      fill: C.muted,
      cls: 'sb-xlabel',
    });
  }

  const label = '堆叠柱状图：' + n + ' 个分类 × ' + series.length + ' 个系列';
  return renderSvg({ width: W, height, type: 'stacked-bar', label, children: body });
}

/* =========================================================================
 * 3. 横向条形图
 * ========================================================================= */

/**
 * 横向条形图：左侧标签右对齐，条内/条尾显示数值，可带排名与备注。
 * @param {object} options
 * @param {Array<{label: string, value: number, color?: string, meta?: string}>} options.items
 * @param {number} [options.height] 画布高度；默认按条目数自动计算
 * @param {(value:number)=>string} [options.valueFormat]
 * @param {boolean} [options.showRank=true] 是否显示排名序号
 * @returns {string} SVG 字符串
 */
function hBarChart(options) {
  const opt = options || {};
  const rawItems = Array.isArray(opt.items) ? opt.items : [];
  const formatter = pickFormatter(opt.valueFormat);
  const showRank = opt.showRank !== false;

  const items = rawItems
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      label: item.label == null ? '项目' + (index + 1) : String(item.label),
      value: finiteOrNull(item.value) == null ? 0 : finiteOrNull(item.value),
      color: safeColor(item.color, index),
      meta: item.meta == null ? '' : String(item.meta),
    }));

  const hasMeta = items.some((item) => item.meta);
  const defaultHeight = Math.max(120, items.length * (hasMeta ? 36 : 30) + 20);
  const height = clamp(opt.height == null ? defaultHeight : Number(opt.height), 80, 900);
  const values = items.map((item) => item.value);

  if (!items.length || allNearZero(values)) {
    return placeholder(DEFAULT_WIDTH, height, '暂无数据', 'h-bar');
  }

  const W = DEFAULT_WIDTH;
  const padX = 12;
  const top = 10;
  const bottom = 10;
  const rankWidth = showRank ? 22 : 0;
  const labelWidth = clamp(
    items.reduce((max, item) => Math.max(max, textWidth(item.label, 10.5)), 0) + 4,
    62,
    140
  );
  const trackX = padX + rankWidth + labelWidth + 14;
  const trackW = Math.max(40, W - trackX - 16);
  const rowHeight = (height - top - bottom) / items.length;
  const barHeight = Math.min(18, Math.max(8, rowHeight * 0.56));

  const dataMin = Math.min(0, ...values);
  const dataMax = Math.max(0, ...values);
  const allNonNegative = dataMin >= 0;
  const range = dataMax - dataMin || Math.max(Math.abs(dataMax), 1);
  // 0 轴在轨道中的位置：全正贴左，全负贴右，跨 0 按比例。
  const zeroX = trackX + (-dataMin / range) * trackW;

  let body = '';
  const zeroLine = !allNonNegative
    ? lineEl(zeroX, top + 2, zeroX, height - bottom - 2, {
        stroke: C.axis,
        width: 1,
        cls: 'hb-zero',
      })
    : '';

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const cy = top + rowHeight * (i + 0.5);
    const barY = cy - barHeight / 2;
    const isPositive = item.value >= 0;
    const barW = (Math.abs(item.value) / range) * trackW;
    const barX = isPositive ? zeroX : zeroX - barW;

    body += rectEl(trackX, barY, trackW, barHeight, {
      rx: barHeight / 2,
      fill: C.track,
      cls: 'hb-track',
    });

    if (barW > 0) {
      body += rectEl(barX, barY, barW, barHeight, {
        rx: barHeight / 2,
        fill: item.color,
        cls: 'hb-bar',
        title:
          item.label + '：' + formatter(item.value) + (item.meta ? '（' + item.meta + '）' : ''),
        attrs: {
          'data-index': i,
          'data-value': num(item.value),
          'data-width': num(barW),
        },
      });
    }

    // 排名序号
    if (showRank) {
      body += textEl(padX + rankWidth / 2, cy + 3.4, String(i + 1), {
        anchor: 'middle',
        size: 9,
        fill: item.value === Math.max(...values) ? C.text : C.faint,
        cls: 'hb-rank',
      });
    }

    // 左侧标签：右对齐；有 meta 时放第二行。
    const labelX = padX + rankWidth + labelWidth;
    if (item.meta && rowHeight >= 24) {
      body += textEl(labelX, cy - 1, truncateToWidth(item.label, labelWidth, 10.5), {
        anchor: 'end',
        size: 10.5,
        fill: C.text,
        cls: 'hb-label',
      });
      body += textEl(labelX, cy + 9.5, truncateToWidth(item.meta, labelWidth, 8.5), {
        anchor: 'end',
        size: 8.5,
        fill: C.muted,
        cls: 'hb-meta',
      });
    } else {
      body += textEl(labelX, cy + 3.6, truncateToWidth(item.label, labelWidth, 10.5), {
        anchor: 'end',
        size: 10.5,
        fill: C.text,
        cls: 'hb-label',
      });
    }

    // 数值：优先放在条内；放不下则贴在条尾外侧。
    const valueText = formatter(item.value);
    const valueWidth = textWidth(valueText, 9.5);
    if (barW > valueWidth + 14) {
      if (isPositive) {
        body += textEl(barX + barW - 7, cy + 3.4, valueText, {
          anchor: 'end',
          size: 9.5,
          weight: 600,
          fill: C.onAccent,
          cls: 'hb-value',
        });
      } else {
        body += textEl(barX + 7, cy + 3.4, valueText, {
          anchor: 'start',
          size: 9.5,
          weight: 600,
          fill: C.onAccent,
          cls: 'hb-value',
        });
      }
    } else if (isPositive) {
      body += textEl(barX + barW + 6, cy + 3.4, valueText, {
        anchor: 'start',
        size: 9.5,
        weight: 600,
        fill: C.text,
        cls: 'hb-value',
      });
    } else {
      body += textEl(barX - 6, cy + 3.4, valueText, {
        anchor: 'end',
        size: 9.5,
        weight: 600,
        fill: C.text,
        cls: 'hb-value',
      });
    }
  }

  const rectHolder = el(
    'g',
    { class: 'hb-plot', 'data-track-width': num(trackW), 'data-zero-x': num(zeroX) },
    body + zeroLine
  );
  const label = '横向条形图：' + items.length + ' 项';

  return renderSvg({
    width: W,
    height,
    type: 'h-bar',
    label,
    children: rectHolder,
  });
}

/* =========================================================================
 * 4. 环形图
 * ========================================================================= */

function polarPoint(cx, cy, radius, angle) {
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

function donutSegmentPath(cx, cy, outer, inner, startAngle, endAngle) {
  const fullCircle = Math.abs(endAngle - startAngle) >= Math.PI * 2 - 1e-6;
  if (fullCircle) {
    // 100% 单项：两段半圆弧拼成完整圆环，evenodd 挖出中心。
    return (
      'M ' + num(cx + outer) + ' ' + num(cy) +
      ' A ' + num(outer) + ' ' + num(outer) + ' 0 1 1 ' + num(cx - outer) + ' ' + num(cy) +
      ' A ' + num(outer) + ' ' + num(outer) + ' 0 1 1 ' + num(cx + outer) + ' ' + num(cy) + ' Z' +
      ' M ' + num(cx + inner) + ' ' + num(cy) +
      ' A ' + num(inner) + ' ' + num(inner) + ' 0 1 1 ' + num(cx - inner) + ' ' + num(cy) +
      ' A ' + num(inner) + ' ' + num(inner) + ' 0 1 1 ' + num(cx + inner) + ' ' + num(cy) + ' Z'
    );
  }
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  const [x0o, y0o] = polarPoint(cx, cy, outer, startAngle);
  const [x1o, y1o] = polarPoint(cx, cy, outer, endAngle);
  const [x1i, y1i] = polarPoint(cx, cy, inner, endAngle);
  const [x0i, y0i] = polarPoint(cx, cy, inner, startAngle);
  return (
    'M ' + num(x0o) + ' ' + num(y0o) +
    ' A ' + num(outer) + ' ' + num(outer) + ' 0 ' + largeArc + ' 1 ' + num(x1o) + ' ' + num(y1o) +
    ' L ' + num(x1i) + ' ' + num(y1i) +
    ' A ' + num(inner) + ' ' + num(inner) + ' 0 ' + largeArc + ' 0 ' + num(x0i) + ' ' + num(y0i) +
    ' Z'
  );
}

/**
 * 环形图 + 双列图例 + 中心文字。
 * 注意：环形图只表达正数构成，value <= 0 的项会被忽略（不应把负数当份额）。
 * @param {object} options
 * @param {Array<{label: string, value: number, color?: string}>} options.items
 * @param {number} [options.size=200] 圆环基准直径（同时影响画布比例）
 * @param {string} [options.centerLabel='合计']
 * @param {string|number} [options.centerValue] 中心数值；缺省用合计的紧凑格式
 * @param {(value:number)=>string} [options.valueFormat]
 * @param {'right'|'bottom'} [options.legendPosition='right']
 * @returns {string} SVG 字符串
 */
function donutChart(options) {
  const opt = options || {};
  const rawItems = Array.isArray(opt.items) ? opt.items : [];
  const formatter = pickFormatter(opt.valueFormat);
  const size = clamp(Number(opt.size) || 200, 140, 420);
  const legendPosition = opt.legendPosition === 'bottom' ? 'bottom' : 'right';

  const items = rawItems
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      label: item.label == null ? '项目' + (index + 1) : String(item.label),
      value: finiteOrNull(item.value),
      color: safeColor(item.color, index),
    }))
    .filter((item) => item.value !== null && item.value > 0);

  if (!items.length) {
    const width = legendPosition === 'bottom' ? Math.max(size + 80, 380) : size + 252;
    return placeholder(width, size, '暂无数据', 'donut');
  }

  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!(total > 0)) return placeholder(size, size, '暂无数据', 'donut');

  const rows = Math.ceil(items.length / 2);
  let W;
  let H;
  let cx;
  let cy;
  let outer;
  let legendX;
  let legendTop;
  let cellWidth;
  let inner;
  const cellGap = 16;

  if (legendPosition === 'right') {
    const legendWidth = 244;
    W = size + legendWidth + 8;
    H = Math.max(size, rows * 20 + 24);
    cx = size / 2;
    cy = H / 2;
    outer = Math.min(size, H) * 0.44;
    legendX = size + 8;
    legendTop = (H - rows * 20) / 2 + 4;
    // 两列之间留出 16px 空隙，避免左列百分比贴住右列圆点。
    cellWidth = (W - legendX - 8 - 16) / 2;
  } else {
    W = Math.max(size + 80, 380);
    H = size + rows * 20 + 14;
    cx = W / 2;
    cy = size / 2;
    outer = size * 0.44;
    legendX = 12;
    legendTop = size + 2;
    cellWidth = (W - 24 - 16) / 2;
  }
  inner = outer * 0.62;

  let body = '';
  let cursor = -Math.PI / 2;
  const gap = items.length > 1 ? 0.018 : 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const angle = (item.value / total) * Math.PI * 2;
    const startAngle = cursor;
    const endAngle = cursor + angle;
    cursor = endAngle;
    const drawStart = startAngle + (angle > gap * 2 ? gap / 2 : 0);
    const drawEnd = endAngle - (angle > gap * 2 ? gap / 2 : 0);
    const pct = (item.value / total) * 100;
    body += pathEl(donutSegmentPath(cx, cy, outer, inner, drawStart, drawEnd), {
      cls: 'donut-segment',
      fill: item.color,
      fillRule: 'evenodd',
      attrs: {
        'data-index': i,
        'data-value': num(item.value),
        'data-pct': num(pct),
      },
      title: item.label + '：' + formatter(item.value) + '（' + pct.toFixed(1) + '%）',
    });
  }

  // 中心文字
  const centerLabel = opt.centerLabel == null ? '合计' : String(opt.centerLabel);
  let centerValue;
  if (opt.centerValue == null) centerValue = formatCompact(total);
  else if (typeof opt.centerValue === 'number') centerValue = formatter(opt.centerValue);
  else centerValue = String(opt.centerValue);

  if (centerLabel) {
    body += textEl(cx, cy - outer * 0.17, truncateToWidth(centerLabel, inner * 1.7, 10), {
      anchor: 'middle',
      size: clamp(size * 0.05, 9, 12),
      fill: C.muted,
      cls: 'donut-center-label',
    });
  }
  if (centerValue) {
    const unitWidth = Math.max(textWidth(centerValue, 1), 0.3);
    const valueSize = clamp((inner * 1.7) / unitWidth, 9, size * 0.12);
    body += textEl(cx, cy + valueSize * 0.42, centerValue, {
      anchor: 'middle',
      size: valueSize,
      weight: 600,
      fill: C.text,
      cls: 'donut-center-value',
    });
  }

  // 图例：固定两列
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cellX = legendX + col * (cellWidth + cellGap);
    const rowY = legendTop + row * 20 + 10;
    const pct = (item.value / total) * 100;
    const pctText = pct.toFixed(1) + '%';
    const pctWidth = textWidth(pctText, 9);
    const labelMax = Math.max(16, cellWidth - pctWidth - 20);
    body += circleEl(cellX + 4, rowY - 3.2, 3.4, {
      fill: item.color,
      cls: 'donut-dot',
    });
    body += textEl(cellX + 12, rowY, truncateToWidth(item.label, labelMax, 9.5), {
      size: 9.5,
      fill: C.text,
      cls: 'donut-legend-label',
    });
    body += textEl(cellX + cellWidth - 2, rowY, pctText, {
      anchor: 'end',
      size: 9,
      fill: C.muted,
      cls: 'donut-pct',
    });
  }

  const label = '环形图：' + items.length + ' 项，合计 ' + formatter(total);

  return renderSvg({ width: W, height: H, type: 'donut', label, children: body });
}

/* =========================================================================
 * 5. 瀑布图
 * ========================================================================= */

/**
 * 瀑布图：start/total 从 0 起，delta 在累计值上浮动，适合现金流/利润桥。
 * @param {object} options
 * @param {Array<{label: string, value?: number, type: 'start'|'delta'|'total'}>} options.items
 * @param {number} [options.height=240]
 * @param {(value:number)=>string} [options.valueFormat]
 * @param {number} [options.yTicks=4]
 * @returns {string} SVG 字符串
 */
function waterfallChart(options) {
  const opt = options || {};
  const rawItems = Array.isArray(opt.items) ? opt.items : [];
  const formatter = pickFormatter(opt.valueFormat);
  const height = clamp(Number(opt.height) || 240, 160, 640);
  const tickCount = clamp(Number(opt.yTicks) || 4, 2, 6);

  const items = rawItems
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const type = item.type === 'start' || item.type === 'total' ? item.type : 'delta';
      const value = finiteOrNull(item.value);
      return {
        label: item.label == null ? '节点' + (index + 1) : String(item.label),
        type,
        value,
      };
    });

  if (!items.length) return placeholder(DEFAULT_WIDTH, height, '暂无数据', 'waterfall');

  let running = 0;
  const bars = [];
  for (const item of items) {
    let base;
    let top;
    if (item.type === 'start') {
      const value = item.value == null ? running : item.value;
      base = 0;
      top = value;
      running = value;
    } else if (item.type === 'total') {
      const value = item.value == null ? running : item.value;
      base = 0;
      top = value;
      running = value;
    } else {
      const value = item.value == null ? 0 : item.value;
      base = running;
      top = running + value;
      running = top;
    }
    bars.push({ label: item.label, type: item.type, value: item.value, base, top });
  }

  const allValues = bars.flatMap((bar) => [bar.base, bar.top]);
  if (allNearZero(allValues)) {
    return placeholder(DEFAULT_WIDTH, height, '暂无数据', 'waterfall');
  }

  const dataMin = Math.min(0, ...allValues);
  const dataMax = Math.max(0, ...allValues);
  const scale = buildScale(dataMin, dataMax, tickCount, { includeZero: true });
  const left = axisLeftMargin(scale, formatter);
  const right = 18;
  const top = 30;
  const bottom = 34;
  const W = DEFAULT_WIDTH;
  const plotWidth = W - left - right;
  const plotHeight = height - top - bottom;
  const y = makeY(scale, top, plotHeight);
  const n = bars.length;
  const band = plotWidth / n;
  const barWidth = Math.min(56, Math.max(10, band * 0.56));

  let body = '';
  body += renderYAxis(scale, formatter, { left, top, plotWidth, plotHeight }, 'wf');

  // 连接线：上一个节点末端 → 下一个 delta 的起点。
  for (let i = 1; i < bars.length; i++) {
    const previous = bars[i - 1];
    const current = bars[i];
    if (current.type !== 'delta') continue;
    if (Math.abs(previous.top - current.base) > 1e-9) continue;
    const previousRight = left + band * (i - 1) + band / 2 + barWidth / 2;
    const currentLeft = left + band * i + band / 2 - barWidth / 2;
    if (currentLeft > previousRight) {
      body += lineEl(previousRight + 2, y(previous.top), currentLeft - 2, y(current.base), {
        stroke: C.faint,
        width: 1,
        dash: '3 3',
        cls: 'wf-connector',
      });
    }
  }

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const cx = left + band * (i + 0.5);
    const x = cx - barWidth / 2;
    const yTop = y(bar.top);
    const yBase = y(bar.base);
    const rectY = Math.min(yTop, yBase);
    const rectH = Math.abs(yBase - yTop);
    const isPositive = bar.top >= bar.base;
    let fill = C.pos;
    if (bar.type === 'start') fill = C.start;
    else if (bar.type === 'total') fill = C.total;
    else if (!isPositive) fill = C.neg;

    const displayValue = bar.type === 'delta' ? bar.top - bar.base : bar.top;
    const valueText = bar.type === 'delta'
      ? formatSigned(displayValue, formatter)
      : formatter(displayValue);

    body += rectEl(x, rectY, barWidth, Math.max(0, rectH), {
      rx: 2,
      fill,
      fillOpacity: 0.94,
      cls: 'wf-bar wf-' + bar.type,
      title: bar.label + '：' + valueText,
      attrs: {
        'data-index': i,
        'data-role': bar.type,
        'data-value': num(displayValue),
        'data-base': num(bar.base),
        'data-top': num(bar.top),
        'data-height': num(rectH),
      },
    });

    let labelY;
    if (isPositive) labelY = Math.max(top + 10, rectY - 6);
    else labelY = Math.min(top + plotHeight - 2, rectY + rectH + 13);
    body += textEl(cx, labelY, valueText, {
      anchor: 'middle',
      size: 9.5,
      weight: 600,
      fill: C.text,
      cls: 'wf-value',
    });
  }

  // 分类标签：统一水平放置，过长时截断（避免旋转标签被画布裁切）。
  for (let i = 0; i < bars.length; i++) {
    const cx = left + band * (i + 0.5);
    body += textEl(cx, height - 10, truncateToWidth(bars[i].label, band - 4, 9.5), {
      anchor: 'middle',
      size: 9.5,
      fill: C.muted,
      cls: 'wf-xlabel',
    });
  }

  // 0 基线
  if (scale.lo <= 0 && scale.hi >= 0) {
    body += lineEl(left, y(0), left + plotWidth, y(0), {
      stroke: C.axis,
      width: 1.2,
      cls: 'wf-baseline',
    });
  }

  const label = '瀑布图：' + bars.length + ' 个节点';
  return renderSvg({ width: W, height, type: 'waterfall', label, children: body });
}

/* =========================================================================
 * 6. 迷你趋势线
 * ========================================================================= */

/**
 * 迷你趋势线（适合 KPI 卡片/表格内嵌）。
 * @param {object} options
 * @param {Array<number|null>} options.values
 * @param {number} [options.width=120] viewBox 宽度
 * @param {number} [options.height=32] viewBox 高度
 * @param {string} [options.color] 线条颜色，默认取主题第一个色
 * @param {(value:number)=>string} [options.valueFormat] 默认紧凑格式
 * @returns {string} SVG 字符串
 */
function sparkline(options) {
  const opt = options || {};
  const values = (Array.isArray(opt.values) ? opt.values : []).map(finiteOrNull);
  const width = clamp(Number(opt.width) || 120, 40, 1000);
  const height = clamp(Number(opt.height) || 32, 20, 300);
  const color = safeColor(opt.color, 0);
  const formatter = pickFormatter(opt.valueFormat || formatCompact);
  const finite = values.filter((v) => v !== null);

  if (!values.length || !finite.length || allNearZero(finite)) {
    return placeholder(width, height, '暂无数据', 'sparkline');
  }

  const padX = 3;
  const padY = 4;
  const innerW = Math.max(1, width - padX * 2);
  const innerH = Math.max(1, height - padY * 2);
  let minValue = Math.min(...finite);
  let maxValue = Math.max(...finite);
  if (minValue === maxValue) {
    minValue -= Math.abs(minValue) * 0.1 || 1;
    maxValue += Math.abs(maxValue) * 0.1 || 1;
  }
  const span = maxValue - minValue;
  const x = (index) => {
    if (values.length <= 1) return padX + innerW / 2;
    return padX + (innerW * index) / (values.length - 1);
  };
  const y = (value) => padY + ((maxValue - value) / span) * innerH;
  const baseY = height - padY;

  let d = '';
  let areaD = '';
  let started = false;
  let runStart = null;
  let runLast = null;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === null) {
      if (runStart !== null && runLast !== null && runLast > runStart) {
        areaD += ' M ' + num(x(runStart)) + ' ' + num(baseY);
        for (let k = runStart; k <= runLast; k++) {
          if (values[k] === null) continue;
          areaD += ' L ' + num(x(k)) + ' ' + num(y(values[k]));
        }
        areaD += ' L ' + num(x(runLast)) + ' ' + num(baseY) + ' Z';
      }
      started = false;
      runStart = null;
      runLast = null;
      continue;
    }
    d += (started ? ' L ' : ' M ') + num(x(i)) + ' ' + num(y(value));
    started = true;
    if (runStart === null) runStart = i;
    runLast = i;
  }
  if (runStart !== null && runLast !== null && runLast > runStart) {
    areaD += ' M ' + num(x(runStart)) + ' ' + num(baseY);
    for (let k = runStart; k <= runLast; k++) {
      if (values[k] === null) continue;
      areaD += ' L ' + num(x(k)) + ' ' + num(y(values[k]));
    }
    areaD += ' L ' + num(x(runLast)) + ' ' + num(baseY) + ' Z';
  }

  let body = '';
  if (areaD) {
    body += pathEl(areaD, { cls: 'spark-area', fill: color, fillOpacity: 0.1 });
  }
  body += pathEl(d, {
    cls: 'spark-line',
    fill: 'none',
    stroke: color,
    strokeWidth: 1.5,
  });

  const lastFiniteIndex = (() => {
    for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return i;
    return -1;
  })();
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === null) continue;
    const isLast = i === lastFiniteIndex;
    body += circleEl(x(i), y(value), isLast ? 2.2 : 1.2, {
      cls: isLast ? 'spark-point spark-last' : 'spark-point',
      fill: color,
      stroke: isLast ? C.surface : null,
      strokeWidth: isLast ? 1.2 : 0,
      title: '第' + (i + 1) + '点：' + formatter(value),
      attrs: { 'data-index': i, 'data-value': num(value) },
    });
  }

  const label = '迷你趋势图：' + finite.length + ' 个数据点';
  return renderSvg({ width, height, type: 'sparkline', label, children: body });
}

/* =========================================================================
 * 7. 进度条（辅助控件，也返回 SVG，便于统一插入容器）
 * ========================================================================= */

/**
 * 进度条（库存周转/目标完成等）。
 * @param {object} options
 * @param {number} options.value 当前值
 * @param {number} options.max 目标值（必须 > 0）
 * @param {string} [options.color]
 * @param {string} [options.label]
 * @param {number} [options.width=320]
 * @param {number} [options.height=38]
 * @param {(value:number)=>string} [options.valueFormat] 用于 tooltip
 * @returns {string} SVG 字符串
 */
function progressBar(options) {
  const opt = options || {};
  const value = finiteOrNull(opt.value);
  const max = finiteOrNull(opt.max);
  const width = clamp(Number(opt.width) || 320, 80, 1200);
  const height = clamp(Number(opt.height) || 38, 26, 120);
  const formatter = pickFormatter(opt.valueFormat);
  const color = safeColor(opt.color, 0);
  const label = opt.label == null ? '' : String(opt.label);

  if (value === null || max === null || !(max > 0)) {
    return placeholder(width, height, '暂无进度', 'progress');
  }

  const ratio = clamp(value / max, 0, 1);
  const percent = value / max * 100;
  const pctText = (Math.round(percent * 10) / 10) + '%';
  const barHeight = Math.min(10, height * 0.28);
  const barY = label ? height - barHeight - 4 : height / 2 - barHeight / 2;
  const pctWidth = textWidth(pctText, 9.5);
  const trackWidth = label ? width : Math.max(20, width - pctWidth - 10);

  let body = '';
  if (label) {
    body += textEl(0, 11, truncateToWidth(label, width - pctWidth - 8, 10.5), {
      size: 10.5,
      fill: C.text,
      cls: 'pb-label',
    });
    body += textEl(width, 11, pctText, {
      anchor: 'end',
      size: 9.5,
      weight: 600,
      fill: C.text,
      cls: 'pb-value',
    });
  } else {
    body += textEl(width, height / 2 + 3.5, pctText, {
      anchor: 'end',
      size: 9.5,
      weight: 600,
      fill: C.text,
      cls: 'pb-value',
    });
  }

  body += rectEl(label ? 0 : 0, barY, trackWidth, barHeight, {
    rx: barHeight / 2,
    fill: C.track,
    cls: 'pb-track',
    title: (label || '进度') + '：' + formatter(value) + ' / ' + formatter(max),
  });
  body += rectEl(0, barY, Math.max(0, trackWidth * ratio), barHeight, {
    rx: barHeight / 2,
    fill: color,
    cls: 'pb-fill',
    title: (label || '进度') + '：' + formatter(value) + ' / ' + formatter(max) + '（' + pctText + '）',
    attrs: { 'data-pct': num(percent), 'data-ratio': num(ratio) },
  });

  const chartLabel = (label || '进度') + '：' + pctText;
  return renderSvg({ width, height, type: 'progress', label: chartLabel, children: body });
}

/* =========================================================================
 * 导出
 * ========================================================================= */

const Charts = {
  lineChart,
  stackedBarChart,
  hBarChart,
  donutChart,
  waterfallChart,
  sparkline,
  progressBar,
  formatCompact,
  formatNumber,
  escapeXml,
  palette: PALETTE.slice(),
};

// CommonJS（Node 测试 / 构建脚本）
if (typeof module !== 'undefined' && module.exports) module.exports = Charts;

// 浏览器单文件场景：挂到 window.Charts 供界面层调用
if (typeof window !== 'undefined') window.Charts = Charts;
