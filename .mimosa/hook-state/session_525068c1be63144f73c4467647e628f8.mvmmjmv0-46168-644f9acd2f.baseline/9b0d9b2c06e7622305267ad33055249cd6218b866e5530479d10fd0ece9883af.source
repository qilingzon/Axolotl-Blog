import { getCollection } from 'astro:content';

/** 去掉 markdown 标记，取正文纯文本供前端检索（保留代码块与链接文字） */
function toPlainText(md: string): string {
  return md
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~`>]+/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function GET() {
  const posts = (await getCollection('blog')).filter((p) => !p.data.draft);
  const index = posts
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
    .map((post) => ({
      id: post.id,
      title: post.data.title,
      description: post.data.description,
      tags: post.data.tags,
      date: post.data.pubDate.toISOString(),
      text: toPlainText(post.body ?? ''),
    }));
  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
