// 美西螈 CMS 纯函数回归测试（无网络、无凭据，CI/本地均可跑）
// 用法：npm test
// 覆盖：frontmatter 解析/序列化往返、normalizeMeta 防线（坏日期/坏 accent/超量标签/超长标题）
import assert from 'node:assert/strict';

const mod = await import('../edge-functions/api/[[default]].js');
const { parseFrontmatter, serializeFrontmatter, normalizeMeta, normalizeDate, parseScalar } = mod;

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log('PASS ' + name);
  } catch (e) {
    fail++;
    console.log('FAIL ' + name + ' :: ' + (e && e.message));
  }
}

// ---------- normalizeDate：日期防线 ----------

t('normalizeDate 合法 ISO 原样保留', () => {
  assert.equal(normalizeDate('2026-10-25T10:00:00.000Z'), '2026-10-25T10:00:00.000Z');
});

t('normalizeDate 垃圾字符串落回当前时间', () => {
  const out = normalizeDate('not-a-date');
  assert.ok(!isNaN(new Date(out).getTime()));
});

t('normalizeDate 缺失落回当前时间', () => {
  assert.ok(!isNaN(new Date(normalizeDate(undefined)).getTime()));
});

t('normalizeDate 日期-only 归一为 ISO', () => {
  assert.equal(normalizeDate('2026-10-08'), '2026-10-08T00:00:00.000Z');
});

// ---------- normalizeMeta：防线逐项 ----------

t('normalizeMeta 坏 pubDate 被拦截', () => {
  const m = normalizeMeta({ title: 'x', pubDate: 'garbage' });
  assert.ok(!isNaN(new Date(m.pubDate).getTime()));
});

t('normalizeMeta 坏 accent 落回 pink', () => {
  assert.equal(normalizeMeta({ accent: 'rainbow' }).accent, 'pink');
});

t('normalizeMeta 标签超 8 个截断', () => {
  const tags = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  assert.equal(normalizeMeta({ tags }).tags.length, 8);
});

t('normalizeMeta 标题超 120 字截断', () => {
  assert.equal(normalizeMeta({ title: '好'.repeat(200) }).title.length, 120);
});

t('normalizeMeta draft 只认布尔真', () => {
  assert.equal(normalizeMeta({ draft: 'yes' }).draft, false);
  assert.equal(normalizeMeta({ draft: 1 }).draft, false);
  assert.equal(normalizeMeta({ draft: true }).draft, true);
});

// ---------- parseScalar ----------

t('parseScalar 布尔与空数组', () => {
  assert.equal(parseScalar('true'), true);
  assert.equal(parseScalar('false'), false);
  assert.deepEqual(parseScalar('[]'), []);
});

t('parseScalar 引号字符串', () => {
  assert.equal(parseScalar("'hello'"), 'hello');
  assert.equal(parseScalar('"double"'), 'double');
});

// ---------- parseFrontmatter ----------

t('parseFrontmatter 标准文档', () => {
  const { meta, body } = parseFrontmatter(
    "---\ntitle: '你好'\ndescription: ''\npubDate: 2026-10-25T10:00:00.000Z\ntags: ['技术', '建站']\naccent: purple\ndraft: false\n---\n\n## 标题\n\n正文\n"
  );
  assert.equal(meta.title, '你好');
  assert.deepEqual(meta.tags, ['技术', '建站']);
  assert.equal(meta.accent, 'purple');
  assert.equal(meta.draft, false);
  assert.equal(body, '## 标题\n\n正文\n');
});

t('parseFrontmatter 无 frontmatter 时正文原样', () => {
  const { meta, body } = parseFrontmatter('只有正文，没有头部\n');
  assert.deepEqual(meta, {});
  assert.equal(body, '只有正文，没有头部\n');
});

t('parseFrontmatter 值里带冒号不截断', () => {
  const { meta } = parseFrontmatter("---\ntitle: '时间: 下午三点'\n---\n正文\n");
  assert.equal(meta.title, '时间: 下午三点');
});

// ---------- 序列化 ↔ 解析 往返 ----------

t('serialize → parse 往返保真（引号/冒号/中文标签）', () => {
  const meta = normalizeMeta({
    title: "池塘笔记: 今天's 日志",
    description: '含 单引号\' 与 : 冒号',
    pubDate: '2026-10-25T10:00:00.000Z',
    tags: ['技术', '随笔', "quote's"],
    accent: 'cyan',
    draft: true,
  });
  const text = serializeFrontmatter(meta, '正文\n');
  const back = parseFrontmatter(text);
  const nb = normalizeMeta(back.meta);
  assert.equal(nb.title, meta.title);
  assert.equal(nb.description, meta.description);
  assert.equal(nb.pubDate, meta.pubDate);
  assert.deepEqual(nb.tags, meta.tags);
  assert.equal(nb.accent, meta.accent);
  assert.equal(nb.draft, meta.draft);
  assert.equal(back.body, '正文\n');
});

t('serializeFrontmatter 正文原样保留（不二次加工）', () => {
  const text = serializeFrontmatter(normalizeMeta({ title: 't' }), '第一行\n\n```\ncode\n```\n');
  assert.ok(text.endsWith('\n```\n'));
});

console.log('');
console.log(`RESULT pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
