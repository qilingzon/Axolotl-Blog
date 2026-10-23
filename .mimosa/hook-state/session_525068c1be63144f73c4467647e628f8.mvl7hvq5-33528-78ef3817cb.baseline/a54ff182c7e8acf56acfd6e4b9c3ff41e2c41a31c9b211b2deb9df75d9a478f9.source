# 项目纪律（blog）

> 领域特有规则写在这里。通用纪律见用户级 `~/.zcode/AGENTS.md`（事实源判定/回合纪律/重试熔断/破坏性操作确认/验收即宪法/git 纪律/备份），对所有项目自动生效。

- 美西螈像素 SVG 组件（`src/components/Axolotl.astro`）是全站视觉核心，改动配色需同时检查三个主题（pink-soft / purple-pixel / lumen-cave）下的呈现。
- 主题切换必须持久化（localStorage），且 `<head>` 内联引导脚本防闪烁逻辑不能移除。
- 所有视觉改动完成后必须开 preview 截图过目（3 主题 × 关键页），截图作为验收证据。
- 站点零外部图片依赖：美术一律内联 SVG/CSS，新增图片资源需先征得同意。
- 文章内容放 `src/content/blog/*.md`，frontmatter 遵循 `src/content.config.ts` 的 schema。
