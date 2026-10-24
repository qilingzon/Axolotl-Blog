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
    mask.addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (act) {
        mask.remove();
        resolve(act === 'yes');
      } else if (e.target === mask) {
        mask.remove();
        resolve(false);
      }
    });
    document.body.appendChild(mask);
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

function nav() {
  var hash = location.hash || '#/dashboard';
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
  else if (parts[0] === 'posts') renderPosts();
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
    api('POST', 'login', {
      body: {
        username: this.username.value,
        password: this.password.value,
      },
    })
      .then(function (data) {
        state.token = data.token;
        state.expiresAt = data.expiresAt;
        state.user = data.user || 'admin';
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
        statCard(posts.length, '篇文章', '/assets/axolotl-cyan.png') +
        statCard(Object.keys(tags).length, '个标签', '/assets/axolotl-gold.png') +
        statCard(drafts, '篇草稿', '/assets/axolotl-wild.png') +
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

function statCard(num, label, img) {
  return (
    '<div class="stat"><img src="' + img + '" alt=""><div><div class="stat__num">' +
    num + '</div><div class="stat__label">' + esc(label) + '</div></div></div>'
  );
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

function renderPosts() {
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
        '<input class="search-input" id="post-search" placeholder="搜标题或标签…">' +
        '<select id="post-tag" style="width:130px"><option value="">全部标签</option>' +
        allTags.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') +
        '</select>' +
        '<a class="btn" href="#/editor/new">写新文章</a></div>' +
        '<div id="post-list">' + posts.map(postRowHtml).join('') + '</div>';
      renderShell('posts', html);
      var listEl = $('#post-list');
      function refresh() {
        var kw = $('#post-search').value.trim().toLowerCase();
        var tag = $('#post-tag').value;
        var filtered = posts.filter(function (p) {
          var hitKw =
            !kw ||
            p.title.toLowerCase().includes(kw) ||
            (p.tags || []).some(function (t) {
              return t.toLowerCase().includes(kw);
            });
          var hitTag = !tag || (p.tags || []).includes(tag);
          return hitKw && hitTag;
        });
        listEl.innerHTML = filtered.length
          ? filtered.map(postRowHtml).join('')
          : '<div class="empty-tip"><img src="/assets/axolotl-wild.png" alt=""><br>没有匹配的文章</div>';
      }
      $('#post-search').addEventListener('input', refresh);
      $('#post-tag').addEventListener('change', refresh);
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
  var listType = null; // 'ul' | 'ol'
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
    if (listType) {
      out.push('</' + listType + '>');
      listType = null;
    }
  }

  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
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
      var lv = Math.min(h[1].length + 1, 4);
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
      if (listType !== type) {
        flushList();
        out.push('<' + type + '>');
        listType = type;
      }
      out.push('<li>' + inline((ul || ol)[1]) + '</li>');
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
        '<div class="card">' +
        '<div class="md-toolbar" id="md-tools">' +
        '<button type="button" data-hist="undo" title="回退（Ctrl+Z）" disabled>↩ 回退</button>' +
        '<button type="button" data-hist="redo" title="恢复（Ctrl+Y）" disabled>↪ 恢复</button>' +
        '<span class="md-toolbar__sep"></span>' +
        mdBtn('H2', '标题', '## ', '') + mdBtn('H3', '小标题', '### ', '') +
        mdBtn('B', '加粗', '**', '**') + mdBtn('I', '斜体', '*', '*') +
        mdBtn('链接', '插入链接', '[', '](https://)') +
        mdBtn('图片', '插入图片', '![', '](/assets/uploads/)') +
        mdBtn('引用', '引用块', '> ', '') + mdBtn('代码', '代码块', '\n```\n', '\n```\n') +
        mdBtn('表格', '表格', '\n| 列1 | 列2 |\n| --- | --- |\n| ', ' | |\n') +
        '</div>' +
        '<div class="split">' +
        '<textarea id="f-body" placeholder="在这里写正文……（支持 Markdown）">' + esc(post ? post.body : '') + '</textarea>' +
        '<div class="preview-pane" id="preview-pane"><div class="md-body" id="preview"></div></div>' +
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

function bindEditor(origSlug, post) {
  var isNew = !post;
  var pickedAccent = post ? post.accent : 'pink';
  var pvThemes = ['pink-soft', 'purple-pixel', 'lumen-cave'];
  var pvIdx = 0;

  var ta = $('#f-body');

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

  function pushHist() {
    clearTimeout(histTimer);
    var top = hist[hist.length - 1];
    if (top && top.v === ta.value) {
      syncHistButtons();
      return;
    }
    hist = hist.slice(0, histIdx + 1);
    hist.push({ v: ta.value, s: ta.selectionStart, e: ta.selectionEnd });
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
    ta.focus();
    refreshPreview();
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
        body: $('#f-body').value,
      },
    })
      .then(function () {
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
      var name = delBtn.dataset.del;
      confirmModal('删除图片', '确定删除 ' + name + ' 吗？正在使用它的文章会显示裂图。', '删除').then(function (yes) {
        if (!yes) return;
        api('DELETE', 'media', { query: { name: name } })
          .then(function () {
            toast('已删除');
            renderMedia();
          })
          .catch(function (err) {
            toast(err.message, true);
          });
      });
    }
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

function uploadFiles(files) {
  if (!files.length) return;
  toast('正在压缩并上传 ' + files.length + ' 张图片……');
  var chain = Promise.resolve();
  files.forEach(function (f) {
    chain = chain
      .then(function () {
        return compressImage(f);
      })
      .then(function (img) {
        return api('POST', 'media', { body: img });
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
if (loggedIn()) {
  api('GET', 'session').catch(function () {});
}
nav();
