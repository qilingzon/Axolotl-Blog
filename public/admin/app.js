/* 美西螈 CMS 前端 —— 零依赖单页应用（hash 路由，全中文） */
'use strict';

// ---------- 常量与状态 ----------

var ACCENTS = [
  { id: 'pink', label: '粉螈', img: '/assets/axolotl-launcher.png' },
  { id: 'purple', label: '紫螈', img: '/assets/axolotl-purple.png' },
  { id: 'wild', label: '栗子', img: '/assets/axolotl-wild.png' },
  { id: 'cyan', label: '汽水', img: '/assets/axolotl-cyan.png' },
  { id: 'gold', label: '焦糖', img: '/assets/axolotl-gold.png' },
  { id: 'blue', label: '蓝图', img: '/assets/axolotl-blue.png' },
  { id: 'green', label: '抹茶', img: '/assets/axolotl-green.png' },
];

var THEMES = [
  { id: 'pink-soft', label: '粉螈·奶油' },
  { id: 'purple-pixel', label: '紫螈·像素' },
  { id: 'lumen-cave', label: '荧光洞窟' },
];

var state = {
  token: localStorage.getItem('cms-token') || '',
  expiresAt: Number(localStorage.getItem('cms-expires') || 0),
  user: localStorage.getItem('cms-user') || '',
  postsCache: null,
};

// ---------- 基础工具 ----------

function $(sel, root) {
  return (root || document).querySelector(sel);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function fmtDate(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d)) return String(iso);
  var p = function (n) {
    return String(n).padStart(2, '0');
  };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function fmtSize(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function toast(msg, isErr) {
  var el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' toast--err' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function () {
    el.remove();
  }, 2400);
}

function confirmModal(title, text, okLabel) {
  return new Promise(function (resolve) {
    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML =
      '<div class="modal"><h3>' +
      esc(title) +
      '</h3><p>' +
      esc(text) +
      '</p><div class="modal__actions">' +
      '<button class="btn btn--ghost" data-act="no">取消</button>' +
      '<button class="btn btn--danger" data-act="yes">' +
      esc(okLabel || '确定') +
      '</button></div></div>';
    function done(val) {
      document.removeEventListener('keydown', onKey);
      mask.remove();
      resolve(val);
    }
    function onKey(e) {
      if (e.key === 'Escape') done(false); // Esc 等同取消
    }
    mask.addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (act) done(act === 'yes');
      else if (e.target === mask) done(false);
    });
    document.body.appendChild(mask);
    document.addEventListener('keydown', onKey);
  });
}

// ---------- API 封装 ----------

/** 端点固定表：url 只能由常量表 + 严格消毒的片段构成，杜绝任意地址请求 */
var ENDPOINTS = {
  login: '/api/login',
  session: '/api/session',
  posts: '/api/posts',
  media: '/api/media',
};

/** slug 白名单：与后端一致（ASCII 字母数字开头，仅 ._-） */
var SLUG_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/;

