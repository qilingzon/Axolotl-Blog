# HANDOFF —— 交接文档（blog / 美西螈池塘）

> 新会话开场白：「读取本文件，继续 <当前任务>」。每次收尾随手更新。

## 当前状态

- 工程：D:\zcodework\blog / Astro 5.18.2 纯静态博客 / 主题：Minecraft 紫粉美西螈
- 后台易用性（2026-10-24，bab32a9）：针对小白反馈——仪表盘三张统计卡改可点击（文章→全部 / 标签→按标签筛选 / 草稿→只看草稿，a.stat 悬停浮起）；文章页新增「只看草稿」勾选（renderPosts(mode)，#/posts/draft 直达并勾选）；编辑器工具栏 H2/H3/B/I 改全中文（标题/小标题/加粗/斜体…）+ 右侧「小白须知：先选中文字再点按钮 · 写错了点 ↩ 回退」。真实点击走查 + 三主题（pink-soft/purple-pixel/lumen-cave）×（仪表盘/编辑器）截图验收通过；线上 bab32a9 已部署复验。白屏修复 1900b10：/admin 无尾斜杠时 ./app.js 相对路径 404 → 全部改 /admin/ 绝对路径
- 进度：**阶段 1-5 ✅ + 吉祥物家族/加载动画/搜索/移动端 ✅ + 美西螈 CMS（EdgeOne Pages 版）✅**
  - **美西螈 CMS**：`public/admin/`（全中文三主题 SPA）+ `edge-functions/api/[[default]].js`（登录鉴权 + GitHub 代理；出站白名单仅 api.github.com；HMAC 签名 token 12h；连续错 5 次锁 15 分钟）+ `scripts/cms-dev.mjs`（本地环境 8090，`.env.local` 供凭据已 gitignore）。Sveltia 已移除，部署指南见 README-CMS.md（EdgeOne 控制台接仓库 + CMS_USERNAME/PASSWORD/SESSION_SECRET/GITHUB_TOKEN 四个环境变量）
  - CMS 走查与修复（2026-10-25）：全功能 UI 走查后修掉两个 🔴——媒体库全局委托改为启动时绑一次（原每次渲染叠加导致重复上传/弹窗叠层，`bindMediaDelegates`）；编辑器未保存保护（脏状态跟踪 + nav 路由拦截 `editorGuard`/`restoringHash` + beforeunload，保存/删除成功后放行）。已验：留下内容不丢、确认走放行、干净态不拦、保存删除不拦、粘贴只传一张、弹窗单层。遗留 🟡：预览标题层级比线上深一级、后台搜索不搜正文、列表 N+1 API、防爆破无备用路径、欢迎语固定 admin、图片按钮占位符整体替换、标题/摘要不在撤销栈、删除无回收站
  - CMS 遗留清理（2026-10-24，真实输入走查+三主题截图已过）：🟡 全清——① 列表 N+1 消除：REST 目录列表实测不返回 content，改用 `ghGraphQL` 一次查询取回全部文章正文+oid（端点仍 api.github.com，白名单不变），GraphQL 失败自动回退 REST 逐篇；② 列表响应带 body → 后台搜索支持正文全文；③ 登录失败文案预告剩余次数（第 5 次直接报锁定）；④ 确认弹窗支持 Esc 取消（confirmModal 统一 done()）；⑤ 预览标题层级对齐线上（## → h2，去 +1），补 `.md-body h1`/`h4` 字号；⑥ 欢迎语用真实用户名（登录取表单值 + session 校验时刷新）；⑦ 删图前引用检查（扫列表 body 含草稿，被引用弹「图片正在使用」强警告，列表拿不到则退回普通确认）。更正上轮误记：媒体工具栏没有「占位符整体替换」按钮（编辑器的图片按钮是正常插入语法）。仍不做：撤销栈扩展（未保存保护已兜底）、回收站（git 历史即回收站）、改名两步非原子（单用户低风险，记为已知限制）；锁定无备用路径维持原样（重启/重新部署即清，见 README-CMS.md）。已部署：rebase 远程 CMS 提交后推 master（7b1f1c0），EdgeOne 自动构建
  - 部署傻瓜化（2026-10-24）：`scripts/cms-setup.mjs` 一键配置向导——问答生成全部环境变量、gh 自动取令牌并**真实验证读写权限**（无 gh 时给预填 scopes=repo 的直链手办，假令牌/无写权限都会被拦）、`.env.local` 覆盖需确认（默认保留不动）、Ctrl+C/断流有明确提示不静默退出；README-CMS.md 重写为小白教学（3 步照点 + 每步「到这里你应该看到」+ 按症状查 FAQ + 技术参考沉底）。测试：主路径（gh 令牌真实验证）/降级分支（PATH 隐藏 gh + 假令牌 401）全过，两次运行前后 .env.local md5 一致。坑：readline 管道喂多行输入有 EOF 竞态（挂起 question 静默退出），测试须逐行延迟喂入；真实用户 TTY 交互不受影响
  - 草稿功能：schema `draft` 字段，前台首页/列表/getStaticPaths/搜索四处过滤（已验证）
  - CMS E2E 已验证（cms-test 分支真实读写后清理）：登录对错/401/防爆破、文章 CRUD、改名迁移、媒体上传删除、中文 commit、UTF-8 全链路无损。**坑：Git Bash curl 命令行传中文会 GBK 乱码，测试 JSON 必须用 `--data-binary @文件`；ghFetch 段内斜杠先拆分再编码（repo 名含 `/`）；onRequest 里 async 处理器必须 await，否则 rejection 绕过 try/catch**
  - wiki 核对结论（minecraft.wiki）：官方五色 = lucy 粉 / wild 棕 / gold 金 / cyan 青·**粉鳃** / blue 蓝（gold 是正式变体非废案）；唯一未进游戏的官方色是 **green 绿**（Minecraft Live 2020 预告片后被砍）→ 已作为彩蛋成员加入
  - 七色家族：pink=启动器原图；purple 紫二创；wild/cyan/gold/blue 采样自 1.18.jar 官方贴图（cyan 用鳃部独立色带还原粉鳃）；green 手调色板。生成器 `scripts/generate-variants.mjs` 支持 `gill` 色带。展示位：关于页住民五只（汽水/焦糖/栗子/蓝图/抹茶）、404 七只、文章卡片 accent 轮换、加载层粉/紫
  - 加载界面（splash）：七色美西螈轮换——七张变体图同位叠加，纯 CSS 交叉淡入（周期 2.8s、每色槽 0.4s）+ 摆尾 + 水泡 + 方块进度条 + 「正在游向池塘」；**每张图的 cycle 负延迟对准自己色槽淡入完成的时刻**，渲染时钟被节流冻结时也恰有一只完整可见（IAB 遮挡面板会冻结动画时钟，这是踩过的坑）；load 后最少展示 0.7s 淡出（3s 兜底，prefers-reduced-motion 停轮换只显粉螈）；sessionStorage `axo-splash-seen` 会话内只展示一次
  - hero 双螈（首页）：**每次访问随机两只、停留期间颜色稳定**——`<head>` 引导脚本首帧前随机写 `html[data-hero-big/small]`（两只必不同色），global.css 按 data 属性点亮对应一张；无 JS 兜底粉螈。曾做过连续轮换版（AxolotlCycle）被用户否决（"闪来闪去看瞎眼"），组件已删，勿回退
  - 踩坑：Astro 组件里 `<style set:html={...}>` 不会输出（插值 style 不支持），动态规则要写 global.css 或 `<style is:inline>`
  - 吉祥物来源：Axolotl Launcher（D:\AxolotlLauncher）应用图标，`PrivateExtractIcons` 提取 256×256 版本，裁掉透明边距后放 `public/assets/axolotl-launcher.png`（256×191）；紫色变体 = CSS `hue-rotate(-55deg)`，无独立位图
  - 提取中间产物在 design-assets/（已 gitignore）：75 张 webp 是启动器内嵌的群系悬浮岛图标（与美西螈无关），JPEG 是 UI 截图，唯一美西螈形象就是 exe 图标
