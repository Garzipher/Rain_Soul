import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, win32 } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { compileLearningCourse } from './build-learning-course.mjs';

function localFile(directory, file) {
  if (isAbsolute(file) || win32.isAbsolute(file) || /[:\\]/.test(file)) throw new Error('教材资源必须使用本地相对路径。');
  const parts = file.split('/');
  if (parts.includes('..')) throw new Error('教材资源路径越界。');
  for (let index = 1; index <= parts.length; index++) {
    if (lstatSync(resolve(directory, ...parts.slice(0, index))).isSymbolicLink()) throw new Error('教材资源不能使用链接。');
  }
  const path = realpathSync(resolve(directory, file));
  const local = relative(directory, path);
  if (!local || local.startsWith('..') || isAbsolute(local)) throw new Error('教材资源路径越界。');
  return path;
}

function pngImage(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 45 || bytes.length > 8 * 1024 * 1024 ||
      bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      bytes.subarray(-8).toString('hex') !== '49454e44ae426082') throw new Error('教材图片必须为有效 PNG，且不超过 8MiB。');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16_000_000) throw new Error('教材图片尺寸超过限制。');
  let offset = 8, hasData = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('PNG 数据块不完整。');
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error('PNG 数据块越界。');
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, end - 4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(end - 4)) throw new Error('PNG 数据校验失败。');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') hasData = true;
    if (type === 'IEND' && (length !== 0 || end !== bytes.length)) throw new Error('PNG 结尾无效。');
    offset = end;
  }
  if (!hasData) throw new Error('PNG 缺少图像内容。');
  return bytes;
}

function imagesInMarkdown(markdown) {
  const tree = unified().use(remarkParse).parse(markdown);
  const definitions = new Map();
  const images = [];
  const walk = (node) => {
    if (node.type === 'definition') definitions.set(node.identifier, node.url);
    if (node.type === 'image') images.push(node.url);
    if (node.type === 'imageReference') images.push({ reference: node.identifier });
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return images.map((image) => typeof image === 'string' ? image : definitions.get(image.reference)).filter(Boolean);
}

/** 只读教材与作者笔记分离；资源在构建期校验并以内容 hash 命名。 */
export function compileTextbook(sourceDirectory) {
  const directory = realpathSync(sourceDirectory);
  const course = compileLearningCourse(directory);
  const manifest = JSON.parse(readFileSync(resolve(directory, 'course.json'), 'utf8'));
  const files = new Map(manifest.volumes.flatMap((volume) => volume.chapters.map((chapter) => [chapter.key, chapter.file])));
  const assets = new Map();
  const chapters = course.volumes.flatMap((volume) => volume.chapters.map((chapter) => {
    const markdown = readFileSync(localFile(directory, files.get(chapter.key)), 'utf8');
    const images = {};
    for (const image of imagesInMarkdown(markdown)) {
      if (!/^images\/[A-Za-z0-9_-]+\.png$/.test(image)) throw new Error(`教材图片未采用批准路径：${image}`);
      const bytes = pngImage(localFile(directory, image));
      const name = `learning/${createHash('sha256').update(bytes).digest('hex')}.png`;
      assets.set(name, { name, bytes });
      images[image] = `/${name}`;
    }
    return { id: chapter.id, key: chapter.key, title: chapter.title, markdown, images };
  }));
  return { book: { workId: course.id, chapters }, assets: [...assets.values()] };
}
