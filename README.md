# 美西螈池塘 🦎

个人博客：纯静态 [Astro](https://astro.build) 站点 + 自研「美西螈 CMS」全中文内容后台，三套主题（粉螈·奶油 / 紫螈·像素 / 荧光洞窟），七色美西螈吉祥物。

## 写文章（日常）

1. 打开线上后台 `https://你的域名/admin/`，账号密码登录
2. 写标题、正文（Markdown），配图直接拖拽/粘贴，点「发布」
3. 约 1 分钟后自动上线——发布 = 自动 commit 到本仓库并触发 EdgeOne 构建，没有别的步骤

## 部署后台到 EdgeOne（一次性）

跟着走就行，**不用终端、手机浏览器也能完成**：**[部署教学（小白版）](README-CMS.md)**。核心是网站自带的「部署助手」页面（`你的域名/admin/setup.html`），点几下生成全部环境变量。

喜欢命令行的话也可以跑等价的终端向导：

```bash
node scripts/cms-setup.mjs
```

## 本地开发

```bash
npm install
npm run dev        # 本地预览站点
npm run build      # 构建到 dist/
node scripts/cms-dev.mjs   # 本地 CMS 环境（http://localhost:8792/admin/）
```

## 目录速览

| 路径 | 是什么 |
|---|---|
| `src/content/blog/` | 文章（Markdown，frontmatter 见 `src/content.config.ts`） |
| `src/pages/` · `src/components/` | 站点页面与组件 |
| `public/admin/` | CMS 后台（零依赖单页应用） |
| `edge-functions/api/` | CMS 的边缘函数 API（登录 + GitHub 代理，出站白名单仅 api.github.com） |
| `scripts/` | 本地环境、配置向导、吉祥物变体生成等脚本 |
| `HANDOFF.md` | 项目状态与交接记录 |
