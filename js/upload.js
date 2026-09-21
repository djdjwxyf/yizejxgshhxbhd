/* ============================================================
 * 加照片 · 逻辑
 * ------------------------------------------------------------
 * 照片直接通过 GitHub 的接口存进仓库的 photos 分支，
 * 所以不用重新部署网站，传完刷新相册就能看到。
 *
 * 手机上用：选图 → 自动压缩 → 上传。压完一般 200–500KB。
 * 兼容主题的 pjax 无刷新跳转。
 * ============================================================ */

(function () {
  'use strict';

  var app = document.getElementById('up-app');
  if (!app || app.getAttribute('data-ready') === '1') return;
  app.setAttribute('data-ready', '1');

  var CFG = window.PHOTO_CONFIG || {};
  var GROUPS = CFG.groups || [];
  var BRANCH = CFG.branch || 'photos';
  var DIR = String(CFG.dir || 'img/album').replace(/\/+$/, '');
  var GAL_CACHE = 'love_gallery_cache_v1';
  var TOKEN_KEY = 'love_photo_token';

  var token = readToken();
  var group = GROUPS.length ? GROUPS[0].key : 'memories';
  var queue = [];
  var busy = false;

  var STATUS = {
    wait: '等着',
    compress: '压缩中',
    upload: '上传中',
    done: '好了',
    error: '没成功'
  };

  /* ---------------- 小工具 ---------------- */

  function readToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function saveToken(v) {
    try { localStorage.setItem(TOKEN_KEY, v); } catch (e) {}
  }

  function dropToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pad(x, len) {
    x = '' + x;
    while (x.length < len) x = '0' + x;
    return x;
  }

  /* 文件名前缀是时间戳，相册按它倒序排 */
  function stamp(i) {
    var d = new Date();
    var rnd = Math.random().toString(36).slice(2, 6);
    return '' + d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2) + '-' +
           pad(d.getHours(), 2) + pad(d.getMinutes(), 2) + pad(d.getSeconds(), 2) + '-' +
           (i + 1) + '-' + rnd;
  }

  function fmtSize(n) {
    if (!n) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function countNeedWork() {
    var n = 0;
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].status === 'wait' || queue[i].status === 'error') n++;
    }
    return n;
  }

  function b64enc(s) {
    try {
      return btoa(unescape(encodeURIComponent(s)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (e) { return ''; }
  }

  /* 把刚传上去的照片先塞进相册的本地记录里。
     两个好处：① 相册页不用等接口就能立刻看到它们；
     ② 万一那会儿 GitHub 接口正被限流（相册本来会报「没读到」），
        也有东西可显示。
     标上 partial 是为了让相册知道「这份还不全，得再去问一次」。 */
  function seedGalleryCache(paths) {
    if (!paths.length) return;

    var list = [];
    try {
      var raw = localStorage.getItem(GAL_CACHE);
      var o = raw ? JSON.parse(raw) : null;
      if (o && o.list && o.list.length) list = o.list;
    } catch (e) {}

    var have = {};
    for (var i = 0; i < list.length; i++) have[list[i].path] = 1;

    for (var j = 0; j < paths.length; j++) {
      var p = paths[j];
      if (have[p]) continue;
      var parts = String(p).split('/');
      list.push({
        path: p,
        name: parts[parts.length - 1],
        group: parts[parts.length - 2],
        size: 0
      });
    }
    list.sort(function (a, b) { return a.name < b.name ? 1 : (a.name > b.name ? -1 : 0); });

    try {
      localStorage.setItem(GAL_CACHE, JSON.stringify({ t: Date.now(), list: list, partial: true }));
    } catch (e) {}
  }

  /* ---------------- 压缩 ---------------- */

  function compress(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();

      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var scale = Math.min(1, maxSide / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));

          var cv = document.createElement('canvas');
          cv.width = cw;
          cv.height = ch;
          var ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, cw, ch);
          URL.revokeObjectURL(url);

          cv.toBlob(function (blob) {
            if (!blob) { reject(new Error('压缩没成功')); return; }
            resolve({ blob: blob, w: cw, h: ch });
          }, 'image/jpeg', quality);
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(new Error('这张图处理不了'));
        }
      };

      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('这张图读不出来'));
      };

      img.src = url;
    });
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || '');
        var i = s.indexOf(',');
        if (i < 0) { reject(new Error('读取失败')); return; }
        resolve(s.slice(i + 1));
      };
      fr.onerror = function () { reject(new Error('读取失败')); };
      fr.readAsDataURL(blob);
    });
  }

  /* ---------------- 上传 ---------------- */

  function putPhoto(path, base64, message) {
    var url = 'https://api.github.com/repos/' + CFG.owner + '/' + CFG.repo + '/contents/' + path;
    return fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: message, content: base64, branch: BRANCH })
    }).then(function (r) {
      if (r.ok) return r.json();
      return r.json().then(function (body) {
        var msg = (body && body.message) || '';
        if (r.status === 401) throw new Error('令牌不对或过期了');
        if (r.status === 403) throw new Error(msg || '令牌权限不够，需要 Contents 的写权限');
        if (r.status === 404) throw new Error('找不到仓库，检查令牌里有没有勾选这个仓库');
        if (r.status === 422) throw new Error('文件重名了，再点一次上传');
        throw new Error(msg || ('HTTP ' + r.status));
      }, function () {
        throw new Error('HTTP ' + r.status);
      });
    });
  }

  /* ---------------- 渲染 ---------------- */

  function renderAuth() {
    var el = document.getElementById('up-auth');
    if (!el) return;

    if (token) {
      el.className = 'up-panel up-panel-ok';
      el.innerHTML =
        '<span class="up-dot"></span>' +
        '<span class="up-ok-text">已经连上了，可以直接传。</span>' +
        '<button type="button" class="up-mini" id="up-forget">换个令牌</button>';
      return;
    }

    el.className = 'up-panel';
    el.innerHTML =
      '<div class="up-panel-title">第一次用，先贴一个令牌</div>' +
      '<p class="up-panel-text">照片要存进你自己的代码仓库，所以需要一把' +
      '只能开这一个仓库的钥匙。只需贴一次，这台设备以后都记得。</p>' +
      '<div class="up-token-row">' +
        '<input id="up-token" type="password" autocomplete="off" ' +
          'placeholder="粘贴令牌（ghp_… 或 github_pat_…）">' +
        '<button type="button" class="up-btn" id="up-save">记住</button>' +
      '</div>' +
      '<details class="up-help">' +
        '<summary>怎么拿到这把钥匙？（手机上点这里展开）</summary>' +
        '<ol>' +
          '<li>打开 GitHub 的 <a href="https://github.com/settings/personal-access-tokens/new" ' +
            'target="_blank" rel="noopener">新建令牌页</a></li>' +
          '<li>Token name 随便写，比如「相册上传」</li>' +
          '<li>Expiration 选 1 年（到期再换一把）</li>' +
          '<li>Repository access 选 <b>Only select repositories</b>，勾选 <b>' + esc(CFG.repo) + '</b></li>' +
          '<li>Permissions → Repository permissions → 找到 <b>Contents</b> → 选 <b>Read and write</b></li>' +
          '<li>点最下面 Generate token，把那串字符复制过来贴进上面的框</li>' +
        '</ol>' +
        '<p class="up-help-warn">这串字符只显示一次，关掉页面就看不到了，先粘过来再关。</p>' +
      '</details>';
  }

  /* 界面骨架在这里生成，不放 markdown 里 ——
     Hexo 渲染 markdown 时，缩进 4 格会被当成代码块，整段 HTML 会被转义掉。 */
  function renderPicker() {
    var el = document.getElementById('up-picker');
    if (!el) return;

    el.innerHTML =
      '<div class="up-group">' +
        '<div class="up-label">放进哪个相册</div>' +
        '<div class="up-groups" id="up-groups"></div>' +
      '</div>' +
      '<label class="up-drop" for="up-file">' +
        '<div class="up-drop-icon"></div>' +
        '<div class="up-drop-main">点这里选照片</div>' +
        '<div class="up-drop-sub">可以一次选多张，也可以直接拍</div>' +
        '<input id="up-file" type="file" accept="image/*" multiple hidden>' +
      '</label>' +
      '<div class="up-queue" id="up-queue"></div>' +
      '<div class="up-actions" id="up-actions"></div>' +
      '<div class="up-note" id="up-note"></div>';

    var fi = document.getElementById('up-file');
    if (fi) {
      fi.addEventListener('change', function () {
        if (this.files && this.files.length) addFiles(this.files);
        this.value = '';   /* 清掉，方便连续选同一张 */
      });
    }
  }

  function renderGroups() {
    var el = document.getElementById('up-groups');
    if (!el) return;
    var html = '';
    for (var i = 0; i < GROUPS.length; i++) {
      html += '<button type="button" class="up-gchip' +
              (group === GROUPS[i].key ? ' is-on' : '') +
              '" data-g="' + esc(GROUPS[i].key) + '">' + esc(GROUPS[i].label) + '</button>';
    }
    el.innerHTML = html;
  }

  function renderQueue() {
    var el = document.getElementById('up-queue');
    if (!el) return;
    if (!queue.length) { el.innerHTML = ''; return; }

    var html = '';
    for (var i = 0; i < queue.length; i++) {
      var q = queue[i];
      var size = q.newSize || q.origSize;
      var meta = STATUS[q.status] || '';
      if ((q.status === 'done' || q.status === 'upload') && size) meta += ' · ' + fmtSize(size);
      if (q.status === 'error') meta += ' · ' + esc(q.error || '');

      html +=
        '<div class="up-item up-item-' + q.status + '">' +
          '<img class="up-thumb" src="' + q.preview + '" alt="">' +
          '<div class="up-info">' +
            '<div class="up-name">' + esc(q.file.name || ('照片 ' + (i + 1))) + '</div>' +
            '<div class="up-meta">' + meta + '</div>' +
          '</div>' +
          '<span class="up-badge"></span>' +
        '</div>';
    }
    el.innerHTML = html;
  }

  function renderActions() {
    var el = document.getElementById('up-actions');
    if (!el) return;
    var n = countNeedWork();
    var html = '';
    if (n) {
      html += '<button type="button" class="up-btn up-btn-main" id="up-go"' +
              (busy ? ' disabled' : '') + '>' +
              (busy ? '正在传…' : '开始上传（' + n + ' 张）') + '</button>';
    }
    if (queue.length) {
      html += '<button type="button" class="up-btn up-btn-quiet" id="up-clear">清空列表</button>';
    }
    el.innerHTML = html;
  }

  function togglePicker() {
    var el = document.getElementById('up-picker');
    if (el) el.style.display = token ? '' : 'none';
  }

  /* ---------------- 上传流程 ---------------- */

  function startUpload() {
    if (busy) return;
    if (!token) { renderAuth(); return; }

    var pending = [];
    for (var i = 0; i < queue.length; i++) {
      var q = queue[i];
      if (q.status === 'wait' || q.status === 'error') pending.push(q);
    }
    if (!pending.length) return;

    busy = true;
    renderActions();

    var seq = 0, okCount = 0, failCount = 0;

    function finish() {
      busy = false;
      renderActions();
      var note = document.getElementById('up-note');
      if (note) {
        if (okCount) {
          /* 收好这次传上去的路径：塞进相册缓存，并挂上「带清单的链接」 */
          var paths = [];
          for (var i = 0; i < queue.length; i++) {
            if (queue[i].status === 'done' && queue[i].path) paths.push(queue[i].path);
          }
          seedGalleryCache(paths);
          var enc = b64enc(JSON.stringify(paths));
          var href = '/gallery/' + (enc ? '#g=' + enc : '');

          note.innerHTML = '<span class="up-note-ok">传上去 ' + okCount + ' 张。</span>' +
            (failCount ? '另外 ' + failCount + ' 张没成功，上面写了原因。' : '') +
            ' <a href="' + href + '">去相册看看 →</a>';
        } else {
          note.innerHTML = '<span class="up-note-bad">这次都没成功。</span>' +
            (failCount ? '上面写了原因，改完再来一次。' : '');
        }
      }
    }

    function step() {
      if (seq >= pending.length) { finish(); return; }

      var item = pending[seq];
      var idx = seq;
      seq++;

      item.status = 'compress';
      renderQueue();

      compress(item.file, CFG.maxSide || 1600, CFG.quality || 0.82)
        .then(function (res) {
          item.blob = res.blob;
          item.newSize = res.blob.size;
          item.w = res.w;
          item.h = res.h;
          item.status = 'upload';
          renderQueue();
          return blobToBase64(res.blob).then(function (b64) {
            var name = stamp(idx) + '.jpg';
            item.path = DIR + '/' + group + '/' + name;
            return putPhoto(item.path, b64, '上传照片 ' + name);
          });
        })
        .then(function () {
          item.status = 'done';
          okCount++;
          renderQueue();
          step();
        })
        .catch(function (e) {
          item.status = 'error';
          item.error = (e && e.message) || '失败了';
          item.newSize = null;
          failCount++;
          renderQueue();
          step();
        });
    }

    step();
  }

  function clearQueue() {
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].preview) {
        try { URL.revokeObjectURL(queue[i].preview); } catch (e) {}
      }
    }
    queue = [];
    renderQueue();
    renderActions();
    var note = document.getElementById('up-note');
    if (note) note.innerHTML = '';
  }

  function addFiles(files) {
    var added = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!f || !/^image\//.test(f.type || '')) continue;
      queue.push({
        file: f,
        status: 'wait',
        preview: URL.createObjectURL(f),
        origSize: f.size
      });
      added++;
    }
    if (added) {
      var note = document.getElementById('up-note');
      if (note) note.innerHTML = '';
    }
    renderQueue();
    renderActions();
  }

  /* ---------------- 事件 ---------------- */

  app.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;

    if (t.closest('#up-save')) {
      var inp = document.getElementById('up-token');
      var v = inp ? String(inp.value || '').trim() : '';
      if (!v) {
        if (inp) inp.focus();
        return;
      }
      token = v;
      saveToken(v);
      renderAuth();
      togglePicker();
      return;
    }

    if (t.closest('#up-forget')) {
      if (!window.confirm('要把这台设备上记住的令牌删掉吗？')) return;
      token = '';
      dropToken();
      renderAuth();
      togglePicker();
      return;
    }

    var g = t.closest('.up-gchip');
    if (g) {
      group = g.getAttribute('data-g');
      renderGroups();
      return;
    }

    if (t.closest('#up-go')) { startUpload(); return; }
    if (t.closest('#up-clear')) { clearQueue(); return; }
  });

  /* ---------------- 启动 ---------------- */

  renderPicker();
  renderAuth();
  renderGroups();
  renderQueue();
  renderActions();
  togglePicker();
})();
