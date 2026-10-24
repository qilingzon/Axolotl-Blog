import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    /** 卡片装饰美西螈的颜色（官方五色 + 预告片绿色 + 站点二创紫） */
    accent: z
      .enum(['pink', 'purple', 'wild', 'cyan', 'gold', 'blue', 'green'])
      .default('pink'),
  }),
});

export const collections = { blog };
