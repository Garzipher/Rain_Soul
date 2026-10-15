import { flushSync } from 'react-dom';

interface Transition { skipTransition: () => void; finished: Promise<void>; updateCallbackDone: Promise<void> }
let active: Transition | undefined;
let latest = 0;
/** 只更新一份真实页面；快照失败不能再次提交同一业务动作。 */
export function transitionPage(commit: () => void, options: { reduced: boolean; composing: boolean }): void {
  const generation = ++latest;
  active?.skipTransition(); active = undefined;
  const start = document.startViewTransition?.bind(document);
  if (options.reduced || options.composing || !start) { flushSync(commit); return; }
  let committed = false;
  const once = () => {
    if (committed || generation !== latest) return;
    committed = true; flushSync(commit);
  };
  try {
    const transition = start(once);
    active = transition;
    void transition.updateCallbackDone.catch(() => once());
    void transition.finished.catch(() => undefined).finally(() => { if (active === transition) active = undefined; });
  } catch { once(); }
}
