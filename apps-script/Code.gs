/**
 * チョコっちゃ‼フェスタ2027 運営ボード用 API（Google Apps Script） v2
 * データ：スプレッドシート「チョコっちゃ‼運営サイト_データ」
 * ログイン：members シートの pass 列（メンバーごとのパスワード）。role 列が admin の人は管理者。
 * パスワードはこのコードには書かない（日髙さんが members シートに入力する）。
 *
 * コードを貼り替えたら：デプロイ → デプロイを管理 → 鉛筆（編集）→ バージョン「新バージョン」→ デプロイ
 * （URL は変わらない）
 */

var TZ = 'Asia/Tokyo';
var MAX_TEXT = 1000;
var TYPES = { done: 1, question: 1, reply: 1, note: 1 };
var KINDS = { d: 1, p: 1, x: 1, m: 1 };
// スプレッドシートの ID（単独のプロジェクトとして作った場合にも使う）
var SS_ID = '1A-ua2SoD1iGm5jk9CcYlWyCvWYn9zivrOC0eu0aTMHQ';

function doGet() {
  return json_({ ok: true, service: 'chocotcha-ops', version: 2 });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  var me = auth_(req.pass);
  if (me === 'not_configured') return json_({ ok: false, error: 'not_configured' });
  if (!me) {
    Utilities.sleep(800); // 総当たりを遅くする
    return json_({ ok: false, error: 'bad_pass' });
  }
  try {
    switch (req.action) {
      case 'data':
        return json_(loadAll_(me));
      case 'post':
        return json_(addPost_(req, me));
      case 'hide':
        if (!me.admin) return json_({ ok: false, error: 'admin_only' });
        return json_(setHidden_(req.task, !!req.hidden));
      case 'addTask':
        if (!me.admin) return json_({ ok: false, error: 'admin_only' });
        return json_(addTask_(req.task || {}, me));
      default:
        return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return json_({ ok: false, error: 'server_error', message: String(err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function ss_() {
  return SpreadsheetApp.getActive() || SpreadsheetApp.openById(SS_ID);
}

function sheet_(name) {
  return ss_().getSheetByName(name);
}

function rows_(name) {
  var v = sheet_(name).getDataRange().getDisplayValues();
  var head = v.shift();
  return v.filter(function (r) { return r.join('') !== ''; }).map(function (r) {
    var o = {};
    head.forEach(function (h, i) { o[h] = r[i]; });
    return o;
  });
}

function readConfig_() {
  var o = {};
  rows_('config').forEach(function (r) { o[r.key] = String(r.value || '').trim(); });
  return o;
}

// パスワードからメンバーを特定する。誰にもパスワードがなければ not_configured。
function auth_(pass) {
  pass = String(pass || '').trim();
  var ms = rows_('members'), any = false, hit = null;
  ms.forEach(function (m) {
    var p = String(m.pass || '').trim();
    if (p) any = true;
    if (p && pass && p === pass) hit = m;
  });
  if (!any) return 'not_configured';
  if (!hit) return null;
  return { key: hit.key, name: hit.name, admin: String(hit.role || '').toLowerCase() === 'admin' };
}

function loadAll_(me) {
  var cfg = readConfig_();
  return {
    ok: true,
    me: me,
    admin: me.admin,
    updated: cfg.updated || '',
    members: rows_('members').map(function (m) {
      return { key: m.key, name: m.name, color: m.color, post: m.post }; // パスワードは返さない
    }),
    lanes: rows_('lanes'),
    tasks: rows_('tasks'),
    posts: rows_('posts'),
    status: rows_('status')
  };
}

function clean_(s, max) {
  s = String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (s.length > max) s = s.slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // 数式として解釈させない
  return s;
}

function addPost_(req, me) {
  var type = String(req.type || '');
  if (!TYPES[type]) return { ok: false, error: 'bad_type' };
  var text = clean_(req.text, MAX_TEXT);
  if (!text && type !== 'done') return { ok: false, error: 'empty' };
  var task = clean_(req.task, 20);
  var tasks = rows_('tasks').map(function (t) { return t.id; });
  if (tasks.indexOf(task) < 0) return { ok: false, error: 'bad_task' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var id = 'p' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    var at = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    sheet_('posts').appendRow([id, at, task, me.key, type, text, clean_(req.parent, 20)]);
    return { ok: true, id: id, at: at };
  } finally {
    lock.releaseLock();
  }
}

function setHidden_(task, hidden) {
  task = clean_(task, 20);
  var sh = sheet_('status');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var v = sh.getDataRange().getValues();
    var at = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    for (var i = 1; i < v.length; i++) {
      if (String(v[i][0]) === task) {
        sh.getRange(i + 1, 2, 1, 2).setValues([[hidden ? 'TRUE' : 'FALSE', hidden ? at : '']]);
        return { ok: true };
      }
    }
    sh.appendRow([task, hidden ? 'TRUE' : 'FALSE', hidden ? at : '']);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function isDate_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z').getTime());
}

function addTask_(t, me) {
  var title = clean_(t.title, 200);
  if (!title) return { ok: false, error: 'task_title' };
  var lanes = rows_('lanes').map(function (l) { return l.key; });
  var lane = String(t.lane || '');
  if (lanes.indexOf(lane) < 0) return { ok: false, error: 'task_lane' };
  var keys = rows_('members').map(function (m) { return m.key; });
  var owners = (Array.isArray(t.owners) ? t.owners : String(t.owners || '').split(','))
    .map(function (k) { return String(k).trim(); })
    .filter(function (k) { return keys.indexOf(k) >= 0; });
  if (!owners.length) return { ok: false, error: 'task_owner' };
  var start = String(t.start || ''), end = String(t.end || start);
  if (!isDate_(start) || !isDate_(end) || end < start) return { ok: false, error: 'task_date' };
  var kind = KINDS[t.kind] ? t.kind : 'd';
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_('tasks');
    var v = sh.getDataRange().getDisplayValues();
    var maxId = 0, maxOrder = 0;
    for (var i = 1; i < v.length; i++) {
      var n = parseInt(String(v[i][0]).replace(/\D/g, ''), 10);
      if (n > maxId) maxId = n;
      var o = parseInt(v[i][9], 10);
      if (o > maxOrder) maxOrder = o;
    }
    var id = 't' + ('00' + (maxId + 1)).slice(-3);
    var at = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    sh.appendRow([id, lane, title, owners.join(','), "'" + start, "'" + end, kind,
      clean_(t.ref, 60), clean_(t.note, 300), maxOrder + 1]);
    setConfig_('updated', at + ' JST｜' + me.name + 'がタスクを追加');
    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

function setConfig_(key, value) {
  var sh = sheet_('config');
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0]) === key) { sh.getRange(i + 1, 2).setValue(value); return; }
  }
  sh.appendRow([key, value, '']);
}
