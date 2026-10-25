// 美西螈 CMS 一键配置向导（小白版）
// 用法：node scripts/cms-setup.mjs
// 问答式生成部署所需的 4 个环境变量：账号密码自定、密钥自动生成、令牌自动检测（无 gh 时给直链手办），
// 并自动写入本地 .env.local（已存在则先确认，默认保留不动）。
import { createInterface } from 'node:readline/promises';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_DEFAULT = 'qilingzon/Axolotl-Blog';
const BRANCH_DEFAULT = 'master';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => rl.question(q);
const hr = () => console.log('-'.repeat(56));

// 中途 Ctrl+C / 输入流断开时给出明确提示，而不是静默退出
let finished = false;
rl.on('close', () => {
  if (!finished) {
    console.log('\n\n❌ 已取消：输入被中断，未更改任何文件。可重新运行：node scripts/cms-setup.mjs');
    process.exit(1);
  }
});

function die(msg) {
  console.log('\n❌ ' + msg);
  console.log('已取消，未更改任何文件。可重新运行：node scripts/cms-setup.mjs');
  rl.close();
  process.exit(1);
}

function maskToken(t) {
  return t.slice(0, 7) + '…' + t.slice(-4);
}

/** 验证令牌：能读仓库且具备写入权限（permissions.push）才放行 */
async function checkToken(token, repo) {
  const [owner, name] = repo.split('/');
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'axolotl-cms-setup' },
    });
    if (res.status === 401) return { ok: false, msg: '令牌无效或已过期（GitHub 返回 401）' };
    if (res.status === 404) return { ok: false, msg: `令牌访问不到仓库 ${repo}（可能没勾本仓库权限）` };
    if (!res.ok) return { ok: false, msg: `GitHub 返回 ${res.status}，稍后再试` };
    const data = await res.json();
    if (data.permissions && data.permissions.push) return { ok: true };
    return { ok: false, msg: '令牌只能读不能写（创建时漏勾 repo 权限），CMS 保存会失败' };
  } catch (e) {
    return { ok: false, msg: '网络错误：' + (e && e.message) };
  }
}