function api(method, endpoint, opts) {
  opts = opts || {};
  var base = ENDPOINTS[endpoint];
  if (!base) return Promise.reject(new Error('未知接口'));
  var url = base;
  if (opts.slug !== undefined) {
    var slug = String(opts.slug);
    if (!SLUG_RE.test(slug)) return Promise.reject(new Error('参数不合法'));
    url += '/' + encodeURIComponent(slug);
  }
  if (opts.query) url += '?' + new URLSearchParams(opts.query).toString();
  var headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  return fetch(url, {
    method: method,
    headers: headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
    .then(function (res) {
      return res.json().catch(function () {
        return {};
      }).then(function (data) {
        if (res.status === 401) {
          logout(false);
          throw new Error(data.error || '请先登录');
        }
        if (!res.ok) throw new Error(data.error || '请求失败（' + res.status + '）');
        return data;
      });
    });
}

function logout(manual) {
  editorGuard = null;
  state.token = '';
  state.user = '';
  state.expiresAt = 0;
  localStorage.removeItem('cms-token');
  localStorage.removeItem('cms-user');
  localStorage.removeItem('cms-expires');
  if (manual) toast('已退出登录');
  location.hash = '#/login';
}

function loggedIn() {
  return !!state.token && Date.now() < state.expiresAt;
}

// ---------- 路由 ----------

var app = null;

// ---------- 未保存保护 ----------
// 编辑器打开时登记 editorGuard（route + isDirty + ask）；nav 拦截一切离开动作：
// 留下 = 哈希退回编辑器路由且不重渲染（脏内容还在 DOM 里），离开 = 用户确认后再跳
var editorGuard = null;
var restoringHash = false;

window.addEventListener('beforeunload', function (e) {
  if (editorGuard && editorGuard.isDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

function nav() {
  var hash = location.hash || '#/dashboard';
  if (editorGuard && editorGuard.isDirty() && !restoringHash && hash !== editorGuard.route) {
    var target = hash;
    restoringHash = true;
    location.hash = editorGuard.route; // 触发的 hashchange 由下一分支吞掉，编辑器 DOM 不动
    editorGuard.ask().then(function (leave) {
      restoringHash = false;
      if (leave) {
        editorGuard = null;
        location.hash = target;
      }
    });
    return;
  }
  if (restoringHash) {
    restoringHash = false;
    return;
  }
  if (!loggedIn() && hash !== '#/login') {
    location.hash = '#/login';
    return;
  }
  if (loggedIn() && hash === '#/login') {
    location.hash = '#/dashboard';
    return;
  }
  var parts = hash.slice(2).split('/');
  if (parts[0] === 'editor' && parts[1]) renderEditor(decodeURIComponent(parts[1]));
  else if (parts[0] === 'posts') renderPosts(parts[1]);
  else if (parts[0] === 'media') renderMedia();
  else if (parts[0] === 'login') renderLogin();
  else renderDashboard();
}

window.addEventListener('hashchange', nav);

// ---------- 顶栏 ----------

function renderShell(active, contentHtml) {
  var themeNow = document.documentElement.dataset.theme || 'pink-soft';
  app.innerHTML =
    '<header class="topbar"><div class="topbar__inner">' +
    '<a class="topbar__logo" href="#/dashboard"><img src="/assets/axolotl-launcher.png" alt="" width="30" height="22">美西螈 CMS</a>' +
    '<nav class="topbar__nav">' +
    '<a href="#/dashboard" class="' + (active === 'dashboard' ? 'active' : '') + '">仪表盘</a>' +
    '<a href="#/posts" class="' + (active === 'posts' ? 'active' : '') + '">文章</a>' +
    '<a href="#/media" class="' + (active === 'media' ? 'active' : '') + '">媒体库</a>' +
    '</nav>' +
    '<button class="icon-btn" id="theme-btn" title="切换主题">' + esc(THEMES.find(function (t) { return t.id === themeNow; }).label) + '</button>' +
    '<a class="icon-btn" href="/" target="_blank" rel="noopener">看博客</a>' +
    '<button class="icon-btn" id="logout-btn">退出</button>' +
    '</div></header>' +
    '<main class="shell">' + contentHtml + '</main>';
  $('#logout-btn').addEventListener('click', function () {
    logout(true);
  });
  $('#theme-btn').addEventListener('click', function () {
    var cur = document.documentElement.dataset.theme || 'pink-soft';
    var idx = THEMES.findIndex(function (t) { return t.id === cur; });
    var next = THEMES[(idx + 1) % THEMES.length];
    document.documentElement.dataset.theme = next.id;
    try {
      localStorage.setItem('axo-theme', next.id);
    } catch (e) {}
    $('#theme-btn').textContent = next.label;
  });
}

function loadingTip(text) {
  return '<div class="loading">' + esc(text || '正在加载……') + '</div>';
}

// ---------- 登录视图 ----------

function renderLogin() {
  app.innerHTML =
    '<div class="login"><div class="login__card">' +
    '<div class="login__pond"><img src="/assets/axolotl-launcher.png" alt="美西螈"></div>' +
    '<h1>美西螈 CMS</h1>' +
    '<p class="login__sub">欢迎回来，池塘等着你打理</p>' +
    '<form id="login-form">' +
    '<div class="field"><label>用户名</label><input name="username" autocomplete="username" required></div>' +
    '<div class="field"><label>密码</label><input name="password" type="password" autocomplete="current-password" required></div>' +
    '<p class="form-error" id="login-error"></p>' +
    '<button class="btn" type="submit" style="width:100%">进入池塘</button>' +
    '</form></div></div>';
  $('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var errEl = $('#login-error');
    errEl.textContent = '';
    var btn = $('#login-form button[type=submit]');
    btn.disabled = true;
    btn.textContent = '正在开门……';
    var userInput = String(this.username.value || '').trim();
    api('POST', 'login', {
      body: {
        username: this.username.value,
        password: this.password.value,
      },
    })
      .then(function (data) {
        state.token = data.token;
        state.expiresAt = data.expiresAt;
        state.user = userInput || 'admin'; // 登录响应不含用户名，用表单输入值，别再显示 admin
        localStorage.setItem('cms-token', data.token);
        localStorage.setItem('cms-expires', String(data.expiresAt));
        localStorage.setItem('cms-user', state.user);
        toast('欢迎回来，' + state.user);
        location.hash = '#/dashboard';
      })
      .catch(function (err) {
        errEl.textContent = err.message;
        btn.disabled = false;
        btn.textContent = '进入池塘';
      });
  });
}

// ---------- 仪表盘 ----------

function renderDashboard() {
  renderShell(
    'dashboard',
    loadingTip('池塘数据搬运中……')
  );
  api('GET', 'posts')
    .then(function (data) {
      var posts = data.posts || [];
      state.postsCache = posts;
      var tags = {};
      posts.forEach(function (p) {
        (p.tags || []).forEach(function (t) {
          tags[t] = 1;
        });
      });
      var drafts = posts.filter(function (p) {
        return p.draft;
      }).length;
      var latest = posts.slice(0, 6);
      var html =
        '<div class="page-head"><h1>仪表盘</h1><span class="spacer"></span>' +
        '<a class="btn" href="#/editor/new">写新文章</a></div>' +
        '<div class="stats">' +
        statCard(posts.length, '篇文章', '/assets/axolotl-cyan.png', '#/posts', '看全部文章') +
        statCard(Object.keys(tags).length, '个标签', '/assets/axolotl-gold.png', '#/posts/tags', '按标签筛选') +
        statCard(drafts, '篇草稿', '/assets/axolotl-wild.png', '#/posts/draft', '只看草稿') +
        '</div>' +
        '<div class="card"><h3 style="margin-top:0">最近文章</h3>' +
        (latest.length
          ? latest.map(postRowHtml).join('')
          : '<div class="empty-tip">池塘还空着，去写第一篇吧</div>') +
        '</div>';
      renderShell('dashboard', html);
    })
    .catch(function (err) {
      renderShell('dashboard', '<div class="empty-tip">' + esc(err.message) + '</div>');
    });
}

function statCard(num, label, img, href, tip) {
  var inner =
    '<img src="' + img + '" alt=""><div><div class="stat__num">' +
    num + '</div><div class="stat__label">' + esc(label) + '</div></div>';
  return href
    ? '<a class="stat stat--link" href="' + href + '" title="' + esc(tip || '') + '">' + inner + '</a>'
    : '<div class="stat">' + inner + '</div>';
}

function postRowHtml(p) {
  var img = (ACCENTS.find(function (a) { return a.id === p.accent; }) || ACCENTS[0]).img;
  return (
    '<a class="post-row" href="#/editor/' + encodeURIComponent(p.slug) + '">' +
    '<img src="' + img + '" alt="">' +
    '<div class="post-row__main"><div class="post-row__title">' + esc(p.title) +
    (p.draft ? ' <span class="badge-draft">草稿</span>' : '') + '</div>' +
    '<div class="post-row__meta"><span>' + fmtDate(p.pubDate) + '</span>' +
    '<span>' + (p.tags || []).map(function (t) { return '<span class="tag-chip">' + esc(t) + '</span>'; }).join(' ') + '</span></div></div>' +
    '<span class="save-state">编辑 →</span></a>'
  );
}

// ---------- 文章列表 ----------

function renderPosts(mode) {
  renderShell('posts', loadingTip('文章清单搬运中……'));
  api('GET', 'posts')
    .then(function (data) {
      var posts = (data.posts || []);
      state.postsCache = posts;
      var allTags = [];
      posts.forEach(function (p) {
        (p.tags || []).forEach(function (t) {
          if (!allTags.includes(t)) allTags.push(t);
        });
      });
      var html =
        '<div class="page-head"><h1>文章</h1><span style="color:var(--text-muted);font-size:14px">共 ' +
        posts.length + ' 篇</span><span class="spacer"></span>' +
        '<input class="search-input" id="post-search" placeholder="搜标题、标签或正文…">' +
        '<select id="post-tag" style="width:130px"><option value="">全部标签</option>' +
        allTags.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') +
        '</select>' +
        '<label class="draft-filter" title="只显示存为草稿的文章"><input type="checkbox" id="post-draft" ' + (mode === 'draft' ? 'checked' : '') + '>只看草稿</label>' +
        '<a class="btn" href="#/editor/new">写新文章</a></div>' +
        '<div id="post-list">' + posts.map(postRowHtml).join('') + '</div>';
      renderShell('posts', html);
      var listEl = $('#post-list');
      function refresh() {
        var kw = $('#post-search').value.trim().toLowerCase();
        var tag = $('#post-tag').value;
        var draftOnly = $('#post-draft').checked;
        var filtered = posts.filter(function (p) {
          var hitKw =
            !kw ||
            p.title.toLowerCase().includes(kw) ||
            String(p.body || '').toLowerCase().includes(kw) ||
            (p.tags || []).some(function (t) {
              return t.toLowerCase().includes(kw);
            });
          var hitTag = !tag || (p.tags || []).includes(tag);
          var hitDraft = !draftOnly || p.draft;
          return hitKw && hitTag && hitDraft;
        });
        listEl.innerHTML = filtered.length
          ? filtered.map(postRowHtml).join('')
          : '<div class="empty-tip"><img src="/assets/axolotl-wild.png" alt=""><br>没有匹配的文章</div>';
      }
      $('#post-search').addEventListener('input', refresh);
      $('#post-tag').addEventListener('change', refresh);
      $('#post-draft').addEventListener('change', refresh);
      refresh();
      if (mode === 'tags') {
        var sel = $('#post-tag');
        if (sel) sel.focus();
      }
    })
    .catch(function (err) {
      renderShell('posts', '<div class="empty-tip">' + esc(err.message) + '</div>');
    });
}

// ---------- Markdown 渲染（轻量实现，覆盖常用语法） ----------

function renderMarkdown(src) {
  var lines = String(src || '').split('\n');
  var out = [];
  var i = 0;
  var listStack = []; // 嵌套列表栈，每项 {type: 'ul'|'ol'}
  var inCode = false;
  var codeBuf = [];
  var paraBuf = [];

  function flushPara() {
    if (paraBuf.length) {
      out.push('<p>' + inline(paraBuf.join(' ')) + '</p>');
      paraBuf = [];
    }
  }

  function flushList() {
    while (listStack.length) out.push('</' + listStack.pop().type + '>');
  }

  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return s;
  }

  for (; i < lines.length; i++) {
    var line = lines[i];
    if (line.startsWith('```')) {
      if (inCode) {
        out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
        codeBuf = [];
        inCode = false;
      } else {
        flushPara();
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    if (/^\s*$/.test(line)) {
      flushPara();
      flushList();
      continue;
    }
    var h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara();
      flushList();
      // 标题级别与线上 Astro 渲染一致：## 就是 h2（文章大标题在 frontmatter，由模板渲染）
      var lv = Math.min(h[1].length, 4);
      out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara();
      flushList();
      out.push('<hr>');
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara();
      flushList();
      out.push('<blockquote><p>' + inline(line.replace(/^>\s?/, '')) + '</p></blockquote>');
      continue;
    }
    var ul = line.match(/^\s*[-*]\s+(.*)$/);
    var ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      var type = ul ? 'ul' : 'ol';
      var item = (ul || ol)[1];
      var task = item.match(/^\[( |x|X)\]\s+(.*)$/);
      var li = task
        ? '<li class="task"><input type="checkbox" disabled' + (task[1].toLowerCase() === 'x' ? ' checked' : '') + '>' + inline(task[2]) + '</li>'
        : '<li>' + inline(item) + '</li>';
      // 行首两个空格 = 子项（最多两层，与序列化口径一致）
      var depth = /^\s{2,}\S/.test(line) ? 2 : 1;
      while (listStack.length > depth) out.push('</' + listStack.pop().type + '>');
      if (listStack.length === depth && listStack[listStack.length - 1].type !== type) {
        out.push('</' + listStack.pop().type + '>');
      }
      while (listStack.length < depth) {
        out.push('<' + type + '>');
        listStack.push({ type: type });
      }
      out.push(li);
      continue;
    }
    if (line.includes('|') && lines[i + 1] && /^[\s|:-]+$/.test(lines[i + 1])) {
      flushPara();
      flushList();
      var rows = [];
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(lines[i]);
        i++;
      }
      i--;
      var cells = rows.map(function (r) {
        return r.split('|').slice(1, -1).map(function (c) {
          return c.trim();
        });
      });
      var t = '<table><thead><tr>';
      cells[0].forEach(function (c) {
        t += '<th>' + inline(c) + '</th>';
      });
      t += '</tr></thead><tbody>';
      cells.slice(2).forEach(function (row) {
        t += '<tr>';
        row.forEach(function (c) {
          t += '<td>' + inline(c) + '</td>';
        });
        t += '</tr>';
      });
      out.push(t + '</tbody></table>');
      continue;
    }
    paraBuf.push(line);
  }
  if (inCode) out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
  flushPara();
  flushList();
  return out.join('\n');
}

// ---------- 小白模式：块解析与序列化（纯函数，块 ↔ 标准 Markdown 无损往返） ----------

var BLOCK_TYPE_LABELS = {
  p: '段落', h2: '大标题', h3: '小标题', h4: '小小标题',
  list: '列表', tasks: '任务清单', quote: '引用', img: '图片',
  code: '代码', table: '表格', hr: '分隔线', raw: '原始 Markdown',
};

function parseBlocks(md) {
  var lines = String(md || '').split('\n');
  var blocks = [];
  var para = [];
  var i = 0;

  function flushPara() {
    if (para.length) {
      blocks.push({ type: 'p', text: para.join('\n') });
      para = [];
    }
  }

  for (; i < lines.length; i++) {
    var line = lines[i];
    if (line.startsWith('```')) {
      flushPara();
      var codeBuf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeBuf.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code', text: codeBuf.join('\n') });
      continue;
    }
    if (/^\s*$/.test(line)) {
      flushPara();
      continue;
    }
    var h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara();
      if (h[1].length === 1) {
        // 一级标题留给 frontmatter 的大标题，正文里出现按原样保留
        blocks.push({ type: 'raw', text: line });
      } else {
        blocks.push({ type: 'h' + h[1].length, text: h[2] });
      }
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara();
      blocks.push({ type: 'hr' });
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara();
      var quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      i--;
      blocks.push({ type: 'quote', text: quote.join('\n') });
      continue;
    }
    // 表格：本行含 | 且下一行是 GFM 分隔行
    if (line.includes('|') && lines[i + 1] && /^\s*:?[\s|:-]*-[\s|:-]*$/.test(lines[i + 1])) {
      flushPara();
      var trows = [];
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
        trows.push(lines[i]);
        i++;
      }
      i--;
      var parseRow = function (r) {
        var cells = r.split('|');
        cells.shift();
        cells.pop();
        return cells.map(function (c) { return c.trim(); });
      };
      blocks.push({
        type: 'table',
        rows: trows.filter(function (r, idx) { return idx !== 1; }).map(parseRow),
      });
      continue;
    }
    var ul = line.match(/^(\s*)[-*]\s+(.*)$/);
    var ol = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      var mark = (ul || ol)[2];
      var isTask = /^\[( |x|X)\]\s+/.test(mark);
      var ordered = !!ol;
      var item = {
        text: mark.replace(/^\[( |x|X)\]\s+/, ''),
        level: (ul || ol)[1].length >= 2 ? 1 : 0,
        done: /^\[(x|X)\]/.test(mark),
      };
      var last = blocks[blocks.length - 1];
      if (last && last.type === (isTask ? 'tasks' : 'list') && (isTask || last.ordered === ordered)) {
        last.items.push(item);
      } else if (isTask) {
        blocks.push({ type: 'tasks', items: [item] });
      } else {
        blocks.push({ type: 'list', ordered: ordered, items: [item] });
      }
      continue;
    }
    var im = line.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/);
    if (im) {
      flushPara();
      blocks.push({ type: 'img', alt: im[1], url: im[2] });
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks.length ? blocks : [{ type: 'p', text: '' }];
}

