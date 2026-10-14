import { createHash } from 'node:crypto';
import type { parseWebArticle } from './web-article';
import { renderLimits } from './restricted-render-policy';

export interface RenderContentOptions {
  deadline: number;
  signal: AbortSignal;
  capture(): Promise<Buffer>;
  parse: typeof parseWebArticle;
  checkHealthy(): void;
  waitForQuiet(deadline: number, signal: AbortSignal): Promise<void>;
}

/** 宿主轮询可提取正文；网络安静与正文稳定共享预算，不信任页面的就绪声明。 */
export async function waitForRenderableContent(options: RenderContentOptions): Promise<Buffer> {
  options.signal.throwIfAborted();
  const deadline = Math.min(options.deadline, Date.now() + renderLimits.maxQuietWaitMs);
  const expired = () => new Error('网页正文未在限定时间内出现并稳定，请粘贴正文或导入本地文件。');
  if (!Number.isFinite(deadline) || deadline <= Date.now()) throw expired();
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const timer = setTimeout(() => controller.abort(expired()), deadline - Date.now());
  const check = () => {
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw expired();
    options.checkHealthy();
  };
  const wait = async <T>(operation: Promise<T>): Promise<T> => {
    let abort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([operation, cancelled]); }
    finally { signal.removeEventListener('abort', abort); }
  };
  const pause = () => new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(delay); reject(signal.reason); };
    const delay = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); },
      Math.min(renderLimits.contentPollMs, deadline - Date.now()));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  let previous: string | undefined, stableSince = 0;
  try {
    while (true) {
      check();
      await wait(options.waitForQuiet(deadline, signal)); check();
      const bytes = await wait(options.capture()); check();
      try {
        const article = await wait(options.parse(bytes, 'text/html; charset=utf-8', signal,
          { deadline, maxNodes: renderLimits.maxDomNodes })); check();
        const hash = createHash('sha256').update(JSON.stringify(article)).digest('hex');
        if (hash !== previous) { previous = hash; stableSince = Date.now(); }
        else if (Date.now() - stableSince >= renderLimits.contentStableMs) {
          await wait(options.waitForQuiet(deadline, signal)); check();
          const latest = await wait(options.capture()); check();
          const verified = await wait(options.parse(latest, 'text/html; charset=utf-8', signal,
            { deadline, maxNodes: renderLimits.maxDomNodes })); check();
          const latestHash = createHash('sha256').update(JSON.stringify(verified)).digest('hex');
          if (latestHash === hash) return latest;
          previous = latestHash; stableSince = Date.now();
        }
      } catch (error) {
        check();
        // 只有可恢复的“正文尚未出现”继续等待，容量/登录/解析故障均拒绝。
        if (!(error instanceof Error) || ![
          '无法识别网页正文，请粘贴正文或导入本地文件。',
          '网页没有可摘选的正文，请粘贴正文。',
        ].includes(error.message)) throw error;
        previous = undefined;
      }
      await pause();
    }
  } finally { clearTimeout(timer); }
}