- 下一步：可选扩展——RSS、标签页、评论系统、"繁茂洞穴"绿色主题
- 未提交的工作区改动及原因：无

## 已验证的流程配方

- 构建：`npm run build`（10 页，退出码 0）
- 本地预览：`npm run preview`（http://localhost:4321）
- 无头截图：`msedge --headless=new --user-data-dir=<独立临时目录> --window-size=W,H --virtual-time-budget=6000 --screenshot=<绝对路径> "<url>"`（连续截多张必须换 user-data-dir，否则静默失败；file:// 页面会被挡，需走本地 HTTP）
- 从 exe 提取大图标：PowerShell `PrivateExtractIcons`（extract-icon.ps1 在 design-assets/）
- 主题预览链接：任意页加 `?theme=pink-soft|purple-pixel|lumen-cave`（优先于 localStorage，不写入）
- 程序化布局验收：IAB tab evaluate 检查 `scrollWidth-clientWidth` 溢出 + 关键元素 rect
- 备份：项目根目录 `bash backup.sh` → git bundle 到 D:\zcodework\_backups\

## 踩坑清单（新会话重读一遍）

- **主题变量必须写 `:root[data-theme='x']`**：裸 `:root` 与 `[data-theme]` 特异性相同，打包后顺序不可控会互相覆盖（已修复，勿回退）。
- **IAB 后台标签页 CSS transition 会被节流暂停**：computed style 停在过渡起点，看起来像"主题切换失效"假象；测试时先 `visibility.set(true)` 或临时禁用 transition 再读值。
- IAB `tab.screenshot()` 可能反复 surface preparation timeout：改用系统 Edge 无头截图（见上）。
- **看图链路**：Read 本地图片 → CDN URL 带未编码路径（坏）；可行链路 = `nodeRepl.emitImage(本地字节)` → 拿干净 CDN URL → `analyze_image` 分析。image-vision 的 config.json 已修 base_url 拼写（minnimax→api.minimax）+ model 换 MiniMax-VL-01，但 key 401，**待用户自查**。
- PowerShell 数组字面量 `@(@(a,b),...)` 会被展平、函数返回数组会被管道展开——HSL 逐像素变换别用 PowerShell 写，用 CSS filter 或 node。
- **preview 服务器别用后台 Bash 任务跑**（stdin 关闭后 astro preview 会静默退出，exit 1 且日志无错误）；`nohup ... &` 也会随后台会话清理而死。**最终方案：PowerShell 独立进程** `powershell -Command 'Start-Process -WindowStyle Hidden node -ArgumentList "node_modules\astro\astro.js","preview","--port","4321" -WorkingDirectory "D:\zcodework\blog" -RedirectStandardOutput "preview.log" -RedirectStandardError "preview.err.log"'`（已验证稳定）。
- 移动端顶栏：≤860px 双行布局（logo+站名/色点按钮一行，导航三项等宽居中一行），断点在 global.css 响应式区；>860px 恢复单行。
- WebView2 (EBWebView) 的 Default/Cache 里可能没有 UI 图片缓存，别指望从那里挖资源。

## 其他

- 三主题：pink-soft（默认）/ purple-pixel / lumen-cave；切换按钮事件委托在 BaseLayout，`<head>` 内联脚本防闪烁（支持 ?theme= 参数）。
- 像素字体：@fontsource/fusion-pixel-12px-proportional-sc（本地打包，零 CDN 依赖）。
- 美术：吉祥物 = 启动器图标位图（用户指定，唯一位图例外）；其余装饰为内联 SVG/CSS；favicon.png 同源图标。
- 验收证据：screenshots/*.png（初版 9 张 + mascot-* 4 张启动器形象版）。