function blocksToMarkdown(blocks) {
  var parts = (blocks || []).map(function (b) {
    if (b.type === 'p') return b.text;
    if (b.type === 'h2') return '## ' + b.text;
    if (b.type === 'h3') return '### ' + b.text;
    if (b.type === 'h4') return '#### ' + b.text;
    if (b.type === 'hr') return '---';
    if (b.type === 'quote') {
      return String(b.text || '').split('\n').map(function (l) { return '> ' + l; }).join('\n');
    }
    if (b.type === 'img') return '![' + (b.alt || '') + '](' + (b.url || '') + ')';
    if (b.type === 'code') return '```\n' + b.text + '\n```';
    if (b.type === 'raw') return b.text;
    if (b.type === 'list') {
      var counters = [0, 0];
      return b.items.map(function (it) {
        var lv = it.level ? 1 : 0;
        counters[lv]++;
        if (lv === 0) counters[1] = 0;
        var mark = b.ordered ? counters[lv] + '. ' : '- ';
        return (it.level ? '  ' : '') + mark + it.text;
      }).join('\n');
    }
    if (b.type === 'tasks') {
      return b.items.map(function (it) {
        return (it.level ? '  ' : '') + '- [' + (it.done ? 'x' : ' ') + '] ' + it.text;
      }).join('\n');
    }
    if (b.type === 'table') {
      var rows = (b.rows && b.rows.length) ? b.rows : [['', '']];
      var cell = function (c) { return String(c == null ? '' : c).replace(/\|/g, '｜'); };
      var md = '| ' + rows[0].map(cell).join(' | ') + ' |';
      md += '\n| ' + rows[0].map(function () { return '---'; }).join(' | ') + ' |';
      rows.slice(1).forEach(function (r) {
        md += '\n| ' + r.map(cell).join(' | ') + ' |';
      });
      return md;
    }
    return '';
  }).filter(function (s) { return s !== ''; });
  return parts.join('\n\n');
}

// ---------- 编辑器 ----------

function defaultSlug() {
  var d = new Date();
  var p = function (n) {
    return String(n).padStart(2, '0');
  };
  return (
    d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' +
    Math.random().toString(36).slice(2, 6)
  );
}

function toLocalInput(iso) {
  var d = iso ? new Date(iso) : new Date();
  if (isNaN(d)) d = new Date();
  var p = function (n) {
    return String(n).padStart(2, '0');
  };
  return (
    d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' +
    p(d.getHours()) + ':' + p(d.getMinutes())
  );
}

// ---------- 小白模式：块编辑器 ----------

