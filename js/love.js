/* ============================================================
 * 今日爱情故事 · 逻辑
 *  - 按日期确定性选取：同一天永远同一篇；一轮看完才循环，不重复
 *  - 纪念日/生日彩蛋优先
 *  - localStorage 记录连续打卡天数 + 已读篇数
 *  - 支持 ?d=2026-04-12 回看某一天、?random=1 随手一篇
 *  - 兼容主题的 pjax 无刷新跳转（配合 script[data-pjax]）
 * ============================================================ */

(function () {
  'use strict';

  var app = document.getElementById('love-app');
  if (!app || app.getAttribute('data-ready') === '1') return;
  app.setAttribute('data-ready', '1');

  var DATA = window.LOVE_STORIES;
  if (!DATA || !DATA.stories || !DATA.stories.length) {
    app.innerHTML = '<div class="love-card"><p class="love-empty">故事库还没加载出来，刷新一下试试。</p></div>';
    return;
  }

  var CFG = DATA.config || {};
  var STORIES = DATA.stories;
  var SPECIALS = DATA.specials || [];
  var KEY_STREAK = 'love_streak_v1';
  var KEY_READ = 'love_read_v1';
  var WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  var el = {
    date: document.getElementById('love-date'),
    badge: document.getElementById('love-badge'),
    card: document.getElementById('love-card'),
    title: document.getElementById('love-title'),
    body: document.getElementById('love-body'),
    streak: document.getElementById('love-streak'),
    bar: document.getElementById('love-bar'),
    progress: document.getElementById('love-progress'),
    pick: document.getElementById('love-datepick'),
    random: document.getElementById('love-random'),
    share: document.getElementById('love-share')
  };

  var todayKey = '';
  var streakText = '';
  var shownDateKey = '';
  var shownStoryId = '';

  /* ---------------- 小工具 ---------------- */

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function parseYmd(s) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || '').trim());
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  function stripTime(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  function daysBetween(a, b) { return Math.round((stripTime(b) - stripTime(a)) / 86400000); }

  function load(key, def) {
    try {
      var raw = localStorage.getItem(key);
      if (raw === null) return def;
      var v = JSON.parse(raw);
      return v === null ? def : v;
    } catch (e) { return def; }
  }

  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 隐私模式下忽略 */ }
  }

  function stopTyping() {
    if (window.__loveTimer) {
      clearInterval(window.__loveTimer);
      window.__loveTimer = null;
    }
  }

  /* ---------------- 连续打卡 ---------------- */

  function updateStreak() {
    var st = load(KEY_STREAK, { count: 0, last: '' });
    if (!st || typeof st.count !== 'number') st = { count: 0, last: '' };

    if (st.last !== todayKey) {
      var gap = st.last ? daysBetween(parseYmd(st.last), parseYmd(todayKey)) : null;
      st.count = (gap === 1) ? st.count + 1 : 1;
      st.last = todayKey;
      save(KEY_STREAK, st);
    }

    if (st.count <= 1) return '从今天开始，每天一篇';
    return '你已经连续第 ' + st.count + ' 天来看故事了';
  }

  function recordRead(id) {
    var arr = load(KEY_READ, []);
    if (!Array.isArray(arr)) arr = [];
    if (arr.indexOf(id) < 0) {
      arr.push(id);
      save(KEY_READ, arr);
    }
    return arr.length;
  }

  /* ---------------- 选故事 ---------------- */

  function pickSpecial(d) {
    var list = CFG.importantDates || [];
    for (var i = 0; i < list.length; i++) {
      if (Number(list[i].month) === d.getMonth() + 1 && Number(list[i].day) === d.getDate()) {
        for (var j = 0; j < SPECIALS.length; j++) {
          if (SPECIALS[j].id === list[i].specialId) {
            return { story: SPECIALS[j], label: list[i].label || '特别的日子' };
          }
        }
      }
    }
    return null;
  }

  function pickByDate(d) {
    var start = parseYmd(CFG.startDate) || stripTime(d);
    var n = STORIES.length;
    var idx = ((daysBetween(start, d) % n) + n) % n;
    return STORIES[idx];
  }

  function pickRandom() {
    return STORIES[Math.floor(Math.random() * STORIES.length)];
  }

  /* ---------------- 渲染 ---------------- */

  function render(d, opts) {
    opts = opts || {};
    var tkey = ymd(d);
    var isToday = tkey === todayKey;
    var special = null;
    var story;

    if (opts.surprise) {
      story = pickRandom();
    } else {
      special = pickSpecial(d);
      story = special ? special.story : pickByDate(d);
    }

    shownDateKey = tkey;
    shownStoryId = story.id;

    el.date.textContent = d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · ' + WEEK[d.getDay()];

    var badgeText, badgeHot = false;
    if (special) { badgeText = '✦ ' + special.label; badgeHot = true; }
    else if (opts.surprise) { badgeText = '随手翻到的一篇'; }
    else if (!isToday) { badgeText = '重温这一天'; }
    else { badgeText = '今天的故事'; }
    el.badge.textContent = badgeText;
    el.badge.className = 'love-badge' + (badgeHot ? ' hot' : '');

    stopTyping();
    el.title.className = 'love-title';
    el.title.textContent = '';
    var chars = String(story.title || '').split('');
    var i = 0;
    window.__loveTimer = setInterval(function () {
      el.title.textContent += chars[i++];
      if (i >= chars.length) {
        stopTyping();
        el.title.className = 'love-title done';
      }
    }, 110);

    el.body.innerHTML = '';
    var paras = String(story.text || '').split('\n');
    var shown = 0;
    for (var k = 0; k < paras.length; k++) {
      var line = paras[k].trim();
      if (!line) continue;
      var p = document.createElement('p');
      p.textContent = line;
      p.style.animationDelay = (shown * 170) + 'ms';
      el.body.appendChild(p);
      p.classList.add('show');
      shown++;
    }

    var readCount = Math.min(recordRead(story.id), STORIES.length);
    el.progress.textContent = '已读过 ' + readCount + ' / ' + STORIES.length + ' 篇';
    el.bar.style.width = Math.round(readCount / STORIES.length * 100) + '%';
    el.streak.textContent = streakText;

    if (el.pick) el.pick.value = tkey;
  }

  /* ---------------- 按钮 ---------------- */

  function bindTools() {
    if (el.pick) {
      el.pick.max = todayKey;
      el.pick.addEventListener('change', function () {
        var d = parseYmd(el.pick.value);
        if (d) render(d);
      });
    }

    if (el.random) {
      el.random.addEventListener('click', function () {
        render(new Date(), { surprise: true });
      });
    }

    if (el.share) {
      el.share.addEventListener('click', function () {
        var isToday = shownDateKey === todayKey;
        var url = location.origin + '/love/' + (isToday ? '' : '?d=' + shownDateKey);
        var done = function () {
          var old = el.share.textContent;
          el.share.textContent = '链接已复制';
          setTimeout(function () { el.share.textContent = old; }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(done, function () { window.prompt('复制这个链接：', url); });
        } else {
          window.prompt('复制这个链接：', url);
        }
      });
    }
  }

  /* ---------------- 启动 ---------------- */

  todayKey = ymd(new Date());
  streakText = updateStreak();

  var params = new URLSearchParams(location.search);
  var initDate = parseYmd(params.get('d')) || new Date();
  var surprise = params.get('random') === '1';

  bindTools();
  render(initDate, { surprise: surprise });

  // 离开页面时停掉打字机（pjax 无刷新跳转时也要停）
  if (!window.__lovePjaxBound) {
    window.__lovePjaxBound = true;
    document.addEventListener('pjax:send', stopTyping);
  }
})();
