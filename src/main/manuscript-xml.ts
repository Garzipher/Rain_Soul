import { SaxesParser, type SaxesTagNS } from 'saxes';
import type { ManuscriptBlock, ManuscriptWarning } from '../shared/manuscript';

const wordNamespaces = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
interface XmlNode { name: string; attributes: Record<string, string>; children: (XmlNode | string)[] }
interface Limits { maxDepth?: number; maxNodes?: number }
function parseXml(xml: string, limits: Limits): XmlNode {
  if (![limits.maxDepth ?? 128, limits.maxNodes ?? 1_000_000].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('XML 解析限额必须是有限正整数。');
  if (Buffer.byteLength(xml) > 64 * 1024 * 1024) throw new Error('XML 内容大小超限。');
  const parser = new SaxesParser({ xmlns: true });
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined, nodes = 0;
  parser.on('doctype', () => { throw new Error('DOCX 不允许 DTD 或外部实体。'); });
  parser.on('error', error => { throw error; });
  parser.on('opentag', (tag: SaxesTagNS) => {
    if (++nodes > (limits.maxNodes ?? 1_000_000)) throw new Error('XML 节点数量超限。');
    if (stack.length >= (limits.maxDepth ?? 128)) throw new Error('XML 深度超限。');
    const attributes: Record<string, string> = {};
    for (const value of Object.values(tag.attributes)) if (wordNamespaces.has(value.uri) || !value.uri) attributes[value.local] = value.value;
    const node = { name: wordNamespaces.has(tag.uri) ? tag.local : `other:${tag.local}`, attributes, children: [] };
    if (stack.length) stack.at(-1)!.children.push(node); else root = node;
    stack.push(node);
  });
  parser.on('closetag', () => { stack.pop(); });
  parser.on('text', text => { if (stack.length) stack.at(-1)!.children.push(text); });
  parser.on('cdata', text => { if (stack.length) stack.at(-1)!.children.push(text); });
  parser.write(xml).close();
  if (!root) throw new Error('XML 没有文档根节点。');
  return root;
}
const children = (node: XmlNode, name?: string): XmlNode[] => node.children.filter((child): child is XmlNode => typeof child !== 'string' && (!name || child.name === name));
const child = (node: XmlNode | undefined, name: string) => node && children(node, name)[0];
const level = (node: XmlNode | undefined): number | undefined => {
  const value = node?.attributes.val;
  return value !== undefined && /^[0-8]$/.test(value) ? Number(value) : undefined;
};

/** 只读取 OOXML 正文段落；复杂对象只计数提示，不导入其文本。 */
export function parseWordXml(documentXml: string, stylesXml?: string, limits: Limits = {}): { blocks: ManuscriptBlock[]; warnings: ManuscriptWarning[] } {
  const root = parseXml(documentXml, limits);
  if (root.name !== 'document') throw new Error('DOCX 缺少有效正文文档。');
  const body = child(root, 'body');
  if (!body) throw new Error('DOCX 缺少正文 body。');
  const styles = new Map<string, { base?: string; level?: number }>();
  if (stylesXml) {
    const stylesRoot = parseXml(stylesXml, limits);
    if (stylesRoot.name !== 'styles') throw new Error('DOCX 样式文档无效。');
    for (const style of children(stylesRoot, 'style')) {
      const id = style.attributes.styleId;
      if (!id || styles.has(id)) throw new Error('DOCX 样式 ID 缺失或重复。');
      styles.set(id, { base: child(style, 'basedOn')?.attributes.val, level: level(child(child(style, 'pPr'), 'outlineLvl')) });
    }
  }
  const inherited = (id: string | undefined): number | undefined => {
    const visited = new Set<string>();
    while (id) {
      if (visited.has(id)) return undefined;
      visited.add(id);
      const style = styles.get(id);
      if (!style) return undefined;
      if (style.level !== undefined) return style.level;
      id = style.base;
    }
    return undefined;
  };
  const counts = new Map<string, number>();
  const ignored = new Map([['tbl', 'ignored-table'], ['drawing', 'ignored-image'], ['pict', 'ignored-image'], ['txbxContent', 'ignored-textbox'], ['instrText', 'ignored-field'], ['object', 'ignored-object']]);
  const scan = (node: XmlNode) => {
    const code = ignored.get(node.name);
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
    for (const item of children(node)) scan(item);
  };
  scan(body);
  const text = (node: XmlNode): string => {
    if (ignored.has(node.name) || node.name === 'del') return '';
    if (node.name === 't') return node.children.filter((value): value is string => typeof value === 'string').join('');
    if (node.name === 'tab') return ' ';
    if (node.name === 'br' || node.name === 'cr') return '\n';
    return children(node).map(text).join('');
  };
  const blocks = children(body, 'p').map(paragraph => {
    const ppr = child(paragraph, 'pPr');
    const headingLevel = level(child(ppr, 'outlineLvl')) ?? inherited(child(ppr, 'pStyle')?.attributes.val);
    const value = text(paragraph);
    return headingLevel === undefined ? { text: value } : { text: value, headingLevel };
  });
  const messages: Record<string, string> = { 'ignored-table': '表格未导入。', 'ignored-image': '图片未导入。', 'ignored-textbox': '文本框未导入。', 'ignored-field': '域命令未执行或导入。', 'ignored-object': '嵌入对象未导入。' };
  return { blocks, warnings: [...counts].map(([code, count]) => ({ code, count, message: messages[code] })) };
}
