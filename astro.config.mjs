// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.iqii.cn',
  // astro 7 默认 compressHTML:'jsx' 会吃掉行内元素之间的空格（中文排版受影响），显式保持 v5 行为
  compressHTML: true,
  integrations: [
    // sitemap：构建期生成 sitemap-index.xml。/preview/ 是作者的私密草稿预览页（noindex），
    // 不能提交给搜索引擎——filter 掉；/admin/ 在 public/ 不进 Astro 路由，天然不收录
    sitemap({
      filter: (page) => !page.includes('/preview/'),
    }),
  ],
});
