/**
 * チョコっちゃ‼フェスタ2027 運営サイト用 API（Google Apps Script）
 * このスクリプトは「チョコっちゃ‼運営サイト_データ」スプレッドシートに紐づけて使う。
 * 合言葉は config シートの team_pass / admin_pass に日髙さんが入力する（コードには書かない）。
 *
 * デプロイ：デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *   次のユーザーとして実行：自分
 *   アクセスできるユーザー：全員
 */

var TZ = 'Asia/Tokyo';
var MAX_TEXT = 1000;
var TYPES = { done: 1, question: 1, reply: 1, note: 1 };

function doGet() {
  return json_({ ok: true, service: 'chocotcha-ops', hint: 'POST only' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  var cfg = readConfig_();
  if (!cfg.team_pass || !cfg.admin_pass) return json_({ ok: false, error: 'not_configured' });
  var isAdmin = !!req.admin && req.admin === cfg.admin_pass;
  var isMember = isAdmin || (!!req.pass && req.pass === cfg.team_pass);
  if (!isMember) return json_({ ok: false, error: 'bad_pass' });

  try {
    switch (req.action) {
      case 'data':
        return json_(loadAll_(cfg, isAdmin));
      case 'post':
        return json_(addPost_(req));
      case 'hide':
        if (!isAdmin) return json_({ ok: false, error: 'admin_only' });
        return json_(setHidden_(req.task, !!req.hidden));
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

// スプレッドシート「チョコっちゃ‼運営サイト_データ」の ID（単独のプロジェクトとして作った場合にも使う）
var SS_ID = '1A-ua2SoD1iGm5jk9CcYlWyCvWYn9zivrOC0eu0aTMHQ';

function sheet_(name) {
  var ss = SpreadsheetApp.getActive() || SpreadsheetApp.openById(SS_ID);
  return ss.getSheetByName(name);
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

function loadAll_(cfg, isAdmin) {
  return {
    ok: true,
    admin: isAdmin,
    updated: cfg.updated || '',
    members: rows_('members'),
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

function addPost_(req) {
  var type = String(req.type || '');
  if (!TYPES[type]) return { ok: false, error: 'bad_type' };
  var text = clean_(req.text, MAX_TEXT);
  if (!text && type !== 'done') return { ok: false, error: 'empty' };
  var task = clean_(req.task, 20);
  var member = clean_(req.member, 30);
  var members = rows_('members').map(function (m) { return m.key; });
  if (members.indexOf(member) < 0) return { ok: false, error: 'bad_member' };
  var tasks = rows_('tasks').map(function (t) { return t.id; });
  if (tasks.indexOf(task) < 0) return { ok: false, error: 'bad_task' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var id = 'p' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    var at = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    sheet_('posts').appendRow([id, at, task, member, type, text, clean_(req.parent, 20)]);
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
