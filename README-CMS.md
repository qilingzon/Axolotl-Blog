# 美西螈 CMS 部署指南（EdgeOne Pages）

全中文内容管理后台，账号密码登录，发布 = 自动 commit 到 GitHub 仓库并触发站点构建。

## 一、它由什么组成

| 部分 | 位置 | 说明 |
|---|---|---|
| 管理界面 | `public/admin/`（访问 `/admin/`） | 纯静态单页应用，与博客同款三主题 |
| API 后端 | `edge-functions/api/[[default]].js` | EdgeOne Pages 边缘函数：登录鉴权 + GitHub 读写代理 |
| 本地调试 | `scripts/cms-dev.mjs` | Node 起本地环境（静态站 + 同源 API） |

## 二、EdgeOne 控制台部署步骤

1. **创建项目**：EdgeOne Pages → 创建项目 → 接入 GitHub 仓库 `qilingzon/Axolotl-Blog`
   - 构建命令：`npm run build`
   - 输出目录：`dist`
   - 生产分支：`master`
2. **配置环境变量**（项目设置 → 环境变量，逐个添加）：

| 变量名 | 值 | 说明 |
|---|---|---|
| `CMS_USERNAME` | 你的登录用户名 | |
| `CMS_PASSWORD` | 你的登录密码 | |
| `CMS_SESSION_SECRET` | 一串随机字符 | 签名登录令牌的密钥，可用 `openssl rand -hex 24` 生成 |
| `CMS_GITHUB_TOKEN` | GitHub 访问令牌 | 本机可直接用 `gh auth token` 的输出；或 GitHub → Settings → Developer settings → Fine-grained tokens 新建（只勾选本仓库的 Contents 读写权限） |

3. 保存后重新部署一次即可。访问 `https://你的域名/admin/` 开始使用。

> 未配置环境变量时，登录接口会返回中文提示，不会泄露任何信息。
> `CMS_REPO` / `CMS_BRANCH` 为可选覆盖项（默认 `qilingzon/Axolotl-Blog` / `master`），本地测试时用它指向测试分支。

## 三、本地调试

```bash
# 1. 准备 .env.local（已被 gitignore，勿提交）：
#    CMS_USERNAME / CMS_PASSWORD / CMS_SESSION_SECRET / CMS_GITHUB_TOKEN / CMS_BRANCH=测试分支
# 2. 构建并启动本地环境（http://localhost:8090/admin/）
npm run build
node scripts/cms-dev.mjs
```

## 四、功能清单

- **登录**：账号密码（环境变量校验），连续错 5 次锁 15 分钟，登录态保持 12 小时
- **仪表盘**：文章/标签/草稿统计 + 最近文章
- **文章**：搜索、标签筛选、新建、编辑、改名（改文件名自动迁移）、删除
- **编辑器**：Markdown 工具栏、**回退/恢复（Ctrl+Z / Ctrl+Y，输入与工具栏插入统一可撤销）**、分屏实时预览（预览区可切三主题）、七色美西螈卡片配色选择、草稿开关
- **草稿**：保存为草稿的文章不出现在前台（首页/列表/搜索/直链全过滤）
- **媒体库**：拖拽/选择/粘贴上传，浏览器端自动压缩（长边 1600px、目标 ≤900KB），复制 Markdown 引用，删除
- **发布记录**：所有写操作以中文 commit message 记录在仓库（如「CMS: 更新《标题》」）

## 五、安全要点

- GitHub 令牌只存在 EdgeOne 环境变量里，浏览器永远接触不到
- API 出站请求硬编码白名单：仅允许 `https://api.github.com`
- 所有接口（除登录）需携带签名令牌；密码比较使用常数时间算法
- `/admin/` 页面带 `noindex`，不会被搜索引擎收录