function createBlockEditor(deps) {
  var root = deps.root;
  var blocks = [];
  var dragIdx = -1;

  function md() {
    return blocksToMarkdown(blocks);
  }

  // ---------- 单块 HTML ----------

  function blkBar(idx, b) {
    return (
      '<div class="blk__bar">' +
      '<span class="blk__drag" draggable="true" title="拖动可调整顺序">⠿</span>' +
      '<span class="blk__type">' + BLOCK_TYPE_LABELS[b.type] + '</span>' +
      (b.type === 'p'
        ? '<span class="blk__inline">' +
          '<button type="button" data-wrap="**" title="把选中的文字加粗">加粗</button>' +
          '<button type="button" data-wrap="*" title="把选中的文字变斜体">斜体</button>' +
          '<button type="button" data-wrap="`" title="变成行内代码">行内代码</button>' +
          '<button type="button" data-wrap="~~" title="给选中文字加删除线">删除线</button>' +
          '<button type="button" data-wrap="link" title="给选中文字加个网址">链接</button>' +
          '</span>'
        : '') +
      '<span class="spacer"></span>' +
      '<button type="button" class="blk__op" data-op="up" title="上移">↑</button>' +
      '<button type="button" class="blk__op" data-op="down" title="下移">↓</button>' +
      '<button type="button" class="blk__op" data-op="copy" title="复制这个块">复制</button>' +
      '<button type="button" class="blk__op blk__op--del" data-op="del" title="删除这个块">✕</button>' +
      '</div>'
    );
  }

  function blkBody(idx, b) {
    if (b.type === 'p' || b.type === 'quote' || b.type === 'raw') {
      var hint = b.type === 'raw' ? '<div class="blk__hint">进阶内容：这块会原样保留，不做加工</div>' : '';
      return hint + '<textarea data-f="text" rows="' + Math.max(3, String(b.text || '').split('\n').length) + '" placeholder="' +
        (b.type === 'p' ? '这里写这一段的话……' : b.type === 'quote' ? '引用的原文……' : '原样保留的 Markdown……') +
        '">' + esc(b.text || '') + '</textarea>';
    }
    if (b.type === 'h2' || b.type === 'h3' || b.type === 'h4') {
      return '<input type="text" data-f="text" value="' + esc(b.text || '') + '" placeholder="标题文字">';
    }
    if (b.type === 'list') {
      var lines = b.items.map(function (it) { return (it.level ? '  ' : '') + it.text; });
      return '<textarea data-f="items-text" rows="' + Math.max(2, lines.length) + '" placeholder="一行一条。行首敲两个空格，这条就变成子项">' + esc(lines.join('\n')) + '</textarea>';
    }
    if (b.type === 'tasks') {
      var rows = b.items.map(function (it, i2) {
        return (
          '<div class="blk__taskrow">' +
          '<input type="checkbox" data-f="taskdone" data-i="' + i2 + '"' + (it.done ? ' checked' : '') + ' title="打勾=已完成">' +
          '<input type="text" data-f="tasktext" data-i="' + i2 + '" value="' + esc(it.text) + '" placeholder="要做的事……">' +
          '<button type="button" class="blk__op" data-op="deltask" data-i="' + i2 + '" title="删掉这一项">✕</button>' +
          '</div>'
        );
      }).join('');
      return rows + '<button type="button" class="blk__op blk__more" data-op="addtask">＋ 一项</button>';
    }
    if (b.type === 'img') {
      return (
        '<div class="blk__imgrow">' +
        '<input type="text" data-f="alt" value="' + esc(b.alt || '') + '" placeholder="图片说明（可不填）">' +
        '<input type="text" data-f="url" value="' + esc(b.url || '') + '" placeholder="图片地址">' +
        '<button type="button" class="btn btn--sm" data-op="pick">选图片</button>' +
        '</div>' +
        '<div class="blk__thumbwrap' + (b.url ? '' : ' hidden') + '"><img class="blk__thumb" data-role="thumb" src="' + esc(b.url || '') + '" alt=""></div>' +
        '<div class="blk__hint">也可以把图片文件直接粘贴或拖到这块上，会自动压缩上传</div>'
      );
    }
    if (b.type === 'code') {
      return '<textarea data-f="text" class="blk__code" rows="' + Math.max(4, String(b.text || '').split('\n').length) + '" placeholder="代码原样贴进来">' + esc(b.text || '') + '</textarea>';
    }
    if (b.type === 'table') {
      var tools =
        '<div class="tbl-tools">' +
        '<button type="button" data-tbl="addrow">＋一行</button>' +
        '<button type="button" data-tbl="addcol">＋一列</button>' +
        '<button type="button" data-tbl="delrow">删末行</button>' +
        '<button type="button" data-tbl="delcol">删末列</button>' +
        '<span class="blk__hint">第一行是表头</span>' +
        '</div>';
      var g = '<table class="tbl-edit"><tbody>';
      b.rows.forEach(function (row, r) {
        g += '<tr>';
        row.forEach(function (c, c2) {
          g += '<td><input type="text" data-f="cell" data-r="' + r + '" data-c="' + c2 + '" value="' + esc(c) + '"></td>';
        });
        g += '<td class="tbl-edit__del"><button type="button" class="blk__op" data-tbl="delrow-at" data-r="' + r + '" title="删除这一行">✕</button></td>';
        g += '</tr>';
      });
      g += '</tbody></table><div class="tbl-cols">';
      b.rows[0].forEach(function (c, c2) {
        g += '<button type="button" class="blk__op" data-tbl="delcol-at" data-c="' + c2 + '" title="删除这一列">列' + (c2 + 1) + ' ✕</button>';
      });
      return tools + g + '</div>';
    }
    if (b.type === 'hr') {
      return '<div class="blk__hrdemo">———— 分隔线 ————</div>';
    }
    return '';
  }

  function renderAll(focusIdx) {
    var html = blocks.map(function (b, idx) {
      return (
        '<div class="blk blk--' + b.type + '" data-idx="' + idx + '">' +
        blkBar(idx, b) +
        '<div class="blk__body">' + blkBody(idx, b) + '</div>' +
        '</div>'
      );
    }).join('');
    if (!blocks.length) html = '<div class="empty-tip">下面点「＋ 添加」开始写</div>';
    root.querySelector('#blk-list').innerHTML = html;
    if (focusIdx != null && blocks[focusIdx]) {
      var el = root.querySelector('.blk[data-idx="' + focusIdx + '"] textarea, .blk[data-idx="' + focusIdx + '"] input[type="text"]');
      if (el) {
        el.focus();
        if (el.setSelectionRange && el.value) el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }

  // ---------- 事件：输入与操作 ----------

  root.addEventListener('input', function (e) {
    var t = e.target;
    var card = t.closest('.blk');
    if (!card) return;
    var b = blocks[Number(card.dataset.idx)];
    if (!b) return;
    var f = t.dataset.f;
    if (!f) return;
    if (f === 'text') b.text = t.value;
    else if (f === 'alt') b.alt = t.value;
    else if (f === 'url') {
      b.url = t.value.trim();
      var tw = card.querySelector('.blk__thumbwrap');
      var thumb = card.querySelector('[data-role=thumb]');
      if (thumb && b.url) {
        thumb.src = b.url;
        tw.classList.remove('hidden');
      } else if (tw) {
        tw.classList.add('hidden');
      }
    } else if (f === 'items-text') {
      b.items = t.value.split('\n').map(function (l) {
        return { text: l.replace(/^\s+/, ''), level: /^\s{2,}/.test(l) ? 1 : 0 };
      }).filter(function (it) { return it.text !== ''; });
    } else if (f === 'tasktext') b.items[Number(t.dataset.i)].text = t.value;
    else if (f === 'taskdone') b.items[Number(t.dataset.i)].done = t.checked;
    else if (f === 'cell') b.rows[Number(t.dataset.r)][Number(t.dataset.c)] = t.value;
    changed('input');
  });
  root.addEventListener('change', function (e) {
    if (e.target.dataset && e.target.dataset.f === 'taskdone') {
      var card2 = e.target.closest('.blk');
      var b2 = blocks[Number(card2.dataset.idx)];
      if (b2) b2.items[Number(e.target.dataset.i)].done = e.target.checked;
      changed('input');
    }
  });

  root.addEventListener('click', function (e) {
    var wrapBtn = e.target.closest('[data-wrap]');
    if (wrapBtn) {
      doWrap(wrapBtn.dataset.wrap);
      return;
    }
    var tblBtn = e.target.closest('[data-tbl]');
    if (tblBtn) {
      doTableOp(tblBtn);
      return;
    }
    var opBtn = e.target.closest('[data-op]');
    if (!opBtn) return;
    var card = opBtn.closest('.blk');
    var idx = Number(card.dataset.idx);
    var op = opBtn.dataset.op;
    if (op === 'up' && idx > 0) {
      var tmp = blocks[idx - 1];
      blocks[idx - 1] = blocks[idx];
      blocks[idx] = tmp;
      renderAll(idx - 1);
      changed('structure');
    } else if (op === 'down' && idx < blocks.length - 1) {
      var tmp2 = blocks[idx + 1];
      blocks[idx + 1] = blocks[idx];
      blocks[idx] = tmp2;
      renderAll(idx + 1);
      changed('structure');
    } else if (op === 'copy') {
      blocks.splice(idx + 1, 0, JSON.parse(JSON.stringify(blocks[idx])));
      renderAll(idx + 1);
      changed('structure');
    } else if (op === 'del') {
      delBlock(idx);
    } else if (op === 'pick') {
      pickImage(function (url) {
        blocks[idx].url = url;
        renderAll(idx);
        changed('structure');
      });
    } else if (op === 'addtask') {
      blocks[idx].items.push({ text: '', done: false, level: 0 });
      renderAll();
      changed('structure');
    } else if (op === 'deltask') {
      blocks[idx].items.splice(Number(opBtn.dataset.i), 1);
      if (!blocks[idx].items.length) blocks[idx].items.push({ text: '', done: false, level: 0 });
      renderAll(idx);
      changed('structure');
    }
  });

  function changed(kind) {
    deps.onChange(kind || 'input');
  }

  function ensureNonEmpty() {
    if (!blocks.length) blocks.push({ type: 'p', text: '' });
  }

  function isBlockEmpty(b) {
    if (b.type === 'list' || b.type === 'tasks') {
      return !b.items.some(function (it) { return String(it.text || '').trim(); });
    }
    if (b.type === 'img') return !(b.url || '').trim();
    if (b.type === 'table') {
      return !b.rows.some(function (r) { return r.some(function (c) { return String(c).trim(); }); });
    }
    if (b.type === 'hr') return true;
    return !String(b.text || '').trim();
  }

  function blockSnippet(b) {
    var s = '';
    if (b.text != null) s = b.text;
    else if (b.items) s = b.items.map(function (it) { return it.text; }).join('；');
    else if (b.rows) s = b.rows.map(function (r) { return r.join(' | '); }).join(' / ');
    else if (b.url) s = b.url;
    return String(s || '（空）').trim().slice(0, 60);
  }

  function delBlock(idx) {
    var b = blocks[idx];
    var label = BLOCK_TYPE_LABELS[b.type] || '块';
    if (isBlockEmpty(b)) {
      blocks.splice(idx, 1);
      ensureNonEmpty();
      renderAll();
      changed('structure');
      return;
    }
    confirmModal('删除这个' + label + '？', '内容：' + blockSnippet(b), '删除').then(function (yes) {
      if (!yes) return;
      blocks.splice(idx, 1);
      ensureNonEmpty();
      // 不回焦输入框：让 Ctrl+Z 落在容器上走块级撤销
      renderAll();
      changed('structure');
    });
  }

  function doWrap(kind) {
    var card = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.blk') : null;
    if (!card) {
      card = root.querySelector('.blk--p');
    }
    var ta2 = card ? card.querySelector('textarea[data-f=text]') : null;
    if (!ta2) {
      toast('先在段落里选中文字，再点按钮', true);
      return;
    }
    var s = ta2.selectionStart;
    var e2 = ta2.selectionEnd;
    var sel = ta2.value.slice(s, e2);
    if (kind === 'link') {
      ta2.setRangeText('[' + sel + '](https://)', s, e2, 'end');
      var urlStart = s + sel.length + 3;
      ta2.setSelectionRange(urlStart, urlStart + 8);
    } else {
      ta2.setRangeText(kind + sel + kind, s, e2, 'end');
      ta2.setSelectionRange(s + kind.length, s + kind.length + sel.length);
    }
    blocks[Number(card.dataset.idx)].text = ta2.value;
    ta2.focus();
    changed('input');
  }

  function doTableOp(btn) {
    var card = btn.closest('.blk');
    var idx = Number(card.dataset.idx);
    var b = blocks[idx];
    var op = btn.dataset.tbl;
    var nr = b.rows.length;
    var nc = b.rows[0].length;
    if (op === 'addrow') b.rows.push(new Array(nc).join('.').split('.').map(function () { return ''; }));
    else if (op === 'addcol') b.rows.forEach(function (r) { r.push(''); });
    else if (op === 'delrow' && nr > 1) b.rows.pop();
    else if (op === 'delcol' && nc > 1) b.rows.forEach(function (r) { r.pop(); });
    else if (op === 'delrow-at' && nr > 1) b.rows.splice(Number(btn.dataset.r), 1);
    else if (op === 'delcol-at' && nc > 1) b.rows.forEach(function (r) { r.splice(Number(btn.dataset.c), 1); });
    else return;
    renderAll(idx);
    changed('structure');
  }

  // ---------- 拖拽排序 / 文件拖入 / 粘贴上传 ----------

  root.addEventListener('dragstart', function (e) {
    var handle = e.target.closest('.blk__drag');
    if (!handle) return;
    var card = handle.closest('.blk');
    dragIdx = Number(card.dataset.idx);
    card.classList.add('blk--dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(dragIdx)); } catch (err) { /* IE 兼容 */ }
  });
  root.addEventListener('dragover', function (e) {
    var card = e.target.closest('.blk');
    if (!card || dragIdx < 0) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    root.querySelectorAll('.blk--drop').forEach(function (el) { el.classList.remove('blk--drop'); });
    card.classList.add('blk--drop');
  });
  root.addEventListener('drop', function (e) {
    var files = e.dataTransfer && e.dataTransfer.files;
    var card = e.target.closest ? e.target.closest('.blk') : null;
    if (files && files.length && card && blocks[Number(card.dataset.idx)] && blocks[Number(card.dataset.idx)].type === 'img') {
      e.preventDefault();
      uploadIntoBlock(Number(card.dataset.idx), files);
      cleanupDrag();
      return;
    }
    if (!card || dragIdx < 0) return;
    e.preventDefault();
    var to = Number(card.dataset.idx);
    if (to !== dragIdx) {
      var moved = blocks.splice(dragIdx, 1)[0];
      blocks.splice(to, 0, moved);
      renderAll(to);
      changed('structure');
    }
    cleanupDrag();
  });
  root.addEventListener('dragend', cleanupDrag);

  function cleanupDrag() {
    dragIdx = -1;
    root.querySelectorAll('.blk--dragging, .blk--drop').forEach(function (el) {
      el.classList.remove('blk--dragging', 'blk--drop');
    });
  }

  root.addEventListener('paste', function (e) {
    var files = e.clipboardData && e.clipboardData.files;
    if (!files || !files.length) return;
    var card = e.target.closest ? e.target.closest('.blk') : null;
    if (!card) return;
    if (blocks[Number(card.dataset.idx)].type !== 'img') return;
    e.preventDefault();
    uploadIntoBlock(Number(card.dataset.idx), files);
  });

  function uploadIntoBlock(idx, files) {
    var b = blocks[idx];
    toast('正在压缩并上传图片……');
    var chain = Promise.resolve();
    Array.prototype.forEach.call(files, function (f) {
      chain = chain
        .then(function () {
          return uploadImageFile(f);
        })
        .then(function (r) {
          b.url = r.url;
          if (!b.alt) b.alt = f.name.replace(/\.[^.]+$/, '');
          renderAll(idx);
          changed('structure');
          toast('图片已上传');
        })
        .catch(function (err) {
          toast(err.message, true);
        });
    });
  }

  // 结构性撤销：Ctrl+Z / Ctrl+Y（焦点在输入框内时交给浏览器原生撤销）
  // 绑在 document 上：块操作后焦点可能落在 body，容器级监听会收不到
  document.addEventListener('keydown', function (e) {
    if (!root.offsetParent) return; // 小白面板未显示时不拦
    var mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    var k = e.key.toLowerCase();
    if (k !== 'z' && k !== 'y') return;
    var t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      deps.step(-1);
    } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
      e.preventDefault();
      deps.step(1);
    }
  });

  // ---------- 添加块 ----------

  root.querySelector('#blk-add').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-add]');
    if (!btn) return;
    blocks.push(newBlock(btn.dataset.add));
    renderAll(blocks.length - 1);
    changed('structure');
  });

  function newBlock(type) {
    if (type === 'h2' || type === 'h3' || type === 'h4') return { type: type, text: '' };
    if (type === 'list') return { type: 'list', ordered: false, items: [{ text: '', level: 0 }] };
    if (type === 'tasks') return { type: 'tasks', items: [{ text: '', done: false, level: 0 }] };
    if (type === 'img') return { type: 'img', alt: '', url: '' };
    if (type === 'table') return { type: 'table', rows: [['列1', '列2'], ['', '']] };
    if (type === 'hr') return { type: 'hr' };
    if (type === 'raw') return { type: 'raw', text: '' };
    if (type === 'quote') return { type: 'quote', text: '' };
    if (type === 'code') return { type: 'code', text: '' };
    return { type: 'p', text: '' };
  }

  // ---------- 图片选择器 ----------

  function pickImage(cb) {
    api('GET', 'media')
      .then(function (data) {
        var images = data.images || [];
        var mask = document.createElement('div');
        mask.className = 'modal-mask';
        mask.innerHTML =
          '<div class="modal picker">' +
          '<h3>选一张图片</h3>' +
          '<div class="picker__grid">' +
          (images.length
            ? images.map(function (im) {
                return (
                  '<button type="button" class="picker__item" data-url="' + esc(im.url) + '" title="' + esc(im.name) + '">' +
                  '<img src="' + esc(im.url) + '" alt=""><span>' + esc(im.name) + '</span></button>'
                );
              }).join('')
            : '<div class="empty-tip">媒体库还是空的，先上传一张吧</div>') +
          '</div>' +
          '<div class="modal__actions">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-pick="upload">上传新图片</button>' +
          '<span class="spacer"></span>' +
          '<button type="button" class="btn btn--ghost btn--sm" data-pick="close">取消</button>' +
          '</div>' +
          '<input type="file" accept="image/*" multiple hidden data-role="picker-file">' +
          '</div>';
        document.body.appendChild(mask);
        var fileInput = mask.querySelector('[data-role=picker-file]');
        function close() {
          document.removeEventListener('keydown', onKey);
          mask.remove();
        }
        function onKey(e) {
          if (e.key === 'Escape') close();
        }
        document.addEventListener('keydown', onKey);
        mask.addEventListener('click', function (e) {
          if (e.target === mask) {
            close();
            return;
          }
          var item = e.target.closest('[data-url]');
          if (item) {
            close();
            cb(item.dataset.url);
            return;
          }
          var act = e.target.closest('[data-pick]');
          if (!act) return;
          if (act.dataset.pick === 'close') close();
          if (act.dataset.pick === 'upload') fileInput.click();
        });
        fileInput.addEventListener('change', function () {
          var files = this.files;
          if (!files || !files.length) return;
          toast('正在压缩并上传……');
          var chain = Promise.resolve();
          var last = null;
          Array.prototype.forEach.call(files, function (f) {
            chain = chain
              .then(function () {
                return uploadImageFile(f);
              })
              .then(function (r) {
                last = r;
                toast('已上传：' + f.name);
              });
          });
          chain
            .then(function () {
              close();
              if (last) cb(last.url);
            })
            .catch(function (err) {
              toast(err.message, true);
            });
        });
      })
      .catch(function (err) {
        toast(err.message, true);
      });
  }

  // ---------- 对外接口 ----------

  return {
    load: function (markdown) {
      blocks = parseBlocks(markdown);
      renderAll();
    },
    toMarkdown: md,
    countChars: function () {
      return md().replace(/\s/g, '').length;
    },
    refreshPreview: function () {
      var wrap = root.querySelector('#blk-preview-wrap');
      if (wrap.hidden) return;
      root.querySelector('#blk-preview').innerHTML =
        renderMarkdown(md()) || '<p style="color:var(--text-muted)">预览会出现在这里……</p>';
    },
  };
}

