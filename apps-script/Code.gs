/**
 * チョコっちゃ‼フェスタ2027 運営ボード用 API（Google Apps Script） v5
 * データ：スプレッドシート「チョコっちゃ‼運営サイト_データ」
 * 閲覧：パスワード不要（URLを知っている人は誰でも見られる）。
 * コメント：誰でも書ける（名前の入力が必須）。管理者はコメントを削除（非表示）できる。
 * 管理：members シートで role が admin の行の pass 列（日髙さんのパスワード）でだけ、
 *       タスクの追加・編集、書き込み、非表示ができる。パスワードはこのコードには書かない。
 *
 * コードを貼り替えたら：デプロイ → デプロイを管理 → 鉛筆（編集）→ バージョン「新バージョン」→ デプロイ
 * （URL は変わらない）
 */

var TZ = 'Asia/Tokyo';
var MAX_TEXT = 1000;
var MAX_NAME = 20;
// パスワードなしで使える操作（閲覧とコメント）
var PUBLIC = { data: 1, post: 1 };
var TYPES = { done: 1, question: 1, reply: 1, note: 1 };
var KINDS = { d: 1, p: 1, x: 1, m: 1 };
// スプレッドシートの ID（単独のプロジェクトとして作った場合にも使う）
var SS_ID = '1A-ua2SoD1iGm5jk9CcYlWyCvWYn9zivrOC0eu0aTMHQ';

