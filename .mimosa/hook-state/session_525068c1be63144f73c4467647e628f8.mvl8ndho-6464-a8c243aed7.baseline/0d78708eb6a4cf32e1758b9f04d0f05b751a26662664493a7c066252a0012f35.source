import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    /** 卡片装饰美西螈的颜色（五个色系对应 Minecraft 美西螈变体） */
    accent: z.enum(['pink', 'purple', 'cyan', 'gold', 'blue']).default('pink'),
  }),
});

export const collections = { blog };
