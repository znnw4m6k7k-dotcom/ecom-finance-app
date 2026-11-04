/* 界面基础工具：格式化、表格、弹窗、下载、图标 */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(n, digits) {
    if (n === null || n === undefined || n === '') return '—';
    var v = Number(n);
    if (!isFinite(v)) return '—';
    return v.toLocaleString('zh-CN', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 });
  }
  function money(n, digits) {
    if (n === null || n === undefined || n === '') return '—';
    var v = Number(n);
    if (!isFinite(v)) return '—';
    var d = digits === undefined ? 0 : digits;
    return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function money2(n) { return money(n, 2); }
  function wan(n) {
    if (n === null || n === undefined) return '—';
    var v = Number(n), abs = Math.abs(v);
    if (!isFinite(v)) return '—';
    if (abs >= 100000000) return (v / 100000000).toFixed(2).replace(/\.?0+$/, '') + ' 亿';
    if (abs >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + ' 万';
    return num(v, 0);
  }
  function pct(v) {
    if (v === null || v === undefined) return '—';
    var n = Number(v);
    if (!isFinite(n)) return '—';
    return (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, '') + '%';
  }
  function rate(v) { return pct(Number(v) * 100); }
  function delta(cur, prev) {
    if (!prev || !isFinite(prev) || !isFinite(cur)) return null;
    var d = (cur - prev) / Math.abs(prev) * 100;
    return { value: d, text: (d >= 0 ? '+' : '') + d.toFixed(1) + '%', cls: d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'flat' };
  }
  function signCls(n) { return Number(n) > 0 ? 'pos' : Number(n) < 0 ? 'neg' : ''; }

  var ICONS = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    stores: '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0"/><path d="M9 20v-5h6v5"/>',
    products: '<path d="M20.6 13.4L11 3.8H4v7l9.6 9.6a2 2 0 002.8 0l4.2-4.2a2 2 0 000-2.8z"/><circle cx="7.5" cy="7.5" r="1"/>',
    settlement: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
    logistics: '<path d="M1 16V6h12v10"/><path d="M13 9h4l4 4v3h-8"/><circle cx="5" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    inventory: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    payroll: '<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>',
    invoices: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
    import: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5-5 5 5"/><path d="M12 5v12"/>',
    settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/>',
    print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><path d="M6 14h12v8H6z"/>',
    download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    alert: '<path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    check: '<path d="M20 6L9 17l-5-5"/>'
  };
  function icon(name, size) {
    var p = ICONS[name] || '';
    return '<svg viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }

  function sortRows(rows, key, dir, numeric) {
    var arr = rows.slice();
    arr.sort(function (a, b) {
      var va = a[key], vb = b[key];
      if (numeric) { va = Number(va) || 0; vb = Number(vb) || 0; return dir === 'asc' ? va - vb : vb - va; }
      var sa = String(va === undefined || va === null ? '' : va);
      var sb = String(vb === undefined || vb === null ? '' : vb);
      return dir === 'asc' ? sa.localeCompare(sb, 'zh-CN') : sb.localeCompare(sa, 'zh-CN');
    });
    return arr;
  }

  function table(opts) {
    var cols = opts.columns || [];
    var rows = opts.rows || [];
    var sort = opts.sort || {};
    var h = '<div class="table-wrap"><table class="data">';
    h += '<thead><tr>';
    cols.forEach(function (c) {
      var cls = [c.num ? 'num' : '', c.sortable ? 'sortable' : '', c.cls || ''].join(' ');
      var arrow = c.sortable && sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
      h += '<th class="' + cls + '"' + (c.sortable ? ' data-sort="' + esc(c.key) + '"' : '') +
        (c.width ? ' style="width:' + c.width + '"' : '') + '>' + esc(c.label) + arrow + '</th>';
    });
    h += '</tr></thead><tbody>';
    if (!rows.length) {
      h += '<tr><td colspan="' + cols.length + '"><div class="empty">暂无数据</div></td></tr>';
    }
    rows.forEach(function (row, i) {
      var attrs = opts.rowAttrs ? opts.rowAttrs(row, i) : '';
      h += '<tr ' + attrs + '>';
      cols.forEach(function (c) {
        var content = c.render ? c.render(row, i) : esc(row[c.key]);
        var cls = [c.num ? 'num' : '', c.cls || ''].join(' ');
        h += '<td class="' + cls + '">' + content + '</td>';
      });
      h += '</tr>';
    });
    if (opts.footer && opts.footer.length) {
      h += '<tr class="total-row">' + opts.footer.map(function (cell) {
        return '<td class="' + (cell.num ? 'num' : '') + '">' + (cell.html !== undefined ? cell.html : esc(cell)) + '</td>';
      }).join('') + '</tr>';
    }
    h += '</tbody></table></div>';
    return h;
  }

  function csvText(headers, rows) {
    function cell(v) {
      var s = v === undefined || v === null ? '' : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    return '\ufeff' + [headers.map(cell).join(',')].concat(rows.map(function (r) { return r.map(cell).join(','); })).join('\r\n');
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 300);
  }
  function downloadCsv(filename, headers, rows) {
    download(filename, csvText(headers, rows), 'text/csv;charset=utf-8');
  }

  function modal(opts) {
    var root = document.getElementById('modal-root');
    root.innerHTML =
      '<div class="modal-mask" data-close-modal></div>' +
      '<div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-head"><div><h3>' + esc(opts.title || '') + '</h3>' +
      (opts.subtitle ? '<p>' + esc(opts.subtitle) + '</p>' : '') + '</div>' +
      '<button class="btn ghost close" data-close-modal aria-label="关闭">' + icon('close', 18) + '</button></div>' +
      '<div class="modal-body">' + (opts.body || '') + '</div></div>';
    root.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    var root = document.getElementById('modal-root');
    root.classList.remove('open');
    root.innerHTML = '';
    document.body.style.overflow = '';
  }

  function toast(msg, type) {
    var box = document.getElementById('toast');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'item ' + (type || 'ok');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, 4200);
  }

  function badge(text, kind) {
    return '<span class="badge ' + (kind || 'neutral') + '">' + esc(text) + '</span>';
  }
  function platformName(p) { return p === 'xhs' ? '小红书' : p === 'taobao' ? '淘宝/天猫' : p; }
  function monthLabel(m) { return m === 'all' ? '全部账期' : Number(m.slice(5, 7)) + '月'; }
  function fullMonth(m) { return m === 'all' ? '全部账期' : m.slice(0, 4) + '年' + Number(m.slice(5, 7)) + '月'; }

  root.UI = {
    esc: esc, num: num, money: money, money2: money2, wan: wan, pct: pct, rate: rate,
    delta: delta, signCls: signCls, icon: icon, table: table, sortRows: sortRows,
    csvText: csvText, download: download, downloadCsv: downloadCsv, modal: modal, closeModal: closeModal,
    toast: toast, badge: badge, platformName: platformName, monthLabel: monthLabel, fullMonth: fullMonth
  };
})(typeof window !== 'undefined' ? window : globalThis);
