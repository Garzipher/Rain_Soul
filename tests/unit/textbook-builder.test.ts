import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compileTextbook } from '../../scripts/build-textbook.mjs';

describe('图文教材离线编译', () => {
  let directory = '';
  function fixture(markdown: string) {
    directory = mkdtempSync(join(tmpdir(), 'rainsoul-textbook-'));
    mkdirSync(join(directory, 'images'));
    writeFileSync(join(directory, 'chapter.md'), markdown);
    writeFileSync(join(directory, 'course.json'), JSON.stringify({ title: '项目全流程开发学习', volumes: [
      { key: 'v1', title: '卷', chapters: [{ key: 'v1/c1', title: '实验', file: 'chapter.md' }] },
    ] }));
  }
  afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

  it('保留完整Markdown、稳定章节身份和本地PNG白名单，重复构建一致', () => {
    fixture('# 实验\n\n```ts\nconst a = 1;\n```\n\n|变量|值|\n|---|---|\n|a|1|\n\n![图1：实际结果](images/screen.png)');
    writeFileSync(join(directory, 'images/screen.png'), readFileSync('assets/rainsoul.png'));
    const first = compileTextbook(directory);
    const second = compileTextbook(directory);
    expect(first).toEqual(second);
    expect(first.book.workId).toBe('80d0c996-574e-5b8b-91d6-93fe72517231');
    expect(first.book.chapters).toHaveLength(1);
    expect(first.book.chapters[0].markdown).toContain('```ts');
    expect(first.book.chapters[0].images['images/screen.png']).toMatch(/^\/learning\/[a-f0-9]+\.png$/);
    expect(first.assets).toHaveLength(1);
    expect(first.assets[0].bytes).toEqual(readFileSync('assets/rainsoul.png'));
  });

  it.each(['https://example.com/a.png', '../outside.png', 'C:/outside.png', 'file:///etc/a.png'])('拒绝图片路径 %s', (path) => {
    fixture(`正文\n\n![危险图片](${path})`);
    expect(() => compileTextbook(directory)).toThrow();
  });

  it('缺失、损坏或过大图片阻断构建，不生成看似成功的空图', () => {
    fixture('正文\n\n![截图](images/screen.png)');
    expect(() => compileTextbook(directory)).toThrow();
    writeFileSync(join(directory, 'images/screen.png'), '伪造PNG');
    expect(() => compileTextbook(directory)).toThrow();
    writeFileSync(join(directory, 'images/screen.png'), Buffer.alloc(8 * 1024 * 1024 + 1));
    expect(() => compileTextbook(directory)).toThrow();
  });

  it('图片目录链接逃逸也拒绝', () => {
    fixture('正文\n\n![截图](linked/icon.png)');
    const outside = join(directory, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'icon.png'), readFileSync('assets/rainsoul.png'));
    const source = join(directory, 'course');
    mkdirSync(source);
    for (const name of ['course.json', 'chapter.md']) writeFileSync(join(source, name), readFileSync(join(directory, name)));
    symlinkSync(outside, join(source, 'linked'), 'junction');
    expect(() => compileTextbook(source)).toThrow();
  });

  it('拒绝CRC损坏的截图，不把损坏PNG打包', () => {
    fixture('正文\n\n![截图](images/screen.png)');
    const bytes = readFileSync('assets/rainsoul.png');
    bytes[32] ^= 1;
    writeFileSync(join(directory, 'images/screen.png'), bytes);
    expect(() => compileTextbook(directory)).toThrow();
  });
});
