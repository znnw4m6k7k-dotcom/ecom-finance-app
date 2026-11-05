/* 数据源页：把钉钉/飞书/企微里的智能表和知识库接进工作台（单向：平台 → 工作台）。
 * 情况一：客户没用智能表 → 在平台生成标准模板表；情况二：已有智能表 → AI 给字段对应草稿，财务确认后同步。
 * 冲突不自动覆盖、平台删除先标记，都由财务在本页处理。知识库分数据型（全文检索）与查询型（只看目录）。
 * 模拟平台 / 模拟模型在页面上明确标注，不得当作已接通真实平台。
 */
(function (root) {
  'use strict';
  var UI = root.UI;
  var Api = root.FinApi;
  var T = root.FinTemplates;
  var st = { loaded: false, loading: false, error: null, platform: null, list: [], current: null, preview: null, conflicts: [], deletions: [], inspect: null, search: null, q: '' };

  var BY = { rule: ['规则', 'neutral'], ai: ['AI 建议', 'warn'], manual: ['人工', 'ok'], template: ['模板', 'ok'], none: ['未对应', 'neutral'] };
  var RUN = { ok: ['成功', 'ok'], partial: ['部分成功', 'warn'], failed: ['失败', 'bad'] };
  function fmt(t) { return t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—'; }
  function tableLabel(id) { var t = T && T.getTable(id); return t ? t.label : id; }
  function refresh() { if (root.App && root.App.state.page === 'sources') root.App.render(); }
  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function fail(e) { st.loading = false; UI.toast(e.message, 'err'); refresh(); }

  function load(keepId) {
    st.loading = true;
    var admin = Api.can('source:admin');
    return Promise.all([
      admin ? Api.request('GET', '/sources/platform') : null,
      admin ? Api.request('GET', '/sources') : [],
      admin ? Api.request('GET', '/sources/conflicts') : [],
      admin ? Api.request('GET', '/sources/deletions') : []
    ]).then(function (r) {
      st.platform = r[0]; st.list = r[1]; st.conflicts = r[2]; st.deletions = r[3];
      var id = keepId || (st.current && st.current.id);
      return id ? Api.request('GET', '/sources/' + id) : null;
    }).then(function (d) { st.current = d; st.loaded = true; st.loading = false; st.error = null; refresh(); })
      .catch(function (e) { st.loaded = true; st.loading = false; st.error = e.message; refresh(); });
  }

  function act(promise, okMsg, keepId) {
    st.loading = true; refresh();
    return promise.then(function (res) {
      if (okMsg) UI.toast(typeof okMsg === 'function' ? okMsg(res) : okMsg, 'ok');
      return load(keepId === undefined ? (res && res.id) : keepId).then(function () { return res; });
    }).catch(fail);
  }

  function platformBanner() {
    var p = st.platform; if (!p) return '';
    var c = p.capabilities || {};
    var html = '<div class="callout' + (p.isMock ? ' warn' : '') + '" style="margin-bottom:14px">' + UI.icon('info') + '<div>当前平台：<b>' + UI.esc(p.providerLabel) + '</b>';
    if (p.isMock) html += ' <span class="badge warn">模拟平台，数据是演示用的，不会连接真实钉钉/飞书/企微</span>';
    if (!c.readTables) html += ' · <b>这个平台暂不支持读取智能表</b>（未实现或未配置应用凭证）';
    if (p.provider === 'wecom') html += ' · 企业微信只能读工作台自己生成的模板表，员工自建的表请导出 xlsx 后用“数据导入”';
    html += '<br>读取时以<b>你本人绑定的平台账号</b>为操作人，只能读到你在平台上能看到的表格和知识库。工作台不会回写平台。</div></div>';
    return html;
  }

  function sourceList() {
    var html = '<div class="card span-4"><div class="panel-head"><h3>已接入</h3></div><div class="panel-body">';
    if (!st.list.length) html += '<p class="muted">还没有数据源。用右侧“接入”开始。</p>';
    st.list.forEach(function (s) {
      var status = s.active ? (s.lastSyncStatus ? UI.badge.apply(null, RUN[s.lastSyncStatus] || [s.lastSyncStatus, 'neutral']) : UI.badge('未同步', 'neutral')) : UI.badge('已断开', 'neutral');
      var kind = s.kind === 'table' ? '表格 → ' + tableLabel(s.tableId) : (s.knowledgeMode === 'data' ? '知识库 · 数据型' : '知识库 · 查询型');
      if (s.kind === 'table' && s.mappingStatus !== 'confirmed') status = UI.badge('待确认字段', 'warn');
      html += '<button class="bf-item' + (st.current && st.current.id === s.id ? ' active' : '') + '" data-src="open" data-id="' + s.id + '"><span><b>' + UI.esc(s.name) + '</b>' + (s.isMock ? '（模拟）' : '') +
        '<br><span class="hint">' + UI.esc(kind) + '</span></span>' + status + '</button>';
    });
    html += '</div></div>';
    return html;
  }

  function addPanel() {
    var opts = (T ? T.TABLES : []).map(function (t) { return '<option value="' + t.id + '">' + UI.esc(t.label) + '</option>'; }).join('');
    var html = '<div class="card span-8"><div class="panel-head"><h3>接入</h3></div><div class="panel-body">';
    html += '<div class="k">情况一：还没用智能表 → 在平台生成标准模板</div>' +
      '<p class="hint">先在' + UI.esc(st.platform ? st.platform.providerLabel : '平台') + '里新建一个空的智能表格，复制链接贴到下面。工作台会在里面建好下面几张表，字段和系统一致，员工填表后自动同步。</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input class="input" id="src-tpl-link" placeholder="空智能表格的链接" style="flex:1;min-width:260px">' +
      ['orders', 'expenses', 'platform_bills'].map(function (id) { return '<label class="hint"><input type="checkbox" class="src-tpl" value="' + id + '" checked> ' + UI.esc(tableLabel(id)) + '</label>'; }).join(' ') +
      '<button class="btn primary" data-src="templates">生成模板表</button></div>';
    html += '<div class="k" style="margin-top:16px">情况二：已经在用智能表 → 连接进来</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><input class="input" id="src-link" placeholder="智能表格链接" style="flex:1;min-width:260px" value="' + UI.esc(st.inspect ? st.inspect.link : '') + '"><button class="btn" data-src="inspect">读取</button></div>';
    if (st.inspect) {
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center"><span class="hint">数据表</span><select class="select" id="src-sheet">' +
        st.inspect.sheets.map(function (s) { return '<option value="' + UI.esc(s.sheetId) + '"' + (st.inspect.sheetId === s.sheetId ? ' selected' : '') + '>' + UI.esc(s.name) + '</option>'; }).join('') +
        '</select><span class="hint">写入</span><select class="select" id="src-table">' + opts + '</select><input class="input" id="src-name" placeholder="名称（可选）" style="width:160px">' +
        '<button class="btn primary" data-src="create-table">连接并生成字段对应</button></div>';
    }
    html += '<div class="k" style="margin-top:16px">知识库</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input class="input" id="src-kb-link" placeholder="知识库首页或目录链接" style="flex:1;min-width:260px">' +
      '<select class="select" id="src-kb-mode"><option value="data">数据型：全文检索，AI 可引用</option><option value="reference">查询型：只同步目录，点开看原文</option></select>' +
      '<input class="input" id="src-kb-name" placeholder="名称（可选）" style="width:140px"><button class="btn" data-src="create-kb">接入知识库</button></div>';
    html += '</div></div>';
    return html;
  }

  function mappingEditor(d) {
    var fields = d.targetFields || [];
    var by = d.mappingBy || {};
    var html = '<div class="k">字段对应（平台列 → 系统字段）' + (d.mappingStatus === 'confirmed' ? ' ' + UI.badge('已确认', 'ok') : ' ' + UI.badge('草稿，需确认后才能同步', 'warn')) + '</div>';
    html += rawTable(['平台列', '系统字段', '来源'], Object.keys(d.mapping || {}).map(function (col) {
      var to = d.mapping[col];
      var sel = '<select class="select src-map" data-col="' + UI.esc(col) + '"><option value="">不导入</option>' + fields.map(function (f) {
        return '<option value="' + f.key + '"' + (f.key === to ? ' selected' : '') + '>' + UI.esc(f.label) + (f.required ? ' *' : '') + '</option>';
      }).join('') + '</select>';
      var x = BY[by[col] || 'none'] || BY.none;
      return [UI.esc(col), sel, UI.badge(x[0], x[1])];
    }));
    if (d.check && !d.check.ok) {
      html += '<p class="hint" style="color:var(--red)">' + (d.check.missing.length ? '还缺必填字段：' + d.check.missing.map(UI.esc).join('、') + '。' : '') + (d.check.duplicates.length ? '重复对应：' + d.check.duplicates.map(UI.esc).join('、') + '。' : '') + '</p>';
    }
    html += '<p class="hint">“AI 建议”只是草稿，请逐列核对；带 * 的是必填字段。</p>';
    html += '<div style="display:flex;gap:8px"><button class="btn" data-src="save-map">保存修改</button><button class="btn primary" data-src="confirm-map">保存并确认字段对应</button></div>';
    return html;
  }

  function previewBox() {
    var p = st.preview; if (!p) return '';
    var html = '<div class="callout" style="margin-top:10px">' + UI.icon('info') + '<div><b>预览（未写入）</b>' + (p.isMock ? '（模拟平台）' : '') + '：读到 ' + p.read + ' 行；将新增 ' + p.created + '、更新 ' + p.updated + '、不变 ' + p.unchanged +
      '；冲突 ' + p.conflicts + '（不会覆盖，需你处理）；平台已删除 ' + p.missingAtSource + '（先标记，确认后才删）' + (p.errorCount ? '；<b>有错的行 ' + p.errorCount + '，整单不写入</b>' : '') + (p.fatal ? '<br><b>无法同步：</b>' + UI.esc(p.fatal) : '') + '</div></div>';
    if (p.errors && p.errors.length) html += UI.table({ columns: [{ key: 'row', label: '平台第几行', num: true }, { key: 'field', label: '字段' }, { key: 'value', label: '值' }, { key: 'message', label: '问题' }], rows: p.errors.slice(0, 20).map(function (e) { return { row: e.row - 1, field: e.field, value: e.value, message: e.message }; }) });
    return html;
  }

  function detailPanel() {
    var d = st.current;
    if (!d) return '';
    var html = '<div class="card span-12"><div class="panel-head"><h3>' + UI.esc(d.name) + (d.isMock ? '（模拟）' : '') + '</h3><span class="sub">' +
      (d.kind === 'table' ? '写入：' + UI.esc(tableLabel(d.tableId)) + (d.fromTemplate ? ' · 工作台生成的模板表' : '') : '知识库 · ' + (d.knowledgeMode === 'data' ? '数据型' : '查询型') + ' · 已同步 ' + d.docs + ' 条') +
      ' · 上次同步 ' + fmt(d.lastSyncAt) + '</span></div><div class="panel-body">';
    html += '<p class="hint" style="word-break:break-all">链接：' + UI.esc(d.link) + '</p>';
    if (d.kind === 'table') {
      html += mappingEditor(d);
      html += '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:center">' +
        '<button class="btn" data-src="preview"' + (d.mappingStatus !== 'confirmed' ? ' disabled' : '') + '>预览</button>' +
        '<button class="btn primary" data-src="sync"' + (d.mappingStatus !== 'confirmed' ? ' disabled' : '') + '>' + UI.icon('refresh') + '立即同步</button>';
    } else {
      html += '<div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap;align-items:center"><span class="hint">类型</span><select class="select" id="src-mode"><option value="data"' + (d.knowledgeMode === 'data' ? ' selected' : '') + '>数据型（全文检索，AI 可引用）</option><option value="reference"' + (d.knowledgeMode === 'reference' ? ' selected' : '') + '>查询型（只同步目录）</option></select><button class="btn" data-src="save-mode">保存类型</button>' +
        '<button class="btn primary" data-src="sync">' + UI.icon('refresh') + '立即同步</button>';
    }
    html += '<span class="hint">自动同步</span><select class="select" id="src-interval">' + [[0, '只手动'], [15, '每 15 分钟'], [60, '每小时'], [360, '每 6 小时'], [1440, '每天']].map(function (o) {
      return '<option value="' + o[0] + '"' + (d.syncIntervalMin === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('') + '</select><button class="btn ghost small" data-src="save-interval">保存</button>' + (d.active ? '<button class="btn ghost small" data-src="disconnect">断开</button>' : '') + '</div>';
    if (d.kind === 'table') html += previewBox();
    html += '<div class="k" style="margin-top:14px">同步记录</div>' + UI.table({
      columns: [{ key: 'time', label: '时间' }, { key: 'trigger', label: '方式' }, { key: 'status', label: '结果' }, { key: 'read', label: '读到', num: true }, { key: 'created', label: '新增', num: true }, { key: 'updated', label: '更新', num: true }, { key: 'conflicts', label: '冲突', num: true }, { key: 'missing', label: '平台已删', num: true }, { key: 'errorCount', label: '错误行', num: true }, { key: 'error', label: '说明' }],
      rows: (d.runs || []).map(function (r) { return { time: fmt(r.createdAt), trigger: (r.trigger === 'schedule' ? '定时' : '手动') + (r.isMock ? '（模拟）' : ''), status: (RUN[r.status] || [r.status])[0], read: r.read, created: r.created, updated: r.updated, conflicts: r.conflicts, missing: r.missingAtSource, errorCount: r.errorCount, error: r.error || '' }; })
    });
    html += '</div></div>';
    return html;
  }

  /** 单元格已是安全 HTML 的简单表格（调用方负责转义） */
  function rawTable(headers, rows) {
    return '<div class="table-wrap"><table class="data"><thead><tr>' + headers.map(function (h) { return '<th>' + UI.esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (rows.length ? rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') : '<tr><td colspan="' + headers.length + '"><div class="empty">暂无数据</div></td></tr>') +
      '</tbody></table></div>';
  }

  function rowText(row) {
    return Object.keys(row || {}).filter(function (k) { return row[k] !== '' && row[k] != null && k !== 'id' && !(row.id && row[k] === row.id); }).map(function (k) { return k + '=' + row[k]; }).join('，');
  }

  function pendingPanel() {
    if (!st.conflicts.length && !st.deletions.length) return '';
    var html = '<div class="card span-12"><div class="panel-head"><h3>待你处理</h3><span class="sub">冲突不会自动覆盖；平台删掉的数据确认后才会从核算里删除</span></div><div class="panel-body">';
    if (st.conflicts.length) {
      html += '<div class="k">数据冲突（' + st.conflicts.length + '）</div>' + rawTable(['编号', '数据源', '工作台现有', '平台新数据', ''], st.conflicts.map(function (c) {
        return [UI.esc(tableLabel(c.tableId)) + ' ' + UI.esc(c.rowKey), UI.esc(c.sourceName), '<span class="hint">' + UI.esc(c.existingOwnerName) + '</span><br>' + UI.esc(rowText(c.existing.main)), UI.esc(rowText(c.incoming.main)),
          '<span style="white-space:nowrap"><button class="btn small primary" data-src="conflict" data-act="accept" data-id="' + c.id + '">用平台的</button> <button class="btn small" data-src="conflict" data-act="reject" data-id="' + c.id + '">保留现有</button></span>'];
      }));
    }
    if (st.deletions.length) {
      html += '<div class="k" style="margin-top:12px">平台上已删除（' + st.deletions.length + '）</div>' + rawTable(['业务表', '编号', '数据源', '发现时间', ''], st.deletions.map(function (x) {
        var attrs = ' data-table="' + UI.esc(x.tableId) + '" data-key="' + UI.esc(x.rowKey) + '"';
        return [UI.esc(x.tableLabel), UI.esc(x.rowKey), UI.esc(x.sourceName), fmt(x.deletedDetectedAt),
          '<span style="white-space:nowrap"><button class="btn small primary" data-src="delete" data-act="delete"' + attrs + '>确认删除</button> <button class="btn small" data-src="delete" data-act="keep"' + attrs + '>保留为手工数据</button></span>'];
      }));
    }
    html += '</div></div>';
    return html;
  }

  function searchPanel() {
    if (!Api.can('knowledge:search')) return '';
    var html = '<div class="card span-12"><div class="panel-head"><h3>知识库检索</h3><span class="sub">数据型搜正文，查询型只搜标题和目录</span></div><div class="panel-body">' +
      '<div style="display:flex;gap:8px"><input class="input" id="src-q" placeholder="例如：佣金、提成、报销" value="' + UI.esc(st.q) + '" style="flex:1"><button class="btn primary" data-src="search">检索</button></div>';
    if (st.search) {
      if (!st.search.length) html += '<p class="muted" style="margin-top:8px">没有找到。</p>';
      html += st.search.map(function (r) {
        var title = r.url && /^https?:/.test(r.url) ? '<a href="' + UI.esc(r.url) + '" target="_blank" rel="noopener">' + UI.esc(r.title) + '</a>' : UI.esc(r.title);
        return '<div style="padding:8px 0;border-bottom:1px solid var(--line)"><b>' + title + '</b> ' + UI.badge(r.mode === 'data' ? '数据型' : '查询型', r.mode === 'data' ? 'ok' : 'neutral') + (r.isMock ? ' ' + UI.badge('模拟', 'warn') : '') +
          '<div class="hint">' + UI.esc(r.sourceName) + ' · ' + UI.esc(r.path) + '</div>' + (r.snippet ? '<div style="margin-top:4px">' + UI.esc(r.snippet) + '</div>' : '') + '</div>';
      }).join('');
    }
    html += '</div></div>';
    return html;
  }

  function view() {
    if (!Api || Api.mode !== 'api') return { html: '<div class="card pad"><h3>数据源需要连接服务端</h3><p class="muted">当前是离线演示模式。启动后端后用浏览器访问系统地址即可接入平台智能表和知识库。</p></div>' };
    if (!Api.can('source:admin') && !Api.can('knowledge:search')) return { html: '<div class="card pad"><h3>没有权限</h3><p class="muted">数据源由老板和财务管理。</p></div>' };
    if (!st.loaded && !st.loading) load();
    var html = '<div class="page-head"><div><div class="eyebrow">Sources</div><h2>数据源</h2><p>把钉钉 / 飞书 / 企业微信里的智能表和知识库接进工作台。方向单向：平台 → 工作台。</p></div></div>';
    if (st.error) html += '<div class="callout warn" style="margin-bottom:14px">' + UI.esc(st.error) + '</div>';
    if (Api.can('source:admin')) {
      html += platformBanner();
      html += '<div class="grid grid-12">' + pendingPanel() + sourceList() + addPanel() + detailPanel() + searchPanel() + '</div>';
    } else {
      html += '<div class="grid grid-12">' + searchPanel() + '</div>';
    }
    if (st.loading) html += '<p class="hint">处理中…</p>';
    return { html: html };
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-src]');
    if (!el) return;
    var a = el.getAttribute('data-src');
    var d = st.current;
    if (a === 'open') { st.preview = null; load(el.getAttribute('data-id')); return; }
    if (a === 'templates') {
      var ids = Array.prototype.filter.call(document.querySelectorAll('.src-tpl'), function (x) { return x.checked; }).map(function (x) { return x.value; });
      if (!val('src-tpl-link') || !ids.length) { UI.toast('请填链接并至少选一张表', 'err'); return; }
      act(Api.request('POST', '/sources/templates', { link: val('src-tpl-link'), tableIds: ids }), function (r) { return '已生成 ' + r.created.length + ' 张模板表'; }, null);
      return;
    }
    if (a === 'inspect') {
      var link = val('src-link');
      st.loading = true; refresh();
      Api.request('POST', '/sources/tables/inspect', { link: link }).then(function (r) { st.inspect = Object.assign({ link: link }, r); st.loading = false; refresh(); }).catch(fail);
      return;
    }
    if (a === 'create-table') {
      act(Api.request('POST', '/sources/tables', { link: st.inspect.link, sheetId: val('src-sheet'), tableId: val('src-table'), name: val('src-name') || undefined }).then(function (r) { st.inspect = null; return r; }), '已读取字段，请核对字段对应');
      return;
    }
    if (a === 'create-kb') {
      act(Api.request('POST', '/sources/knowledge', { link: val('src-kb-link'), mode: val('src-kb-mode'), name: val('src-kb-name') || undefined }).then(function (r) {
        return Api.request('POST', '/sources/' + r.id + '/sync').then(function () { return r; });
      }), '知识库已接入并同步');
      return;
    }
    if (a === 'search') {
      st.q = val('src-q');
      Api.request('GET', '/sources/knowledge/search?q=' + encodeURIComponent(st.q)).then(function (r) { st.search = r.items; refresh(); }).catch(fail);
      return;
    }
    if (a === 'conflict') { act(Api.request('POST', '/sources/conflicts/' + el.getAttribute('data-id') + '/resolve', { action: el.getAttribute('data-act') }), '已处理', d ? d.id : null); return; }
    if (a === 'delete') {
      var del = el.getAttribute('data-act') === 'delete';
      if (del && !root.confirm('确认从工作台删除这条数据？删除后核算数字会变化（会记审计）。')) return;
      act(Api.request('POST', '/sources/deletions/resolve', { tableId: el.getAttribute('data-table'), rowKey: el.getAttribute('data-key'), action: el.getAttribute('data-act') }), del ? '已删除' : '已保留为手工数据', d ? d.id : null);
      return;
    }
    if (!d) return;
    if (a === 'save-map' || a === 'confirm-map') {
      var mapping = {};
      Array.prototype.forEach.call(document.querySelectorAll('.src-map'), function (s) { mapping[s.getAttribute('data-col')] = s.value || null; });
      var p = Api.request('PATCH', '/sources/' + d.id + '/mapping', { mapping: mapping });
      if (a === 'confirm-map') p = p.then(function () { return Api.request('POST', '/sources/' + d.id + '/mapping/confirm'); });
      act(p, a === 'confirm-map' ? '字段对应已确认，可以同步了' : '已保存（需重新确认）', d.id);
    } else if (a === 'preview') {
      st.loading = true; refresh();
      Api.request('POST', '/sources/' + d.id + '/preview').then(function (r) { st.preview = r; st.loading = false; refresh(); }).catch(fail);
    } else if (a === 'sync') {
      act(Api.request('POST', '/sources/' + d.id + '/sync'), function (r) { st.preview = null; return r.status === 'failed' ? '同步失败：' + (r.error || '') : '同步完成：新增 ' + r.created + '，更新 ' + r.updated + (r.conflicts ? '，冲突 ' + r.conflicts : '') + (r.errorCount ? '，错误行 ' + r.errorCount : ''); }, d.id)
        .then(function () { if (root.App && root.App.reloadData) root.App.reloadData(); });
    } else if (a === 'save-mode') {
      act(Api.request('PATCH', '/sources/' + d.id, { knowledgeMode: val('src-mode') }), '已保存，下次同步按新类型处理', d.id);
    } else if (a === 'save-interval') {
      act(Api.request('PATCH', '/sources/' + d.id, { syncIntervalMin: Number(val('src-interval')) }), '已保存', d.id);
    } else if (a === 'disconnect') {
      if (!root.confirm('断开后不再同步。已写入的业务数据保留（转为手工数据），知识库条目会从检索中移除。确定？')) return;
      act(Api.request('DELETE', '/sources/' + d.id), '已断开', d.id);
    }
  });

  root.Views = root.Views || {};
  root.Views.sources = view;
})(typeof window !== 'undefined' ? window : globalThis);