async function getToken(repo) {
  let token = '';
  try {
    token = execSync('gh auth token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    token = '';
  }
  if (token) {
    console.log(`\n检测到本机 GitHub CLI ✓，已自动取到令牌（${maskToken(token)}）`);
    console.log('正在验证它能否读写 ' + repo + ' ……');
    const r = await checkToken(token, repo);
    if (r.ok) {
      console.log('✓ 令牌可用，读写都没问题');
      return token;
    }
    console.log('⚠ 这个令牌不能用：' + r.msg);
    console.log('改为手动粘贴一个新令牌。');
  } else {
    console.log('\n本机没有检测到 GitHub CLI，改用手动方式。');
  }
  console.log('\n【手动获取令牌·照做即可】');
  console.log(' 1. 用浏览器打开下面这个链接（已帮你勾好权限）：');
  console.log('    https://github.com/settings/tokens/new?scopes=repo&description=Axolotl-CMS');
  console.log(' 2. 拉到页面最底部，点绿色按钮「Generate token」');
  console.log(' 3. 复制生成的令牌（ghp_ 开头一长串），粘贴到下面：');
  for (let i = 1; i <= 3; i++) {
    const t = (await ask(`\n粘贴令牌（第 ${i}/3 次机会）：`)).trim();
    if (!t) continue;
    console.log('正在验证……');
    const r = await checkToken(t, repo);
    if (r.ok) {
      console.log('✓ 令牌可用！');
      return t;
    }
    console.log('⚠ ' + r.msg);
  }
  die('连续 3 次令牌验证失败。');
}

async function main() {
  console.log('🐟 美西螈 CMS 一键配置向导');
  hr();
  console.log('这个脚本帮你准备部署所需的 4 个环境变量（共 4 步，约 2 分钟）：');
  console.log(' 1. 定后台登录的用户名和密码（你自己定）');
  console.log(' 2. 自动生成登录密钥');
  console.log(' 3. 自动检测 / 引导你拿一个 GitHub 令牌（CMS 靠它帮你存文章）');
  console.log(' 4. 写好本地配置 + 打印「要粘贴到 EdgeOne 的 4 行」');

  // [1/4] 用户名
  let username = '';
  while (!username) {
    const v = (await ask('\n[1/4] 给后台起个用户名（建议字母数字，直接回车 = axolotl-admin）：')).trim();
    username = v || 'axolotl-admin';
    if (/\s/.test(username)) {
      console.log('⚠ 用户名不能带空格，重新输一个');
      username = '';
    }
  }

  // [2/4] 密码
  let password = '';
  while (true) {
    const v = (await ask('\n[2/4] 设置登录密码（至少 8 位，建议字母+数字，输入时可见，输完自己核对）：')).trim();
    if (v.length < 8) {
      console.log('⚠ 不足 8 位，再想一个长一点的');
      continue;
    }
    if (/\s/.test(v)) {
      console.log('⚠ 密码不能带空格（避免粘贴到 EdgeOne 时出错）');
      continue;
    }
    password = v;
    break;
  }
  console.log(`  你的密码是：${password}（待会儿登录后台要用，记到安全的地方）`);

  // 仓库与分支（直接回车走默认）
  hr();
  const repo = (await ask(`\n仓库（直接回车 = ${REPO_DEFAULT}）：`).catch(() => '')) || REPO_DEFAULT;
  const branch = (await ask(`分支（直接回车 = ${BRANCH_DEFAULT}）：`).catch(() => '')) || BRANCH_DEFAULT;
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) die('仓库名格式应为 用户名/仓库名');

  // [3/4] 令牌
  hr();
  const token = await getToken(repo);

  // [4/4] 写 .env.local
  hr();
  const secret = randomBytes(24).toString('hex');
  const envText = [
    `CMS_USERNAME=${username}`,
    `CMS_PASSWORD=${password}`,
    `CMS_SESSION_SECRET=${secret}`,
    `CMS_GITHUB_TOKEN=${token}`,
    `CMS_REPO=${repo}`,
    `CMS_BRANCH=${branch}`,
    '',
  ].join('\n');
  const envPath = join(ROOT, '.env.local');
  let wrote = false;
  if (existsSync(envPath)) {
    console.log('\n[4/4] 本地配置 .env.local 已存在（可能是你之前的本地调试配置）。');
    const yn = (await ask('      覆盖它吗？覆盖请输 y，其他任何键 = 保留不动（只打印）：')).trim().toLowerCase();
    if (yn === 'y') {
      writeFileSync(envPath, envText);
      wrote = true;
      console.log('✓ 已覆盖写入 .env.local');
    } else {
      console.log('✓ 好，.env.local 保持原样没动。');
    }
  } else {
    writeFileSync(envPath, envText);
    wrote = true;
    console.log('\n[4/4] ✓ 已写入 .env.local（本地试用用，已被 gitignore，不会进仓库）');
  }

  // 输出 EdgeOne 粘贴块
  hr();
  console.log('\n🎉 配置完成！下一步去 EdgeOne 控制台，把下面 4 条逐一添加为环境变量：\n');
  console.log('┌─ 复制这 4 行（变量名 = 值）──────────────');
  console.log(`│ CMS_USERNAME = ${username}`);
  console.log(`│ CMS_PASSWORD = ${password}`);
  console.log(`│ CMS_SESSION_SECRET = ${secret}`);
  console.log(`│ CMS_GITHUB_TOKEN = ${token}`);
  console.log('└──────────────────────────────');
  console.log('\n⚠ 里面有密码和令牌：别发别人、别截图外传。');
  if (!wrote) console.log('（提示：本地 .env.local 是旧配置，想更新可重跑本脚本）');
  console.log('\n接下来：打开 README-CMS.md 跟着「第 1 步」继续，共 3 步，约 10 分钟。');
  console.log('想在本地先试试？npm run build && node scripts/cms-dev.mjs → http://localhost:8090/admin/');
  finished = true;
  rl.close();
}

main().catch(() => die('输入中断。'));
