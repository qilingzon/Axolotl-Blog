import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { SITE } from '../config';

// 全站 RSS 订阅：/rss.xml —— 已发布文章（草稿过滤口径与前台一致），按发布日期倒序
export async function GET(context) {
  const posts = (await getCollection('blog'))
    .filter((p) => !p.data.draft)
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
  return rss({
    title: SITE.name,
    description: SITE.description,
    site: context.site,
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.pubDate,
      link: `/blog/${p.id}/`,
      categories: p.data.tags,
    })),
    customData: '<language>zh-cn</language>',
  });
}
