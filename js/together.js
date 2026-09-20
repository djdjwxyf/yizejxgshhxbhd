/* ============================================================
 * 在一起计时器
 *  ------------------------------------------------------------
 *  只在首页显示。由本脚本注入到 #recent-posts 的最前面。
 *
 *  改在一起的日子：改下面 START 三个数字（年, 月-1, 日）
 *    注意 JS 的月份从 0 开始：2 月 = 1，所以 2024 年 2 月 8 日 → new Date(2024, 1, 8)
 *
 *  改里程碑：改 MILESTONES（距离下一个整百/整年天数还会倒数提示）
 *
 *  兼容主题的 pjax 无刷新跳转：
 *    pjax 会整体替换 #body-wrap，注入的节点随之销毁，
 *    所以只需在 pjax:complete 重新挂一次，切页时停掉定时器即可。
 * ============================================================ */

(function () {
  'use strict';

  /* 在一起的日子 */
  var START = new Date(2024, 1, 8, 0, 0, 0);

  /* 里程碑天数（到下一个会显示倒数） */
  var MILESTONES = [
    100, 200, 300, 365,        /* 满月·整百·一周年 */
    500, 730, 1000, 1096,      /* 一千天·两周年·三周年 */
    1500, 1825, 2000,          /* 五周年 */
    2555, 3000, 3650,          /* 十周年 */
    4380, 5000, 5475, 7300
  ];

  var timer = null;

  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  /* 判断是否首页（兼容 / 和 /index.html） */
  function isHome() {
    var p = location.pathname || '/';
    return p === '/' || p === '' || p === '/index.html';
  }

  function buildBox() {
    var box = document.createElement('div');
    box.id = 'together-box';
    box.className = 'together-box';
    box.innerHTML =
      '<div class="tg-label">我们已经在一起</div>' +
      '<div class="tg-clock">' +
        '<span class="tg-num tg-big" id="tg-d">0</span><span class="tg-unit tg-unit-big">天</span>' +
        '<span class="tg-num" id="tg-h">00</span><span class="tg-unit">时</span>' +
        '<span class="tg-num" id="tg-m">00</span><span class="tg-unit">分</span>' +
        '<span class="tg-num" id="tg-s">00</span><span class="tg-unit">秒</span>' +
      '</div>' +
      '<div class="tg-meta">' +
        '<span class="tg-since">2024 年 2 月 8 日 起</span>' +
        '<span class="tg-next" id="tg-next"></span>' +
      '</div>';
    return box;
  }

  function tick() {
    var dEl = document.getElementById('tg-d');
    if (!dEl) {
      stop();
      return;
    }

    var total = Math.floor((Date.now() - START.getTime()) / 1000);
    if (total < 0) total = 0;

    /* 用「序数」口径：在一起当天就是第 1 天（与大事记页保持一致） */
    var days = Math.floor(total / 86400) + 1;
    var rest = total % 86400;

    dEl.textContent = days;
    document.getElementById('tg-h').textContent = pad2(Math.floor(rest / 3600));
    document.getElementById('tg-m').textContent = pad2(Math.floor(rest / 60) % 60);
    document.getElementById('tg-s').textContent = pad2(rest % 60);

    var nextEl = document.getElementById('tg-next');
    if (!nextEl) return;

    var nextDay = null;
    for (var i = 0; i < MILESTONES.length; i++) {
      if (MILESTONES[i] >= days) {
        nextDay = MILESTONES[i];
        break;
      }
    }
    if (nextDay === days) {
      nextEl.textContent = '今天是在一起第 ' + days + ' 天';
    } else if (nextDay) {
      nextEl.textContent = '距离第 ' + nextDay + ' 天还有 ' + (nextDay - days) + ' 天';
    } else {
      nextEl.textContent = '';
    }
  }

  function start() {
    stop();
    tick();
    timer = setInterval(tick, 1000);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function mount() {
    if (!isHome()) {
      stop();
      return;
    }
    var host = document.getElementById('recent-posts') || document.getElementById('content-inner');
    if (!host) return;

    /* 幂等：已存在就只重启定时器，避免重复插入 */
    if (document.getElementById('together-box')) {
      start();
      return;
    }
    host.insertBefore(buildBox(), host.firstChild);
    start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  document.addEventListener('pjax:complete', mount);
  document.addEventListener('pjax:send', stop);
})();
