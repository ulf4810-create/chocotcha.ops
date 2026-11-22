(function () {
  "use strict";
  var API = (window.OPS_CONFIG && window.OPS_CONFIG.api) || "";
  // 種別：決定は既定なので一覧では表示しない
  var KL = { p: "提案", x: "回答待ち", m: "期日" };
  var KF = { d: "決定", p: "提案（未決定）", x: "外部の回答待ち", m: "期日（1日だけ）" };
  // パスワードは保存しない。以前の版が保存した分は消す。名前（コメント用）だけ覚える。
  try { localStorage.removeItem("ops_pass"); } catch (e) {}
  var getName = function () { try { return localStorage.getItem("ops_name") || ""; } catch (e) { return ""; } };
  var setName = function (v) { try { localStorage.setItem("ops_name", v); } catch (e) {} };

  var S = { pass: "", me: null, data: null, isAdmin: false,
    view: (window.innerWidth || 0) >= 900 ? "chart" : "list",
    who: decodeURIComponent(location.hash.slice(1)) || "all", showHid: false, busy: false, cur: "", editId: "", open: "" };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  var I = {
    cal: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2.5 6.8h11M5.5 2v3M10.5 2v3" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>',
    cmt: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h10a1.5 1.5 0 0 1 1.5 1.5v5.5A1.5 1.5 0 0 1 13 11.5H7.2L4.2 14v-2.5H3A1.5 1.5 0 0 1 1.5 10V4.5A1.5 1.5 0 0 1 3 3z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
    tag: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 2.5h5.2l6 6-5.2 5.2-6-6z" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="5.4" cy="5.4" r="1" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.8 8.4l2.6 2.6 5.8-5.9" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    x: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5"/></svg>'
  };

  // ---- dates（日数で扱う。日本時間）
  var D = function (s) { var a = String(s).split("-").map(Number); return Date.UTC(a[0], a[1] - 1, a[2]) / 864e5; };
  var W = function (x) { return "日月火水木金土"[new Date(x * 864e5).getUTCDay()]; };
  var md = function (x) { var d = new Date(x * 864e5); return (d.getUTCMonth() + 1) + "/" + d.getUTCDate() + "（" + W(x) + "）"; };
  var today = Math.floor((Date.now() + 9 * 36e5) / 864e5);
  var S0 = D("2026-11-22"), S1 = D("2027-03-21"), N = S1 - S0;
  var pct = function (x) { return ((x - S0) / N * 100).toFixed(3) + "%"; };
  var ymd = function (x) { return new Date(x * 864e5).toISOString().slice(0, 10); };
  $("cd").textContent = Math.max(0, D("2027-02-14") - today);

  // ---- api
  function api(body) {
    if (!API) return Promise.reject({ error: "no_api" });
    if (S.pass) body.pass = S.pass;
    return fetch(API, { method: "POST", body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j.ok) throw j; return j; });
  }
  var toastT = 0;
  function say(t) {
    var m = $("msg"); clearTimeout(toastT);
    m.textContent = t || ""; m.classList.toggle("hide", !t);
    if (t) toastT = setTimeout(function () { m.classList.add("hide"); }, 3500);
  }
  var ERR = {
    bad_pass: "パスワードが違います。",
    not_configured: "管理用パスワードがまだ設定されていません（スプレッドシートのmembersで、日髙さんの行のpass列に入力します）。",
    task_title: "タスク名を入力してください。", task_lane: "分野を選んでください。", task_owner: "担当を1人以上選んでください。",
    task_date: "開始日と期限を正しく入れてください（期限は開始日以降）。", no_api: "接続先がまだ設定されていません。",
    admin_only: "この操作は管理モードでだけできます。", empty: "コメントを入力してください。", need_name: "お名前を入力してください。",
    bad_name: "その名前は使えません。別の書き方にしてください。", busy: "書き込みが混み合っています。少し時間をおいてください。",
    bad_task: "そのタスクが見つかりません（削除された可能性があります）。", bad_post: "そのコメントが見つかりません。"
  };
  var errText = function (e) { return ERR[e && e.error] || "通信できませんでした。少し待ってからもう一度お試しください。"; };

  // ---- sheets（くわしい画面・入力画面）
  var SHEETS = ["taskSheet", "addForm", "admForm"], lastFocus = null;
  function show(id, focusSel) {
    SHEETS.forEach(function (x) { $(x).classList.toggle("hide", x !== id); });
    $("scrim").classList.remove("hide"); document.body.classList.add("modal");
    if (!S.open) lastFocus = document.activeElement;
    S.open = id;
    setTimeout(function () { var f = focusSel ? $(id).querySelector(focusSel) : null; (f || $(id).querySelector("[data-close]")).focus(); }, 30);
  }
  function closeSheets() {
    SHEETS.forEach(function (x) { $(x).classList.add("hide"); });
    $("scrim").classList.add("hide"); document.body.classList.remove("modal");
    S.open = ""; S.cur = "";
    if (S.editId) { clearForm(); formMode(""); }
    $("gerr").textContent = ""; $("gpass").value = "";
    if (lastFocus && lastFocus.focus && document.body.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }
  $("scrim").addEventListener("click", closeSheets);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && S.open) closeSheets(); });

  // ---- 管理モード（右上）
  $("admOpen").addEventListener("click", function () { show("admForm", "#gpass"); });
  $("admForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var p = $("gpass").value.trim(); if (!p) return;
    $("gerr").textContent = "確認しています…";
    S.pass = p; load(false, true, true);
  });
  function logout(msg) {
    S.pass = ""; S.isAdmin = false; S.me = null; S.showHid = false; $("showhid").checked = false;
    if (S.open === "addForm" || S.open === "admForm") closeSheets();
    if (S.data) { S.data.admin = false; setup(); render(); if (S.open === "taskSheet") renderSheet(); }
    say(msg || "");
  }
  $("logout").addEventListener("click", function () { logout("ログアウトしました。"); });

  function bootErr(msg) { var b = $("boot"); b.textContent = msg; b.classList.remove("hide"); }
  function load(first, quiet, login) {
    if (S.busy) return; S.busy = true;
    if (!first && !quiet) say("読み込んでいます…");
    return api({ action: "data" }).then(function (j) {
      S.busy = false; S.data = j; S.isAdmin = !!j.admin; S.me = S.isAdmin ? j.me : null;
      if (!S.isAdmin) S.pass = "";
      $("boot").classList.add("hide"); $("app").classList.remove("hide"); $("bar2").classList.remove("hide");
      if (login) { closeSheets(); say("管理モードでログインしました。"); }
      else if (!quiet) say("");
      setup(); render();
      if (S.open === "taskSheet" && S.cur) { var ta = $("c-text"); if (!ta || !ta.value) renderSheet(); }
    }).catch(function (e) {
      S.busy = false;
      if (login) { S.pass = ""; $("gerr").textContent = errText(e); return; }
      var authErr = e && (e.error === "bad_pass" || e.error === "not_configured" || e.error === "admin_only");
      if (authErr && S.pass) { logout("管理モードを終了しました（パスワードが変わった可能性があります）。"); return; }
      if (authErr && !S.data) { bootErr("準備中です（サイト側の更新待ち）。少し時間をおいて開き直してください。"); return; }
      if (!S.data) bootErr(errText(e)); else if (!quiet) say(errText(e));
    });
  }

  // ---- model
  var M = {}, Lanes = [], postsBy = {}, hidden = {}, TM = {};
  var PALETTE = ["#2f6fb5", "#16807a", "#7d4cab", "#b07d1a", "#c44f86", "#3f8f3f", "#8a6a55", "#4f6f8f"];
  var short = function (n) { return String(n || "").replace(/（.*$/, ""); };
  var nameOf = function (k) { return M[k] ? short(M[k].name) : k; };
  function colorOf(k) {
    if (M[k]) return M[k].color;
    for (var mk in M) if (short(M[mk].name) === k) return M[mk].color; // 名前がメンバー名と同じなら同じ色
    var h = 0; String(k).split("").forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
    return PALETTE[h % PALETTE.length];
  }
  var av = function (k) { var n = nameOf(k); return '<span class="av" style="background:' + esc(colorOf(k)) + '" title="' + esc(n) + '" aria-hidden="true">' + esc(n.charAt(0)) + "</span>"; };
  var own = function (t) { return String(t.owners || "").split(",").filter(Boolean); };
  var col = function (t) { return colorOf(own(t)[0] || ""); };
  var laneName = function (k) { var l = Lanes.filter(function (x) { return x.key === k; })[0]; return l ? l.name : k; };
  function flags(t) {
    var ps = postsBy[t.id] || [], done = false;
    ps.forEach(function (p) { if (p.type === "done") done = true; });
    return { done: done, n: ps.length };
  }

  function setup() {
    var d = S.data; M = {}; TM = {};
    d.members.forEach(function (m) { M[m.key] = m; });
    d.tasks.forEach(function (t) { TM[t.id] = t; });
    Lanes = d.lanes; hidden = {};
    d.status.forEach(function (s) { if (String(s.hidden).toUpperCase() === "TRUE") hidden[s.task] = s.confirmed_at || true; });
    postsBy = {}; d.posts.forEach(function (p) { (postsBy[p.task] = postsBy[p.task] || []).push(p); });
    $("upd").textContent = d.updated || "—";
    // 右上：管理モードの表示
    $("meName").innerHTML = S.isAdmin && S.me ? av(S.me.key) + esc(nameOf(S.me.key)) + "（管理）" : "";
    $("meName").classList.toggle("hide", !S.isAdmin); $("logout").classList.toggle("hide", !S.isAdmin); $("admOpen").classList.toggle("hide", S.isAdmin);
    $("addBtn").classList.toggle("hide", !S.isAdmin); $("showhidL").classList.toggle("hide", !S.isAdmin);
    if (!S.isAdmin) { S.showHid = false; $("showhid").checked = false; }
    // コメントの名前候補
    $("names").innerHTML = d.members.filter(function (m) { return String(m.post).toUpperCase() === "TRUE"; }).map(function (m) { return '<option value="' + esc(short(m.name)) + '">'; }).join("");
    if (S.isAdmin) {
      var lv = $("a-lane").value;
      $("a-lane").innerHTML = Lanes.map(function (l) { return '<option value="' + esc(l.key) + '">' + esc(l.name) + "</option>"; }).join("");
      $("a-lane").value = lv || "e";
      var checked = {}; [].forEach.call($("a-owners").querySelectorAll("input:checked"), function (c) { checked[c.value] = 1; });
      $("a-owners").innerHTML = d.members.map(function (m) { return '<label><input type="checkbox" value="' + esc(m.key) + '"' + (checked[m.key] ? " checked" : "") + ">" + esc(short(m.name)) + "</label>"; }).join("");
    }
  }

  // ---- 担当の絞り込み（チップ）
  function renderChips() {
    var d = S.data, vis = d.tasks.filter(function (t) { return S.showHid || !hidden[t.id]; });
    var cnt = function (k) { return vis.filter(function (t) { return own(t).indexOf(k) >= 0; }).length; };
    var keys = d.members.map(function (m) { return m.key; }).filter(function (k) { return k !== "all" && cnt(k) > 0; });
    if (S.who !== "all" && keys.indexOf(S.who) < 0) S.who = "all";
    $("who").innerHTML = '<button type="button" class="chip all" data-who="all" aria-pressed="' + (S.who === "all") + '">全員<span class="n">' + vis.length + "</span></button>" +
      keys.map(function (k) { return '<button type="button" class="chip" data-who="' + esc(k) + '" aria-pressed="' + (S.who === k) + '">' + av(k) + esc(nameOf(k)) + '<span class="n">' + cnt(k) + "</span></button>"; }).join("");
  }
  function visibleTasks() {
    return S.data.tasks.filter(function (t) { return (S.who === "all" || own(t).indexOf(S.who) >= 0) && (S.showHid || !hidden[t.id]); });
  }

  // ---- 一覧（リスト）
  function dueCls(b) { return b < today ? "over" : b === today ? "today" : b === today + 1 ? "tmr" : b <= today + 6 ? "week" : ""; }
  function dl(x) { var d = x - today; return d === 0 ? "今日" : d === 1 ? "明日" : d === -1 ? "昨日" : md(x); }
  function dueHtml(t) {
    var a = D(t.start), b = D(t.end);
    var txt = a === b ? dl(b) : dl(a) + "〜" + dl(b);
    return '<span class="due ' + dueCls(b) + '">' + I.cal + "<span>" + esc(txt) + "</span></span>";
  }
  function ringHtml(t) {
    var on = flags(t).done || !!hidden[t.id];
    return '<span class="ring' + (on ? " on" : "") + '" style="--c:' + esc(col(t)) + '" aria-hidden="true">' + (on ? I.check : "") + "</span>";
  }
  function ownHtml(t) {
    var os = own(t);
    return '<span class="own"><span class="avs">' + os.map(av).join("") + "</span>" + esc(os.map(nameOf).join("・")) + "</span>";
  }
  function row(t) {
    var f = flags(t), h = hidden[t.id];
    return '<div class="task' + (h ? " is-hid" : "") + '" data-open="' + esc(t.id) + '" tabindex="0" role="button">' + ringHtml(t) +
      '<div class="tbody"><div class="tt">' + esc(t.title) + "</div>" +
      (t.note ? '<div class="tn">' + esc(t.note) + "</div>" : "") +
      '<div class="tm">' + dueHtml(t) +
      (KL[t.kind] ? '<span class="lbl k-' + esc(t.kind) + '">' + I.tag + esc(KL[t.kind]) + "</span>" : "") +
      (f.n ? '<span class="cm" title="コメント">' + I.cmt + f.n + "</span>" : "") +
      (h ? '<span class="lbl tagb">確認済み</span>' : f.done ? '<span class="lbl ok tagb">完了の記録あり</span>' : "") +
      '<span class="right">' + ownHtml(t) + '<span class="proj"># ' + esc(laneName(t.lane)) + "</span></span>" +
      "</div></div></div>";
  }
  var byDue = function (a, b) { return D(a.end) - D(b.end) || D(a.start) - D(b.start) || (+a.order || 0) - (+b.order || 0); };
  function section(key, title, sub, list) {
    return '<section class="sec" data-sec="' + esc(key) + '"><h2 class="sec-h">' + title + (sub ? ' <span class="wd">' + esc(sub) + "</span>" : "") + "<small>" + list.length + "件</small></h2>" + list.map(row).join("") + "</section>";
  }
  function renderList() {
    var ts = visibleTasks().slice().sort(byDue), h = "";
    // 最近のコメント
    var ps = S.data.posts.filter(function (p) { return TM[p.task] && (S.showHid || !hidden[p.task]); }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    if (ps.length) {
      h += '<details class="recent"><summary>' + I.cmt + "<b>最近のコメント</b>" + ps.length + "件</summary>" + ps.slice(0, 6).map(function (p) {
        return '<div class="rc" data-open="' + esc(p.task) + '" tabindex="0" role="button">' + av(p.member) + '<div class="rb"><div class="rt">' + esc(nameOf(p.member)) + "・" + esc(String(p.at).slice(5).replace("-", "/")) + "・" + esc(TM[p.task].title) + "</div>" + (p.text ? "<p>" + esc(p.text) + "</p>" : "<p>完了を記録</p>") + "</div></div>";
      }).join("") + "</details>";
    }
    if (S.isAdmin) {
      var wait = ts.filter(function (t) { return !hidden[t.id] && flags(t).done; });
      if (wait.length) h += section("wait", "確認待ち", "完了の記録あり", wait);
    }
    var G = [], grp = function (key, title, sub) { var g = G.filter(function (x) { return x.key === key; })[0]; if (!g) G.push(g = { key: key, title: title, sub: sub, list: [] }); return g; };
    ts.forEach(function (t) {
      var b = D(t.end), dt = new Date(b * 864e5), g;
      if (b < today) g = grp("over", "期限切れ", "");
      else if (b <= today + 6) g = grp("d" + b, b === today ? "今日" : b === today + 1 ? "明日" : md(b), b <= today + 1 ? md(b) : "");
      else g = grp("m" + dt.getUTCFullYear() + "-" + dt.getUTCMonth(), (dt.getUTCMonth() + 1) + "月", dt.getUTCFullYear() !== new Date(today * 864e5).getUTCFullYear() ? dt.getUTCFullYear() + "年" : "");
      g.list.push(t);
    });
    h += G.map(function (g) { return section(g.key, esc(g.title), g.sub, g.list); }).join("");
    if (!ts.length) h += '<p class="empty-st">表示するタスクはありません。</p>';
    $("pl").innerHTML = h;
  }

  // ---- チャート
  function renderChart() {
    var h = '<div class="g-hd"><div class="g-lab"></div><div class="g-t">', x, dt;
    for (x = S0; x < S1; x++) { dt = new Date(x * 864e5); if (dt.getUTCDate() === 1 || x === S0) h += '<b style="left:calc(' + pct(x) + ' + 4px)">' + (dt.getUTCMonth() + 1) + "月</b>"; if (dt.getUTCDay() === 1) h += '<span style="left:' + pct(x) + '">' + (dt.getUTCMonth() + 1) + "/" + dt.getUTCDate() + "</span>"; }
    h += '</div></div><div class="g-ov">';
    for (x = S0; x < S1; x++) if (new Date(x * 864e5).getUTCDay() === 1) h += '<i class="g-wk" style="left:' + pct(x) + '"></i>';
    [["2026-12-29", "2027-01-04", "年末年始"], ["2027-01-20", "2027-02-11", "期末試験（目安）"]].forEach(function (a) { h += '<i class="g-hol" style="left:' + pct(D(a[0])) + ";width:calc(" + pct(D(a[1])) + " - " + pct(D(a[0])) + ')"><b>' + a[2] + "</b></i>"; });
    if (today >= S0 && today < S1) h += '<i class="g-now" style="left:' + pct(today + 0.5) + '"></i>';
    h += "</div>";
    var vis = visibleTasks();
    Lanes.forEach(function (l) {
      var rows = S.data.tasks.filter(function (t) { return t.lane === l.key && (vis.indexOf(t) >= 0 || (S.who !== "all" && t.lane === "k" && (S.showHid || !hidden[t.id]))); })
        .sort(function (a, b) { return D(a.start) - D(b.start) || D(a.end) - D(b.end); });
      if (!rows.length) return;
      h += '<div class="g-lane"><div class="g-lab">' + esc(l.name) + "</div><div></div></div>";
      rows.forEach(function (t) {
        var a = D(t.start), b = D(t.end) + 1, f = flags(t);
        var mk = t.kind === "m" ? '<i class="g-ms" style="left:' + pct(a + 0.5) + ";--c:" + esc(col(t)) + '"></i>' : '<i class="g-bar k-' + esc(t.kind) + '" style="left:' + pct(a) + ";width:" + pct(S0 + b - a) + ";--c:" + esc(col(t)) + '"></i>';
        h += '<div class="g-row' + (hidden[t.id] ? " is-hid" : "") + '" tabindex="0" role="button" data-open="' + esc(t.id) + '"><div class="g-lab">' + esc(t.title) + (f.done && !hidden[t.id] ? ' <span class="g-mk ok">完了</span>' : "") + '</div><div class="g-trk">' + mk + "</div></div>";
      });
    });
    $("g").innerHTML = h;
  }

  function render() {
    if (!S.data) return;
    renderChips();
    $("app").classList.toggle("wide", S.view === "chart");
    $("pl").classList.toggle("hide", S.view !== "list"); $("pc").classList.toggle("hide", S.view !== "chart");
    $("v-list").setAttribute("aria-pressed", S.view === "list"); $("v-chart").setAttribute("aria-pressed", S.view === "chart");
    if (S.view === "list") renderList(); else {
      renderChart();
      var sc = $("sc"); requestAnimationFrame(function () { var lw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--lw")) || 0; sc.scrollLeft = Math.max(0, (today - S0) / N * (sc.scrollWidth - lw) - 24); });
    }
  }

  // ---- くわしい画面（タスク）
  function post(p) {
    var isAdm = !!M[p.member];
    return '<div class="cmt">' + av(p.member) + '<div class="cb"><div class="chd"><b>' + esc(nameOf(p.member)) + "</b>" +
      (isAdm ? '<span class="lbl tagb">主催</span>' : "") + (p.type === "done" ? '<span class="lbl ok tagb">完了を記録</span>' : "") +
      "<time>" + esc(String(p.at).slice(5).replace("-", "/")) + "</time>" +
      (S.isAdmin ? '<button type="button" class="icon" data-del="' + esc(p.id) + '" aria-label="このコメントを削除" title="削除">' + I.x + "</button>" : "") +
      "</div>" + (p.text ? "<p>" + esc(p.text) + "</p>" : "") + "</div></div>";
  }
  function commentForm() {
    if (S.isAdmin) return '<form class="cform" id="cform"><textarea id="c-text" maxlength="1000" rows="3" placeholder="コメントを入力"></textarea>' +
      '<div class="cact"><span class="sub">' + esc(nameOf(S.me.key)) + "（主催）として書き込みます</span><button class=\"btn pri sm\" type=\"submit\">コメント</button></div></form>";
    return '<form class="cform" id="cform"><input id="c-name" type="text" maxlength="20" list="names" placeholder="お名前（必須）" autocomplete="name" value="' + esc(getName()) + '" aria-label="お名前">' +
      '<textarea id="c-text" maxlength="1000" rows="3" placeholder="コメントを入力" aria-label="コメント"></textarea>' +
      '<div class="cact"><span class="sub">名前とコメントは、このページを見る全員に表示されます</span><button class="btn pri sm" type="submit">コメント</button></div></form>';
  }
  function renderSheet() {
    var t = TM[S.cur]; if (!t) { closeSheets(); return; }
    var f = flags(t), h = hidden[t.id], os = own(t);
    var ps = (postsBy[t.id] || []).slice().sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    $("taskSheet").innerHTML =
      '<div class="sh-head"><span class="crumb"># ' + esc(laneName(t.lane)) + '</span><button type="button" class="icon" data-close aria-label="閉じる">' + I.x + "</button></div>" +
      '<div class="sh-body"><div class="sh-title">' + ringHtml(t) + '<h2 id="tsTitle">' + esc(t.title) + "</h2></div>" +
      (t.note ? '<p class="desc">' + esc(t.note) + "</p>" : "") +
      '<dl class="props">' +
      "<div><dt>期日</dt><dd>" + dueHtml(t) + (t.start !== t.end ? '<span class="sub">開始 ' + md(D(t.start)) + "／期限 " + md(D(t.end)) + "</span>" : "") + "</dd></div>" +
      '<div><dt>担当</dt><dd class="ownl">' + os.map(function (k) { return "<span>" + av(k) + esc(nameOf(k)) + "</span>"; }).join("") + "</dd></div>" +
      "<div><dt>分野</dt><dd># " + esc(laneName(t.lane)) + "</dd></div>" +
      "<div><dt>種別</dt><dd>" + esc(KF[t.kind] || "") + "</dd></div>" +
      (t.ref ? "<div><dt>根拠</dt><dd>決定ログ " + esc(t.ref) + "</dd></div>" : "") +
      (h ? '<div><dt>状態</dt><dd>確認済み（非表示）' + (h === true ? "" : '<span class="sub">' + esc(h) + "</span>") + "</dd></div>" : f.done ? '<div><dt>状態</dt><dd class="okc">完了の記録あり</dd></div>' : "") +
      "</dl>" +
      (S.isAdmin ? '<div class="admrow"><button type="button" class="btn sm" data-edit="' + esc(t.id) + '">編集</button><button type="button" class="btn sm" data-done>完了を記録</button>' +
        (h ? '<button type="button" class="btn sm" data-hide="0">表示に戻す</button>' : '<button type="button" class="btn sm" data-hide="1">確認済みにして非表示</button>') + "</div>" : "") +
      '<h3 class="ch">コメント<span>' + ps.length + "</span></h3>" +
      '<div class="thread">' + (ps.length ? ps.map(post).join("") : '<p class="empty">まだコメントはありません。</p>') + "</div>" +
      commentForm() + "</div>";
  }
  function openTask(id) { if (!TM[id]) return; S.cur = id; renderSheet(); show("taskSheet"); }

  function sendPost(type) {
    var ta = $("c-text"), text = ta ? ta.value.trim() : "", body = { action: "post", task: S.cur, type: type, text: text };
    if (!S.isAdmin) {
      var nm = $("c-name").value.trim();
      if (!nm) { say(ERR.need_name); $("c-name").focus(); return; }
      body.name = nm; setName(nm);
    }
    if (!text && type !== "done") { say(ERR.empty); ta.focus(); return; }
    var bs = $("taskSheet").querySelectorAll("button"); [].forEach.call(bs, function (b) { b.disabled = true; });
    var tid = S.cur;
    api(body).then(function () {
      if ($("c-text")) $("c-text").value = "";
      say(type === "done" ? "完了を記録しました。" : "コメントしました。");
      S.cur = tid; return load(false, true);
    }).catch(function (er) { [].forEach.call(bs, function (b) { b.disabled = false; }); say(errText(er)); });
  }

  // ---- 追加・編集（同じ画面）
  function formMode(id) {
    S.editId = id || "";
    $("addHead").textContent = id ? "タスクを編集（" + id + "）" : "タスクを追加";
    $("addSubmit").textContent = id ? "保存する" : "追加する";
  }
  function clearForm() {
    $("a-title").value = ""; $("a-ref").value = ""; $("a-note").value = ""; $("a-kind").value = "d"; $("a-end").disabled = false;
    [].forEach.call($("a-owners").querySelectorAll("input"), function (c) { c.checked = false; });
  }
  function syncKind() { var m = $("a-kind").value === "m"; $("a-end").disabled = m; if (m) $("a-end").value = $("a-start").value; }
  $("a-kind").addEventListener("change", syncKind);
  $("a-start").addEventListener("change", function () { if (!$("a-end").value || $("a-end").value < $("a-start").value || $("a-kind").value === "m") $("a-end").value = $("a-start").value; });
  $("addBtn").addEventListener("click", function () {
    if (S.editId) clearForm(); formMode("");
    if (!$("a-start").value) { $("a-start").value = ymd(today); $("a-end").value = ymd(today); }
    if (S.who !== "all") [].forEach.call($("a-owners").querySelectorAll("input"), function (c) { if (!$("a-title").value) c.checked = c.value === S.who; });
    show("addForm", "#a-title");
  });
  function openEdit(id) {
    var t = TM[id]; if (!t) return;
    formMode(id);
    $("a-title").value = t.title || ""; $("a-lane").value = t.lane; $("a-kind").value = KF[t.kind] ? t.kind : "d";
    $("a-start").value = t.start; $("a-end").value = t.end; $("a-ref").value = t.ref || ""; $("a-note").value = t.note || "";
    var os = own(t); [].forEach.call($("a-owners").querySelectorAll("input"), function (c) { c.checked = os.indexOf(c.value) >= 0; });
    syncKind();
    show("addForm", "#a-title");
  }
  $("addForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var owners = [].map.call($("a-owners").querySelectorAll("input:checked"), function (c) { return c.value; });
    var t = { title: $("a-title").value.trim(), lane: $("a-lane").value, kind: $("a-kind").value, start: $("a-start").value, end: $("a-kind").value === "m" ? $("a-start").value : $("a-end").value, owners: owners, ref: $("a-ref").value.trim(), note: $("a-note").value.trim() };
    if (!t.title) { say(ERR.task_title); $("a-title").focus(); return; }
    if (!owners.length) { say(ERR.task_owner); return; }
    if (!t.start || !t.end || t.end < t.start) { say(ERR.task_date); return; }
    var btn = $("addSubmit"), editing = S.editId; btn.disabled = true;
    if (editing) t.id = editing;
    api({ action: editing ? "editTask" : "addTask", task: t }).then(function (j) {
      btn.disabled = false; clearForm(); formMode(""); closeSheets();
      say(editing ? "タスクを更新しました。" : "タスクを追加しました（" + j.id + "）。");
      return load(false, true).then(function () { openTask(j.id); });
    }).catch(function (er) { btn.disabled = false; say(errText(er)); });
  });

  // ---- events
  $("showhid").addEventListener("change", function () { S.showHid = $("showhid").checked; render(); });
  $("v-list").addEventListener("click", function () { S.view = "list"; render(); });
  $("v-chart").addEventListener("click", function () { S.view = "chart"; render(); });
  window.addEventListener("hashchange", function () { var h = decodeURIComponent(location.hash.slice(1)) || "all"; if (h !== S.who) { S.who = h; render(); } });
  document.addEventListener("keydown", function (e) {
    var o = e.target.closest && e.target.closest("[data-open]");
    if (o && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openTask(o.dataset.open); }
  });
  document.addEventListener("submit", function (e) { if (e.target.id === "cform") { e.preventDefault(); sendPost("note"); } });
  document.addEventListener("click", function (e) {
    var t = e.target;
    var w = t.closest("[data-who]"); if (w) { S.who = w.dataset.who; history.replaceState(null, "", S.who === "all" ? location.pathname + location.search : "#" + encodeURIComponent(S.who)); render(); return; }
    var o = t.closest("[data-open]"); if (o) { openTask(o.dataset.open); return; }
    if (t.closest("[data-close]")) { closeSheets(); return; }
    var ed = t.closest("[data-edit]"); if (ed) { openEdit(ed.dataset.edit); return; }
    if (t.closest("[data-done]")) { sendPost("done"); return; }
    var del = t.closest("[data-del]");
    if (del) {
      if (!window.confirm("このコメントを削除しますか？（閲覧者には表示されなくなります）")) return;
      del.disabled = true;
      api({ action: "deletePost", id: del.dataset.del }).then(function () { say("コメントを削除しました。"); return load(false, true); })
        .catch(function (er) { del.disabled = false; say(errText(er)); });
      return;
    }
    var hd = t.closest("[data-hide]");
    if (hd) {
      hd.disabled = true;
      api({ action: "hide", task: S.cur, hidden: hd.dataset.hide === "1" }).then(function () {
        say(hd.dataset.hide === "1" ? "確認済みにして非表示にしました。" : "表示に戻しました。"); return load(false, true);
      }).catch(function (er) { hd.disabled = false; say(errText(er)); });
    }
  });
  setInterval(function () {
    var a = document.activeElement;
    if (document.visibilityState === "visible" && S.data && !(a && a.matches && a.matches("input,textarea,select")) && S.open !== "addForm") load(false, true);
  }, 90000);

  // ---- start
  if (!API) bootErr("接続先がまだ設定されていません（準備中）。");
  else load(true);
})();