function doGet() {
  return json_({ ok: true, service: 'chocotcha-ops', version: 5 });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  var me = null;
  var pass = String(req.pass || '').trim();
  // 閲覧とコメントはパスワードなしで可。パスワードが付いていれば管理者として確認する。
  if (pass || !PUBLIC[req.action]) {
    me = auth_(pass);
    if (me === 'not_configured') return json_({ ok: false, error: 'not_configured' });
    if (!me) {
      Utilities.sleep(800); // 総当たりを遅くする
      return json_({ ok: false, error: pass ? 'bad_pass' : 'admin_only' });
    }
  }
  try {
    switch (req.action) {
      case 'data':
        return json_(loadAll_(me));
      case 'post':
        return json_(addPost_(req, me));
      case 'hide':
        return json_(setHidden_(req.task, !!req.hidden));
      case 'addTask':
        return json_(addTask_(req.task || {}, me));
      case 'editTask':
        return json_(editTask_(req.task || {}, me));
      case 'deletePost':
        return json_(deletePost_(req.id));
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
  if (!sheet_('config')) return o; // config タブがなくても表示は止めない
  rows_('config').forEach(function (r) { o[r.key] = String(r.value || '').trim(); });
  return o;
}

// 管理者（role が admin の行）のパスワードと一致するか確認する。
// 管理者のパスワードが未入力なら not_configured。admin 以外の行の pass は使わない。
function auth_(pass) {
  pass = String(pass || '').trim();
  var any = false, hit = null;
  rows_('members').forEach(function (m) {
    if (String(m.role || '').trim().toLowerCase() !== 'admin') return;
    var p = String(m.pass || '').trim();
    if (p) any = true;
    if (p && pass && p === pass) hit = m;
  });
  if (!any) return 'not_configured';
  if (!hit) return null;
  return { key: hit.key, name: hit.name, admin: true };
}

function loadAll_(me) {
  var cfg = readConfig_();
  return {
    ok: true,
    me: me,
    admin: !!(me && me.admin),
    updated: cfg.updated || '',
    members: rows_('members').map(function (m) {
      return { key: m.key, name: m.name, color: m.color, post: m.post }; // パスワードは返さない
    }),
    lanes: rows_('lanes'),
    tasks: rows_('tasks'),
    posts: rows_('posts').filter(function (p) { return String(p.hidden || '').toUpperCase() !== 'TRUE'; }),
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
  var who;
  if (me) {
    if (!TYPES[type]) return { ok: false, error: 'bad_type' };
    who = me.key;
  } else {
    // 管理者以外はコメントのみ。名前は必須。
    if (type !== 'note') return { ok: false, error: 'admin_only' };
    who = clean_(req.name, MAX_NAME);
    if (!who) return { ok: false, error: 'need_name' };
    // メンバーの内部ID（hidaka など）は主催の書き込みと区別できなくなるので使わせない
    var keys = rows_('members').map(function (m) { return String(m.key).toLowerCase(); });
    if (keys.indexOf(who.replace(/^'/, '').toLowerCase()) >= 0) return { ok: false, error: 'bad_name' };
    if (tooMany_()) return { ok: false, error: 'busy' };
  }
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
    sheet_('posts').appendRow([id, at, task, who, type, text, me ? clean_(req.parent, 20) : '']);
    return { ok: true, id: id, at: at };
  } finally {
    lock.releaseLock();
  }
}

// いたずら対策：パスワードなしのコメントは10分間に全体で40件まで
function tooMany_() {
  var c = CacheService.getScriptCache();
  var n = parseInt(c.get('pubposts') || '0', 10) + 1;
  c.put('pubposts', String(n), 600);
  return n > 40;
}

// コメントを削除（posts シートの hidden 列を TRUE にする。行は残る）
function deletePost_(id) {
  id = clean_(id, 20);
  var sh = sheet_('posts');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var v = sh.getDataRange().getValues();
    var col = v[0].indexOf('hidden');
    if (col < 0) { col = v[0].length; sh.getRange(1, col + 1).setValue('hidden'); }
    for (var i = 1; i < v.length; i++) {
      if (String(v[i][0]) === id) {
        sh.getRange(i + 1, col + 1).setValue('TRUE');
        return { ok: true };
      }
    }
    return { ok: false, error: 'bad_post' };
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

// 追加・編集で共通の入力チェック。問題があれば { error }、なければ書き込む値を返す。
function checkTask_(t) {
  var title = clean_(t.title, 200);
  if (!title) return { error: 'task_title' };
  var lanes = rows_('lanes').map(function (l) { return l.key; });
  var lane = String(t.lane || '');
  if (lanes.indexOf(lane) < 0) return { error: 'task_lane' };
  var keys = rows_('members').map(function (m) { return m.key; });
  var owners = (Array.isArray(t.owners) ? t.owners : String(t.owners || '').split(','))
    .map(function (k) { return String(k).trim(); })
    .filter(function (k) { return keys.indexOf(k) >= 0; });
  if (!owners.length) return { error: 'task_owner' };
  var start = String(t.start || ''), end = String(t.end || start);
  if (!isDate_(start) || !isDate_(end) || end < start) return { error: 'task_date' };
  var kind = KINDS[t.kind] ? t.kind : 'd';
  // 列の順：lane, title, owners, start, end, kind, ref, note（id と order は別）
  return { cols: [lane, title, owners.join(','), "'" + start, "'" + end, kind, clean_(t.ref, 60), clean_(t.note, 300)] };
}

function addTask_(t, me) {
  var c = checkTask_(t);
  if (c.error) return { ok: false, error: c.error };
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
    sh.appendRow([id].concat(c.cols, [maxOrder + 1]));
    setConfig_('updated', at + ' JST｜' + me.name + 'がタスクを追加');
    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

// 既存タスクを書き換える。id と並び順（order）は変えない。
function editTask_(t, me) {
  var id = clean_(t.id, 20);
  var c = checkTask_(t);
  if (c.error) return { ok: false, error: c.error };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_('tasks');
    var v = sh.getDataRange().getDisplayValues();
    for (var i = 1; i < v.length; i++) {
      if (String(v[i][0]) === id) {
        sh.getRange(i + 1, 2, 1, 8).setValues([c.cols]);
        var at = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
        setConfig_('updated', at + ' JST｜' + me.name + 'がタスクを編集（' + id + '）');
        return { ok: true, id: id };
      }
    }
    return { ok: false, error: 'bad_task' };
  } finally {
    lock.releaseLock();
  }
}

function setConfig_(key, value) {
  var sh = sheet_('config');
  if (!sh) { sh = ss_().insertSheet('config'); sh.appendRow(['key', 'value', '説明']); }
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0]) === key) { sh.getRange(i + 1, 2).setValue(value); return; }
  }
  sh.appendRow([key, value, '']);
}
