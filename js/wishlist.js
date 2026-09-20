/* ============================================================
 * 100 件想一起做的事 · 交互逻辑
 * ------------------------------------------------------------
 * 功能：
 *   1. 点一下打勾 / 再点取消，进度存浏览器（localStorage）
 *   2. 顶部总进度条 + 百分比 + 五个分类各自的小进度
 *   3. 分类筛选、「今天做这件」随机抽一条、清空
 *   4. 分享进度：把勾选状态压成一小段编码，塞进链接的 #w=
 *      对方打开链接就自动合并 —— 这是在没有后端的情况下，
 *      让两个人的进度能互相看见的办法
 *   5. 每勾满 10 件给一句反馈
 *
 * 兼容主题的 pjax 无刷新跳转：每次进入本页都会重新挂载。
 * ============================================================ */

(function () {
  'use strict';

  var app = document.getElementById('wl-app');
  if (!app || app.getAttribute('data-ready') === '1') return;
  app.setAttribute('data-ready', '1');

  var DATA = window.WISHES;
  if (!DATA || !DATA.items || !DATA.items.length) {
    app.innerHTML = '<p class="wl-empty">清单还没加载出来，刷新一下试试。</p>';
    return;
  }

  var ITEMS = DATA.items;
  var TOTAL = ITEMS.length;
  var CATS = DATA.categories || [];
  var KEY = DATA.storageKey || 'love_wishlist_v1';

  /* 打勾状态：{ 条目id: 1 }，用对象是为了能直接 JSON 存 */
  var state = {};
  var filter = 'all';
  var lastMilestone = 0;

  /* ---------------- 本地存取 ---------------- */

  function loadFromStorage() {
    var out = {};
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return out;
      var ids = JSON.parse(raw);
      if (Object.prototype.toString.call(ids) !== '[object Array]') return out;
      for (var i = 0; i < ids.length; i++) {
        var n = Number(ids[i]);
        if (n) out[n] = 1;
      }
    } catch (e) { /* 隐私模式或数据损坏，就当是空的 */ }
    return out;
  }

  function save() {
    var ids = [];
    for (var id in state) if (state[id]) ids.push(Number(id));
    ids.sort(function (a, b) { return a - b; });
    try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch (e) {}
  }

  function count() {
    var n = 0;
    for (var id in state) if (state[id]) n++;
    return n;
  }

  /* ---------------- 进度编码 ----------------
   * 100 个勾选位 = 100 bit = 13 字节 = 26 个十六进制字符。
   * 比「1,4,7,...」这种写法短得多，链接才不会被撑得很长。
   */

  function encode() {
    var bytes = new Uint8Array(Math.ceil(TOTAL / 8));
    for (var i = 0; i < TOTAL; i++) {
      if (state[ITEMS[i].id]) bytes[i >> 3] |= (1 << (i & 7));
    }
    var out = '';
    for (var b = 0; b < bytes.length; b++) {
      out += ('0' + bytes[b].toString(16)).slice(-2);
    }
    return out;
  }

  function decode(str) {
    var out = {};
    if (!str || !/^[0-9a-fA-F]+$/.test(str)) return out;
    var need = Math.ceil(TOTAL / 8) * 2;
    var s = str.length >= need ? str.slice(0, need) : padHexTail(str, need);
    for (var i = 0; i < TOTAL; i++) {
      var byte = parseInt(s.substr((i >> 3) * 2, 2), 16);
      if (isNaN(byte)) continue;
      if ((byte >> (i & 7)) & 1) out[ITEMS[i].id] = 1;
    }
    return out;
  }

  function padHexTail(str, len) {
    while (str.length < len) str += '0';
    return str;
  }

  /* 打开（或粘贴）带 #w= 的链接时，把对方的进度并进来，只增不减，谁也不吃亏。
     除了首次加载要看一眼，还得监听 hashchange —— 否则她本来就在这一页时，
     再点一次链接浏览器只做页内跳转、不会重新加载，就什么都不会发生。 */
  function applyHash() {
    var m = /[#&]w=([0-9a-fA-F]+)/.exec(location.hash || '');
    if (!m) return false;

    var incoming = decode(m[1]);
    var added = 0, total = 0;
    for (var id in incoming) {
      total++;
      if (!state[id]) { state[id] = 1; added++; }
    }

    if (added > 0) {
      save();
      renderProgress();
      renderList();
      toast('已合并这份进度，新增 ' + added + ' 件。');
    } else if (total > 0) {
      toast('这份进度在本机已经有了。');
    }

    /* 抹掉地址里的编码，否则刷新一次就提示一次 */
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {}

    return true;
  }

  /* ---------------- 渲染 ---------------- */

  function renderProgress() {
    var el = document.getElementById('wl-progress');
    if (!el) return;

    var done = count();
    var pct = TOTAL ? Math.round(done / TOTAL * 100) : 0;

    var cats = '';
    for (var i = 0; i < CATS.length; i++) {
      var c = CATS[i], t = 0, d = 0;
      for (var j = 0; j < ITEMS.length; j++) {
        if (ITEMS[j].cat !== c) continue;
        t++;
        if (state[ITEMS[j].id]) d++;
      }
      cats += '<span class="wl-cat-stat"><em>' + c + '</em><b>' + d + ' / ' + t + '</b></span>';
    }

    var tail = '';
    if (done >= TOTAL) tail = '<div class="wl-all-done">一百件，全勾完了。</div>';
    else if (done === 0) tail = '<div class="wl-hint">从哪一件开始都行，点了就算数。</div>';
    else tail = '<div class="wl-hint">还剩 ' + (TOTAL - done) + ' 件，慢慢来。</div>';

    el.innerHTML =
      '<div class="wl-count"><b>' + done + '</b><span>/ ' + TOTAL + '</span></div>' +
      '<div class="wl-pct">' + pct + '%</div>' +
      '<div class="wl-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="wl-cats">' + cats + '</div>' +
      tail;
  }

  function renderTools() {
    var el = document.getElementById('wl-tools');
    if (!el) return;

    var chips = '<button type="button" class="wl-chip' + (filter === 'all' ? ' is-on' : '') +
                '" data-cat="all">全部</button>';
    for (var i = 0; i < CATS.length; i++) {
      chips += '<button type="button" class="wl-chip' + (filter === CATS[i] ? ' is-on' : '') +
               '" data-cat="' + CATS[i] + '">' + CATS[i] + '</button>';
    }

    el.innerHTML =
      '<div class="wl-chips">' + chips + '</div>' +
      '<div class="wl-acts">' +
        '<button type="button" class="wl-act" data-act="random">今天做这件</button>' +
        '<button type="button" class="wl-act" data-act="share">分享进度</button>' +
        '<button type="button" class="wl-act wl-act-quiet" data-act="reset">清空</button>' +
      '</div>';
  }

  function renderList() {
    var el = document.getElementById('wl-list');
    if (!el) return;

    var html = '';
    for (var i = 0; i < ITEMS.length; i++) {
      var it = ITEMS[i];
      if (filter !== 'all' && it.cat !== filter) continue;
      var done = !!state[it.id];
      html +=
        '<button type="button" class="wl-item' + (done ? ' is-done' : '') +
          '" data-id="' + it.id + '" aria-pressed="' + (done ? 'true' : 'false') + '">' +
          '<span class="wl-box"></span>' +
          '<span class="wl-no">' + it.id + '</span>' +
          '<span class="wl-text">' + it.text + '</span>' +
        '</button>';
    }
    el.innerHTML = html;
  }

  /* ---------------- 交互 ---------------- */

  function toggle(id) {
    if (state[id]) delete state[id];
    else state[id] = 1;
    save();

    var node = app.querySelector('.wl-item[data-id="' + id + '"]');
    if (node) {
      var done = !!state[id];
      node.className = 'wl-item' + (done ? ' is-done' : '');
      node.setAttribute('aria-pressed', done ? 'true' : 'false');
    }

    renderProgress();
    celebrate();
  }

  function celebrate() {
    var done = count();
    if (done > lastMilestone && done % 10 === 0) {
      lastMilestone = done;
      if (done >= TOTAL) toast('一百件，全勾完了。下一份清单，我们慢慢写。');
      else toast('第 ' + done + ' 件了，还剩 ' + (TOTAL - done) + ' 件。');
    } else if (done < lastMilestone) {
      lastMilestone = Math.floor(done / 10) * 10;
    }
  }

  function pickRandom() {
    var pool = [];
    for (var i = 0; i < ITEMS.length; i++) {
      if (!state[ITEMS[i].id]) pool.push(ITEMS[i]);
    }
    if (!pool.length) {
      toast('一百件都做完了，该写新清单了。');
      return;
    }

    var it = pool[Math.floor(Math.random() * pool.length)];

    /* 抽到的条目可能被当前筛选挡住，那就切回「全部」 */
    if (filter !== 'all' && filter !== it.cat) {
      filter = 'all';
      renderTools();
      renderList();
    }

    var node = app.querySelector('.wl-item[data-id="' + it.id + '"]');
    if (node) {
      try { node.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      catch (e) { node.scrollIntoView(); }
      node.classList.add('is-flash');
      setTimeout(function () { node.classList.remove('is-flash'); }, 1800);
    }

    toast('今天做这件：' + it.text);
  }

  function share() {
    var url = location.origin + location.pathname + '#w=' + encode();
    copyText(url, function (ok) {
      if (ok) toast('链接已复制。发给她，她打开就能看到你的进度。');
      else showLink(url);
    });
  }

  function copyText(text, cb) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { cb(true); },
        function () { cb(legacyCopy(text)); }
      );
      return;
    }
    cb(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  /* 复制不了（比如非 HTTPS）就退化成手动复制 */
  function showLink(url) {
    var el = document.getElementById('wl-foot');
    if (!el) return;
    el.innerHTML =
      '<div class="wl-linkbox">' +
        '<div class="wl-linktip">复制下面这个链接，发给她就行：</div>' +
        '<input class="wl-linkinput" type="text" readonly>' +
        '<button type="button" class="wl-act" data-act="closelink">好</button>' +
      '</div>';
    var inp = el.querySelector('.wl-linkinput');
    if (inp) {
      inp.value = url;
      inp.focus();
      inp.select();
    }
  }

  function reset() {
    if (!window.confirm('确定要清空整份清单的勾选吗？这一下会全部回到「没做」。')) return;
    state = {};
    save();
    lastMilestone = 0;
    renderProgress();
    renderList();
    toast('已清空，可以从头再来。');
  }

  /* ---------------- 轻提示 ---------------- */

  var toastEl = null;
  var toastTimer = null;

  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'wl-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (toastEl) toastEl.classList.remove('is-on');
    }, 2600);
  }

  /* pjax 换页时把浮层收掉，避免留在下一页 */
  if (!window.__wlPjaxBound) {
    window.__wlPjaxBound = true;
    document.addEventListener('pjax:send', function () {
      var nodes = document.querySelectorAll('.wl-toast');
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
      }
      if (toastTimer) clearTimeout(toastTimer);
    });
  }

  /* 让后续的 hashchange 能唤到「当前这一页」的 applyHash */
  window.__wlApplyHash = applyHash;
  if (!window.__wlHashBound) {
    window.__wlHashBound = true;
    window.addEventListener('hashchange', function () {
      if (!document.getElementById('wl-app')) return;
      if (typeof window.__wlApplyHash === 'function') window.__wlApplyHash();
    });
  }

  /* ---------------- 事件 ---------------- */

  app.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;

    var item = t.closest('.wl-item');
    if (item) {
      toggle(Number(item.getAttribute('data-id')));
      return;
    }

    var chip = t.closest('.wl-chip');
    if (chip) {
      filter = chip.getAttribute('data-cat');
      renderTools();
      renderList();
      return;
    }

    var act = t.closest('[data-act]');
    if (!act) return;
    var a = act.getAttribute('data-act');
    if (a === 'random') pickRandom();
    else if (a === 'share') share();
    else if (a === 'reset') reset();
    else if (a === 'closelink') {
      var f = document.getElementById('wl-foot');
      if (f) f.innerHTML = '';
    }
  });

  /* ---------------- 启动 ---------------- */

  state = loadFromStorage();
  lastMilestone = Math.floor(count() / 10) * 10;

  renderProgress();
  renderTools();
  renderList();

  /* 放在渲染之后：合并完要顺手刷新进度条，也要能弹提示 */
  applyHash();
})();
