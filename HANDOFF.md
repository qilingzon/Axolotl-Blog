# HANDOFF —— 交接文档（blog / 美西螈池塘）

> 新会话开场白：「读取本文件，继续 <当前任务>」。每次收尾随手更新。

## 当前状态

- 工程：D:\zcodework\blog / Astro 5.18.2 纯静态博客 / 主题：Minecraft 紫粉美西螈
- 进度：**阶段 1-5 全部完成 ✅**（commit: init / feat 三主题+页面 / 验收收尾）
- 下一步：可选扩展——RSS、标签页、评论系统、"繁茂洞穴"绿色主题
- 未提交的工作区改动及原因：无

## 已验证的流程配方

- 构建：`npm run build`（10 页，退出码 0）
- 本地预览：`npm run preview`（http://localhost:4321）
- 无头截图：`msedge --headless=new --user-data-dir=<独立临时目录> --window-size=W,H --virtual-time-budget=6000 --screenshot=<绝对路径> "<url>"`（连续截多张必须换 user-data-dir，否则静默失败）
- 主题预览链接：任意页加 `?theme=pink-soft|purple-pixel|lumen-cave`（优先于 localStorage，不写入）
- 程序化布局验收：IAB tab evaluate 检查 `scrollWidth-clientWidth` 溢出 + 关键元素 rect
- 备份：项目根目录 `bash backup.sh` → git bundle 到 D:\zcodework\_backups\

## 踩坑清单（新会话重读一遍）

- **主题变量必须写 `:root[data-theme='x']`**：裸 `:root` 与 `[data-theme]` 特异性相同，打包后顺序不可控会互相覆盖（已修复，勿回退）。
- **IAB 后台标签页 CSS transition 会被节流暂停**：computed style 停在过渡起点，看起来像"主题切换失效"假象；测试时先 `visibility.set(true)` 或临时禁用 transition 再读值。
- IAB `tab.screenshot()` 可能反复 surface preparation timeout：改用系统 Edge 无头截图（见上）。
- `analyze_image` MCP 无法访问本地文件/localhost URL；image-vision vision.ps1 的 config.json 原域名拼写错误已修（minnimax→api.minimax + model 换 MiniMax-VL-01），但 API key 401 未授权，**需用户自查 key**。
- Windows 路径含反斜杠时 host CDN 上传 URL 不编码，Read 工具读图收不到视觉内容（环境问题，非项目问题）。

## 其他

- 三主题：pink-soft（默认）/ purple-pixel / lumen-cave；切换按钮事件委托在 BaseLayout，`<head>` 内联脚本防闪烁。
- 像素字体：@fontsource/fusion-pixel-12px-proportional-sc（本地打包，零 CDN 依赖）。
- 零位图图片：全部美术为 Axolotl.astro 矩阵像素画 SVG + favicon.svg。
- 验收证据：screenshots/*.png（9 张：三主题首页、列表、文章、关于、404、移动端×2）+ 程序化检查记录（桌面 7 页 / 移动 5 页均无溢出无重叠）。
