import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, win32 } from 'node:path';
import { z } from 'zod';

const name = z.string().trim().min(1);
const chapter = z.object({ key: name, title: name, file: name }).strict();
const manifestSchema = z.object({
  title: z.literal('项目全流程开发学习'),
  volumes: z.array(z.object({ key: name, title: name, chapters: z.array(chapter).min(1) }).strict()).min(1),
}).strict();

// 内容顺序或正文修订不改变卷章身份；key 一经发布不得复用。
function stableId(key) {
  const bytes = createHash('sha256').update(`rainsoul/project-learning/${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function chapterFile(directory, file) {
  if (isAbsolute(file) || win32.isAbsolute(file)) throw new Error('课程章节必须使用目录内相对路径。');
  const path = realpathSync(resolve(directory, file));
  const local = relative(directory, path);
  if (!local || local.startsWith('..') || isAbsolute(local)) throw new Error('课程章节路径越界。');
  return path;
}

function documentFromMarkdown(markdown, key) {
  const blocks = markdown.replace(/\r\n/g, '\n').split(/\n\s*\n/)
    .map((block) => block.split('\n').filter((line) => !/^\s*```/.test(line))
      .map((line) => line.replace(/^#{1,6}\s+/, '').replace(/^\s*[-*]\s+/, '')).join('\n').trim())
    .filter(Boolean);
  if (!blocks.length) throw new Error('课程正文不能为空。');
  return { type: 'doc', content: blocks.map((text, index) => ({ type: 'paragraph',
    attrs: { id: stableId(`paragraph/${key}/${index}`) }, content: [{ type: 'text', text }] })) };
}

/** 构建期编译本地教学真源；运行期仅消费包内 JSON。 */
export function compileLearningCourse(sourceDirectory) {
  const directory = realpathSync(sourceDirectory);
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(resolve(directory, 'course.json'), 'utf8')));
  const keys = new Set();
  const claim = (key) => {
    if (keys.has(key)) throw new Error(`课程标识重复：${key}`);
    keys.add(key);
    return stableId(key);
  };
  return { id: '80d0c996-574e-5b8b-91d6-93fe72517231', title: manifest.title,
    volumes: manifest.volumes.map((volume) => ({ key: volume.key, id: claim(volume.key), title: volume.title,
      chapters: volume.chapters.map((item) => ({ key: item.key, id: claim(item.key), title: item.title,
        document: documentFromMarkdown(readFileSync(chapterFile(directory, item.file), 'utf8'), item.key) })) })) };
}
