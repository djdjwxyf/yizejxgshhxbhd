/* ============================================================
 * 留言板 · 逻辑
 *  - 读取 message/config.js 的配置
 *  - 已配置后端 → 动态加载对应库并初始化
 *  - 未配置 → 对访客显示一句友好的占位，技术步骤只打到控制台
 *  - 兼容主题的 pjax 无刷新跳转（每次进入本页都重新初始化）
 * ============================================================ */

(function () {
  'use strict';

  var app = document.getElementById('msg-app');
  if (!app || app.getAttribute('data-ready') === '1') return;
  app.setAttribute('data-ready', '1');

  var CFG = window.MESSAGE_CONFIG || {};
  var introEl = document.getElementById('msg-intro');
  var boxEl = document.getElementById('msg-box');

  var INTRO = '这里没有点赞，也没有已读。想到什么就写下来吧，我都会看到。';

  function loadScript(src, ok, fail) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = function () { if (fail) fail(); };
    document.head.appendChild(s);
  }

  /* ---------- 还没配后端 ---------- */

  function showPending() {
    if (introEl) introEl.textContent = INTRO;
    if (boxEl) {
      boxEl.innerHTML =
        '<div class="msg-pending">' +
          '<div class="msg-pending-heart"></div>' +
          '<p>留言板还在准备中，很快就好。</p>' +
          '<p class="msg-pending-sub">想说的话，先记在心里，或者直接告诉我。</p>' +
        '</div>';
    }
    /* 技术步骤只打给站主看，访客看不见 */
    console.info(
      '%c留言板还没接上后端',
      'color:#d47b7b;font-weight:bold',
      '\n1) 去 https://console.cloud.tencent.com/tcb 开通「云开发」并新建环境（国内地域，访问快）' +
      '\n2) 部署 Twikoo 云函数：https://twikoo.js.org/quick-start.html' +
      '\n3) 把环境 ID 填进 source/message/config.js 的 twikoo.envId' +
      '\n4) hexo clean && hexo g && hexo d' +
      '\n（也可以在留言板页按 F12 看到这段话）'
    );
  }

  /* ---------- Twikoo ---------- */

  function initTwikoo() {
    if (introEl) introEl.textContent = INTRO;

    function start() {
      if (typeof twikoo === 'undefined') {
        pendingWithError('Twikoo 脚本没加载成功');
        return;
      }
      try {
        twikoo.init({
          envId: CFG.twikoo.envId,
          el: '#msg-box',
          lang: CFG.twikoo.lang || 'zh-CN',
          login: CFG.twikoo.login || 'none',
          pageSize: CFG.twikoo.pageSize || 20,
          path: location.pathname,
          onCommentLoaded: function () {
            app.setAttribute('data-loaded', '1');
          }
        });
      } catch (e) {
        pendingWithError('Twikoo 初始化失败：' + e.message);
      }
    }

    if (window.twikoo) {
      start();
    } else {
      loadScript('/js/twikoo/twikoo.min.js', start, function () {
        pendingWithError('Twikoo 脚本加载失败，检查 /js/twikoo/twikoo.min.js 是否存在');
      });
    }
  }

  function pendingWithError(msg) {
    if (!boxEl) return;
    boxEl.innerHTML = '<div class="msg-pending"><p>' + msg + '</p></div>';
    console.error('[留言板] ' + msg);
  }

  /* ---------- Waline ---------- */

  function initWaline() {
    if (introEl) introEl.textContent = INTRO;

    function start() {
      if (typeof Waline === 'undefined') {
        pendingWithError('Waline 脚本没加载成功');
        return;
      }
      Waline.init({
        el: '#msg-box',
        serverURL: CFG.waline.serverURL,
        path: location.pathname,
        lang: 'zh-CN',
        dark: 'html[data-theme="dark"]',
        search: false,
        imageUploader: false
      });
    }

    if (window.Waline) {
      start();
    } else {
      /* 如果国内加载不稳，把 waline 的 js/css 下到 /js/waline/ 再改这两个地址 */
      loadScript('https://cdn.jsdelivr.net/npm/@waline/client@2/dist/waline.js', start, function () {
        pendingWithError('Waline 脚本加载失败（国内可能连不上 jsdelivr）');
      });
      if (!document.querySelector('link[data-waline]')) {
        var l = document.createElement('link');
        l.rel = 'stylesheet';
        l.setAttribute('data-waline', '1');
        l.href = 'https://cdn.jsdelivr.net/npm/@waline/client@2/dist/waline.css';
        document.head.appendChild(l);
      }
    }
  }

  /* ---------- 入口 ---------- */

  var t = CFG.type;
  if (t === 'twikoo' && CFG.twikoo && CFG.twikoo.envId) {
    initTwikoo();
  } else if (t === 'waline' && CFG.waline && CFG.waline.serverURL) {
    initWaline();
  } else {
    showPending();
  }
})();
