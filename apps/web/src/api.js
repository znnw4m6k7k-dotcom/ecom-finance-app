/* 薄适配层：把 Demo 前端接到后端 API。
 * - 用 http(s) 打开且后端 /api/v1/health 可用 → 服务端模式：登录、数据来自数据库、导入/设置写回服务端；
 * - 用 file:// 双击打开 → 保持 Demo 原样（离线演示模式）。
 * 令牌只放 sessionStorage（关闭标签页即失效），不放 localStorage。
 */
(function (root) {
  'use strict';
  var BASE = '/api/v1';
  var TOKEN_KEY = 'efa_token';
  var TENANT_KEY = 'efa_tenant';

  function getToken() { try { return sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function setToken(t) { try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } }

  function request(method, path, body, opts) {
    opts = opts || {};
    var headers = {};
    var token = getToken();
    if (token) headers.authorization = 'Bearer ' + token;
    var payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    return fetch(BASE + path, { method: method, headers: headers, body: payload }).then(function (res) {
      return res.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { json = { message: text }; }
        if (res.status === 401 && !opts.noAuthRedirect) {
          setToken(null);
          api.user = null;
          showLogin('登录已失效，请重新登录');
        }
        if (!res.ok) {
          var msg = json && json.message ? (Array.isArray(json.message) ? json.message.join('；') : json.message) : ('请求失败 ' + res.status);
          var err = new Error(msg);
          err.status = res.status;
          err.body = json;
          throw err;
        }
        return json;
      });
    });
  }

  var loginResolve = null;
  function showLogin(message) {
    var el = document.getElementById('login-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'login-root';
      document.body.appendChild(el);
    }
    var tenant = '';
    try { tenant = localStorage.getItem(TENANT_KEY) || ''; } catch (e) { /* ignore */ }
    el.innerHTML = '<div class="login-mask"><form class="login-card" id="login-form" autocomplete="on">' +
      '<div class="brand-mark" style="margin:0 auto 10px">财</div>' +
      '<h2>电商财务中枢</h2><p class="hint">请使用公司分配的账号登录</p>' +
      (message ? '<div class="login-msg">' + root.UI.esc(message) + '</div>' : '') +
      '<label class="field"><span>企业代码</span><input class="input" name="tenant" required value="' + root.UI.esc(tenant) + '" placeholder="例如 luye-demo"></label>' +
      '<label class="field"><span>账号</span><input class="input" name="username" required autocomplete="username"></label>' +
      '<label class="field"><span>密码</span><input class="input" name="password" type="password" required autocomplete="current-password"></label>' +
      '<button class="btn primary" type="submit" style="width:100%;justify-content:center;margin-top:8px">登录</button>' +
      '</form></div>';
    el.querySelector('#login-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var body = { tenant: f.tenant.value.trim(), username: f.username.value.trim(), password: f.password.value };
      request('POST', '/auth/login', body, { noAuthRedirect: true }).then(function (res) {
        setToken(res.token);
        try { localStorage.setItem(TENANT_KEY, body.tenant); } catch (e2) { /* ignore */ }
        api.user = res.user;
        el.innerHTML = '';
        if (loginResolve) { var r = loginResolve; loginResolve = null; r(res.user); }
        else location.reload();
      }).catch(function (err) { showLogin(err.message); });
    });
  }

  // ---------- 钉钉工作台免登 ----------
  function inDingTalk() { return /DingTalk/i.test(navigator.userAgent || ''); }
  function urlTenant() {
    var m = (location.search || '').match(/[?&]tenant=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
    try { return localStorage.getItem(TENANT_KEY) || ''; } catch (e) { return ''; }
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error('钉钉 JSAPI 加载失败')); };
      document.head.appendChild(s);
    });
  }
  // 钉钉首页地址可写 ?corpId=$CORPID$，钉钉打开时会替换成当前企业的 CorpId，免去手工配置
  function urlCorpId() {
    try { var v = new URLSearchParams(root.location.search).get('corpId'); return v && v.indexOf('$') < 0 ? v : ''; } catch (e) { return ''; }
  }
  function getAuthCode(cfg) {
    cfg = Object.assign({}, cfg, { corpId: urlCorpId() || cfg.corpId });
    return new Promise(function (resolve, reject) {
      if (!cfg.corpId) { reject(new Error('钉钉免登失败：缺少 CorpId（首页地址请带 &corpId=$CORPID$）')); return; }
      var dd = root.dd;
      if (!dd) { reject(new Error('钉钉 JSAPI 不可用')); return; }
      var done = function (r) { resolve(r.code || r.authCode); };
      var fail = function (e) { reject(new Error('钉钉免登失败：' + ((e && (e.errorMessage || e.message)) || JSON.stringify(e)))); };
      if (dd.requestAuthCode) dd.requestAuthCode({ corpId: cfg.corpId, clientId: cfg.clientId, onSuccess: done, onFail: fail, success: done, fail: fail });
      else if (dd.runtime && dd.runtime.permission) dd.runtime.permission.requestAuthCode({ corpId: cfg.corpId, onSuccess: done, onFail: fail });
      else fail({ message: '当前钉钉版本不支持免登' });
    });
  }
  function dingtalkLogin() {
    var tenant = urlTenant();
    if (!inDingTalk() || !tenant) return Promise.resolve(null);
    return request('GET', '/auth/dingtalk/config', undefined, { noAuthRedirect: true }).then(function (cfg) {
      if (!cfg || !cfg.enabled) return null;
      return loadScript(cfg.jsapiUrl).then(function () { return getAuthCode(cfg); }).then(function (code) {
        return request('POST', '/auth/dingtalk', { tenant: tenant, authCode: code }, { noAuthRedirect: true });
      }).then(function (res) {
        setToken(res.token);
        try { localStorage.setItem(TENANT_KEY, tenant); } catch (e) { /* ignore */ }
        api.user = res.user;
        return res.user;
      });
    }).catch(function (e) { showLogin(e.message); return new Promise(function (resolve) { loginResolve = resolve; }); });
  }

  function ensureLogin() {
    if (!getToken()) {
      return dingtalkLogin().then(function (u) {
        if (u) return u;
        return new Promise(function (resolve) { loginResolve = resolve; showLogin(); });
      });
    }
    return request('GET', '/auth/me', undefined, { noAuthRedirect: true }).then(function (me) { api.user = me; return me; }).catch(function () {
      setToken(null);
      return new Promise(function (resolve) { loginResolve = resolve; showLogin('请重新登录'); });
    });
  }

  function detect() {
    if (location.protocol === 'file:') return Promise.resolve(false);
    return fetch(BASE + '/health').then(function (r) { return r.ok ? r.json() : null; }).then(function (h) {
      api.health = h;
      return !!(h && h.ok);
    }).catch(function () { return false; });
  }

  var api = {
    mode: 'demo',
    user: null,
    health: null,
    request: request,
    can: function (perm) { return !!(api.user && api.user.permissions && api.user.permissions.indexOf(perm) >= 0); },
    /** 返回 Promise<dataset|null>；null 表示离线演示模式 */
    boot: function () {
      return detect().then(function (ok) {
        if (!ok) return null;
        api.mode = 'api';
        return ensureLogin().then(function () { return api.loadDataset(); });
      });
    },
    loadDataset: function () { return request('GET', '/dataset'); },
    validateImport: function (tableId, file) {
      var fd = new FormData(); fd.append('file', file);
      return request('POST', '/imports/' + encodeURIComponent(tableId) + '/validate', fd);
    },
    commitImport: function (tableId, file, mode) {
      var fd = new FormData(); fd.append('file', file); fd.append('mode', mode);
      return request('POST', '/imports/' + encodeURIComponent(tableId) + '/commit', fd);
    },
    saveSettings: function (payload) { return request('PUT', '/dataset/settings', payload); },
    logout: function () { setToken(null); location.reload(); }
  };

  root.FinApi = api;
})(typeof window !== 'undefined' ? window : globalThis);