function renderEditor(slug) {
  if (slug !== 'new' && !SLUG_RE.test(slug)) {
    renderShell('posts', '<div class="empty-tip">文章地址不合法</div>');
    return;
  }
  renderShell('posts', loadingTip('正在捞这篇文章……'));
  var load = slug === 'new' ? Promise.resolve(null) : api('GET', 'posts', { slug: slug });
  load
    .then(function (post) {
      var isNew = !post;
      var accent = post ? post.accent : 'pink';
      var html =
        '<div class="page-head"><h1>' + (isNew ? '写新文章' : '编辑文章') + '</h1><span class="spacer"></span>' +
        (isNew ? '' : '<a class="btn btn--ghost" href="/blog/' + encodeURIComponent(slug) + '/" target="_blank" rel="noopener">看线上页面</a>') +
        '</div>' +
        '<div class="editor-grid">' +
        '<div class="card">' +
        '<div class="field"><label>标题</label><input id="f-title" value="' + esc(post ? post.title : '') + '"></div>' +
        '<div class="field"><label>摘要</label><textarea id="f-desc" rows="2">' + esc(post ? post.description : '') + '</textarea></div>' +
        '<div class="field-row">' +
        '<div class="field"><label>发布日期</label><input id="f-date" type="datetime-local" value="' + toLocalInput(post && post.pubDate) + '"></div>' +
        '<div class="field"><label>文件名（url 路径，仅字母数字.-_）</label><input id="f-slug" value="' + esc(post ? post.slug : defaultSlug()) + '"></div>' +
        '</div>' +
        '<div class="field"><label>标签（用逗号分隔）</label><input id="f-tags" value="' + esc(post ? (post.tags || []).join(', ') : '') + '" placeholder="技术, 随笔"></div>' +
        '<div class="field"><label>卡片美西螈</label><div class="accent-picker" id="f-accent">' +
        ACCENTS.map(function (a) {
          return '<button type="button" data-id="' + a.id + '" class="' + (a.id === accent ? 'active' : '') + '" title="' + a.label + '"><img src="' + a.img + '" alt="' + a.label + '"></button>';
        }).join('') +
        '</div></div>' +
        '<div class="field draft-toggle"><label class="switch"><input type="checkbox" id="f-draft" ' + (post && post.draft ? 'checked' : '') + '><span class="switch__track"></span><span class="switch__thumb"></span></label>' +
        '<span>存为草稿（前台不显示，随时可发布）</span></div>' +
        '</div>' +
        '<div class="card" id="editor-card">' +
        '<div class="ed-topbar">' +
        '<div class="mode-seg" id="mode-seg" role="group" aria-label="写作方式">' +
        '<button type="button" data-mode="easy" title="像搭积木一样写，不用学任何符号">小白写作</button>' +
        '<button type="button" data-mode="pro" title="直接写 Markdown，左右分栏实时预览">进阶写作</button>' +
        '</div>' +
        '<span class="word-count" id="word-count"></span>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="ed-topbar__btn" id="focus-btn" title="收起上面的文章信息，专心写正文">专注</button>' +
        '<button type="button" class="ed-topbar__btn" id="pv-toggle-btn" title="展开/收起正文预览">预览</button>' +
        '</div>' +
        '<div id="easy-pane">' +
        '<div id="blk-list"></div>' +
        '<div class="blk-add" id="blk-add"><span class="blk-add__label">＋ 添加：</span>' +
        blkAddBtn('p', '段落') + blkAddBtn('h2', '大标题') + blkAddBtn('h3', '小标题') +
        blkAddBtn('list', '列表') + blkAddBtn('tasks', '任务清单') + blkAddBtn('quote', '引用') +
        blkAddBtn('img', '图片') + blkAddBtn('code', '代码') + blkAddBtn('table', '表格') +
        blkAddBtn('hr', '分隔线') + blkAddBtn('raw', '原始 Markdown') +
        '</div>' +
        '<div class="preview-pane blk-preview" id="blk-preview-wrap" hidden><div class="md-body" id="blk-preview"></div></div>' +
        '<p class="blk-tip">写好了点下面的「发布」，内容会自动存成标准格式，以后随时能改。</p>' +
        '</div>' +
        '<div id="pro-pane">' +
        '<div class="md-toolbar" id="md-tools">' +
        '<button type="button" data-hist="undo" title="回退（Ctrl+Z）" disabled>↩ 回退</button>' +
        '<button type="button" data-hist="redo" title="恢复（Ctrl+Y）" disabled>↪ 恢复</button>' +
        '<span class="md-toolbar__sep"></span>' +
        mdBtn('标题', '把这一行变成大标题（## ）', '## ', '') + mdBtn('小标题', '把这一行变成小标题（### ）', '### ', '') +
        mdBtn('加粗', '把选中的文字加粗', '**', '**') + mdBtn('斜体', '把选中的文字变斜体', '*', '*') +
        mdBtn('链接', '给选中文字加个网址', '[', '](https://)') +
        mdBtn('图片', '插入一张图片', '![', '](/assets/uploads/)') +
        mdBtn('引用', '引用块', '> ', '') + mdBtn('代码', '代码块', '\n```\n', '\n```\n') +
        mdBtn('表格', '表格', '\n| 列1 | 列2 |\n| --- | --- |\n| ', ' | |\n') +
        '<span class="md-toolbar__hint">小白须知：先选中文字再点按钮 · 写错了点 ↩ 回退</span>' +
        '</div>' +
        '<div class="split">' +
        '<textarea id="f-body" placeholder="在这里写正文……（支持 Markdown）">' + esc(post ? post.body : '') + '</textarea>' +
        '<div class="preview-pane" id="preview-pane"><div class="md-body" id="preview"></div></div>' +
        '</div>' +
        '</div>' +
        '<div class="editor-actions">' +
        '<button class="btn" id="save-btn">' + (isNew ? '发布' : '保存') + '</button>' +
        (isNew ? '' : '<button class="btn btn--danger" id="del-btn">删除</button>') +
        '<span class="save-state" id="save-state"></span>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn--ghost btn--sm" id="pv-theme-btn">预览换个主题</button>' +
        '</div>' +
        '</div></div>';
      renderShell('posts', html);
      bindEditor(slug, post);
    })
    .catch(function (err) {
      renderShell('posts', '<div class="empty-tip">' + esc(err.message) + '</div>');
    });
}

