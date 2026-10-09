import { readFile, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { chromium } from 'playwright';
import { encodeWindowsIcon } from './windows-icon.mjs';

/** 仅使用已安装的本地 Chromium，从 Demo 同源 SVG 重建窗口和 Windows 图标。 */
const svg = await readFile(new URL('../assets/rainsoul.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const images = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    images.push({ size, png: await page.screenshot({ omitBackground: true }) });
  }
  await writeFile(new URL('../assets/rainsoul.png', import.meta.url), images.at(-1).png);
  await writeFile(new URL('../assets/rainsoul.ico', import.meta.url), encodeWindowsIcon(images));
} finally {
  await browser.close();
}
