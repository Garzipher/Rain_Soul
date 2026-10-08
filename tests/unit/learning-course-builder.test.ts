import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compileLearningCourse } from '../../scripts/build-learning-course.mjs';
import { validateDocument } from '../../src/shared/document';

describe('项目学习课程编译', () => {
  let directory = '';
  afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

  it('项目教学源覆盖全部 8 卷 24 章，每章为可编辑的有效正文', () => {
    const course = compileLearningCourse('learning/项目全流程开发学习');
    expect(course.volumes).toHaveLength(8);
    expect(course.volumes.flatMap((volume) => volume.chapters)).toHaveLength(24);
    for (const volume of course.volumes) for (const chapter of volume.chapters) {
      expect(validateDocument(chapter.document)).toEqual(chapter.document);
      expect(JSON.stringify(chapter.document).length).toBeGreaterThan(1000);
      expect(JSON.stringify(chapter.document)).toContain('练习');
    }
  });

  it('按清单编译真实卷章和受限文档，且身份可重复构建', () => {
    directory = mkdtempSync(join(tmpdir(), 'rainsoul-course-'));
    mkdirSync(join(directory, 'chapters'));
    writeFileSync(join(directory, 'course.json'), JSON.stringify({ title: '项目全流程开发学习', volumes: [
      { key: 'foundation', title: '基础', chapters: [{ key: 'foundation/01', title: '起步', file: 'chapters/01.md' }] },
    ] }));
    writeFileSync(join(directory, 'chapters/01.md'), '# 从问题开始\n\n练习：确认目标与验收。\n\n- 记录失败条件。\n');
    const first = compileLearningCourse(directory);
    const second = compileLearningCourse(directory);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ title: '项目全流程开发学习', volumes: [{ title: '基础', chapters: [{ title: '起步' }] }] });
    const paragraphs = first.volumes[0].chapters[0].document.content;
    expect(paragraphs.map((paragraph) => paragraph.content?.map((inline) => inline.type === 'text' ? inline.text : '').join('')))
      .toEqual(['从问题开始', '练习：确认目标与验收。', '记录失败条件。']);
    expect(new Set(paragraphs.map((paragraph) => paragraph.attrs.id)).size).toBe(paragraphs.length);
  });

  it.each(['../outside.md', 'C:/outside.md', ''])('拒绝越界或空章节路径 %s', (file) => {
    directory = mkdtempSync(join(tmpdir(), 'rainsoul-course-'));
    writeFileSync(join(directory, 'course.json'), JSON.stringify({ title: '项目全流程开发学习', volumes: [
      { key: 'foundation', title: '基础', chapters: [{ key: 'foundation/01', title: '起步', file }] },
    ] }));
    expect(() => compileLearningCourse(directory)).toThrow();
  });

  it('拒绝重复标识、缺失正文和无效课程标题', () => {
    directory = mkdtempSync(join(tmpdir(), 'rainsoul-course-'));
    mkdirSync(join(directory, 'chapters'));
    writeFileSync(join(directory, 'chapters/01.md'), '有效正文');
    const base = { title: '项目全流程开发学习', volumes: [{ key: 'foundation', title: '基础', chapters: [
      { key: 'foundation/01', title: '起步', file: 'chapters/01.md' },
      { key: 'foundation/01', title: '重复', file: 'chapters/01.md' },
    ] }] };
    writeFileSync(join(directory, 'course.json'), JSON.stringify(base));
    expect(() => compileLearningCourse(directory)).toThrow();
    base.volumes[0].chapters.pop();
    writeFileSync(join(directory, 'course.json'), JSON.stringify(base));
    writeFileSync(join(directory, 'chapters/01.md'), ' \n\n');
    expect(() => compileLearningCourse(directory)).toThrow('正文不能为空');
    rmSync(join(directory, 'chapters/01.md'));
    expect(() => compileLearningCourse(directory)).toThrow();
    writeFileSync(join(directory, 'course.json'), JSON.stringify({ ...base, title: ' ' }));
    expect(() => compileLearningCourse(directory)).toThrow();
  });

  it('新章加入或既有正文修改不改变已发布卷章 ID', () => {
    directory = mkdtempSync(join(tmpdir(), 'rainsoul-course-'));
    writeFileSync(join(directory, '01.md'), '首章');
    const manifest = { title: '项目全流程开发学习', volumes: [{ key: 'a', title: '卷', chapters: [
      { key: 'a/01', title: '第一章', file: '01.md' },
    ] }] };
    writeFileSync(join(directory, 'course.json'), JSON.stringify(manifest));
    const before = compileLearningCourse(directory);
    writeFileSync(join(directory, '01.md'), '正文修订');
    writeFileSync(join(directory, '02.md'), '第二章');
    manifest.volumes[0].chapters.push({ key: 'a/02', title: '第二章', file: '02.md' });
    writeFileSync(join(directory, 'course.json'), JSON.stringify(manifest));
    const after = compileLearningCourse(directory);
    expect(after.id).toBe(before.id);
    expect(after.volumes[0].id).toBe(before.volumes[0].id);
    expect(after.volumes[0].chapters[0].id).toBe(before.volumes[0].chapters[0].id);
    expect(after.volumes[0].chapters[1].id).not.toBe(before.volumes[0].chapters[0].id);
  });

  it('已存在的越界路径和目录链接仍拒绝；代码示例可读且不产生 HTML 节点', () => {
    directory = mkdtempSync(join(tmpdir(), 'rainsoul-course-'));
    const source = join(directory, 'source');
    const outside = join(directory, 'outside');
    mkdirSync(source); mkdirSync(outside);
    writeFileSync(join(outside, '01.md'), '外部正文');
    symlinkSync(outside, join(source, 'linked'), 'junction');
    const manifest = { title: '项目全流程开发学习', volumes: [{ key: 'a', title: '卷', chapters: [
      { key: 'a/01', title: '章', file: '../outside/01.md' },
    ] }] };
    for (const file of ['../outside/01.md', 'linked/01.md']) {
      manifest.volumes[0].chapters[0].file = file;
      writeFileSync(join(source, 'course.json'), JSON.stringify(manifest));
      expect(() => compileLearningCourse(source)).toThrow('路径越界');
    }
    writeFileSync(join(source, '01.md'), '```ts\nconst data = "<script>";\n```\n\n教学示例');
    manifest.volumes[0].chapters[0].file = '01.md';
    writeFileSync(join(source, 'course.json'), JSON.stringify(manifest));
    const chapter = compileLearningCourse(source).volumes[0].chapters[0];
    expect(chapter.document.content[0].content).toEqual([{ type: 'text', text: 'const data = "<script>";' }]);
  });
});