function mdBtn(label, title, before, after) {
  return (
    '<button type="button" data-before="' + esc(before) + '" data-after="' + esc(after) + '" title="' + title + '">' + label + '</button>'
  );
}

function blkAddBtn(type, label) {
  return '<button type="button" data-add="' + type + '">＋ ' + label + '</button>';
}

function bindEditor(origSlug, post) {
  var isNew = !post;
  var pickedAccent = post ? post.accent : 'pink';
  var pvThemes = ['pink-soft', 'purple-pixel', 'lumen-cave'];
  var pvIdx = 0;

  var ta = $('#f-body');

  // ---------- 未保存保护：字段输入/选色/草稿开关/正文都算改动 ----------
  var dirty = false;
  function markDirty() {
    dirty = true;
  }
  ['#f-title', '#f-desc', '#f-date', '#f-slug', '#f-tags'].forEach(function (id) {
    $(id).addEventListener('input', markDirty);
  });
  $('#f-draft').addEventListener('change', markDirty);
  ta.addEventListener('input', markDirty);
  editorGuard = {
    route: '#/editor/' + encodeURIComponent(origSlug),
    isDirty: function () {
      return dirty;
    },
    ask: function () {
      return confirmModal('有未保存的修改', '页面内容还没保存，离开就找不回来了。确定要走吗？', '直接走');
    },
  };

  // ---------- 回退/恢复：自管历史栈（输入/工具栏插入统一可撤销） ----------
  var hist = [{ v: ta.value, s: 0, e: 0 }];
  var histIdx = 0;
  var histTimer = null;
  var undoBtn = $('#md-tools button[data-hist=undo]');
  var redoBtn = $('#md-tools button[data-hist=redo]');

  function syncHistButtons() {
    undoBtn.disabled = histIdx <= 0;
    redoBtn.disabled = histIdx >= hist.length - 1;
  }

  function pushHist(forceValue) {
    var v = arguments.length ? forceValue : ta.value;
    clearTimeout(histTimer);
    var top = hist[hist.length - 1];
    if (top && top.v === v) {
      syncHistButtons();
      return;
    }
    hist = hist.slice(0, histIdx + 1);
    hist.push({ v: v, s: ta.selectionStart, e: ta.selectionEnd });
    if (hist.length > 200) hist.shift();
    histIdx = hist.length - 1;
    syncHistButtons();
  }

  function stepHist(dir) {
    var next = histIdx + dir;
    if (next < 0 || next >= hist.length) return;
    histIdx = next;
    var snap = hist[histIdx];
    ta.value = snap.v;
    ta.setSelectionRange(snap.s, snap.e);
    if (typeof easyMode !== 'undefined' && easyMode) {
      blk.load(snap.v);
      blk.refreshPreview();
    } else {
      ta.focus();
      refreshPreview();
    }
    syncHistButtons();
  }

  function queueHist() {
    clearTimeout(histTimer);
    histTimer = setTimeout(pushHist, 350);
  }

  undoBtn.addEventListener('click', function () {
    stepHist(-1);
  });
  redoBtn.addEventListener('click', function () {
    stepHist(1);
  });
  ta.addEventListener('keydown', function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    var k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      stepHist(-1);
    } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
      e.preventDefault();
      stepHist(1);
    }
  });
  syncHistButtons();

  function refreshPreview() {
    $('#preview').innerHTML = renderMarkdown($('#f-body').value) || '<p style="color:var(--text-muted)">预览会出现在这里……</p>';
  }
  ta.addEventListener('input', function () {
    queueHist();
    refreshPreview();
  });
  refreshPreview();

  $('#f-accent').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-id]');
    if (!btn) return;
    dirty = true;
    pickedAccent = btn.dataset.id;
    $('#f-accent').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
  });

  $('#md-tools').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-before]');
    if (!btn) return;
    var before = btn.dataset.before.replace(/\\n/g, '\n');
    var after = btn.dataset.after.replace(/\\n/g, '\n');
    ta.setRangeText(before + after, ta.selectionStart, ta.selectionEnd, 'select');
    ta.focus();
    pushHist();
  });

  $('#pv-theme-btn').addEventListener('click', function () {
    pvIdx = (pvIdx + 1) % pvThemes.length;
    $('#preview-pane').dataset.pvTheme = pvThemes[pvIdx];
  });

  // ---------- 小白模式（块编辑） ----------
  var easyMode = (localStorage.getItem('cms-editor-mode') || 'easy') !== 'pro';
  var AUTODRAFT_KEY = 'cms-autodraft';

  function currentBody() {
    return easyMode ? blk.toMarkdown() : ta.value;
  }

  var blk = createBlockEditor({
    root: $('#easy-pane'),
    onChange: function (kind) {
      dirty = true;
      updateWordCount();
      if (kind === 'structure') {
        pushHist(blk.toMarkdown());
      } else {
        clearTimeout(histTimer);
        histTimer = setTimeout(function () {
          pushHist(blk.toMarkdown());
        }, 350);
      }
      blk.refreshPreview();
    },
    step: function (d) {
      stepHist(d);
    },
  });
  blk.load(ta.value);

  function updateWordCount() {
    var n = easyMode ? blk.countChars() : ta.value.replace(/\s/g, '').length;
    $('#word-count').textContent = n ? '约 ' + n + ' 字' : '';
  }

  function applyMode() {
    $('#easy-pane').hidden = !easyMode;
    $('#pro-pane').hidden = easyMode;
    $('#pv-toggle-btn').hidden = !easyMode;
    $('#mode-seg').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', (b.dataset.mode === 'easy') === easyMode);
    });
    if (easyMode) blk.refreshPreview();
    updateWordCount();
  }
  applyMode();

  $('#mode-seg').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    var wantEasy = btn.dataset.mode === 'easy';
    if (wantEasy === easyMode) return;
    if (wantEasy) {
      blk.load(ta.value);
    } else {
      ta.value = blk.toMarkdown();
      refreshPreview();
    }
    easyMode = wantEasy;
    localStorage.setItem('cms-editor-mode', easyMode ? 'easy' : 'pro');
    dirty = true;
    applyMode();
    pushHist();
  });

  $('#focus-btn').addEventListener('click', function () {
    var grid = document.querySelector('.editor-grid');
    var on = grid.classList.toggle('focus-mode');
    this.textContent = on ? '退出专注' : '专注';
  });

  $('#pv-toggle-btn').addEventListener('click', function () {
    var wrap = $('#blk-preview-wrap');
    wrap.hidden = !wrap.hidden;
    this.textContent = wrap.hidden ? '预览' : '收起预览';
    blk.refreshPreview();
  });

  // ---------- 自动暂存：防断电/误关丢稿 ----------
  function collectMeta() {
    return {
      title: $('#f-title').value,
      description: $('#f-desc').value,
      pubDate: $('#f-date').value,
      slug: $('#f-slug').value,
      tags: $('#f-tags').value,
      accent: pickedAccent,
      draft: $('#f-draft').checked,
    };
  }
  function restoreMeta(m) {
    $('#f-title').value = m.title || '';
    $('#f-desc').value = m.description || '';
    $('#f-date').value = m.pubDate || '';
    $('#f-slug').value = m.slug || '';
    $('#f-tags').value = m.tags || '';
    $('#f-draft').checked = !!m.draft;
    pickedAccent = m.accent || 'pink';
    $('#f-accent').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.id === pickedAccent);
    });
  }
  setInterval(function () {
    if (!dirty) return;
    try {
      localStorage.setItem(AUTODRAFT_KEY, JSON.stringify({
        slug: isNew ? 'new' : origSlug,
        at: Date.now(),
        mode: easyMode ? 'easy' : 'pro',
        meta: collectMeta(),
        body: currentBody(),
      }));
    } catch (e) { /* 存储异常忽略 */ }
  }, 30000);

  try {
    var ad = JSON.parse(localStorage.getItem(AUTODRAFT_KEY) || 'null');
    if (ad && ad.body != null && ad.slug === (isNew ? 'new' : origSlug)) {
      confirmModal(
        '发现自动暂存的草稿',
        '上次编辑到 ' + new Date(ad.at).toLocaleString() + ' 的内容已自动暂存。要恢复吗？（选取消就丢弃暂存）',
        '恢复'
      ).then(function (yes) {
        if (!yes) {
          localStorage.removeItem(AUTODRAFT_KEY);
          return;
        }
        restoreMeta(ad.meta || {});
        if (ad.mode === 'pro') {
          easyMode = false;
          ta.value = ad.body;
        } else {
          easyMode = true;
          blk.load(ad.body);
        }
        localStorage.setItem('cms-editor-mode', easyMode ? 'easy' : 'pro');
        applyMode();
        dirty = true;
        pushHist();
        toast('已恢复上次暂存的内容');
      });
    }
  } catch (e) { /* 暂存内容损坏则忽略 */ }


  $('#save-btn').addEventListener('click', function () {
    var slug = $('#f-slug').value.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(slug)) {
      toast('文件名不合法：仅字母、数字、点、下划线、短横线', true);
      return;
    }
    if (!$('#f-title').value.trim()) {
      toast('标题不能为空', true);
      return;
    }
    var btn = this;
    btn.disabled = true;
    $('#save-state').textContent = '正在提交到 GitHub……';
    api('PUT', 'posts', {
      slug: slug,
      body: {
        oldSlug: isNew || slug === origSlug ? '' : origSlug,
        post: {
          title: $('#f-title').value.trim(),
          description: $('#f-desc').value.trim(),
          pubDate: new Date($('#f-date').value || Date.now()).toISOString(),
          tags: $('#f-tags').value.split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean),
          accent: pickedAccent,
          draft: $('#f-draft').checked,
        },
        body: currentBody(),
      },
    })
      .then(function () {
        editorGuard = null; // 保存成功后的跳转不拦截
        localStorage.removeItem('cms-autodraft');
        toast('已保存，站点构建约需一分钟');
        location.hash = '#/posts';
      })
      .catch(function (err) {
        toast(err.message, true);
        btn.disabled = false;
        $('#save-state').textContent = '';
      });
  });

  if (!isNew) {
    $('#del-btn').addEventListener('click', function () {
      confirmModal('删除文章', '确定删除《' + post.title + '》吗？此操作会从仓库移除文件，不可撤销。', '删除')
        .then(function (yes) {
          if (!yes) return;
          api('DELETE', 'posts', { slug: origSlug })
            .then(function () {
              editorGuard = null; // 删除成功后的跳转不拦截
              toast('已删除');
              location.hash = '#/posts';
            })
            .catch(function (err) {
              toast(err.message, true);
            });
        });
    });
  }
}

