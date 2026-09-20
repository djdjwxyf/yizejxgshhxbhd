/* ============================================================
 * 大事记 · 渲染逻辑
 *  - 按 events.js 里的数据画出时间轴，每件事自动标注「在一起第 N 天」
 *  - 「接下来」自动算出：下一个纪念日 + 下一个天数里程碑
 *  - 兼容主题的 pjax 无刷新跳转
 * ============================================================ */

(function () {
  'use strict';

  var app = document.getElementById('tl-app');
  if (!app || app.getAttribute('data-ready') === '1') return;
  app.setAttribute('data-ready', '1');

  var DATA = window.LOVE_TIMELINE;
  if (!DATA || !DATA.events || !DATA.events.length) {
    app.innerHTML = '<p class="tl-empty">时间轴数据还没加载出来，刷新一下试试。</p>';
    return;
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function parseYmd(s) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || '').trim());
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  function stripTime(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  function daysBetween(a, b) { return Math.round((stripTime(b) - stripTime(a)) / 86400000); }

  function fmtDate(d) { return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日'; }

  var START = parseYmd(DATA.startDate) || stripTime(new Date());
  var TODAY = stripTime(new Date());

  /* ---------------- 概览 ---------------- */

  function renderSummary() {
    var el = document.getElementById('tl-summary');
    if (!el) return;
    var days = daysBetween(START, TODAY) + 1;
    el.innerHTML =
      '<div class="tl-summary-line">从 ' + fmtDate(START) + ' 到现在</div>' +
      '<div class="tl-summary-days">' + days + '</div>' +
      '<div class="tl-summary-line">天</div>';
  }

  /* ---------------- 时间轴 ---------------- */

  function renderTrack() {
    var track = document.getElementById('tl-track');
    if (!track) return;

    var list = DATA.events.slice().sort(function (a, b) {
      return parseYmd(a.date) - parseYmd(b.date);
    });

    var html = '';
    for (var i = 0; i < list.length; i++) {
      var ev = list[i];
      var d = parseYmd(ev.date);
      if (!d) continue;

      var n = daysBetween(START, d) + 1;
      var isFuture = d > TODAY;
      var badge = isFuture
        ? '还有 ' + (daysBetween(TODAY, d) + 1) + ' 天'
        : '第 ' + n + ' 天';

      html +=
        '<div class="tl-item' + (isFuture ? ' tl-item-future' : '') + '">' +
          '<div class="tl-node"></div>' +
          '<div class="tl-card">' +
            '<div class="tl-head">' +
              '<span class="tl-date">' + pad(d.getMonth() + 1) + '月' + pad(d.getDate()) + '日</span>' +
              '<span class="tl-year">' + d.getFullYear() + '</span>' +
            '</div>' +
            '<div class="tl-title">' + ev.title + '</div>' +
            '<div class="tl-text">' + ev.text + '</div>' +
            '<div class="tl-badge">' + badge + '</div>' +
          '</div>' +
        '</div>';
    }

    html += '<div class="tl-item tl-item-end"><div class="tl-node tl-node-end"></div>' +
            '<div class="tl-end">未完待续</div></div>';

    track.innerHTML = html;
  }

  /* ---------------- 接下来 ---------------- */

  function nextAnniversary(month, day) {
    var y = TODAY.getFullYear();
    var d = new Date(y, month - 1, day);
    if (d < TODAY) d = new Date(y + 1, month - 1, day);
    return d;
  }

  function collectUpcoming() {
    var out = [];

    var anns = DATA.anniversaries || [];
    for (var i = 0; i < anns.length; i++) {
      var d = nextAnniversary(Number(anns[i].month), Number(anns[i].day));
      /* 周年数要用「这个纪念日自己的起始年」算，不能拿在一起的年份套 */
      var base = Number(anns[i].since) || START.getFullYear();
      var nth = d.getFullYear() - base;
      out.push({
        date: d,
        title: anns[i].label,
        note: nth > 0 ? nth + ' 周年' : ''
      });
    }

    var ms = DATA.milestones || [];
    for (var j = 0; j < ms.length; j++) {
      /* 序数口径：第 N 天 = 起始日 + (N-1) 天（与首页计时器一致） */
      var md = new Date(START.getFullYear(), START.getMonth(), START.getDate() + ms[j] - 1);
      if (md >= TODAY) {
        out.push({ date: md, title: '在一起第 ' + ms[j] + ' 天', note: '' });
      }
    }

    out.sort(function (a, b) { return a.date - b.date; });

    /* 去重：里程碑可能正好落在某个周年纪念日上（如第 1096 天 = 3 周年），
       这种情况保留更有意义的纪念日，去掉天数里程碑。 */
    var seen = {};
    var deduped = [];
    function key(d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
    for (var k = 0; k < out.length; k++) {
      var kk = key(out[k].date);
      if (seen[kk]) continue;
      seen[kk] = true;
      deduped.push(out[k]);
    }

    var limit = DATA.upcomingLimit || 4;
    return deduped.slice(0, limit);
  }

  function renderUpcoming() {
    var ul = document.getElementById('tl-upcoming');
    if (!ul) return;

    var items = collectUpcoming();
    var html = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var left = daysBetween(TODAY, it.date);
      html +=
        '<li>' +
          '<span class="tl-up-date">' + pad(it.date.getMonth() + 1) + '/' + pad(it.date.getDate()) + '</span>' +
          '<span class="tl-up-title">' + it.title + (it.note ? ' <em>' + it.note + '</em>' : '') + '</span>' +
          '<span class="tl-up-left">' + (left === 0 ? '就是今天' : left + ' 天后') + '</span>' +
        '</li>';
    }
    ul.innerHTML = html;
  }

  renderSummary();
  renderTrack();
  renderUpcoming();
})();
