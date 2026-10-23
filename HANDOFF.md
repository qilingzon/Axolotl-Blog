# HANDOFF —— 交接文档（blog / 美西螈池塘）

> 新会话开场白：「读取本文件，继续 <当前任务>」。每次收尾随手更新。

## 当前状态

- 工程：D:\zcodework\blog / Astro 5.18.2 纯静态博客 / 主题：Minecraft 紫粉美西螈
- 进度：**阶段 1-5 完成 ✅ + 启动器吉祥物 ✅ + 加载界面 ✅ + 七色美西螈家族（官方全色 + wiki 核对）✅**
  - wiki 核对结论（minecraft.wiki）：官方五色 = lucy 粉 / wild 棕 / gold 金 / cyan 青·**粉鳃** / blue 蓝（gold 是正式变体非废案）；唯一未进游戏的官方色是 **green 绿**（Minecraft Live 2020 预告片后被砍）→ 已作为彩蛋成员加入
  - 七色家族：pink=启动器原图；purple 紫二创；wild/cyan/gold/blue 采样自 1.18.jar 官方贴图（cyan 用鳃部独立色带还原粉鳃）；green 手调色板。生成器 `scripts/generate-variants.mjs` 支持 `gill` 色带。展示位：关于页住民五只（汽水/焦糖/栗子/蓝图/抹茶）、404 七只、文章卡片 accent 轮换、加载层粉/紫
  - 加载界面（splash）：进入站点时美西螈摆尾 + 水泡上浮 + Minecraft 方块进度条 + 「正在游向池塘」；页面 load 后最少展示 0.7s 淡出（3s 兜底，prefers-reduced-motion 跳过最短展示）；sessionStorage `axo-splash-seen` 会话内只展示一次；展示哪只螈由 `<head>` 引导脚本按主题映射（pink-soft→粉 / purple-pixel→紫 / lumen-cave→每次随机），标记为 `html[data-splash]`
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
- WebView2 (EBWebView) 的 Default/Cache 里可能没有 UI 图片缓存，别指望从那里挖资源。

## 其他

- 三主题：pink-soft（默认）/ purple-pixel / lumen-cave；切换按钮事件委托在 BaseLayout，`<head>` 内联脚本防闪烁（支持 ?theme= 参数）。
- 像素字体：@fontsource/fusion-pixel-12px-proportional-sc（本地打包，零 CDN 依赖）。
- 美术：吉祥物 = 启动器图标位图（用户指定，唯一位图例外）；其余装饰为内联 SVG/CSS；favicon.png 同源图标。
- 验收证据：screenshots/*.png（初版 9 张 + mascot-* 4 张启动器形象版）。
