(function () {
  "use strict";
  var API = (window.OPS_CONFIG && window.OPS_CONFIG.api) || "";
  // 状態（空欄＝日付から自動）と優先度（Todoist と同じ P1〜P4）
  var ST = { todo: { n: "未着手", c: "var(--s-todo)" }, doing: { n: "進行中", c: "var(--s-doing)" }, hold: { n: "保留", c: "var(--s-hold)" }, done: { n: "完了", c: "var(--s-done)" } };
  var ST_ORDER = ["todo", "doing", "hold", "done"];
  var PR = { "1": { n: "P1", l: "最優先", c: "var(--p1)" }, "2": { n: "P2", l: "高", c: "var(--p2)" }, "3": { n: "P3", l: "中", c: "var(--p3)" }, "4": { n: "P4", l: "なし", c: "var(--p4)" } };
  var SORTS = { due: 1, prio: 1, state: 1, owner: 1, lane: 1 }, BSORTS = { due: 1, prio: 1, start: 1, title: 1 }, VIEWS = { list: 1, board: 1, chart: 1, comments: 1 };

  // パスワードは保存しない（以前の版が保存した分は消す）。名前と表示の好みだけ端末に覚える。
  var ls = function (k, v) { try { if (v === undefined) return localStorage.getItem(k) || ""; localStorage.setItem(k, v); } catch (e) { return ""; } };
  try { localStorage.removeItem("ops_pass"); } catch (e) {}
  var P = {}; try { P = JSON.parse(ls("ops_prefs") || "{}") || {}; } catch (e) {}

  var S = { ver: 0, pass: "", me: null, data: null, sig: "", isAdmin: false,
    view: VIEWS[P.view] ? P.view : "list", sort: SORTS[P.sort] ? P.sort : "due", showDone: !!P.showDone,
    bgroup: SORTS[P.bgroup] ? P.bgroup : "state", bsort: BSORTS[P.bsort] ? P.bsort : "due",
    who: decodeURIComponent(location.hash.slice(1)) || "all", showHid: false, busy: false, cur: "", editId: "", open: "" };
  var savePrefs = function () { ls("ops_prefs", JSON.stringify({ view: S.view, sort: S.sort, showDone: S.showDone, bgroup: S.bgroup, bsort: S.bsort })); };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var sv = function (d, w) { return '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="' + (w || 1.4) + '" stroke-linecap="round" stroke-linejoin="round">' + d + "</svg>"; };
  var I = {
    cal: sv('<rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 6.8h11M5.5 2v3M10.5 2v3"/>'),
    cmt: sv('<path d="M3 3h10a1.5 1.5 0 0 1 1.5 1.5v5.5A1.5 1.5 0 0 1 13 11.5H7.2L4.2 14v-2.5H3A1.5 1.5 0 0 1 1.5 10V4.5A1.5 1.5 0 0 1 3 3z"/>'),
    flag: sv('<path d="M3.5 14V2.5M3.5 3h8l-1.8 3 1.8 3h-8"/>'),
    check: sv('<path d="M3.8 8.4l2.6 2.6 5.8-5.9"/>', 2),
    x: sv('<path d="M4 4l8 8M12 4l-8 8"/>', 1.6)
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

  // ---- api / toast
  function api(body) {
    if (!API) return Promise.reject({ error: "no_api" });
    if (S.pass) body.pass = S.pass;
    return fetch(API, { method: "POST", body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j.ok) throw j; return j; });
  }
  var toastT = 0;
  function say(t, undo) {
    var m = $("msg"); clearTimeout(toastT);
    m.innerHTML = t ? "<span>" + esc(t) + "</span>" + (undo ? ' <button type="button" class="undo">元に戻す</button>' : "") : "";
    m.classList.toggle("hide", !t);
    if (undo) m.querySelector(".undo").onclick = function () { m.classList.add("hide"); undo(); };
    if (t) { m.style.animation = "none"; void m.offsetWidth; m.style.animation = ""; toastT = setTimeout(function () { m.classList.add("hide"); }, undo ? 6000 : 3500); }
  }
  var ERR = {
    bad_pass: "パスワードが違います。",
    not_configured: "管理用パスワードがまだ設定されていません（スプレッドシートのmembersで、日髙さんの行のpass列に入力します）。",
    task_title: "タスク名を入力してください。", task_lane: "分野を選んでください。", task_owner: "担当を1人以上選んでください。",
    task_date: "開始日と期限を正しく入れてください（期限は開始日以降）。", no_api: "接続先がまだ設定されていません。",
    admin_only: "この操作は管理モードでだけできます。", empty: "コメントを入力してください。", need_name: "お名前を入力してください。",
    bad_name: "その名前は使えません。別の書き方にしてください。", busy: "書き込みが混み合っています。少し時間をおいてください。",
    bad_task: "そのタスクが見つかりません（削除された可能性があります）。", bad_post: "そのコメントが見つかりません。",
    unknown_action: "サイト側の更新がまだです（Apps Scriptの再デプロイ待ち）。"
  };
  var errText = function (e) {
    if (e && e.error === "admin_only" && !S.isAdmin) return "サイト側の更新がまだのため、保存できませんでした（日髙さんがApps Scriptを更新すると使えます）。";
    return ERR[e && e.error] || "通信できませんでした。少し待ってからもう一度お試しください。";
  };

  // ---- sheets（くわしい画面・入力画面）
  var SHEETS = ["taskSheet", "addForm", "admForm"], lastFocus = null, closeT = 0;
  function show(id, focusSel) {
    clearTimeout(closeT);
    SHEETS.forEach(function (x) { $(x).classList.remove("out"); $(x).classList.toggle("hide", x !== id); });
    $("scrim").classList.remove("hide", "out"); document.body.classList.add("modal");
    if (!S.open) lastFocus = document.activeElement;
    S.open = id;
    setTimeout(function () { var f = focusSel ? $(id).querySelector(focusSel) : null; (f || $(id).querySelector("[data-close]")).focus({ preventScroll: true }); }, 40);
  }
  function closeSheets(instant) {
    var cur = S.open; if (!cur) return;
    S.open = ""; S.cur = ""; document.body.classList.remove("modal");
    var el = $(cur), sc = $("scrim");
    var fin = function () { el.classList.add("hide"); el.classList.remove("out"); sc.classList.add("hide"); sc.classList.remove("out"); };
    if (instant || reduced) fin(); else { el.classList.add("out"); sc.classList.add("out"); closeT = setTimeout(fin, 200); }
    if (S.editId) { clearForm(); formMode(""); }
    $("gerr").textContent = ""; $("gpass").value = "";
    if (lastFocus && lastFocus.focus && document.body.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
  }
  $("scrim").addEventListener("click", function () { closeSheets(); });
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
    if (S.open === "addForm" || S.open === "admForm") closeSheets(true);
    if (S.data) { S.data.admin = false; setup(); render(); if (S.open === "taskSheet") renderSheet(); }
    say(msg || "");
  }
  $("logout").addEventListener("click", function () { logout("ログアウトしました。"); });

  function bootErr(msg) { var b = $("boot"); b.textContent = msg; b.classList.remove("hide"); }
  function load(first, quiet, login) {
    if (S.busy) return Promise.resolve(); S.busy = true;
    if (!first && !quiet) say("読み込んでいます…");
    return api({ action: "data" }).then(function (j) {
      S.busy = false;
      var sig = JSON.stringify([j.admin, j.tasks, j.posts, j.status, j.members, j.lanes, j.updated]);
      var same = sig === S.sig && !login;
      S.sig = sig; S.data = j; S.isAdmin = !!j.admin; S.me = S.isAdmin ? j.me : null;
      if (!S.isAdmin) S.pass = "";
      $("boot").classList.add("hide"); $("app").classList.remove("hide"); $("bar2").classList.remove("hide");
      if (login) { closeSheets(); say("管理モードでログインしました。"); }
      else if (!quiet) say("");
      if (same) return; // 変化がなければ描き直さない（ちらつき防止）
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
  var laneName = function (k) { var l = Lanes.filter(function (x) { return x.key === k; })[0]; return l ? l.name : k; };
  var prOf = function (t) { return PR[String(t.priority || "")] ? String(t.priority) : "4"; };
  function postsDone(t) { return (postsBy[t.id] || []).some(function (p) { return p.type === "done"; }); }
  function stOf(t) { var s = t.state || ""; if (ST[s]) return s; if (postsDone(t)) return "done"; return D(t.start) <= today ? "doing" : "todo"; }
  var isAuto = function (t) { return !ST[t.state || ""]; };

  function setup() {
    var d = S.data; M = {}; TM = {};
    d.members.forEach(function (m) { M[m.key] = m; });
    d.tasks.forEach(function (t) { TM[t.id] = t; });
    Lanes = d.lanes; hidden = {};
    d.status.forEach(function (s) { if (String(s.hidden).toUpperCase() === "TRUE") hidden[s.task] = s.confirmed_at || true; });
    postsBy = {}; d.posts.forEach(function (p) { (postsBy[p.task] = postsBy[p.task] || []).push(p); });
    $("upd").textContent = d.updated || "—";
    $("meName").innerHTML = S.isAdmin && S.me ? av(S.me.key) + esc(nameOf(S.me.key)) + "（管理）" : "";
    $("meName").classList.toggle("hide", !S.isAdmin); $("logout").classList.toggle("hide", !S.isAdmin); $("admOpen").classList.toggle("hide", S.isAdmin);
    $("addBtn").classList.toggle("hide", !S.isAdmin); $("showhidL").classList.toggle("hide", !S.isAdmin);
    if (!S.isAdmin) { S.showHid = false; $("showhid").checked = false; }
    $("names").innerHTML = d.members.filter(function (m) { return String(m.post).toUpperCase() === "TRUE"; }).map(function (m) { return '<option value="' + esc(short(m.name)) + '">'; }).join("");
    if (S.isAdmin) {
      var lv = $("a-lane").value;
      $("a-lane").innerHTML = Lanes.map(function (l) { return '<option value="' + esc(l.key) + '">' + esc(l.name) + "</option>"; }).join("");
      $("a-lane").value = lv || "e";
      var checked = {}; [].forEach.call($("a-owners").querySelectorAll("input:checked"), function (c) { checked[c.value] = 1; });
      $("a-owners").innerHTML = d.members.map(function (m) { return '<label><input type="checkbox" value="' + esc(m.key) + '"' + (checked[m.key] ? " checked" : "") + ">" + esc(short(m.name)) + "</label>"; }).join("");
    }
  }

  // ---- 絞り込み
  function baseTasks() { return S.data.tasks.filter(function (t) { return S.showHid || !hidden[t.id]; }); }
  function visibleTasks(withDone) {
    return baseTasks().filter(function (t) { return (S.who === "all" || own(t).indexOf(S.who) >= 0) && (withDone || S.showDone || stOf(t) !== "done"); });
  }
  function renderChips() {
    var vis = baseTasks().filter(function (t) { return S.view === "board" || S.showDone || stOf(t) !== "done"; });
    var cnt = function (k) { return vis.filter(function (t) { return own(t).indexOf(k) >= 0; }).length; };
    var keys = S.data.members.map(function (m) { return m.key; }).filter(function (k) { return k !== "all" && cnt(k) > 0; });
    if (S.who !== "all" && keys.indexOf(S.who) < 0) S.who = "all";
    $("who").innerHTML = '<button type="button" class="chip all" data-who="all" aria-pressed="' + (S.who === "all") + '">全員<span class="n">' + vis.length + "</span></button>" +
      keys.map(function (k) { return '<button type="button" class="chip" data-who="' + esc(k) + '" aria-pressed="' + (S.who === k) + '">' + av(k) + esc(nameOf(k)) + '<span class="n">' + cnt(k) + "</span></button>"; }).join("");
  }

  // ---- 部品
  function dueCls(b) { return b < today ? "over" : b === today ? "today" : b === today + 1 ? "tmr" : b <= today + 6 ? "week" : ""; }
  function dl(x) { var d = x - today; return d === 0 ? "今日" : d === 1 ? "明日" : d === -1 ? "昨日" : md(x); }
  function dueHtml(t) {
    var a = D(t.start), b = D(t.end), txt = a === b ? dl(b) : dl(a) + "〜" + dl(b);
    return '<span class="due ' + (stOf(t) === "done" ? "" : dueCls(b)) + '">' + I.cal + "<span>" + esc(txt) + "</span></span>";
  }
  function ringHtml(t) {
    var p = prOf(t), on = stOf(t) === "done", lbl = (on ? "完了を取り消す：" : "完了にする：") + t.title;
    var cls = "ring p" + p + (on ? " on" : ""), sty = ' style="--pc:' + PR[p].c + '"';
    return S.isAdmin ? '<button type="button" class="' + cls + '"' + sty + ' data-ring="' + esc(t.id) + '" aria-label="' + esc(lbl) + '" title="' + (on ? "完了を取り消す" : "完了にする") + '">' + I.check + "</button>"
      : '<span class="' + cls + '"' + sty + ' aria-hidden="true">' + I.check + "</span>";
  }
  function stPill(s) { return '<span class="stp" style="--c:' + ST[s].c + '"><i></i>' + ST[s].n + "</span>"; }
  function prFlag(t) { var p = prOf(t); return p === "4" ? "" : '<span class="pf" style="--pc:' + PR[p].c + '" title="優先度 ' + PR[p].l + '">' + I.flag + PR[p].n + "</span>"; }
  function ownHtml(t) { var os = own(t); return '<span class="own"><span class="avs">' + os.map(av).join("") + "</span>" + esc(os.map(nameOf).join("・")) + "</span>"; }
  function metaHtml(t, compact) {
    var s = stOf(t), n = (postsBy[t.id] || []).length;
    return '<div class="tm">' + dueHtml(t) + prFlag(t) + (s === "doing" || s === "hold" ? stPill(s) : "") +
      (n ? '<span class="cm" title="コメント">' + I.cmt + n + "</span>" : "") +
      (hidden[t.id] ? '<span class="tagb">非表示</span>' : "") +
      '<span class="right">' + ownHtml(t) + (compact ? "" : '<span class="proj"># ' + esc(laneName(t.lane)) + "</span>") + "</span></div>";
  }
  function row(t) {
    var s = stOf(t);
    return '<div class="task' + (s === "done" ? " is-done" : "") + (hidden[t.id] ? " is-hid" : "") + '" data-open="' + esc(t.id) + '" tabindex="0" role="button">' + ringHtml(t) +
      '<div class="tbody"><div class="tt">' + esc(t.title) + "</div>" + (t.note ? '<div class="tn">' + esc(t.note) + "</div>" : "") + metaHtml(t) + "</div></div>";
  }
  var byDue = function (a, b) { return D(a.end) - D(b.end) || prOf(a) - prOf(b) || D(a.start) - D(b.start) || (+a.order || 0) - (+b.order || 0); };
  var byPrio = function (a, b) { return prOf(a) - prOf(b) || byDue(a, b); };
  function section(key, title, sub, list, dot) {
    return '<section class="sec" data-sec="' + esc(key) + '"><h2 class="sec-h">' + (dot ? '<i class="sdot" style="--c:' + dot + '"></i>' : "") + title + (sub ? ' <span class="wd">' + esc(sub) + "</span>" : "") + "<small>" + list.length + "件</small></h2>" + list.map(row).join("") + "</section>";
  }

  // ---- リスト
  function groupsOf(ts) {
    var G = [], grp = function (key, title, sub, dot) { var g = G.filter(function (x) { return x.key === key; })[0]; if (!g) G.push(g = { key: key, title: title, sub: sub, dot: dot, list: [] }); return g; };
    if (S.sort === "prio") {
      ["1", "2", "3", "4"].forEach(function (p) { var l = ts.filter(function (t) { return prOf(t) === p; }).sort(byDue); if (l.length) grp("p" + p, PR[p].n + " " + PR[p].l, "", PR[p].c).list = l; });
    } else if (S.sort === "state") {
      ["doing", "todo", "hold", "done"].forEach(function (s) { var l = ts.filter(function (t) { return stOf(t) === s; }).sort(byDue); if (l.length) grp("s" + s, ST[s].n, "", ST[s].c).list = l; });
    } else if (S.sort === "owner") {
      S.data.members.forEach(function (m) { if (S.who !== "all" && m.key !== S.who) return; var l = ts.filter(function (t) { return own(t).indexOf(m.key) >= 0; }).sort(byDue); if (l.length) grp("o" + m.key, esc(short(m.name)), "", m.color).list = l; });
    } else if (S.sort === "lane") {
      Lanes.forEach(function (ln) { var l = ts.filter(function (t) { return t.lane === ln.key; }).sort(byDue); if (l.length) grp("l" + ln.key, "# " + esc(ln.name), "").list = l; });
    } else {
      ts.slice().sort(byDue).forEach(function (t) {
        var b = D(t.end), dt = new Date(b * 864e5), g;
        if (b < today) g = grp("over", "期限切れ", "");
        else if (b <= today + 6) g = grp("d" + b, b === today ? "今日" : b === today + 1 ? "明日" : md(b), b <= today + 1 ? md(b) : "");
        else g = grp("m" + dt.getUTCFullYear() + "-" + dt.getUTCMonth(), (dt.getUTCMonth() + 1) + "月", dt.getUTCFullYear() !== new Date(today * 864e5).getUTCFullYear() ? dt.getUTCFullYear() + "年" : "");
        g.list.push(t);
      });
    }
    return G;
  }
  function renderList() {
    var ts = visibleTasks(), h = "";
    var ps = S.data.posts.filter(function (p) { return TM[p.task] && (S.showHid || !hidden[p.task]); }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    if (ps.length) {
      h += '<details class="recent"' + (S.recentOpen ? " open" : "") + '><summary>' + I.cmt + "<b>最近のコメント</b>" + ps.length + "件</summary>" + ps.slice(0, 6).map(function (p) {
        return '<div class="rc" data-open="' + esc(p.task) + '" tabindex="0" role="button">' + av(p.member) + '<div class="rb"><div class="rt">' + esc(nameOf(p.member)) + "・" + esc(String(p.at).slice(5).replace("-", "/")) + "・" + esc(TM[p.task].title) + "</div>" + (p.text ? "<p>" + esc(p.text) + "</p>" : "<p>完了を記録</p>") + "</div></div>";
      }).join("") + "</details>";
    }
    if (S.isAdmin && !S.showDone) {
      var wait = visibleTasks(true).filter(function (t) { return !hidden[t.id] && stOf(t) === "done"; }).sort(byDue);
      if (wait.length) h += section("wait", "完了（確認待ち）", "確認したら非表示に", wait, ST.done.c);
    }
    h += groupsOf(ts).map(function (g) { return section(g.key, g.title, g.sub, g.list, g.dot); }).join("");
    if (!ts.length) h += '<p class="empty-st">表示するタスクはありません。</p>';
    $("pl").innerHTML = h;
  }

  // ---- ボード（状態ごとの列）
  // 「並べ方」に合わせて列を作る。状態・優先度の列はドラッグで移動できる（管理モード）。
  function boardCols(ts) {
    var C = [], col = function (title, dot, field, val, list) { C.push({ title: title, dot: dot, field: field || "", val: val || "", list: list }); };
    var G = S.bgroup;
    if (G === "state") ST_ORDER.forEach(function (s) { col(ST[s].n, ST[s].c, "state", s, ts.filter(function (t) { return stOf(t) === s; })); });
    else if (G === "prio") ["1", "2", "3", "4"].forEach(function (p) { col(PR[p].n + " " + PR[p].l, PR[p].c, "priority", p, ts.filter(function (t) { return prOf(t) === p; })); });
    else if (G === "owner") S.data.members.forEach(function (m) { if (S.who !== "all" && m.key !== S.who) return; var l = ts.filter(function (t) { return own(t).indexOf(m.key) >= 0; }); if (l.length) col(esc(short(m.name)), m.color, "", "", l); });
    else if (G === "lane") Lanes.forEach(function (ln) { var l = ts.filter(function (t) { return t.lane === ln.key; }); if (l.length) col("# " + esc(ln.name), "", "", "", l); });
    else [["期限切れ", "var(--over)", -1e9, today - 1], ["今日", "var(--today)", today, today], ["7日以内", "var(--week)", today + 1, today + 6], ["30日以内", "var(--p3)", today + 7, today + 30], ["それ以降", "var(--p4)", today + 31, 1e9]]
      .forEach(function (b) { col(b[0], b[1], "", "", ts.filter(function (t) { var e = D(t.end); return e >= b[2] && e <= b[3]; })); });
    var cmp = { due: byDue, prio: byPrio,
      start: function (a, b) { return D(a.start) - D(b.start) || byDue(a, b); },
      title: function (a, b) { return String(a.title).localeCompare(String(b.title), "ja") || byDue(a, b); } }[S.bsort] || byDue;
    C.forEach(function (c) { c.list.sort(cmp); });
    return C;
  }
  function renderBoard() {
    var ts = visibleTasks(S.bgroup === "state");
    $("pb").innerHTML = '<div class="board">' + boardCols(ts).map(function (c) {
      var dr = S.isAdmin && c.field;
      return '<section class="col"' + (c.field ? ' data-field="' + c.field + '" data-val="' + c.val + '"' : "") + '><h2 class="col-h">' + (c.dot ? '<i style="--c:' + c.dot + '"></i>' : "") + c.title + "<small>" + c.list.length + '</small></h2><div class="cards">' +
        (c.list.length ? c.list.map(function (t) {
          return '<article class="card' + (stOf(t) === "done" ? " is-done" : "") + '" data-open="' + esc(t.id) + '" tabindex="0" role="button"' + (dr ? ' draggable="true"' : "") + '><div class="card-top">' + ringHtml(t) + '<div class="card-t">' + esc(t.title) + "</div></div>" + metaHtml(t, true) + "</article>";
        }).join("") : '<p class="col-empty">' + (dr ? "ここへドラッグで移動" : "なし") + "</p>") + "</div></section>";
    }).join("") + "</div>";
  }

  // ---- コメント一覧（管理モード）：タスクごとにまとめ、新しいコメントがあるタスクを上に
  var seenAt = ls("ops_seen");
  // コメントが主役の一覧：新しい順、日付ごと。各コメントの下に、どのタスクかを小さく添える
  function dayLabel(at) { var x = D(String(at).slice(0, 10)); return x === today ? "今日" : x === today - 1 ? "昨日" : md(x); }
  function renderComments() {
    var ps = S.data.posts.filter(function (p) { var t = TM[p.task]; return t && (S.who === "all" || own(t).indexOf(S.who) >= 0); })
      .sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    var fresh = ps.filter(function (p) { return seenAt && p.at > seenAt; }).length;
    var h = '<div class="cm-head"><b>コメント</b><span>' + ps.length + "件" + (fresh ? '・<span class="new">新着 ' + fresh + "件</span>" : "") + "</span></div>", day = "";
    ps.forEach(function (p) {
      var t = TM[p.task], dl0 = dayLabel(p.at), isNew = seenAt && p.at > seenAt, s = stOf(t);
      if (dl0 !== day) { day = dl0; h += '<h2 class="sec-h cday">' + esc(dl0) + "</h2>"; }
      h += '<article class="ci' + (isNew ? " is-new" : "") + '" data-open="' + esc(t.id) + '" tabindex="0" role="button" aria-label="' + esc("「" + t.title + "」のページを開く") + '">' + av(p.member) + '<div class="ci-b">' +
        '<div class="chd"><b>' + esc(nameOf(p.member)) + "</b>" + (M[p.member] ? '<span class="tagb">主催</span>' : "") + (isNew ? '<span class="new">新着</span>' : "") +
        (p.type === "done" ? '<span class="tagb ok">完了を記録</span>' : "") + "<time>" + esc(String(p.at).slice(11, 16)) + "</time>" +
        '<button type="button" class="icon" data-del="' + esc(p.id) + '" aria-label="このコメントを削除" title="削除">' + I.x + "</button></div>" +
        (p.text ? '<p class="ci-t">' + esc(p.text) + "</p>" : "") +
        '<div class="ci-ctx"><span class="ctx"><span class="ctx-k">タスク</span><span class="ctx-t">' + esc(t.title) + "</span>" + dueHtml(t) + stPill(s) + "</span>" +
        '<button type="button" class="btn sm ghost" data-reply="' + esc(t.id) + '">返信</button></div>' +
        "</div></article>";
    });
    if (!ps.length) h += '<p class="empty-st">まだコメントはありません。</p>';
    $("pm").innerHTML = h;
  }
  function markSeen() {
    var m = S.data.posts.reduce(function (x, p) { return p.at > x ? p.at : x; }, "");
    if (m) { seenAt = m; ls("ops_seen", m); }
  }
  function updateBadge() {
    var n = S.isAdmin ? S.data.posts.filter(function (p) { return TM[p.task] && seenAt && p.at > seenAt; }).length : 0;
    if (S.isAdmin && !seenAt) markSeen(); // 初回は既読から始める
    $("cmtNew").textContent = n; $("cmtNew").classList.toggle("hide", !n || S.view === "comments");
  }
  var isDefault = function () { return S.who === "all" && S.view === "list" && S.sort === "due" && S.bgroup === "state" && S.bsort === "due" && !S.showDone && !S.showHid; };

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
      var rows = vis.filter(function (t) { return t.lane === l.key; }).sort(function (a, b) { return D(a.start) - D(b.start) || D(a.end) - D(b.end); });
      if (!rows.length) return;
      h += '<div class="g-lane"><div class="g-lab">' + esc(l.name) + "</div><div></div></div>";
      rows.forEach(function (t) {
        var a = D(t.start), b = D(t.end) + 1, s = stOf(t), c = esc(colorOf(own(t)[0] || "")), p = prOf(t);
        var mk = a === b - 1 ? '<i class="g-ms" style="left:' + pct(a + 0.5) + ";--c:" + c + '"></i>' : '<i class="g-bar' + (s === "hold" ? " hold" : "") + '" style="left:' + pct(a) + ";width:" + pct(S0 + b - a) + ";--c:" + c + '"></i>';
        h += '<div class="g-row' + (hidden[t.id] ? " is-hid" : "") + (s === "done" ? " is-done" : "") + '" tabindex="0" role="button" data-open="' + esc(t.id) + '"><div class="g-lab">' + (p !== "4" ? '<span class="g-pf" style="--pc:' + PR[p].c + '">' + PR[p].n + "</span>" : "") + esc(t.title) + '</div><div class="g-trk">' + mk + "</div></div>";
      });
    });
    $("g").innerHTML = h;
  }

  function render() {
    if (!S.data) return;
    var rc = document.querySelector(".recent"); if (rc) S.recentOpen = rc.open;
    if (S.view === "comments" && !S.isAdmin) S.view = "list";
    renderChips();
    document.body.classList.toggle("wide", S.view === "board" || S.view === "chart");
    var PANE = { list: "pl", board: "pb", chart: "pc", comments: "pm" };
    Object.keys(PANE).forEach(function (v) { $(PANE[v]).classList.toggle("hide", S.view !== v); });
    [].forEach.call($("views").querySelectorAll("button"), function (b) { b.setAttribute("aria-pressed", b.dataset.view === S.view); });
    $("v-cmt").classList.toggle("hide", !S.isAdmin);
    $("sortW").classList.toggle("hide", S.view !== "list");
    $("groupW").classList.toggle("hide", S.view !== "board"); $("bsortW").classList.toggle("hide", S.view !== "board");
    $("showDoneL").classList.toggle("hide", S.view === "comments" || (S.view === "board" && S.bgroup === "state"));
    $("sort").value = S.sort; $("bgroup").value = S.bgroup; $("bsort").value = S.bsort; $("showDone").checked = S.showDone;
    $("resetBtn").disabled = isDefault();
    updateBadge();
    if (S.view === "list") renderList();
    else if (S.view === "board") renderBoard();
    else if (S.view === "comments") { renderComments(); markSeen(); }
    else {
      renderChart();
      var sc = $("sc"); requestAnimationFrame(function () { var lw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--lw")) || 0; sc.style.scrollBehavior = "auto"; sc.scrollLeft = Math.max(0, (today - S0) / N * (sc.scrollWidth - lw) - 24); sc.style.scrollBehavior = ""; });
    }
  }

  // ---- 状態・優先度の変更（管理モード。先に画面へ反映してから保存）
  function patch(id, f, msg, undoF) {
    var t = TM[id]; if (!t) return;
    var before = {}; Object.keys(f).forEach(function (k) { before[k] = t[k] || ""; t[k] = f[k]; });
    render(); if (S.open === "taskSheet" && S.cur === id) renderSheet();
    f.id = id;
    api({ action: "patchTask", task: f }).then(function () {
      say(msg, undoF ? function () { patch(id, before, "元に戻しました。"); } : null);
      S.sig = ""; load(false, true);
    }).catch(function (er) {
      Object.keys(before).forEach(function (k) { t[k] = before[k]; });
      render(); if (S.open === "taskSheet" && S.cur === id) renderSheet();
      say(errText(er));
    });
  }
  function toggleDone(id) {
    var t = TM[id]; if (!t) return;
    if (stOf(t) === "done") patch(id, { state: "" }, "完了を取り消しました。", true);
    else patch(id, { state: "done" }, "「" + t.title.slice(0, 18) + (t.title.length > 18 ? "…" : "") + "」を完了にしました。", true);
  }

  // ---- くわしい画面
  function post(p) {
    var isAdm = !!M[p.member];
    return '<div class="cmt">' + av(p.member) + '<div class="cb"><div class="chd"><b>' + esc(nameOf(p.member)) + "</b>" +
      (isAdm ? '<span class="tagb">主催</span>' : "") + (p.type === "done" ? '<span class="tagb ok">完了を記録</span>' : "") +
      "<time>" + esc(String(p.at).slice(5).replace("-", "/")) + "</time>" +
      (S.isAdmin ? '<button type="button" class="icon" data-del="' + esc(p.id) + '" aria-label="このコメントを削除" title="削除">' + I.x + "</button>" : "") +
      "</div>" + (p.text ? "<p>" + esc(p.text) + "</p>" : "") + "</div></div>";
  }
  var OLD = function () { return S.ver && S.ver < 6; };
  function commentForm() {
    if (OLD() && !S.isAdmin) return '<p class="note">コメント機能は準備中です（サイト側の更新待ち）。日髙さんが更新すると書き込めるようになります。</p>';
    if (S.isAdmin) return '<form class="cform" id="cform"><textarea id="c-text" maxlength="1000" rows="3" placeholder="コメントを入力（Shift＋Enterで送信）" aria-label="コメント"></textarea>' +
      '<div class="cact"><span class="sub">' + esc(nameOf(S.me.key)) + '（主催）として書き込みます・Shift＋Enterで送信</span><button class="btn pri sm" type="submit">コメント</button></div></form>';
    return '<form class="cform" id="cform"><input id="c-name" type="text" maxlength="20" list="names" placeholder="お名前（必須）" autocomplete="name" value="' + esc(ls("ops_name")) + '" aria-label="お名前">' +
      '<textarea id="c-text" maxlength="1000" rows="3" placeholder="コメントを入力（Shift＋Enterで送信）" aria-label="コメント"></textarea>' +
      '<div class="cact"><span class="sub">名前とコメントは全員に表示されます・Shift＋Enterで送信</span><button class="btn pri sm" type="submit">コメント</button></div></form>';
  }
  function renderSheet() {
    var t = TM[S.cur]; if (!t) { closeSheets(true); return; }
    var h = hidden[t.id], os = own(t), s = stOf(t), p = prOf(t);
    var ps = (postsBy[t.id] || []).slice().sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    var stDD = S.isAdmin
      ? '<div class="opts" role="group" aria-label="状態">' + '<button type="button" class="opt auto" data-st="" aria-pressed="' + isAuto(t) + '" style="--c:var(--sub)">自動</button>' +
        ST_ORDER.map(function (k) { return '<button type="button" class="opt" data-st="' + k + '" aria-pressed="' + (!isAuto(t) && s === k) + '" style="--c:' + ST[k].c + '"><i></i>' + ST[k].n + "</button>"; }).join("") + "</div>" +
        (isAuto(t) ? '<span class="sub">今は日付から「' + ST[s].n + "」</span>" : "")
      : stPill(s) + (isAuto(t) && s !== "done" ? '<span class="sub">日付から自動</span>' : "");
    var prDD = S.isAdmin
      ? '<div class="opts" role="group" aria-label="優先度">' + ["1", "2", "3", "4"].map(function (k) { return '<button type="button" class="opt" data-pr="' + k + '" aria-pressed="' + (p === k) + '" style="--c:' + PR[k].c + '"><i></i>' + PR[k].n + " " + PR[k].l + "</button>"; }).join("") + "</div>"
      : (p === "4" ? '<span class="sub">なし</span>' : '<span class="pf" style="--pc:' + PR[p].c + '">' + I.flag + PR[p].n + " " + PR[p].l + "</span>");
    $("taskSheet").innerHTML =
      '<div class="sh-head"><span class="crumb"># ' + esc(laneName(t.lane)) + '</span><button type="button" class="icon" data-close aria-label="閉じる">' + I.x + "</button></div>" +
      '<div class="sh-body"><div class="sh-title">' + ringHtml(t) + '<h2 id="tsTitle">' + esc(t.title) + "</h2></div>" +
      (t.note ? '<p class="desc">' + esc(t.note) + "</p>" : "") +
      '<dl class="props">' +
      "<div><dt>状態</dt><dd>" + stDD + "</dd></div>" +
      "<div><dt>優先度</dt><dd>" + prDD + "</dd></div>" +
      "<div><dt>期日</dt><dd>" + dueHtml(t) + (t.start !== t.end ? '<span class="sub">開始 ' + md(D(t.start)) + "／期限 " + md(D(t.end)) + "</span>" : "") + "</dd></div>" +
      '<div><dt>担当</dt><dd class="ownl">' + os.map(function (k) { return "<span>" + av(k) + esc(nameOf(k)) + "</span>"; }).join("") + "</dd></div>" +
      "<div><dt>分野</dt><dd># " + esc(laneName(t.lane)) + "</dd></div>" +
      (t.ref ? "<div><dt>根拠</dt><dd>決定ログ " + esc(t.ref) + "</dd></div>" : "") +
      (h ? '<div><dt>表示</dt><dd>非表示（確認済み）' + (h === true ? "" : '<span class="sub">' + esc(h) + "</span>") + "</dd></div>" : "") +
      "</dl>" +
      (S.isAdmin && OLD() ? '<p class="note">サイト側（Apps Script）がまだ v' + S.ver + ' です。状態・優先度の変更と、閲覧者のコメントは、v6 に更新すると使えます。</p>' : "") +
      (S.isAdmin ? '<div class="admrow"><button type="button" class="btn sm" data-edit="' + esc(t.id) + '">編集</button>' +
        (h ? '<button type="button" class="btn sm" data-hide="0">表示に戻す</button>' : '<button type="button" class="btn sm" data-hide="1">確認済みにして非表示</button>') + "</div>" : "") +
      '<h3 class="ch">コメント<span>' + ps.length + "</span></h3>" +
      '<div class="thread">' + (ps.length ? ps.map(post).join("") : '<p class="empty">まだコメントはありません。</p>') + "</div>" +
      commentForm() + "</div>";
  }
  function openTask(id) { if (!TM[id]) return; S.cur = id; renderSheet(); show("taskSheet"); }

  function sendPost() {
    var ta = $("c-text"), text = ta ? ta.value.trim() : "", body = { action: "post", task: S.cur, type: "note", text: text };
    if (!S.isAdmin) {
      var nm = $("c-name").value.trim();
      if (!nm) { say(ERR.need_name); $("c-name").focus(); return; }
      body.name = nm; ls("ops_name", nm);
    }
    if (!text) { say(ERR.empty); ta.focus(); return; }
    var bs = $("taskSheet").querySelectorAll("button"); [].forEach.call(bs, function (b) { b.disabled = true; });
    var tid = S.cur;
    api(body).then(function () {
      if ($("c-text")) $("c-text").value = "";
      say("コメントしました。"); S.cur = tid; S.sig = ""; return load(false, true);
    }).catch(function (er) { [].forEach.call(bs, function (b) { b.disabled = false; }); say(errText(er)); });
  }

  // ---- 追加・編集（同じ画面）
  function formMode(id) {
    S.editId = id || "";
    $("addHead").textContent = id ? "タスクを編集（" + id + "）" : "タスクを追加";
    $("addSubmit").textContent = id ? "保存する" : "追加する";
  }
  var setPrio = function (v) { [].forEach.call(document.getElementsByName("a-prio"), function (r) { r.checked = r.value === v; }); };
  var getPrio = function () { var r = [].filter.call(document.getElementsByName("a-prio"), function (x) { return x.checked; })[0]; return r ? r.value : "4"; };
  function clearForm() {
    $("a-title").value = ""; $("a-ref").value = ""; $("a-note").value = ""; $("a-state").value = ""; setPrio("4");
    [].forEach.call($("a-owners").querySelectorAll("input"), function (c) { c.checked = false; });
  }
  $("a-start").addEventListener("change", function () { if (!$("a-end").value || $("a-end").value < $("a-start").value) $("a-end").value = $("a-start").value; });
  $("addBtn").addEventListener("click", function () {
    if (S.editId) clearForm(); formMode("");
    if (!$("a-start").value) { $("a-start").value = ymd(today); $("a-end").value = ymd(today); }
    if (S.who !== "all" && !$("a-title").value) [].forEach.call($("a-owners").querySelectorAll("input"), function (c) { c.checked = c.value === S.who; });
    show("addForm", "#a-title");
  });
  function openEdit(id) {
    var t = TM[id]; if (!t) return;
    formMode(id);
    $("a-title").value = t.title || ""; $("a-lane").value = t.lane; $("a-state").value = ST[t.state || ""] ? t.state : ""; setPrio(prOf(t));
    $("a-start").value = t.start; $("a-end").value = t.end; $("a-ref").value = t.ref || ""; $("a-note").value = t.note || "";
    var os = own(t); [].forEach.call($("a-owners").querySelectorAll("input"), function (c) { c.checked = os.indexOf(c.value) >= 0; });
    show("addForm", "#a-title");
  }
  $("addForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var owners = [].map.call($("a-owners").querySelectorAll("input:checked"), function (c) { return c.value; });
    var t = { title: $("a-title").value.trim(), lane: $("a-lane").value, start: $("a-start").value, end: $("a-end").value, owners: owners,
      ref: $("a-ref").value.trim(), note: $("a-note").value.trim(), priority: getPrio(), state: $("a-state").value };
    if (!t.title) { say(ERR.task_title); $("a-title").focus(); return; }
    if (!owners.length) { say(ERR.task_owner); return; }
    if (!t.start || !t.end || t.end < t.start) { say(ERR.task_date); return; }
    var btn = $("addSubmit"), editing = S.editId; btn.disabled = true;
    if (editing) t.id = editing;
    api({ action: editing ? "editTask" : "addTask", task: t }).then(function (j) {
      btn.disabled = false; clearForm(); formMode(""); closeSheets(true);
      say(editing ? "タスクを更新しました。" : "タスクを追加しました。");
      S.sig = ""; return load(false, true).then(function () { openTask(j.id); });
    }).catch(function (er) { btn.disabled = false; say(errText(er)); });
  });

  // ---- events
  $("showhid").addEventListener("change", function () { S.showHid = $("showhid").checked; render(); });
  // 標準に戻す：全員・リスト・期限順（同じ期限は優先度順）・完了と非表示は隠す
  $("resetBtn").addEventListener("click", function () {
    S.who = "all"; S.view = "list"; S.sort = "due"; S.bgroup = "state"; S.bsort = "due"; S.showDone = false; S.showHid = false; $("showhid").checked = false;
    history.replaceState(null, "", location.pathname + location.search);
    savePrefs(); render(); window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" }); say("標準の表示に戻しました。");
  });
  $("showDone").addEventListener("change", function () { S.showDone = $("showDone").checked; savePrefs(); render(); });
  $("sort").addEventListener("change", function () { S.sort = $("sort").value; savePrefs(); render(); });
  $("bgroup").addEventListener("change", function () { S.bgroup = $("bgroup").value; savePrefs(); render(); });
  $("bsort").addEventListener("change", function () { S.bsort = $("bsort").value; savePrefs(); render(); });
  $("views").addEventListener("click", function (e) { var b = e.target.closest("[data-view]"); if (b && b.dataset.view !== S.view) { S.view = b.dataset.view; savePrefs(); render(); } });
  window.addEventListener("hashchange", function () { var h = decodeURIComponent(location.hash.slice(1)) || "all"; if (h !== S.who) { S.who = h; render(); } });
  document.addEventListener("keydown", function (e) {
    if (e.target.closest && e.target.closest("button")) return;
    var o = e.target.closest && e.target.closest("[data-open]");
    if (o && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openTask(o.dataset.open); }
  });
  document.addEventListener("submit", function (e) { if (e.target.id === "cform") { e.preventDefault(); sendPost(); } });
  // コメント：Shift＋Enterで送信（Enterだけなら改行。日本語の変換中は送らない）
  document.addEventListener("keydown", function (e) {
    if (e.target.id !== "c-text" && e.target.id !== "c-name") return;
    if (e.key === "Enter" && e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); sendPost(); }
  });
  document.addEventListener("click", function (e) {
    var t = e.target;
    var r = t.closest("[data-ring]"); if (r) { e.stopPropagation(); toggleDone(r.dataset.ring); return; }
    var w = t.closest("[data-who]"); if (w) { S.who = w.dataset.who; history.replaceState(null, "", S.who === "all" ? location.pathname + location.search : "#" + encodeURIComponent(S.who)); render(); return; }
    var rp = t.closest("[data-reply]"); if (rp) { openTask(rp.dataset.reply); setTimeout(function () { var ta = $("c-text"); if (ta) { ta.focus(); ta.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" }); } }, 80); return; }
    var del = t.closest("[data-del]");
    if (del) {
      if (!window.confirm("このコメントを削除しますか？（閲覧者には表示されなくなります）")) return;
      del.disabled = true;
      api({ action: "deletePost", id: del.dataset.del }).then(function () { say("コメントを削除しました。"); S.sig = ""; return load(false, true); })
        .catch(function (er) { del.disabled = false; say(errText(er)); });
      return;
    }
    var o = t.closest("[data-open]"); if (o && !o.closest(".sheet")) { openTask(o.dataset.open); return; }
    if (t.closest("[data-close]")) { closeSheets(); return; }
    var st = t.closest("[data-st]"); if (st) { var cur = TM[S.cur]; if ((cur.state || "") !== st.dataset.st) patch(S.cur, { state: st.dataset.st }, "状態を「" + (st.dataset.st ? ST[st.dataset.st].n : "自動") + "」にしました。"); return; }
    var pr = t.closest("[data-pr]"); if (pr) { if (prOf(TM[S.cur]) !== pr.dataset.pr) patch(S.cur, { priority: pr.dataset.pr }, "優先度を" + PR[pr.dataset.pr].n + "にしました。"); return; }
    var ed = t.closest("[data-edit]"); if (ed) { openEdit(ed.dataset.edit); return; }
    var hd = t.closest("[data-hide]");
    if (hd) {
      hd.disabled = true;
      api({ action: "hide", task: S.cur, hidden: hd.dataset.hide === "1" }).then(function () {
        say(hd.dataset.hide === "1" ? "確認済みにして非表示にしました。" : "表示に戻しました。"); S.sig = ""; return load(false, true);
      }).catch(function (er) { hd.disabled = false; say(errText(er)); });
    }
  });
  // ボード：ドラッグで状態を変える（管理モード・PC）
  var dragId = "";
  document.addEventListener("dragstart", function (e) { var c = e.target.closest && e.target.closest(".card[draggable]"); if (!c) return; dragId = c.dataset.open; c.classList.add("dragging"); try { e.dataTransfer.setData("text/plain", dragId); e.dataTransfer.effectAllowed = "move"; } catch (x) {} });
  document.addEventListener("dragend", function (e) { var c = e.target.closest && e.target.closest(".card"); if (c) c.classList.remove("dragging"); [].forEach.call(document.querySelectorAll(".col.drop"), function (x) { x.classList.remove("drop"); }); dragId = ""; });
  document.addEventListener("dragover", function (e) { var col = dragId && e.target.closest && e.target.closest(".col[data-field]"); if (!col) return; e.preventDefault(); [].forEach.call(document.querySelectorAll(".col.drop"), function (x) { if (x !== col) x.classList.remove("drop"); }); col.classList.add("drop"); });
  document.addEventListener("drop", function (e) {
    var col = dragId && e.target.closest && e.target.closest(".col[data-field]"); if (!col) return; e.preventDefault();
    var id = dragId, fd = col.dataset.field, v = col.dataset.val, t = TM[id]; col.classList.remove("drop"); dragId = "";
    if (!t) return;
    if (fd === "state" && stOf(t) !== v) patch(id, { state: v }, "「" + ST[v].n + "」に移動しました。", true);
    if (fd === "priority" && prOf(t) !== v) patch(id, { priority: v }, "優先度を" + PR[v].n + "にしました。", true);
  });
  setInterval(function () {
    var a = document.activeElement;
    if (document.visibilityState === "visible" && S.data && !dragId && !(a && a.matches && a.matches("input,textarea,select")) && S.open !== "addForm") load(false, true);
  }, 90000);

  // ---- start
  if (!API) bootErr("接続先がまだ設定されていません（準備中）。");
  else {
    load(true);
    // サイト側（Apps Script）の版を確かめる。古い版ではコメントや状態の変更が保存できないので、先に知らせる
    fetch(API).then(function (r) { return r.json(); }).then(function (j) { S.ver = +j.version || 0; if (S.open === "taskSheet") renderSheet(); }).catch(function () {});
  }
})();
