import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { webImportRequestSchema, type BookExtractionPreview } from '../shared/book-extraction';
import type { FrozenSourceDocument } from '../shared/source-document';
import { freezeSource } from './freeze-source';
import { fetchPublicArticle } from './public-web-transport';
import { publicWebAddress } from './public-web-address';
import { parseWebArticle } from './web-article';
import { getWebRenderCapability, renderLimits } from './restricted-render-policy';
import { renderPublicArticle } from './restricted-web-renderer';

const cancelRequest = z.object({ operationId: z.uuid() }).strict();
const pasteRequest = z.object({ workId: z.uuid(), title: z.string().trim().min(1).max(200), text: z.string().min(1).refine(text => Array.from(text).length <= 200000) }).strict();
export interface WebExtractionDependencies { fetch: typeof fetchPublicArticle; parse: typeof parseWebArticle;
  render?: typeof renderPublicArticle; capability?: typeof getWebRenderCapability }

export function sourcePreview(workId: string, source: FrozenSourceDocument): BookExtractionPreview {
  const missingLocations = source.kind === 'txt' || source.kind === 'docx' ? source.segments.filter(segment => segment.chapterIndex === undefined).length : 0;
  return { token: randomUUID(), workId, filename: source.title, fileHash: source.rawHash, format: source.kind,
    source, warnings: missingLocations ? [{ code: 'source-location-unknown', message: '旧素材未保存章内坐标，章序未知；段号仅表示原文顺序。', count: missingLocations }] : [],
    segments: source.segments.map(segment => ({ id: segment.id, chapterTitle: segment.chapterTitle || source.title,
      chapterIndex: segment.chapterIndex ?? (missingLocations ? 0 : 1), paragraphIndex: segment.paragraphIndex ?? segment.ordinal, text: segment.text,
      ...(missingLocations && segment.chapterIndex === undefined ? { locationUnknown: true } : {}) })) };
}

/** 网络与解析不进入文件串行队列；切换来源会立即取消旧任务。 */
export class WebExtractionCommands {
  private current: { id: string; controller: AbortController } | null = null;
  private readonly running = new Set<Promise<unknown>>();
  constructor(private readonly replace: (preview: BookExtractionPreview | null) => void,
    private readonly dependencies: WebExtractionDependencies = { fetch: fetchPublicArticle, parse: parseWebArticle }) {}
  accepts(command: string) { return ['getWebRenderCapability', 'fetchWebExtraction', 'cancelWebExtraction', 'previewPastedExtraction'].includes(command); }
  reset() { this.current?.controller.abort(); this.current = null; this.replace(null); }
  execute(command: string, payload: unknown): Promise<unknown> {
    const operation = this.run(command, payload); this.running.add(operation);
    void operation.then(() => this.running.delete(operation), () => this.running.delete(operation)); return operation;
  }
  private async interruptible<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    let abort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new Error('网页获取或解析已取消。'));
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([operation, cancelled]); }
    finally { signal.removeEventListener('abort', abort); }
  }
  private async run(command: string, payload: unknown): Promise<unknown> {
    if (command === 'getWebRenderCapability') {
      z.undefined().parse(payload); return structuredClone((this.dependencies.capability ?? getWebRenderCapability)());
    }
    if (command === 'cancelWebExtraction') {
      const { operationId } = cancelRequest.parse(payload);
      if (this.current?.id === operationId) this.reset(); return;
    }
    if (command === 'previewPastedExtraction') {
      const { workId, title, text } = pasteRequest.parse(payload); this.reset();
      const source = freezeSource({ kind: 'paste', title, rawBytes: Buffer.from(text), segments: text.replace(/\r\n?/g, '\n').split('\n').map(text => ({ text })) });
      const preview = sourcePreview(workId, source); this.replace(preview); return structuredClone(preview);
    }
    const { workId, operationId, url, mode } = webImportRequestSchema.parse(payload);
    if (mode === 'restricted-browser') {
      const capability = (this.dependencies.capability ?? getWebRenderCapability)();
      if (!capability.enabled) throw new Error(capability.message);
    }
    const address = publicWebAddress(url); this.reset();
    const entry = { id: operationId, controller: new AbortController() }; this.current = entry;
    try {
      const result = mode === 'restricted-browser'
        ? await this.interruptible((this.dependencies.render ?? renderPublicArticle)(address.url, entry.controller.signal), entry.controller.signal)
        : await this.interruptible(this.dependencies.fetch(address.url, entry.controller.signal), entry.controller.signal);
      entry.controller.signal.throwIfAborted();
      const rendered = 'domBytes' in result ? result : undefined, capturedAt = rendered?.capturedAt ?? new Date().toISOString();
      const bodyBytes = 'domBytes' in result ? result.domBytes : result.bytes, rawBytes = 'rawBytes' in result ? result.rawBytes : result.bytes;
      const contentType = 'contentType' in result ? result.contentType : 'text/html';
      const article = await this.interruptible(this.dependencies.parse(bodyBytes, contentType,
        entry.controller.signal, { deadline: result.deadline, maxNodes: renderLimits.maxDomNodes }), entry.controller.signal);
      if (this.current !== entry || entry.controller.signal.aborted) throw new Error('网页预览已取消或被新任务替换。');
      const source = freezeSource({ kind: 'web', rawBytes, title: article.title, originalUrl: address.url, finalUrl: result.finalUrl,
        fetchedAt: capturedAt, capture: rendered ? { captureMethod: 'restricted-browser', capturedAt, policyVersion: 1, renderedDomHash: rendered.renderedDomHash }
          : { captureMethod: 'static', capturedAt, policyVersion: 1 }, segments: article.paragraphs.map(text => ({ text })) });
      const preview = sourcePreview(workId, source);
      if (rendered) preview.warnings.push(...rendered.warnings.map(message => ({ code: 'restricted-render-warning', message, count: 1 })));
      this.replace(preview); return structuredClone(preview);
    } finally { if (this.current === entry) this.current = null; }
  }
  async drain() { this.reset(); await Promise.allSettled(this.running); }
}