// ---------- 媒体库 ----------

function renderMedia() {
  renderShell('media', loadingTip('媒体库打开中……'));
  api('GET', 'media')
    .then(function (data) {
      var images = data.images || [];
      var html =
        '<div class="page-head"><h1>媒体库</h1><span style="color:var(--text-muted);font-size:14px">' +
        images.length + ' 张图片 · 上传自动压缩</span></div>' +
        '<div class="dropzone" id="dropzone">把图片拖到这里，或 <button class="btn btn--sm" id="pick-btn" type="button">选择文件</button>（也可以直接 Ctrl+V 粘贴截图）</div>' +
        '<input type="file" id="file-input" accept="image/*" multiple hidden>' +
        (images.length
          ? '<div class="media-grid">' +
            images
              .map(function (im) {
                return (
                  '<div class="media-item"><img src="' + im.url + '" alt="" loading="lazy">' +
                  '<div class="media-item__bar"><span class="media-item__name" title="' + esc(im.name) + '">' +
                  esc(im.name) + '（' + fmtSize(im.size) + '）</span>' +
                  '<button class="btn btn--ghost btn--sm" data-copy="' + esc(im.url) + '">复制</button>' +
                  '<button class="btn btn--danger btn--sm" data-del="' + esc(im.name) + '">删</button>' +
                  '</div></div>'
                );
              })
              .join('') +
            '</div>'
          : '<div class="empty-tip"><img src="/assets/axolotl-cyan.png" alt=""><br>还没有图片，拖一张上来试试</div>');
      renderShell('media', html);
      bindMedia();
    })
    .catch(function (err) {
      renderShell('media', '<div class="empty-tip">' + esc(err.message) + '</div>');
    });
}

