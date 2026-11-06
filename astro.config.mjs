// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.iqii.cn',
  integrations: [
    // sitemap：构建期生成 sitemap-index.xml。/preview/ 是作者的私密草稿预览页（noindex），
    // 不能提交给搜索引擎——filter 掉；/admin/ 在 public/ 不进 Astro 路由，天然不收录
    sitemap({
      filter: (page) => !page.includes('/preview/'),
    }),
  ],
});
