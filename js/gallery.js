/* ============================================================
 * 相册 · 渲染逻辑
 * ------------------------------------------------------------
 * 照片不在网站里，而是存在仓库的 photos 分支。
 * 这个文件在浏览器里向 GitHub 的公开接口要一份文件清单，
 * 再自己画出相册 —— 所以「她刚传的照片」不用重新部署网站就能出现。
 *
 * 兼容主题的 pjax 无刷新跳转。
 * ============================================================ */

(function () {
  'use strict';

  var app = document.getElementById('gal-app');
  if (!app || app.getAttribute('data-ready') === '1') return;
  app.setAttribute('data-ready', '1');

  var CFG = window.PHOTO_CONFIG || {};
  if (!CFG.owner || !CFG.repo) {
    app.innerHTML = '<p class="gal-empty">相册配置还没填好，检查一下 /gallery/photo-config.js。</p>';
    return;
  }

  var BRANCH = CFG.branch || 'photos';
  var DIR = String(CFG.dir || 'img/album').replace(/\/+$/, '');
  var GROUPS = CFG.groups || [];
  var BASE = 'https://github.com/' + CFG.owner + '/' + CFG.repo;
  var TREE_API = 'https://api.github.com/repos/' + CFG.owner + '/' + CFG.repo +
                 '/git/trees/' + BRANCH + '?recursive=1';

  var CACHE_KEY = 'love_gallery_cache_v1';
  var CACHE_TTL = 10 * 60 * 1000;   /* 10 分钟内直接读本地，不再问接口 */
  var TOKEN_KEY = 'love_photo_token';

  var photos = [];
  var filter = 'all';

  /* ---------------- 工具 ---------------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* 文件名形如 20260921-235712-1-ab3f.jpg，前缀就是拍摄/上传时间 */
  function parseStamp(name) {
    var m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name);
    if (!m) return null;
    return {
      y: +m[1], mo: +m[2], d: +m[3],
      h: +m[4], mi: +m[5],
      text: m[1] + ' 年 ' + (+m[2]) + ' 月 ' + (+m[3]) + ' 日',
      full: m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5]
    };
  }

  function labelOf(key) {
    for (var i = 0; i < GROUPS.length; i++) {
      if (GROUPS[i].key === key) return GROUPS[i].label;
    }
    return key;
  }

  function srcOf(path, raw) {
    if (raw) {
      return 'https://raw.githubusercontent.com/' + CFG.owner + '/' + CFG.repo +
             '/' + BRANCH + '/' + path;
    }
    return 'https://cdn.jsdelivr.net/gh/' + CFG.owner + '/' + CFG.repo +
           '@' + BRANCH + '/' + path;
  }

  /* ---------------- 拉清单 ---------------- */

  /* 上传页存过一把令牌，这里借来用：
     匿名调 GitHub 接口每小时只有 60 次，手机在运营商 NAT 后面
     可能和很多人共用一个出口 IP，很容易被限流；
     带上令牌的话额度是 5000 次/小时。 */
  function readToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.t || !o.list) return null;
      return o;
    } catch (e) { return null; }
  }

  function writeCache(list) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), list: list }));
    } catch (e) {}
  }

  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
  }

  /* 接口返回的是整棵文件树，这里筛出相册目录下的图片 */
  function buildList(data) {
    var out = [];
    var tree = (data && data.tree) || [];
    for (var i = 0; i < tree.length; i++) {
      var n = tree[i];
      if (!n || n.type !== 'blob' || !n.path) continue;
      if (n.path.indexOf(DIR + '/') !== 0) continue;

      var rest = n.path.slice(DIR.length + 1);
      var parts = rest.split('/');
      if (parts.length < 2) continue;                       /* 必须在分组子目录里 */
      var name = parts[parts.length - 1];
      if (!/\.(jpe?g|png|gif|webp|avif)$/i.test(name)) continue;

      out.push({
        path: n.path,
        name: name,
        group: parts[0],
        size: n.size || 0
      });
    }
    /* 文件名带时间戳，所以倒序排就是最新的在前 */
    out.sort(function (a, b) {
      return a.name < b.name ? 1 : (a.name > b.name ? -1 : 0);
    });
    return out;
  }

  function loadList(cb) {
    var cached = readCache();

    /* 本地缓存还新，直接用，省一次请求 */
    if (cached && (Date.now() - cached.t) < CACHE_TTL) {
      cb(cached.list, null, false);
      return;
    }

    var headers = { Accept: 'application/vnd.github+json' };
    var tk = readToken();
    if (tk) headers.Authorization = 'Bearer ' + tk;

    fetch(TREE_API, { headers: headers })
      .then(function (r) {
        if (r.status === 404) throw new Error('还没建好相册分支');
        if (r.status === 401) throw new Error('令牌过期了，去「加照片」页重新贴一把');
        if (r.status === 403) throw new Error('接口调用次数用完了');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var list = buildList(data);
        writeCache(list);
        cb(list, null, false);
      })
      .catch(function (e) {
        /* 拿不到新列表就用旧缓存顶着，别让相册整页变白 */
        if (cached) { cb(cached.list, e, true); return; }
        cb(null, e, false);
      });
  }

  /* ---------------- 渲染 ---------------- */

  function renderBar() {
    var el = document.getElementById('gal-bar');
    if (!el) return;

    var counts = {};
    for (var i = 0; i < photos.length; i++) {
      counts[photos[i].group] = (counts[photos[i].group] || 0) + 1;
    }

    var chips = '<button type="button" class="gal-chip' + (filter === 'all' ? ' is-on' : '') +
                '" data-g="all">全部 <b>' + photos.length + '</b></button>';
    for (var j = 0; j < GROUPS.length; j++) {
      var g = GROUPS[j];
      var c = counts[g.key] || 0;
      chips += '<button type="button" class="gal-chip' + (filter === g.key ? ' is-on' : '') +
               '" data-g="' + g.key + '">' + g.label +
               (c ? ' <b>' + c + '</b>' : '') + '</button>';
    }

    el.innerHTML =
      '<div class="gal-chips">' + chips + '</div>' +
      '<a class="gal-add" href="/upload/">＋ 加照片</a>';
  }

  function renderGrid() {
    var el = document.getElementById('gal-grid');
    if (!el) return;

    var list = [];
    for (var i = 0; i < photos.length; i++) {
      if (filter === 'all' || photos[i].group === filter) list.push(photos[i]);
    }

    if (!list.length) {
      el.className = 'gal-grid gal-grid-empty';
      el.innerHTML =
        '<div class="gal-empty">' +
          '<div class="gal-empty-heart"></div>' +
          '<p>这里还没有照片。</p>' +
          '<p class="gal-empty-sub">拍了就传上来，我等着看。</p>' +
        '</div>';
      return;
    }

    el.className = 'gal-grid';
    var html = '';
    for (var k = 0; k < list.length; k++) {
      var p = list[k];
      var ts = parseStamp(p.name);
      var alt = labelOf(p.group) + (ts ? ' · ' + ts.text : '');
      html +=
        '<button type="button" class="gal-item" data-i="' + k + '" title="' + alt + '">' +
          '<img loading="lazy" decoding="async" alt="' + alt +
            '" src="' + srcOf(p.path, false) + '" data-raw="' + srcOf(p.path, true) + '">' +
        '</button>';
    }
    el.innerHTML = html;

    /* jsdelivr 上刚传的图可能还没缓存好，失败就回退到 GitHub 原始地址 */
    var imgs = el.querySelectorAll('img');
    for (var m = 0; m < imgs.length; m++) {
      imgs[m].addEventListener('error', function () {
        if (this.getAttribute('data-fellback')) return;
        this.setAttribute('data-fellback', '1');
        this.src = this.getAttribute('data-raw');
      });
    }

    window.__galList = list;
  }

  /* ---------------- 灯箱 ---------------- */

  var box = null;

  function ensureBox() {
    if (box) return box;
    box = document.createElement('div');
    box.className = 'gal-box';
    box.innerHTML =
      '<div class="gal-box-inner">' +
        '<img alt="">' +
        '<div class="gal-box-cap"></div>' +
      '</div>';
    box.addEventListener('click', closeBox);
    document.body.appendChild(box);
    return box;
  }

  function openBox(item) {
    var b = ensureBox();
    var ts = parseStamp(item.name);
    b.querySelector('img').src = srcOf(item.path, false);
    b.querySelector('.gal-box-cap').textContent =
      labelOf(item.group) + (ts ? ' · ' + ts.text : '');
    b.classList.add('is-on');
  }

  function closeBox() {
    if (box) box.classList.remove('is-on');
  }

  /* ---------------- 事件 ---------------- */

  app.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;

    var chip = t.closest('.gal-chip');
    if (chip) {
      filter = chip.getAttribute('data-g');
      renderBar();
      renderGrid();
      return;
    }

    var item = t.closest('.gal-item');
    if (item) {
      var list = window.__galList || [];
      var one = list[Number(item.getAttribute('data-i'))];
      if (one) openBox(one);
    }
  });

  if (!window.__galEscBound) {
    window.__galEscBound = true;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var b = document.querySelector('.gal-box');
        if (b) b.classList.remove('is-on');
      }
    });
    document.addEventListener('pjax:send', function () {
      var b = document.querySelector('.gal-box');
      if (b && b.parentNode) b.parentNode.removeChild(b);
    });
  }

  /* ---------------- 启动 ---------------- */

  var grid = document.getElementById('gal-grid');
  if (grid) grid.innerHTML = '<div class="gal-loading">正在看看相册里有什么…</div>';

  function showStaleNote(msg) {
    var bar = document.getElementById('gal-bar');
    if (!bar || !bar.parentNode) return;
    if (document.querySelector('.gal-stale')) return;
    var n = document.createElement('div');
    n.className = 'gal-stale';
    n.textContent = '暂时拿不到最新列表（' + msg + '），先显示上次看到的。';
    bar.parentNode.insertBefore(n, bar.nextSibling);
  }

  loadList(function (list, err, stale) {
    if (!list) {
      if (grid) {
        grid.className = 'gal-grid gal-grid-empty';
        grid.innerHTML = '<div class="gal-empty"><p>没能读到相册。</p>' +
                         '<p class="gal-empty-sub">' + esc((err && err.message) || '网络不通') +
                         '，刷新一下再试试。</p></div>';
      }
      return;
    }
    photos = list;
    renderBar();
    renderGrid();
    if (stale && err) showStaleNote(err.message || '网络不通');
  });

  /* 从上传页回来时清掉缓存，保证刚传的图立刻出现 */
  window.__galRefresh = function () { clearCache(); };
})();
