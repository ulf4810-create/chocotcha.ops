(function () {
  "use strict";
  var API = (window.OPS_CONFIG && window.OPS_CONFIG.api) || "";
  var K = { d: "決定", p: "提案", x: "回答待ち", m: "期日" };
  var TYPE = { done: "完了報告", question: "質問", reply: "返信", note: "コメント" };
  var LS = {
    get: function (k) { try { return localStorage.getItem("ops_" + k) || ""; } catch (e) { return ""; } },
    set: function (k, v) { try { if (v) localStorage.setItem("ops_" + k, v); else localStorage.removeItem("ops_" + k); } catch (e) {} }
  };
  var S = { pass: LS.get("pass"), me: null, data: null, isAdmin: false,
    view: (window.innerWidth || 0) >= 900 ? "chart" : "list", open: {}, showHid: false, busy: false };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  // ---- dates
  var D = function (s) { var a = String(s).split("-").map(Number); return Date.UTC(a[0], a[1] - 1, a[2]) / 864e5; };
  var W = function (x) { return "日月火水木金土"[new Date(x * 864e5).getUTCDay()]; };
  var MD = function (s) { var a = String(s).split("-").map(Number); return a[1] + "/" + a[2] + "（" + W(D(s)) + "）"; };
  var today = Math.floor((Date.now() + 9 * 36e5) / 864e5);
  var S0 = D("2026-11-22"), S1 = D("2027-03-21"), N = S1 - S0;
  var pct = function (x) { return ((x - S0) / N * 100).toFixed(3) + "%"; };
  $("cd").textContent = Math.max(0, D("2027-02-14") - today);

  // ---- api
  function api(body) {
    if (!API) return Promise.reject({ error: "no_api" });
    body.pass = S.pass;
    return fetch(API, { method: "POST", body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j.ok) throw j; return j; });
  }
  function say(t) { var m = $("msg"); m.textContent = t || ""; m.classList.toggle("hide", !t); }
  var ERR = { bad_pass: "パスワードが違います。", not_configured: "パスワードがまだ設定されていません（日髙さんがスプレッドシートのmembersに入力します）。", task_title: "タスク名を入力してください。", task_lane: "分野を選んでください。", task_owner: "担当を1人以上選んでください。", task_date: "開始日と期限を正しく入れてください（期限は開始日以降）。", no_api: "接続先がまだ設定されていません。", admin_only: "この操作は日髙さんだけができます。", empty: "内容を入力してください。", bad_member: "「あなた」を選んでください。" };
  var errText = function (e) { return ERR[e && e.error] || "通信できませんでした。少し待ってから「最新にする」を押してください。"; };

  // ---- gate
  function showGate(msg) { $("gate").classList.remove("hide"); $("app").classList.add("hide"); $("gerr").textContent = msg || ""; }
  $("gform").addEventListener("submit", function (e) {
    e.preventDefault();
    S.pass = $("gpass").value.trim();
    $("gerr").textContent = "確認しています…";
    load(true);
  });
  $("logout").addEventListener("click", function () { LS.set("pass", ""); S.pass = ""; S.data = null; S.me = null; S.open = {}; $("gpass").value = ""; $("addForm").classList.add("hide"); showGate("ログアウトしました。"); });

  function load(fromGate, quiet, keep) {
    if (S.busy) return; S.busy = true;
    if (!fromGate && !quiet) say("読み込んでいます…");
    api({ action: "data" }).then(function (j) {
      S.busy = false; S.data = j; S.isAdmin = !!j.admin; S.me = j.me || null;
      LS.set("pass", S.pass); $("gpass").value = "";
      $("gate").classList.add("hide"); $("app").classList.remove("hide"); if (!keep) say("");
      setup(); render();
    }).catch(function (e) {
      S.busy = false;
      if (e && (e.error === "bad_pass" || e.error === "not_configured")) { LS.set("pass", ""); showGate(errText(e)); }
      else if (fromGate || !S.data) showGate(errText(e)); else if (!quiet) say(errText(e));
    });
  }

  // ---- model
  var M = {}, Lanes = [], postsBy = {}, hidden = {}, keys = [];
  function setup() {
    var d = S.data; M = {}; d.members.forEach(function (m) { M[m.key] = m; });
    Lanes = d.lanes; hidden = {}; d.status.forEach(function (s) { if (String(s.hidden).toUpperCase() === "TRUE") hidden[s.task] = s.confirmed_at || true; });
    postsBy = {}; d.posts.forEach(function (p) { (postsBy[p.task] = postsBy[p.task] || []).push(p); });
    $("upd").textContent = d.updated || "—";
    var cnt = function (k) { return d.tasks.filter(function (t) { return own(t).indexOf(k) >= 0; }).length; };
    keys = ["all"].concat(d.members.map(function (m) { return m.key; }).filter(function (k) { return k !== "all"; }));
    var cur = $("who").value || (location.hash.slice(1) || "all");
    $("who").innerHTML = keys.map(function (k) { return '<option value="' + esc(k) + '">' + esc(k === "all" ? "全員" : M[k].name) + "（" + (k === "all" ? d.tasks.length : cnt(k)) + "）</option>"; }).join("");
    $("who").value = keys.indexOf(cur) >= 0 ? cur : "all";
    $("meName").textContent = S.me ? S.me.name + "さん" + (S.isAdmin ? "（管理）" : "") : "";
    $("addBtn").classList.toggle("hide", !S.isAdmin);
    if (S.isAdmin) {
      $("a-lane").innerHTML = Lanes.map(function (l) { return '<option value="' + esc(l.key) + '">' + esc(l.name) + "</option>"; }).join("");
      if (!$("a-lane").dataset.v) { $("a-lane").value = "e"; $("a-lane").dataset.v = "1"; }
      var checked = {}; [].forEach.call($("a-owners").querySelectorAll("input:checked"), function (c) { checked[c.value] = 1; });
      $("a-owners").innerHTML = d.members.map(function (m) { return '<label><input type="checkbox" value="' + esc(m.key) + '"' + (checked[m.key] ? " checked" : "") + "> " + esc(m.name) + "</label>"; }).join("");
    }
  }
  var own = function (t) { return String(t.owners || "").split(",").filter(Boolean); };
  var col = function (t) { var m = M[own(t)[0]]; return m ? m.color : "#888"; };
  var nm = function (t) { return own(t).map(function (k) { return M[k] ? M[k].name : k; }).join("・"); };
  var rng = function (t) { return t.start === t.end ? MD(t.start) : MD(t.start) + "〜" + MD(t.end); };
  function flags(t) {
    var ps = postsBy[t.id] || [], done = false, q = 0;
    ps.forEach(function (p) {
      if (p.type === "done") done = true;
      if (p.type === "question" && !ps.some(function (r) { return r.parent === p.id; })) q++;
    });
    return { done: done, q: q, n: ps.length };
  }
  function badges(t) {
    var f = flags(t), h = "";
    if (hidden[t.id]) h += '<span class="st">確認済み</span>';
    else if (f.done) h += '<span class="st done">完了報告あり</span>';
    if (f.q) h += '<span class="st q">未回答の質問 ' + f.q + "</span>";
    if (f.n) h += '<span class="st c">やり取り ' + f.n + "</span>";
    return h;
  }

  // ---- list
  function thread(t) {
    var ps = (postsBy[t.id] || []).slice().sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    var top = ps.filter(function (p) { return !p.parent; });
    var one = function (p, rep) {
      var who = M[p.member] ? M[p.member].name : p.member;
      return '<div class="ps' + (rep ? " reply" : "") + '"><div class="h"><b>' + esc(who) + '</b><span class="st ' + (p.type === "done" ? "done" : p.type === "question" ? "q" : "c") + '">' + esc(TYPE[p.type] || p.type) + "</span><time>" + esc(p.at) + "</time></div>" +
        (p.text ? "<p>" + esc(p.text) + "</p>" : "") +
        (p.type === "question" && !rep ? '<div class="rb"><button class="btn sm" data-reply="' + esc(p.id) + '" data-task="' + esc(t.id) + '">返信する</button></div>' : "") + "</div>" +
        ps.filter(function (r) { return r.parent === p.id; }).map(function (r) { return one(r, true); }).join("");
    };
    return top.length ? '<div class="thread">' + top.map(function (p) { return one(p, false); }).join("") + "</div>" : '<p class="info">まだやり取りはありません。</p>';
  }
  function item(t) {
    var isOpen = !!S.open[t.id];
    return '<details class="it' + (hidden[t.id] ? " hid" : "") + '" id="task-' + esc(t.id) + '" data-id="' + esc(t.id) + '" style="--c:' + esc(col(t)) + '"' + (isOpen ? " open" : "") + '><summary><div class="d">' + MD(t.start) + (t.start !== t.end ? "<span>〜" + MD(t.end) + "</span>" : "") +
      '</div><div><div class="tt">' + esc(t.title) + '</div><div class="who"><span><i class="dot"></i>' + esc(nm(t)) + '</span><span class="st ' + esc(t.kind) + '">' + esc(K[t.kind] || "") + "</span>" + badges(t) + "</div></div></summary>" +
      '<div class="body"><p class="info">' + esc(laneName(t.lane)) + (t.ref ? "｜根拠：決定ログ " + esc(t.ref) : "") + (t.note ? "<br>" + esc(t.note) : "") + "</p>" + thread(t) +
      '<div class="form" data-task="' + esc(t.id) + '"><label class="sub" for="tx-' + esc(t.id) + '">報告・質問・コメント</label><textarea id="tx-' + esc(t.id) + '" maxlength="1000" placeholder="例：申込を済ませました／〇〇はどうしますか？"></textarea>' +
      '<div class="acts"><button class="btn ok" data-post="done">完了を報告</button><button class="btn" data-post="question">質問する</button><button class="btn" data-post="note">コメント</button></div></div>' +
      (S.isAdmin ? '<div class="admbar">' + (hidden[t.id] ? '<span class="sub">確認済み（' + esc(hidden[t.id] === true ? "" : hidden[t.id]) + '）</span><button class="btn sm" data-hide="0">表示に戻す</button>' : '<button class="btn sm pri" data-hide="1">確認済みにして非表示</button>') + "</div>" : "") +
      "</div></details>";
  }
  var laneName = function (k) { var l = Lanes.filter(function (x) { return x.key === k; })[0]; return l ? l.name : k; };
  function visibleTasks() {
    var k = $("who").value || "all";
    return S.data.tasks.filter(function (t) { return (k === "all" || own(t).indexOf(k) >= 0) && (S.showHid || !hidden[t.id]); });
  }
  function renderList() {
    var ts = visibleTasks().slice().sort(function (a, b) { return D(a.start) - D(b.start) || D(a.end) - D(b.end); });
    var h = "";
    var news = S.data.posts.slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; }).slice(0, 8);
    var tmap = {}; S.data.tasks.forEach(function (t) { tmap[t.id] = t; });
    if (news.length) h += '<h2 class="h">新しい書き込み<small>' + S.data.posts.length + "件</small></h2><div class=\"news\">" + news.map(function (p) {
      var t = tmap[p.task]; return '<div class="nw" data-go="' + esc(p.task) + '" tabindex="0"><time>' + esc(p.at.slice(5)) + "</time><div><b>" + esc(M[p.member] ? M[p.member].name : p.member) + "</b>｜" + esc(TYPE[p.type] || "") + "｜" + esc(t ? t.title : p.task) + (p.text ? '<div class="sub">' + esc(p.text.slice(0, 80)) + "</div>" : "") + "</div></div>";
    }).join("") + "</div>";
    if (S.isAdmin) {
      var wait = S.data.tasks.filter(function (t) { return !hidden[t.id] && flags(t).done; });
      if (wait.length) h += '<h2 class="h">確認待ち（完了報告あり）<small>' + wait.length + "件</small></h2><div class=\"news\">" + wait.map(function (t) { return '<div class="nw" data-go="' + esc(t.id) + '" tabindex="0"><time>' + MD(t.end) + "</time><div><b>" + esc(nm(t)) + "</b>｜" + esc(t.title) + "</div></div>"; }).join("") + "</div>";
    }
    var G = [], add = function (n, t) { var x = G.filter(function (z) { return z[0] === n; })[0]; if (!x) G.push(x = [n, []]); x[1].push(t); };
    ts.forEach(function (t) { var a = D(t.start), b = D(t.end); if (b < today) add("past", t); else if (a <= today + 6) add("今日から7日以内", t); else if (a <= today + 13) add("来週", t); else add(Number(t.start.split("-")[1]) + "月", t); });
    if (!ts.length) h += '<p class="note">表示するタスクはありません。</p>';
    h += G.map(function (g) {
      return g[0] === "past" ? '<h2 class="h">期限を過ぎたもの<small>' + g[1].length + "件（完了したら報告してください）</small></h2>" + g[1].map(item).join("")
        : '<h2 class="h">' + g[0] + "<small>" + g[1].length + "件</small></h2>" + g[1].map(item).join("");
    }).join("");
    $("pl").innerHTML = h;
  }

  // ---- chart
  function renderChart() {
    var h = '<div class="hd"><div class="lab"></div><div class="t">', x, dt;
    for (x = S0; x < S1; x++) { dt = new Date(x * 864e5); if (dt.getUTCDate() === 1 || x === S0) h += '<b style="left:calc(' + pct(x) + ' + 4px)">' + (dt.getUTCMonth() + 1) + "月</b>"; if (dt.getUTCDay() === 1) h += '<span style="left:' + pct(x) + '">' + (dt.getUTCMonth() + 1) + "/" + dt.getUTCDate() + "</span>"; }
    h += '</div></div><div class="ov">';
    for (x = S0; x < S1; x++) if (new Date(x * 864e5).getUTCDay() === 1) h += '<i class="wk" style="left:' + pct(x) + '"></i>';
    [["2026-12-29", "2027-01-04", "年末年始"], ["2027-01-20", "2027-02-11", "期末試験（目安）"]].forEach(function (a) { h += '<i class="hol" style="left:' + pct(D(a[0])) + ";width:calc(" + pct(D(a[1])) + " - " + pct(D(a[0])) + ')"><b>' + a[2] + "</b></i>"; });
    if (today >= S0 && today < S1) h += '<i class="now" style="left:' + pct(today + 0.5) + '"></i>';
    h += "</div>";
    var vis = visibleTasks(), k = $("who").value || "all";
    Lanes.forEach(function (l) {
      var rows = S.data.tasks.filter(function (t) { return t.lane === l.key && (vis.indexOf(t) >= 0 || (k !== "all" && t.lane === "k" && (S.showHid || !hidden[t.id]))); });
      if (!rows.length) return;
      h += '<div class="lane"><div class="lab">' + esc(l.name) + "</div><div></div></div>";
      rows.forEach(function (t) {
        var a = D(t.start), b = D(t.end) + 1, f = flags(t);
        var mk = t.kind === "m" ? '<i class="m" style="left:' + pct(a + 0.5) + ";--c:" + esc(col(t)) + '"></i>' : '<i class="b ' + esc(t.kind) + '" style="left:' + pct(a) + ";width:" + pct(S0 + b - a) + ";--c:" + esc(col(t)) + '"></i>';
        h += '<div class="row' + (hidden[t.id] ? " hid" : "") + '" tabindex="0" data-go="' + esc(t.id) + '"><div class="lab">' + esc(t.title) + (f.done && !hidden[t.id] ? ' <span class="mk done">完了報告</span>' : "") + (f.q ? ' <span class="mk q">質問</span>' : "") + '</div><div class="trk">' + mk + "</div></div>";
      });
    });
    $("g").innerHTML = h;
  }

  function render() {
    if (!S.data) return;
    $("pl").classList.toggle("hide", S.view !== "list"); $("pc").classList.toggle("hide", S.view !== "chart");
    $("v-list").setAttribute("aria-pressed", S.view === "list"); $("v-chart").setAttribute("aria-pressed", S.view === "chart");
    if (S.view === "list") renderList(); else {
      renderChart();
      var sc = $("sc"); requestAnimationFrame(function () { var lw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--lw")) || 0; sc.scrollLeft = Math.max(0, (today - S0) / N * (sc.scrollWidth - lw) - 24); });
    }
  }
  function goTask(id) {
    S.open[id] = true; S.view = "list"; if (!visibleTasks().some(function (t) { return t.id === id; })) { $("who").value = "all"; if (hidden[id]) { S.showHid = true; $("showhid").checked = true; } }
    render(); var el = $("task-" + id); if (el) el.scrollIntoView({ block: "start" });
  }

  // ---- events
  $("who").addEventListener("change", function () { location.hash = $("who").value; render(); });
  var ymd = function (x) { return new Date(x * 864e5).toISOString().slice(0, 10); };
  $("addBtn").addEventListener("click", function () {
    var f = $("addForm"); f.classList.toggle("hide");
    if (!f.classList.contains("hide")) { if (!$("a-start").value) { $("a-start").value = ymd(today); $("a-end").value = ymd(today); } $("a-title").focus(); }
  });
  $("addCancel").addEventListener("click", function () { $("addForm").classList.add("hide"); });
  $("a-kind").addEventListener("change", function () { if ($("a-kind").value === "m") $("a-end").value = $("a-start").value; });
  $("a-start").addEventListener("change", function () { if (!$("a-end").value || $("a-end").value < $("a-start").value || $("a-kind").value === "m") $("a-end").value = $("a-start").value; });
  $("addForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var owners = [].map.call($("a-owners").querySelectorAll("input:checked"), function (c) { return c.value; });
    var t = { title: $("a-title").value.trim(), lane: $("a-lane").value, kind: $("a-kind").value, start: $("a-start").value, end: $("a-kind").value === "m" ? $("a-start").value : $("a-end").value, owners: owners, ref: $("a-ref").value.trim(), note: $("a-note").value.trim() };
    if (!t.title) { say(ERR.task_title); $("a-title").focus(); return; }
    if (!owners.length) { say(ERR.task_owner); return; }
    if (!t.start || !t.end || t.end < t.start) { say(ERR.task_date); return; }
    var btn = $("addForm").querySelector("button[type=submit]"); btn.disabled = true;
    api({ action: "addTask", task: t }).then(function (j) {
      btn.disabled = false; $("a-title").value = ""; $("a-ref").value = ""; $("a-note").value = "";
      [].forEach.call($("a-owners").querySelectorAll("input"), function (c) { c.checked = false; });
      $("addForm").classList.add("hide"); S.open[j.id] = true; say("タスクを追加しました（" + j.id + "）。"); load(false, true, true);
    }).catch(function (er) { btn.disabled = false; say(errText(er)); });
  });
  $("showhid").addEventListener("change", function () { S.showHid = $("showhid").checked; render(); });
  $("v-list").addEventListener("click", function () { S.view = "list"; render(); });
  $("v-chart").addEventListener("click", function () { S.view = "chart"; render(); });
  $("reload").addEventListener("click", function () { load(false); });
  window.addEventListener("hashchange", function () { var h = location.hash.slice(1); if (keys.indexOf(h) >= 0 && $("who").value !== h) { $("who").value = h; render(); } });
  document.addEventListener("toggle", function (e) { var d = e.target; if (d.classList && d.classList.contains("it")) { if (d.open) S.open[d.dataset.id] = true; else delete S.open[d.dataset.id]; } }, true);
  document.addEventListener("keydown", function (e) { var g = e.target.closest && e.target.closest("[data-go]"); if (g && e.key === "Enter") goTask(g.dataset.go); });
  document.addEventListener("click", function (e) {
    var g = e.target.closest("[data-go]"); if (g) { goTask(g.dataset.go); return; }
    var b = e.target.closest("button[data-post]");
    if (b) {
      var f = b.closest(".form"), tid = f.dataset.task, ta = f.querySelector("textarea"), parent = f.dataset.parent || "";
      var type = parent ? "reply" : b.dataset.post, text = ta.value.trim();
      if (!text && type !== "done") { say("内容を入力してください。"); ta.focus(); return; }
      f.querySelectorAll("button").forEach(function (x) { x.disabled = true; });
      api({ action: "post", task: tid, type: type, text: text, parent: parent }).then(function () {
        ta.value = ""; S.open[tid] = true; say("書き込みました。"); load(false, true, true);
      }).catch(function (er) { say(errText(er)); f.querySelectorAll("button").forEach(function (x) { x.disabled = false; }); });
      return;
    }
    var r = e.target.closest("button[data-reply]");
    if (r) {
      var form = r.closest(".body").querySelector(".form");
      form.dataset.parent = r.dataset.reply;
      form.querySelector("label").textContent = "質問への返信";
      form.querySelector("[data-post=done]").classList.add("hide"); form.querySelector("[data-post=question]").classList.add("hide");
      form.querySelector("[data-post=note]").textContent = "返信する";
      form.querySelector("textarea").focus(); return;
    }
    var hd = e.target.closest("button[data-hide]");
    if (hd) {
      var tk = hd.closest("details").dataset.id; hd.disabled = true;
      api({ action: "hide", task: tk, hidden: hd.dataset.hide === "1" }).then(function () { say(hd.dataset.hide === "1" ? "確認済みにして非表示にしました。" : "表示に戻しました。"); load(false, true, true); })
        .catch(function (er) { hd.disabled = false; say(errText(er)); });
    }
  });
  setInterval(function () { if (document.visibilityState === "visible" && S.data && !(document.activeElement && document.activeElement.matches("textarea"))) load(false, true, true); }, 90000);

  // ---- start
  if (!API) showGate("接続先がまだ設定されていません（準備中）。");
  else if (S.pass) load(true); else showGate("");
})();
