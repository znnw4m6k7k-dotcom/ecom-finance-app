/* 经营简报页：AI 草稿 → 财务修改/提交 → 老板审核 → 钉钉通知。
 * 所有数字来自服务端核算（facts），AI 只写文字；页面明确标注“模拟模型 / 模拟连接器”。
 */
(function (root) {
  'use strict';
  var UI = root.UI;
  var Api = root.FinApi;
  var st = { list: null, current: null, loading: false, editing: false, error: null, connector: null };

  var STATUS = { DRAFT: ['草稿', 'neutral'], FAILED: ['生成失败', 'bad'], SUBMITTED: ['待审核', 'warn'], APPROVED: ['已通过', 'ok'], REJECTED: ['已退回', 'bad'] };
  function statusBadge(s) { var x = STATUS[s] || [s, 'neutral']; return UI.badge(x[0], x[1]); }
  function fmt(t) { return t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—'; }
  function factText(f) { return f.unit === '元' ? UI.money2(f.value) : f.unit === '%' ? f.value.toFixed(2) + '%' : UI.num(f.value) + ' ' + f.unit; }

  function refresh() { if (root.App && root.App.state.page === 'briefing') root.App.render(); }

  function load(id) {
    st.loading = true;
    var p = [Api.request('GET', '/briefings'), st.connector ? Promise.resolve(st.connector) : Api.request('GET', '/connectors')];
    return Promise.all(p).then(function (r) {
      st.list = r[0]; st.connector = r[1];
      var pick = id || (st.current && st.current.id) || (st.list[0] && st.list[0].id);
      return pick ? Api.request('GET', '/briefings/' + pick) : null;
    }).then(function (b) { st.current = b; st.loading = false; st.error = null; refresh(); })
      .catch(function (e) { st.loading = false; st.error = e.message; refresh(); });
  }

  function act(promise, okMsg) {
    st.loading = true; refresh();
    return promise.then(function (b) {
      st.current = b; st.editing = false; st.loading = false;
      if (okMsg) UI.toast(okMsg, 'ok');
      return load(b.id);
    }).catch(function (e) { st.loading = false; UI.toast(e.message, 'err'); refresh(); });
  }

  function renderDraft(b) {
    var d = b.draft;
    if (!d) return '<p class="muted">暂无草稿内容。' + (b.error ? '失败原因：' + UI.esc(b.error) : '') + '</p>';
    if (st.editing) {
      return '<div class="bf-edit"><label class="field"><span>标题</span><input class="input" id="bf-headline" value="' + UI.esc(d.headline) + '"></label>' +
        '<label class="field"><span>要点（每行一条，最多 5 条）</span><textarea class="input" id="bf-highlights" rows="5">' + UI.esc(d.highlights.join('\n')) + '</textarea></label>' +
        '<label class="field"><span>风险与异常（每行“标题：说明”）</span><textarea class="input" id="bf-risks" rows="5">' + UI.esc(d.risks.map(function (r) { return r.title + '：' + r.detail; }).join('\n')) + '</textarea></label>' +
        '<label class="field"><span>建议动作（每行“老板/财务/运营｜标题：说明”）</span><textarea class="input" id="bf-actions" rows="5">' + UI.esc(d.actions.map(function (a) { return a.owner + '｜' + a.title + '：' + a.detail; }).join('\n')) + '</textarea></label>' +
        '<div style="display:flex;gap:8px"><button class="btn primary" data-bf="save">保存为新版本</button><button class="btn" data-bf="cancel-edit">取消</button></div></div>';
    }
    var html = '<h3 style="margin:0 0 8px">' + UI.esc(d.headline) + '</h3>';
    html += '<div class="k">要点</div><ul class="bf-list">' + d.highlights.map(function (h) { return '<li>' + UI.esc(h) + '</li>'; }).join('') + '</ul>';
    if (d.risks.length) html += '<div class="k">风险与异常</div><ul class="bf-list">' + d.risks.map(function (r) { return '<li><b>' + UI.esc(r.title) + '</b>：' + UI.esc(r.detail) + '</li>'; }).join('') + '</ul>';
    if (d.actions.length) html += '<div class="k">建议动作</div><ul class="bf-list">' + d.actions.map(function (a) { return '<li>【' + UI.esc(a.owner) + '】<b>' + UI.esc(a.title) + '</b>：' + UI.esc(a.detail) + '</li>'; }).join('') + '</ul>';
    return html;
  }

  function parseEdit() {
    function lines(id) { return document.getElementById(id).value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); }
    function split(s, sep) { var i = s.indexOf(sep); return i < 0 ? [s, s] : [s.slice(0, i).trim(), s.slice(i + 1).trim()]; }
    return {
      headline: document.getElementById('bf-headline').value.trim(),
      highlights: lines('bf-highlights'),
      risks: lines('bf-risks').map(function (l) { var p = split(l, '：'); return { title: p[0], detail: p[1] }; }),
      actions: lines('bf-actions').map(function (l) {
        var a = split(l, '｜'); var p = split(a[1], '：');
        return { owner: ['老板', '财务', '运营'].indexOf(a[0]) >= 0 ? a[0] : '财务', title: p[0], detail: p[1] };
      })
    };
  }

  function view(ctx) {
    if (!Api || Api.mode !== 'api') {
      return { html: '<div class="card pad"><h3>经营简报需要连接服务端</h3><p class="muted">当前是离线演示模式（双击打开的单文件 HTML）。启动后端后用浏览器访问系统地址即可使用 AI 简报、审核与钉钉通知。</p></div>' };
    }
    if (st.list === null && !st.loading) { load(); }
    var model = root.App.state.model;
    var html = '<div class="page-head"><div><div class="eyebrow">Briefing</div><h2>月度经营简报</h2>' +
      '<p>系统核算数字 + AI 起草文字解读 → 财务修改提交 → 老板审核通过后推送到办公平台。</p></div>';
    if (Api.can('briefing:generate')) {
      html += '<div class="head-actions"><select class="select" id="bf-month">' + model.months.slice().reverse().map(function (m) { return '<option value="' + m + '">' + UI.fullMonth(m) + '</option>'; }).join('') + '</select>' +
        '<button class="btn primary" data-bf="generate"' + (st.loading ? ' disabled' : '') + '>' + UI.icon('refresh') + (st.loading ? '处理中…' : '生成 AI 草稿') + '</button></div>';
    }
    html += '</div>';
    var c = st.connector;
    var h = Api.health || {};
    html += '<div class="callout" style="margin-bottom:14px">' + UI.icon('info') + '<div>' +
      '模型：<b>' + UI.esc(h.model ? h.model.provider : '?') + '</b>' + (h.model && h.model.isMock ? ' <span class="badge warn">模拟模型，非真实 AI</span>' : '') +
      ' · 通知：<b>' + UI.esc(c ? c.active.provider : '?') + '</b>' + (c && c.active.isMock ? ' <span class="badge warn">模拟连接器，不会真正发送</span>' : '') +
      '</div></div>';
    if (st.error) html += '<div class="callout" style="border-color:var(--red)">' + UI.esc(st.error) + '</div>';
    html += '<div class="grid grid-12">';
    html += '<div class="card span-4"><div class="panel-head"><h3>简报记录</h3></div><div class="panel-body">';
    if (!st.list) html += '<p class="muted">加载中…</p>';
    else if (!st.list.length) html += '<p class="muted">还没有简报。选择账期后点「生成 AI 草稿」。</p>';
    else html += st.list.map(function (x) {
      return '<button class="bf-item' + (st.current && st.current.id === x.id ? ' active' : '') + '" data-bf="open" data-id="' + x.id + '">' +
        '<span>' + UI.fullMonth(x.month) + ' · 第 ' + x.version + ' 版</span>' + statusBadge(x.status) + '</button>';
    }).join('');
    html += '</div></div>';

    var b = st.current;
    html += '<div class="card span-8"><div class="panel-head"><h3>' + (b ? UI.fullMonth(b.month) + ' 经营简报' : '简报详情') + '</h3>' + (b ? '<span class="sub">' + statusBadge(b.status) + ' 第 ' + b.version + ' 版 · 更新 ' + fmt(b.updatedAt) + '</span>' : '') + '</div><div class="panel-body">';
    if (!b) html += '<p class="muted">选择左侧一份简报查看。</p>';
    else {
      var facts = (b.facts && b.facts.facts) || [];
      html += '<div class="k">系统核算（不可由 AI 修改）</div><div class="bf-facts">' + facts.slice(0, 8).map(function (f) {
        return '<div><span>' + UI.esc(f.label) + '</span><b>' + factText(f) + '</b></div>';
      }).join('') + '</div>';
      if (b.unverified && b.unverified.length) {
        html += '<div class="callout" style="margin:10px 0;border-color:var(--amber, #c58b00)">' + UI.icon('alert') + '<div><b>请核对：</b>文字中有数字与系统核算对不上：' + b.unverified.map(UI.esc).join('、') + '</div></div>';
      }
      html += '<div class="k" style="margin-top:12px">文字解读（' + (b.modelIsMock ? '模拟模型' : UI.esc(b.modelProvider + ' / ' + b.modelName)) + ' 起草）</div>';
      html += renderDraft(b);
      if (b.reviewComment) html += '<p class="hint">审核意见：' + UI.esc(b.reviewComment) + '</p>';
      if (b.status === 'FAILED' && b.error) html += '<p class="hint" style="color:var(--red)">生成失败：' + UI.esc(b.error) + '，可点“重新生成”。</p>';
      html += '<div class="bf-actions">';
      var s = b.status;
      if (Api.can('briefing:generate') && (s === 'DRAFT' || s === 'FAILED' || s === 'REJECTED')) html += '<button class="btn" data-bf="regenerate">' + UI.icon('refresh') + '重新生成</button>';
      if (Api.can('briefing:edit') && (s === 'DRAFT' || s === 'REJECTED') && b.draft && !st.editing) html += '<button class="btn" data-bf="edit">修改</button>';
      if (Api.can('briefing:submit') && s === 'DRAFT' && !st.editing) html += '<button class="btn primary" data-bf="submit">提交老板审核</button>';
      if (Api.can('briefing:approve') && s === 'SUBMITTED') {
        html += '<input class="input" id="bf-comment" placeholder="审核意见（退回必填）" style="min-width:220px">' +
          '<button class="btn primary" data-bf="approve">' + UI.icon('check') + '审核通过并通知</button><button class="btn" data-bf="reject">退回修改</button>';
      }
      if (Api.can('briefing:approve') && s === 'APPROVED' && b.notifications && b.notifications.some(function (n) { return n.status !== 'sent'; })) html += '<button class="btn" data-bf="notify">重试通知</button>';
      html += '</div>';

      html += '<div class="k" style="margin-top:16px">通知记录</div>';
      html += (b.notifications && b.notifications.length) ? UI.table({
        columns: [{ key: 'provider', label: '平台' }, { key: 'channel', label: '通道' }, { key: 'statusText', label: '状态' }, { key: 'attempts', label: '尝试', num: true }, { key: 'time', label: '时间' }, { key: 'error', label: '说明' }],
        rows: b.notifications.map(function (n) { return { provider: n.provider + (n.isMock ? '（模拟）' : ''), channel: n.channel, statusText: n.status === 'sent' ? '已发送' : n.status === 'failed' ? '失败' : '处理中', attempts: n.attempts, time: fmt(n.updatedAt), error: n.error || '' }; })
      }) : '<p class="hint">审核通过后自动发送。</p>';
      html += '<div class="k" style="margin-top:16px">AI 调用记录</div>';
      html += (b.aiCalls && b.aiCalls.length) ? UI.table({
        columns: [{ key: 'model', label: '模型' }, { key: 'ok', label: '结果' }, { key: 'tokens', label: 'tokens', num: true }, { key: 'cost', label: '估算费用(元)', num: true }, { key: 'ms', label: '耗时ms', num: true }, { key: 'err', label: '错误' }],
        rows: b.aiCalls.map(function (a) { return { model: a.provider + '/' + a.model + (a.isMock ? '（模拟）' : ''), ok: a.ok ? '成功' : '失败', tokens: a.inputTokens + a.outputTokens, cost: a.costCny == null ? '未配置单价' : Number(a.costCny).toFixed(4), ms: a.latencyMs, err: a.error || '' }; })
      }) : '<p class="hint">无</p>';
      html += '<div class="k" style="margin-top:16px">版本</div><p class="hint">' + (b.versions || []).map(function (v) { return '第 ' + v.version + ' 版（' + (v.source === 'ai' ? 'AI' : '人工') + '，' + UI.esc((b.names && b.names[v.createdById]) || '') + '，' + fmt(v.createdAt) + '）'; }).join('；') + '</p>';
    }
    html += '</div></div></div>';
    return { html: html };
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-bf]');
    if (!el) return;
    var a = el.getAttribute('data-bf');
    var b = st.current;
    if (a === 'open') { st.editing = false; load(el.getAttribute('data-id')); return; }
    if (a === 'generate') { act(Api.request('POST', '/briefings', { month: document.getElementById('bf-month').value }), '草稿已生成'); return; }
    if (!b) return;
    if (a === 'regenerate') act(Api.request('POST', '/briefings/' + b.id + '/regenerate'), '已重新生成');
    else if (a === 'edit') { st.editing = true; refresh(); }
    else if (a === 'cancel-edit') { st.editing = false; refresh(); }
    else if (a === 'save') act(Api.request('PATCH', '/briefings/' + b.id, { draft: parseEdit() }), '已保存为新版本');
    else if (a === 'submit') act(Api.request('POST', '/briefings/' + b.id + '/submit'), '已提交审核');
    else if (a === 'approve') {
      var c = document.getElementById('bf-comment').value.trim();
      act(Api.request('POST', '/briefings/' + b.id + '/approve', c ? { version: b.version, comment: c } : { version: b.version }), '已审核通过');
    } else if (a === 'reject') act(Api.request('POST', '/briefings/' + b.id + '/reject', { comment: document.getElementById('bf-comment').value.trim() }), '已退回');
    else if (a === 'notify') act(Api.request('POST', '/briefings/' + b.id + '/notify').then(function () { return b; }), '已重试');
  });

  root.Views = root.Views || {};
  root.Views.briefing = view;
})(typeof window !== 'undefined' ? window : globalThis);
