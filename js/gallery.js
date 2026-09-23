/* ============================================================
 * 相册 · 渲染逻辑
 * ------------------------------------------------------------
 * 照片不在网站里，而是存在仓库的 photos 分支。
 * 这个文件在浏览器里向外面要一份文件清单，再自己画出相册 ——
 * 所以「她刚传的照片」不用重新部署网站就能出现。
 *
 * 清单有两个来源，一主一备：
 *   ① GitHub 官方接口 —— 最新最准，但匿名访问每小时只有 60 次，
 *      国内出口 IP 常被共用，很容易被限流（403）。
 *   ② jsDelivr 的列目录接口 —— 完全免鉴权、没有次数限制，
 *      缺点是刚传的文件要等一段时间才收录。
 * 所以：有 ① 就用 ①，① 挂了立刻用 ② 顶上，两个都挂就退回本地上次看过的。
 * 三层都拿不到才会出现提示，而且提示里有「再试一次」。
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

  /* ① GitHub 官方：文件树 */
  var GH_API = 'https://api.github.com/repos/' + CFG.owner + '/' + CFG.repo +
               '/git/trees/' + BRANCH + '?recursive=1';
  /* ② jsDelivr：免鉴权列目录 */
  var JD_API = 'https://data.jsdelivr.com/v1/packages/gh/' + CFG.owner + '/' +
               CFG.repo + '@' + BRANCH + '?structure=flat';

  var CACHE_KEY = 'love_gallery_cache_v1';
  var TOKEN_KEY = 'love_photo_token';

  var photos = [];
  var filter = 'all';
  var loading = false;

  /* ---------------- 工具 ---------------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function b64dec(s) {
    try {
      s = String(s).replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      return decodeURIComponent(escape(atob(s)));
    } catch (e) { return ''; }
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

  /* 一张图给两个地址，前面的不通就用后面的。
     顺序看「新旧」：jsDelivr 是 CDN、通常更快，但它收录新文件有几分钟延迟
     （刚传上去的图会 404），而 GitHub 原始地址是立刻可用的。
     所以刚拍的先走原始地址，老照片先走 CDN。 */
  function srcsOf(p) {
    var cdn = srcOf(p.path, false);
    var raw = srcOf(p.path, true);

    var ts = parseStamp(p.name);
    if (ts) {
      var t = new Date(ts.y, ts.mo - 1, ts.d, ts.h, ts.mi, 0).getTime();
      if (Date.now() - t < 60 * 60 * 1000) return [raw, cdn];   /* 一小时内传的 */
    }
    return [cdn, raw];
  }

  /* ---------------- 把两份清单都整理成同一个形状 ---------------- */

  /* 只留 DIR/分组/图片 这种路径 */
  function toPhoto(path, size) {
    if (!path) return null;
    path = String(path).replace(/^\/+/, '');
    if (path.indexOf(DIR + '/') !== 0) return null;

    var rest = path.slice(DIR.length + 1);
    var parts = rest.split('/');
    if (parts.length < 2) return null;                      /* 必须在分组子目录里 */
    var name = parts[parts.length - 1];
    if (!/\.(jpe?g|png|gif|webp|avif)$/i.test(name)) return null;

    return { path: path, name: name, group: parts[0], size: size || 0 };
  }

  function sortList(out) {
    /* 文件名带时间戳，所以倒序排就是最新的在前 */
    out.sort(function (a, b) {
      return a.name < b.name ? 1 : (a.name > b.name ? -1 : 0);
    });
    return out;
  }

  /* ① GitHub 的文件树格式 */
  function fromTree(data) {
    var out = [], tree = (data && data.tree) || [];
    for (var i = 0; i < tree.length; i++) {
      var n = tree[i];
      if (!n || n.type !== 'blob') continue;
      var p = toPhoto(n.path, n.size);
      if (p) out.push(p);
    }
    return sortList(out);
  }

  /* ② jsDelivr 的扁平文件表格式 */
  function fromFiles(data) {
    var out = [], fs = (data && data.files) || [];
    for (var i = 0; i < fs.length; i++) {
      var p = toPhoto(fs[i] && fs[i].name, fs[i] && fs[i].size);
      if (p) out.push(p);
    }
    return sortList(out);
  }

  /* ---------------- 本地缓存 ---------------- */

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

  /* ---------------- 问接口 ---------------- */

  /* 上传页存过一把令牌，这里借来用：
     匿名调 GitHub 接口每小时只有 60 次，手机在运营商 NAT 后面
     可能和很多人共用一个出口 IP，很容易被限流；
     带上令牌的话额度是 5000 次/小时。 */
  function fetchGithub() {
    var headers = { Accept: 'application/vnd.github+json' };
    var tk = readToken();
    if (tk) headers.Authorization = 'Bearer ' + tk;

    return fetch(GH_API, { headers: headers }).then(function (r) {
      if (r.status === 404) throw new Error('还没建好相册分支');
      if (r.status === 401) throw new Error('令牌过期了');
      if (r.status === 403) throw new Error('GitHub 接口次数用完了');
      if (!r.ok) throw new Error('GitHub 接口 HTTP ' + r.status);
      return r.json();
    }).then(fromTree);
  }

  /* jsDelivr 这份清单是给「GitHub 接口被限流」时兜底的。
     它不需要令牌，也不会被限流，但刚传的照片要等一阵才收录，
     所以永远只当备胎。加时间戳是为了绕开浏览器那一年的缓存。 */
  function fetchJsdelivr() {
    return fetch(JD_API + '&cb=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('备份接口 HTTP ' + r.status);
      return r.json();
    }).then(fromFiles);
  }

  /* 两个源并行问，① 优先；① 不行用 ②；都不行退回缓存。
     两个请求都很小，就等齐了再决定，逻辑最不容易出错。

     注意：本地记录只当「先垫一下」，不是最终答案 —— 每次都还是要去问一遍。
     否则她在电脑上刚传的照片，手机要等很久才看得到。 */
  var fetchSeq = 0;

  function loadList(cb) {
    var cached = readCache();

    if (cached) cb(cached.list, null, false, 'cache');   /* 先拿旧记录垫上，界面不空等 */

    var mySeq = ++fetchSeq;
    var pending = 2, gh = null, jd = null, err = null;

    function settle() {
      pending--;
      if (pending > 0) return;
      if (mySeq !== fetchSeq) return;   /* 期间又发起过一次，这次的结果作废 */

      var list = gh !== null ? gh : jd;        /* ① 权威，② 兜底 */
      if (list !== null) {
        writeCache(list);
        cb(list, err, false, gh !== null ? 'github' : 'jsdelivr');
        return;
      }
      if (cached) { cb(cached.list, err, true, 'stale'); return; }
      cb(null, err, false, 'fail');
    }

    function ok(mark, list) {
      if (mark === 'gh') gh = list; else jd = list;
      settle();
    }

    function bad(e) {
      if (!err) err = e;
      settle();
    }

    try { fetchGithub().then(function (l) { ok('gh', l); }, bad); }
    catch (e) { bad(e); }
    try { fetchJsdelivr().then(function (l) { ok('jd', l); }, bad); }
    catch (e) { bad(e); }
  }

  /* ---------------- 渲染 ---------------- */

  /* 不管有没有照片，工具条都要画出来 —— 失败了也要能点「＋ 加照片」 */
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
               '" data-g="' + esc(g.key) + '">' + esc(g.label) +
               (c ? ' <b>' + c + '</b>' : '') + '</button>';
    }

    el.innerHTML =
      '<div class="gal-chips">' + chips + '</div>' +
      '<div class="gal-tools">' +
        '<button type="button" class="gal-refresh" id="gal-refresh">刷新</button>' +
        '<a class="gal-add" href="/upload/">＋ 加照片</a>' +
      '</div>';
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
          '<a class="gal-retry" href="/upload/">去加照片</a>' +
        '</div>';
      return;
    }

    el.className = 'gal-grid';
    var html = '';
    for (var k = 0; k < list.length; k++) {
      var p = list[k];
      var ts = parseStamp(p.name);
      var alt = labelOf(p.group) + (ts ? ' · ' + ts.text : '');
      var s = srcsOf(p);
      html +=
        '<button type="button" class="gal-item" data-i="' + k + '" title="' + esc(alt) + '">' +
          '<img loading="lazy" decoding="async" alt="' + esc(alt) +
            '" src="' + s[0] + '" data-alt="' + s[1] + '">' +
        '</button>';
    }
    el.innerHTML = html;

    /* 第一个地址不通就换第二个；两个都不通就别再挂着浏览器的破图 */
    var imgs = el.querySelectorAll('img');
    for (var m = 0; m < imgs.length; m++) {
      bindFallback(imgs[m], function (img) {
        var btn = img.parentNode;
        if (btn && btn.classList) btn.classList.add('is-broken');
      });
    }

    window.__galList = list;
  }

  function bindFallback(img, onAllFail) {
    img.addEventListener('error', function () {
      if (img.getAttribute('data-step') !== '1') {
        img.setAttribute('data-step', '1');
        img.src = img.getAttribute('data-alt');
        return;
      }
      if (onAllFail) onAllFail(img);
    });
  }

  /* 把技术味的报错翻成人话 */
  function friendly(err) {
    var m = String((err && err.message) || '');
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return '网络没通到 GitHub';
    if (/403|次数/.test(m)) return 'GitHub 今天给这个网络的免费次数用完了';
    if (/401/.test(m)) return '令牌过期了';
    if (/404/.test(m)) return '照片分支找不到了';
    return m || '网络不太通';
  }

  function renderFail(err) {
    var el = document.getElementById('gal-grid');
    if (!el) return;
    el.className = 'gal-grid gal-grid-empty';
    el.innerHTML =
      '<div class="gal-empty">' +
        '<div class="gal-empty-heart"></div>' +
        '<p>这回没读到相册。</p>' +
        '<p class="gal-empty-sub">' + esc(friendly(err)) +
          '，多半是暂时的，等会儿再试一次。</p>' +
        '<button type="button" class="gal-retry" id="gal-retry">再试一次</button>' +
      '</div>';
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
    var s = srcsOf(item);
    var img = b.querySelector('img');
    var cap = b.querySelector('.gal-box-cap');
    var text = labelOf(item.group) + (ts ? ' · ' + ts.text : '');

    cap.textContent = text;
    img.setAttribute('data-step', '0');
    img.setAttribute('data-alt', s[1]);
    img.onerror = function () {
      if (img.getAttribute('data-step') !== '1') {
        img.setAttribute('data-step', '1');
        img.src = img.getAttribute('data-alt');
        return;
      }
      cap.textContent = text + '　（这张图这会儿取不到，晚点再看）';
    };
    img.src = s[0];
    b.classList.add('is-on');
  }

  function closeBox() {
    if (box) box.classList.remove('is-on');
  }

  /* ---------------- 从上传页带回来的清单 ---------------- */

  /* 上传页传完照片会跳回 /gallery/#g=<清单>，
     这样即使这会儿所有接口都不通，刚传的照片也能立刻看到。 */
  function takeHashList() {
    var h = String(location.hash || '');
    var m = /[#&]g=([A-Za-z0-9\-_]+)/.exec(h);
    if (!m) return null;
    var raw = b64dec(m[1]);
    var arr;
    try { arr = JSON.parse(raw); } catch (e) { arr = null; }
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    if (!arr || !arr.length) return null;
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var p = toPhoto(arr[i], 0);
      if (p) out.push(p);
    }
    return out.length ? sortList(out) : null;
  }

  /* 把带回来的和已有的合起来（同一路径只留一份） */
  function union(a, b) {
    var map = {}, i, k;
    for (i = 0; i < a.length; i++) map[a[i].path] = a[i];
    for (i = 0; i < b.length; i++) map[b[i].path] = b[i];
    var out = [];
    for (k in map) if (Object.prototype.hasOwnProperty.call(map, k)) out.push(map[k]);
    return sortList(out);
  }

  /* ---------------- 事件 ---------------- */

  app.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;

    if (t.closest('#gal-retry')) {
      clearCache();
      photos = [];
      filter = 'all';
      renderBar();
      start();
      return;
    }

    if (t.closest('#gal-refresh')) {
      var btn = document.getElementById('gal-refresh');
      if (btn) { btn.disabled = true; btn.textContent = '刷新中…'; }
      clearCache();
      start();
      return;
    }

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

  /* 说清楚这份清单是从哪来的 —— 免得她以为照片传丢了 */
  function showNote(text) {
    var bar = document.getElementById('gal-bar');
    if (!bar || !bar.parentNode) return;
    var n = document.querySelector('.gal-stale');
    if (!n) {
      n = document.createElement('div');
      n.className = 'gal-stale';
      bar.parentNode.insertBefore(n, bar.nextSibling);
    }
    n.textContent = text;
  }

  function hideNote() {
    var n = document.querySelector('.gal-stale');
    if (n && n.parentNode) n.parentNode.removeChild(n);
  }

  /* 上传页带回来的清单：接口通了也一起合上，
     因为备份接口（jsDelivr）刚传的照片还没收录。 */
  var hashPhotos = [];

  function start() {
    if (loading) return;
    loading = true;

    var grid = document.getElementById('gal-grid');
    if (grid) {
      grid.className = 'gal-grid';
      grid.innerHTML = '<div class="gal-loading">正在看看相册里有什么…</div>';
    }

    var fromHash = takeHashList();
    if (fromHash) {
      hashPhotos = union(fromHash, hashPhotos);
      photos = union(hashPhotos, (readCache() || { list: [] }).list);
      renderBar();
      renderGrid();
    }

    loadList(function (list, err, stale, how) {
      loading = false;

      var btn = document.getElementById('gal-refresh');
      if (btn) { btn.disabled = false; btn.textContent = '刷新'; }

      if (!list) {
        renderBar();                 /* 工具条照画，「＋ 加照片」要能点 */
        renderFail(err);
        return;
      }

      photos = union(hashPhotos, list);
      renderBar();
      renderGrid();

      if (stale && err) {
        showNote('这会儿拿不到最新列表（' + friendly(err) + '），先看本地记住的这些。');
      } else if (how === 'jsdelivr') {
        showNote('这会儿连不上 GitHub 的接口，列表可能滞后几分钟；刚传的照片过一会儿点「刷新」就会出来。');
      } else {
        hideNote();                  /* 拿到权威清单了，撤掉之前的提示 */
      }
    });
  }

  start();

  /* 从上传页回来时清掉缓存，保证刚传的图立刻出现 */
  window.__galRefresh = function () { clearCache(); };
})();
