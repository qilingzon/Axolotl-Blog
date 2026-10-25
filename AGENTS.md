# 项目纪律（blog）

> 领域特有规则写在这里。通用纪律见用户级 `~/.zcode/AGENTS.md`（事实源判定/回合纪律/重试熔断/破坏性操作确认/验收即宪法/git 纪律/备份），对所有项目自动生效。

- 美西螈吉祥物组件（`src/components/Axolotl.astro`）是全站视觉核心：粉色为 Axolotl Launcher 应用图标原图（`public/assets/axolotl-launcher.png`，用户指定），其余六色变体（紫二创 / wild 棕 / cyan 青·粉鳃 / gold 金 / blue 蓝 / green 预告片彩蛋）由 `node scripts/generate-variants.mjs` 按官方贴图采样色板重上色生成——改色先改脚本里的 RAMPS 再重新生成，不要手改位图、不要引入 CSS 滤镜方案。改动需同时检查三个主题（pink-soft / purple-pixel / lumen-cave）下的呈现。
- 除吉祥物资源外，站点零外部图片依赖：其余美术一律内联 SVG/CSS，新增图片资源需先征得同意。
- 主题切换必须持久化（localStorage），且 `<head>` 内联引导脚本防闪烁逻辑不能移除。
- 所有视觉改动完成后必须开 preview 截图过目（3 主题 × 关键页），截图作为验收证据。
- 美西螈 CMS（`public/admin/` + `edge-functions/api/[[default]].js`）：全中文界面，改动需同步检查三主题；API 出站白名单（仅 api.github.com）与端点白名单表（app.js 的 ENDPOINTS）是安全底线，不得放宽。本地调试用 `node scripts/cms-dev.mjs`。**`.env.local` 存放登录凭据与 GitHub 令牌：任何会话不得读取、打印、复制其内容到聊天、日志或网络，不得提交仓库或硬编码进代码；确需更换凭据由用户自行编辑该文件。**
- 文章内容放 `src/content/blog/*.md`，frontmatter 遵循 `src/content.config.ts` 的 schema（CMS 保存时会按 schema 序列化，改字段要同步 CMS 表单与 API 的 normalizeMeta）。
- **git push 常设授权（2026-10-25 用户授予）**：每个任务 commit 完成后直接 push 到 origin，不必再问；推送前仍须满足通用纪律（build/测试先过）。适用于本仓库与 Axolotl-CMS 独立仓库。
- **`cms-test` 是用户本地演示的常设分支**（`.env.local` 指向它）：任何会话测试后都不得删除，删了用户本地后台就会"池塘还空着/读不到分支"。测试请自建 `cms-selftest-*` 等一次性分支，测完删自己的。
