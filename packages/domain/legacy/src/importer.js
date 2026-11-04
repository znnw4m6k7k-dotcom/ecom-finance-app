/* 导入器：CSV / XLSX → 表头映射 → 逐行校验 → 数据补丁
 * 设计原则：先只解析和校验，用户确认后再 apply；任何错误行都不写入，错误清单可导出。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./templates.js'), require('./xlsx.js'));
  } else {
    root.FinImporter = factory(root.FinTemplates, root.XLSXReader);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Templates, XLSXReader) {
  'use strict';

  var MAX_ERRORS = 300;

  function normalizeHeader(s) {
    return String(s == null ? '' : s)
      .replace(/^\ufeff/, '')
      .replace(/[\s　]/g, '')
      .replace(/[（）()]/g, '')
      .replace(/[:：*]/g, '')
      .toLowerCase();
  }

  function detectDelimiter(line) {
    var counts = { ',': 0, '\t': 0, ';': 0, '|': 0 };
    var inQuote = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') inQuote = !inQuote;
      if (!inQuote && counts[ch] !== undefined) counts[ch]++;
    }
    var best = ',', max = -1;
    Object.keys(counts).forEach(function (k) { if (counts[k] > max) { max = counts[k]; best = k; } });
    return best;
  }

  function parseCsv(text, delimiter) {
    var str = String(text || '').replace(/^\ufeff/, '');
    var firstLine = str.split(/\r?\n/)[0] || '';
    var d = delimiter || detectDelimiter(firstLine);
    var rows = [], row = [], field = '', inQuote = false;
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (inQuote) {
        if (ch === '"') {
          if (str[i + 1] === '"') { field += '"'; i++; } else { inQuote = false; }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuote = true;
      } else if (ch === d) {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && str[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || String(row[0]).trim() !== '') rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
    row.push(field);
    if (row.length > 1 || String(row[0]).trim() !== '') rows.push(row);
    var headers = (rows[0] || []).map(function (h) { return String(h).trim(); });
    return { headers: headers, rows: rows.slice(1), delimiter: d };
  }

  function parseMoney(v) {
    if (v === null || v === undefined) return NaN;
    var s = String(v).trim().replace(/[¥￥,\s，]/g, '').replace(/元/g, '');
    if (!s) return NaN;
    var neg = /^\(.*\)$/.test(s);
    s = s.replace(/[()]/g, '');
    var pctFlag = /%$/.test(s);
    s = s.replace(/%$/, '');
    var n = Number(s);
    if (!isFinite(n)) return NaN;
    if (pctFlag) n = n / 100;
    return neg ? -n : n;
  }

  function validYmd(y, m, d) {
    y = Number(y); m = Number(m); d = Number(d);
    if (!(y >= 1990 && y <= 2100)) return false;
    if (!(m >= 1 && m <= 12)) return false;
    if (!(d >= 1 && d <= 31)) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  function normalizeDate(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).trim();
    if (!s) return '';
    var m = s.match(/^(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})/);
    if (m) return validYmd(m[1], m[2], m[3]) ? m[1] + '-' + pad(m[2], 2) + '-' + pad(m[3], 2) : '';
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return validYmd(m[1], m[2], m[3]) ? m[1] + '-' + m[2] + '-' + m[3] : '';
    return '';
  }

  function pad(n, w) {
    var s = String(n);
    while (s.length < w) s = '0' + s;
    return s;
  }

  function mapHeaders(headers, fields) {
    var mapping = {}; // colIndex -> fieldKey
    var used = {};
    var unmatched = [];
    headers.forEach(function (h, idx) {
      var norm = normalizeHeader(h);
      var hit = null;
      fields.forEach(function (fld) {
        if (used[fld.key]) return;
        var names = [fld.label].concat(fld.aliases || []);
        for (var i = 0; i < names.length; i++) {
          if (normalizeHeader(names[i]) === norm) { hit = fld; break; }
        }
      });
      if (hit) { mapping[idx] = hit.key; used[hit.key] = true; }
      else if (h) unmatched.push(h);
    });
    var missing = fields.filter(function (fld) { return fld.required && !used[fld.key]; }).map(function (fld) { return fld.label; });
    return { mapping: mapping, unmatched: unmatched, missing: missing };
  }

  function resolveRef(dataset, kind, value) {
    if (!value) return null;
    var list = dataset[kind] || [];
    var v = String(value).trim();
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (row.id === v || row.name === v || row.number === v) return row;
    }
    return null;
  }

  function coerce(field, raw, dataset, errors, rowNo) {
    var v = raw === undefined || raw === null ? '' : String(raw).trim();
    if (v === '') {
      if (field.required) errors.push(err(rowNo, field.label, '', '必填项为空'));
      return field.type === 'money' || field.type === 'int' ? 0 : '';
    }
    if (field.type === 'money' || field.type === 'int') {
      var n = parseMoney(v);
      if (!isFinite(n)) { errors.push(err(rowNo, field.label, v, '不是有效数字')); return 0; }
      if (field.type === 'int' && Math.abs(n - Math.round(n)) > 1e-6) { errors.push(err(rowNo, field.label, v, '必须是整数')); return Math.round(n); }
      return field.type === 'int' ? Math.round(n) : n;
    }
    if (field.type === 'date' || field.type === 'month') {
      var d;
      if (field.type === 'month') {
        var mm = String(v).match(/(\d{4})[-\/.年](\d{1,2})/);
        d = mm && validYmd(mm[1], mm[2], 1) ? mm[1] + '-' + pad(mm[2], 2) : '';
        if (!d) { errors.push(err(rowNo, field.label, v, '账期格式应为 YYYY-MM（如 2026-10）')); return ''; }
        return d;
      }
      d = normalizeDate(v);
      if (!d) { errors.push(err(rowNo, field.label, v, '日期无效或格式无法识别（支持 2026-08-01 / 2026/8/1 / 20260801）')); return ''; }
      return d;
    }
    if (field.type === 'enum') {
      var lower = v.toLowerCase();
      var map = { '进项': 'input', '销项': 'output', '是': '1', '否': '0', '已结算': 'settled', '待结算': 'pending', '已入库': 'received', '待入库': 'pending', '已退款': 'refunded', '部分退款': 'partial', '已支付': 'paid', '淘宝': 'taobao', '天猫': 'taobao', '淘宝/天猫': 'taobao', '小红书': 'xhs' };
      var val = map[v] || map[lower] || lower;
      var values = field.values || [];
      if (values.length && values.map(function (x) { return String(x).toLowerCase(); }).indexOf(String(val).toLowerCase()) < 0) {
        errors.push(err(rowNo, field.label, v, '取值必须是：' + values.join(' / ')));
      }
      return val;
    }
    if (field.type === 'ids') {
      return v.split(/[,，、;；\s]+/).filter(Boolean);
    }
    return v;
  }

  function err(row, field, value, message) {
    return { row: row, field: field, value: value, message: message };
  }

  function colValue(rowArr, mapping, key) {
    var idx = -1;
    Object.keys(mapping).forEach(function (i) { if (mapping[i] === key) idx = Number(i); });
    return idx >= 0 ? rowArr[idx] : '';
  }

  // 订单：按订单号聚合，生成订单头 + 明细
  function transformOrders(records, dataset, errors, warnings) {
    var groups = {};
    var order = [];
    records.forEach(function (r) {
      if (!r.values.order_id) return;
      if (!groups[r.values.order_id]) { groups[r.values.order_id] = []; order.push(r.values.order_id); }
      groups[r.values.order_id].push(r);
    });
    var orders = [], items = [];
    order.forEach(function (id) {
      var rows = groups[id];
      var head = rows[0].values;
      var store = resolveRef(dataset, 'stores', head.store_id);
      if (!store) {
        errors.push(err(head.__row, '店铺', head.store_id, '店铺不存在，请先在「店铺主数据」中登记'));
        return;
      }
      var itemRows = [], itemSum = 0, refundSum = 0, refundQty = 0;
      rows.forEach(function (r) {
        var v = r.values;
        var sku = resolveRef(dataset, 'skus', v.sku_id);
        if (!sku) {
          errors.push(err(v.__row, '商品编码', v.sku_id, '商品不存在，请先在「商品主数据」中登记'));
          return;
        }
        var amount = v.amount || 0;
        var qty = v.qty || 0;
        if (amount <= 0) warnings.push('第 ' + v.__row + ' 行：商品金额为 0，请确认');
        itemRows.push({
          order_id: id, sku_id: sku.id, qty: qty, amount: round2(amount),
          refund_amount: round2(v.item_refund_amount || 0), refund_qty: Math.round(v.item_refund_qty || 0)
        });
        itemSum += amount;
        refundSum += v.item_refund_amount || 0;
        refundQty += v.item_refund_qty || 0;
      });
      if (!itemRows.length) return;
      var paid = head.paid_amount ? head.paid_amount : round2(itemSum);
      if (head.paid_amount && Math.abs(head.paid_amount - itemSum) > 0.05) {
        warnings.push('订单 ' + id + '：明细金额合计 ' + round2(itemSum) + ' 与支付金额 ' + round2(head.paid_amount) + ' 不一致（以支付金额为准）');
      }
      var refund = head.refund_amount || round2(refundSum);
      var status = head.status || (refund >= paid ? 'refunded' : refund > 0 ? 'partial' : 'paid');
      var shipDate = head.ship_date || head.order_date;
      orders.push({
        id: id, store_id: store.id, order_date: head.order_date,
        status: status, paid_amount: round2(paid), refund_amount: round2(refund),
        refund_date: head.refund_date || (refund > 0 ? head.order_date : ''),
        ship_date: shipDate, carrier: head.carrier || '', province: head.province || '',
        returned: refundQty > 0 || (refund >= paid && paid > 0)
      });
      items = items.concat(itemRows);
    });
    return { orders: orders, order_items: items };
  }

  function transformPurchase(records, dataset, errors, warnings) {
    var groups = {}, order = [];
    records.forEach(function (r) {
      if (!r.values.po_id) return;
      if (!groups[r.values.po_id]) { groups[r.values.po_id] = []; order.push(r.values.po_id); }
      groups[r.values.po_id].push(r);
    });
    var pos = [], items = [];
    order.forEach(function (id) {
      var rows = groups[id];
      var head = rows[0].values;
      var sup = resolveRef(dataset, 'suppliers', head.supplier_id);
      if (!sup) { errors.push(err(head.__row, '供应商', head.supplier_id, '供应商不存在')); return; }
      var total = 0;
      rows.forEach(function (r) {
        var v = r.values;
        var sku = resolveRef(dataset, 'skus', v.sku_id);
        if (!sku) { errors.push(err(v.__row, '商品编码', v.sku_id, '商品不存在')); return; }
        var amount = v.amount || round2(v.qty * v.unit_price);
        if (!v.unit_price && v.qty) warnings.push('采购单 ' + id + '：第 ' + v.__row + ' 行未填单价，已按金额/数量推算');
        var unit = v.unit_price || (v.qty ? round2(amount / v.qty) : 0);
        items.push({ po_id: id, sku_id: sku.id, qty: Math.round(v.qty), unit_price: round2(unit), amount: round2(amount) });
        total += amount;
      });
      if (!items.length) return;
      pos.push({
        id: id, supplier_id: sup.id, date: head.date, status: head.status || 'received',
        invoice_no: head.invoice_no || ''
      });
    });
    return { purchase_orders: pos, purchase_items: items };
  }

  function prepare(tableId, parsed, dataset, mode) {
    var table = Templates.getTable(tableId);
    if (!table) throw new Error('未知导入表：' + tableId);
    var headers = parsed.headers || [];
    var status = mapHeaders(headers, table.fields);
    var errors = [], warnings = [];
    var records = [];
    var seenIds = {};

    if (!headers.length) {
      return { ok: false, tableId: tableId, headers: [], mapping: {}, missing: table.fields.filter(function (x) { return x.required; }).map(function (x) { return x.label; }), errors: [err(0, '文件', '', '文件为空或没有表头')], warnings: [], preview: [], patch: {}, stats: { rows: 0, valid: 0 } };
    }
    if (status.missing.length) {
      return { ok: false, tableId: tableId, headers: headers, mapping: status.mapping, missing: status.missing, unmatched: status.unmatched, errors: [err(0, '表头', status.missing.join('、'), '缺少必填列：' + status.missing.join('、'))], warnings: [], preview: [], patch: {}, stats: { rows: parsed.rows.length, valid: 0 } };
    }

    parsed.rows.forEach(function (rowArr, i) {
      var rowNo = i + 2; // 含表头
      if (rowArr.every(function (c) { return String(c == null ? '' : c).trim() === ''; })) return;
      var values = { __row: rowNo };
      var rowErrors = [];
      table.fields.forEach(function (fld) {
        var raw = colValue(rowArr, status.mapping, fld.key);
        var e0 = errors.length;
        var val = coerce(fld, raw, dataset, errors, rowNo);
        if (errors.length > e0) rowErrors.push(errors[errors.length - 1]);
        // 外键在行级先校验，保证一次把问题都报出来
        if (fld.fk && val) {
          var hit = resolveRef(dataset, fld.fk, val);
          if (!hit) {
            errors.push(err(rowNo, fld.label, val, '找不到对应记录（' + fld.label + '）'));
            rowErrors.push(errors[errors.length - 1]);
          } else {
            val = hit.id;
          }
        }
        values[fld.key] = val;
      });
      // 主键 / 唯一性
      var pk = pkField(tableId);
      if (pk && values[pk]) {
        if (seenIds[values[pk]]) errors.push(err(rowNo, pk, values[pk], '文件内主键重复'));
        seenIds[values[pk]] = true;
      }
      if (rowErrors.length === 0) records.push({ values: values, rowNo: rowNo });
      if (errors.length > MAX_ERRORS) return;
    });

    var patch = {};
    if (tableId === 'orders') patch = transformOrders(records, dataset, errors, warnings);
    else if (tableId === 'purchase') patch = transformPurchase(records, dataset, errors, warnings);
    else {
      var key = table.tables[0];
      patch[key] = records.map(function (r) {
        var obj = {};
        table.fields.forEach(function (fld) { obj[fld.key] = r.values[fld.key]; });
        obj.__row = undefined;
        return finalizeRow(tableId, obj, dataset, errors, r.rowNo);
      }).filter(Boolean);
      if (tableId === 'invoices') {
        patch.invoices.forEach(function (inv) {
          if (inv.direction === '进项') inv.direction = 'input';
          if (inv.direction === '销项') inv.direction = 'output';
        });
      }
    }

    var trimmedErrors = errors.slice(0, MAX_ERRORS);
    var preview = (patch[Object.keys(patch)[0]] || []).slice(0, 5);
    return {
      ok: trimmedErrors.length === 0,
      tableId: tableId,
      label: table.label,
      headers: headers,
      mapping: status.mapping,
      unmatched: status.unmatched,
      missing: status.missing,
      errors: trimmedErrors,
      errorCount: errors.length,
      warnings: warnings.slice(0, 30),
      warningCount: warnings.length,
      preview: preview,
      patch: patch,
      stats: { rows: parsed.rows.length, valid: records.length, outputRows: Object.keys(patch).reduce(function (s, k) { return s + patch[k].length; }, 0) }
    };
  }

  function pkField(tableId) {
    var map = {
      orders: 'order_id', shipments: 'shipment_id', platform_bills: 'bill_id', payouts: 'payout_id',
      purchase: 'po_id', employees: 'employee_id', expenses: 'expense_id', invoices: 'invoice_id',
      skus: 'sku_id', stores: 'store_id', opening_inventory: 'sku_id'
    };
    return map[tableId];
  }

  function finalizeRow(tableId, obj, dataset, errors, rowNo) {
    function ref(kind, key, required, label) {
      if (!obj[key]) { if (required) errors.push(err(rowNo, label, '', '必填项为空')); return; }
      var hit = resolveRef(dataset, kind, obj[key]);
      if (!hit && required) { errors.push(err(rowNo, label, obj[key], '找不到对应记录')); return; }
      if (hit) obj[key] = hit.id;
    }
    if (tableId === 'shipments') {
      if (!obj.shipment_id) obj.shipment_id = 'SH-' + (obj.order_id || '') + '-' + rowNo;
      ref('orders', 'order_id', true, '订单号');
      obj.returned = ['1', 'true', '是'].indexOf(String(obj.returned).toLowerCase()) >= 0;
    }
    if (tableId === 'expenses') { ref('stores', 'store_id', false, '店铺'); if (!obj.expense_id) obj.expense_id = 'EXP-IMP-' + rowNo; }
    if (tableId === 'invoices') {
      if (!obj.invoice_id) obj.invoice_id = 'INV-IMP-' + rowNo;
      obj.direction = obj.direction === '销项' ? 'output' : obj.direction === '进项' ? 'input' : obj.direction;
    }
    if (tableId === 'employees') {
      obj.store_ids = (Array.isArray(obj.store_ids) ? obj.store_ids : []).map(function (sid) {
        var hit = resolveRef(dataset, 'stores', sid);
        return hit ? hit.id : sid;
      }).filter(Boolean);
    }
    if (tableId === 'skus') { ref('suppliers', 'supplier_id', false, '供应商'); }
    if (tableId === 'platform_bills') { ref('stores', 'store_id', true, '店铺'); }
    if (tableId === 'payouts') { ref('stores', 'store_id', true, '店铺'); ref('platform_bills', 'bill_id', false, '账单号'); }
    if (tableId === 'opening_inventory') { ref('skus', 'sku_id', true, '商品编码'); }
    if (tableId === 'stores') {
      if (obj.platform && ['淘宝', '天猫', 'taobao'].indexOf(String(obj.platform).toLowerCase()) >= 0) obj.platform = 'taobao';
      if (obj.platform === '小红书') obj.platform = 'xhs';
    }
    var idField = pkField(tableId);
    if (idField && idField !== 'sku_id' && obj[idField]) obj.id = obj[idField];
    if (tableId === 'skus' && obj.sku_id) obj.id = obj.sku_id;
    if (tableId === 'opening_inventory') obj.sku_id = obj.sku_id;
    delete obj.__row;
    return obj;
  }

  function apply(dataset, patch, mode) {
    var out = JSON.parse(JSON.stringify(dataset));
    function replaceOrMerge(table, key) {
      if (!patch[table]) return;
      if (mode === 'replace' || !out[table]) { out[table] = patch[table]; return; }
      var map = {};
      out[table].forEach(function (r) { map[r[key]] = r; });
      patch[table].forEach(function (r) { map[r[key]] = r; });
      out[table] = Object.keys(map).map(function (k) { return map[k]; });
    }
    if (patch.orders) {
      var oids = {};
      patch.orders.forEach(function (o) { oids[o.id] = true; });
      if (mode === 'replace') {
        out.orders = patch.orders.slice();
        out.order_items = (patch.order_items || []).slice();
      } else {
        out.orders = out.orders.filter(function (o) { return !oids[o.id]; }).concat(patch.orders);
        out.order_items = out.order_items.filter(function (it) { return !oids[it.order_id]; }).concat(patch.order_items || []);
      }
    }
    if (patch.purchase_orders) {
      var pids = {};
      patch.purchase_orders.forEach(function (p) { pids[p.id] = true; });
      if (mode === 'replace') {
        out.purchase_orders = patch.purchase_orders.slice();
        out.purchase_items = (patch.purchase_items || []).slice();
      } else {
        out.purchase_orders = out.purchase_orders.filter(function (p) { return !pids[p.id]; }).concat(patch.purchase_orders);
        out.purchase_items = out.purchase_items.filter(function (it) { return !pids[it.po_id]; }).concat(patch.purchase_items || []);
      }
    }
    replaceOrMerge('shipments', 'id');
    replaceOrMerge('platform_bills', 'id');
    replaceOrMerge('payouts', 'id');
    replaceOrMerge('employees', 'id');
    replaceOrMerge('expenses', 'id');
    replaceOrMerge('invoices', 'id');
    replaceOrMerge('skus', 'id');
    replaceOrMerge('stores', 'id');
    replaceOrMerge('opening_inventory', 'sku_id');
    return out;
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var name = String(file.name || '').toLowerCase();
      if (/\.xls$/.test(name)) {
        reject(new Error('不支持旧版 .xls，请在 Excel 中另存为 .xlsx 或 CSV 后再导入'));
        return;
      }
      if (/\.(csv|txt)$/.test(name) || !/\.xlsx$/.test(name)) {
        var reader = new FileReader();
        reader.onerror = function () { reject(new Error('文件读取失败')); };
        reader.onload = function () {
          try {
            var parsed = parseCsv(String(reader.result || ''));
            resolve({ headers: parsed.headers, rows: parsed.rows, sheetNames: [], source: 'csv' });
          } catch (e) { reject(e); }
        };
        reader.readAsText(file, 'utf-8');
        return;
      }
      var xr = new FileReader();
      xr.onerror = function () { reject(new Error('文件读取失败')); };
      xr.onload = function () {
        XLSXReader.parseXlsx(xr.result, { maxRows: 20000 }).then(function (res) {
          var rows = res.rows || [];
          if (!rows.length) { resolve({ headers: [], rows: [], sheetNames: res.sheetNames, source: 'xlsx' }); return; }
          resolve({
            headers: rows[0].map(function (h) { return String(h).trim(); }),
            rows: rows.slice(1),
            sheetNames: res.sheetNames,
            truncated: res.truncated,
            source: 'xlsx'
          });
        }).catch(reject);
      };
      xr.readAsArrayBuffer(file);
    });
  }

  function round2(n) { return Math.round((n + (n >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }

  return {
    parseCsv: parseCsv,
    normalizeDate: normalizeDate,
    parseMoney: parseMoney,
    mapHeaders: mapHeaders,
    prepare: prepare,
    apply: apply,
    readFile: readFile
  };
});