function bindMedia() {
  var dz = $('#dropzone');
  var fi = $('#file-input');

  $('#pick-btn').addEventListener('click', function () {
    fi.click();
  });
  fi.addEventListener('change', function () {
    uploadFiles(Array.prototype.slice.call(fi.files));
    fi.value = '';
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) {
      e.preventDefault();
      dz.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) {
      e.preventDefault();
      dz.classList.remove('dragover');
    });
  });
  dz.addEventListener('drop', function (e) {
    uploadFiles(Array.prototype.slice.call(e.dataTransfer.files).filter(function (f) {
      return f.type.startsWith('image/');
    }));
  });
}

// 粘贴与按钮委托是全局级监听：renderMedia 每次重渲染都会跑 bindMedia，
// 若把这两个挂在其内会层层叠加（一次粘贴多路上传、确认弹窗叠层），只在启动时绑一次
function bindMediaDelegates() {
  document.addEventListener('paste', function (e) {
    var items = Array.prototype.slice.call(e.clipboardData.items || []);
    var files = items
      .filter(function (it) {
        return it.kind === 'file' && it.type.startsWith('image/');
      })
      .map(function (it) {
        return it.getAsFile();
      })
      .filter(Boolean);
    if (files.length && location.hash === '#/media') {
      e.preventDefault();
      uploadFiles(files);
    }
  });

  $('#app').addEventListener('click', function (e) {
    var copyBtn = e.target.closest('button[data-copy]');
    if (copyBtn) {
      var md = '![](' + copyBtn.dataset.copy + ')';
      navigator.clipboard
        .writeText(md)
        .then(function () {
          toast('已复制 Markdown 引用');
        })
        .catch(function () {
          toast('复制失败，请手动复制：' + md, true);
        });
      return;
    }
    var delBtn = e.target.closest('button[data-del]');
    if (delBtn) {
      deleteImageFlow(delBtn.dataset.del);
    }
  });
}

/**
 * 删图流程：先尽力扫描文章正文里的引用（列表数据带 body，含草稿），
 * 被引用时把确认弹窗升级为红色警告并列出引用文章；列表拿不到就退回普通确认。
 */
function deleteImageFlow(name) {
  function doDelete() {
    api('DELETE', 'media', { query: { name: name } })
      .then(function () {
        toast('已删除');
        renderMedia();
      })
      .catch(function (err) {
        toast(err.message, true);
      });
  }
  function ask() {
    return confirmModal('删除图片', '确定删除 ' + name + ' 吗？正在使用它的文章会显示裂图。', '删除');
  }
  var cached = state.postsCache;
  var prep =
    cached && cached.map
      ? Promise.resolve(cached)
      : api('GET', 'posts')
          .then(function (data) {
            state.postsCache = data.posts || [];
            return state.postsCache;
          })
          .catch(function () {
            return null; // 引用检查是尽力而为，不挡删除
          });
  prep
    .then(function (list) {
      if (!list) return ask();
      var used = list.filter(function (p) {
        return String(p.body || '').indexOf('/assets/uploads/' + name) !== -1;
      });
      if (!used.length) return ask();
      var titles = used
        .map(function (p) {
          return '《' + (p.title || p.slug) + '》' + (p.draft ? '（草稿）' : '');
        })
        .join('、');
      return confirmModal(
        '图片正在使用',
        name + ' 正被这些文章引用：' + titles + '。删除后它们会显示裂图。',
        '仍然删除'
      );
    })
    .then(function (yes) {
      if (yes) doDelete();
    });
}

/** 浏览器端压缩：长边 ≤1600px；透明图输出 webp，其余 jpeg（控制在 900KB 内适配边缘函数 1MB 限制） */
function compressImage(file) {
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var maxEdge = 1600;
      var scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      var hasAlpha = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif';
      var type = hasAlpha ? 'image/webp' : 'image/jpeg';
      var quality = 0.85;
      var dataUrl = canvas.toDataURL(type, quality);
      while (dataUrl.length > 900 * 1024 * 1.37 && quality > 0.5) {
        quality -= 0.1;
        dataUrl = canvas.toDataURL(type, quality);
      }
      var ext = hasAlpha ? 'webp' : 'jpg';
      var base = file.name.replace(/\.[^.]+$/, '').replace(/[^\w\u4e00-\u9fa5-]+/g, '-') || 'image';
      var stamp = Date.now().toString(36);
      resolve({ name: base + '-' + stamp + '.' + ext, data: dataUrl.split(',')[1] });
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败：' + file.name));
    };
    img.src = url;
  });
}

/** 压缩并上传一张图片，返回 Promise<{name, url}>；媒体库、块编辑器、图片选择器共用 */
function uploadImageFile(file) {
  return compressImage(file)
    .then(function (img) {
      return api('POST', 'media', { body: img }).then(function () {
        return { name: img.name, url: '/assets/uploads/' + img.name };
      });
    });
}

function uploadFiles(files) {
  if (!files.length) return;
  toast('正在压缩并上传 ' + files.length + ' 张图片……');
  var chain = Promise.resolve();
  Array.prototype.forEach.call(files, function (f) {
    chain = chain
      .then(function () {
        return uploadImageFile(f);
      })
      .then(function () {
        toast('已上传：' + f.name);
      })
      .catch(function (err) {
        toast(err.message, true);
      });
  });
  chain.then(function () {
    renderMedia();
  });
}

// ---------- 启动 ----------

app = $('#app');
bindMediaDelegates();
if (loggedIn()) {
  // 校验 token 的同时刷新用户名（token 里才有真实身份，localStorage 可能是旧值）
  api('GET', 'session')
    .then(function (data) {
      if (data.user && data.user !== state.user) {
        state.user = data.user;
        localStorage.setItem('cms-user', state.user);
      }
    })
    .catch(function () {});
}
nav();
