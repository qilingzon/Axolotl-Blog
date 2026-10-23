---
title: 给博客做三套主题是什么体验
description: CSS 变量驱动的多主题系统实践：从一套变量到三种完全不同的气质，以及防闪烁的坑。
pubDate: 2026-10-22
tags: [技术, CSS, 设计]
accent: gold
---

博客有三套主题：**粉螈·奶油**、**紫螈·像素**、**荧光洞窟**。这篇讲讲实现思路。

## 变量不止是颜色

多数教程里 CSS 变量只管颜色，但其实**圆角、阴影、字体都可以变量化**：

```css
[data-theme='purple-pixel'] {
  --radius: 0;
  --shadow: 4px 4px 0 #33265c;
  --font-display: 'Fusion Pixel 12px Proportional SC', monospace;
}
```

同一份组件代码，像素主题下自动变成方角 + 硬阴影 + 像素字体，气质完全不同——这是「多主题」和「暗色模式」的区别：主题换的是性格，不只是亮度。

## 防闪烁

主题存在 localStorage 里，如果等页面 JS 加载完再切换，用户会先看到默认主题闪一下。解法是在 `<head>` 里放一段内联脚本，**首帧渲染前**把 `data-theme` 设置好：

```html
<script is:inline>
  var t = localStorage.getItem('axo-theme');
  if (t) document.documentElement.dataset.theme = t;
</script>
```

## 三个实践细节

1. **变量给结构开关**：像素主题额外用 `[data-theme]` 选择器做结构性覆盖（hover 位移方向、SVG 硬边渲染）
2. **切换按钮用事件委托**：写在布局里一次，所有页面生效
3. **`color-scheme` 跟着主题走**：深色主题下系统控件（滚动条、表单）才会跟着变深

## 遗憾

像素中文字体体积不小，所幸它是按需加载的 woff2 分片。下一个想做的主题是「繁茂洞穴」：绿色 + 悬挂藤蔓装饰，敬请期待。
