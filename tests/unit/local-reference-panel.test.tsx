// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalReferencePanel } from '../../src/renderer/components/local-reference-panel';
afterEach(cleanup);
it('作者主动本机检索并勾选才采用参考，回退信息可见，修订后清除选择', async () => {
  const entry = { id: 'entry', body: '雨夜的原文描写', source: '例文', deletedAt: null };
  const onRetrieve = vi.fn(async () => ({ queryId: '', hits: [{ workId: 'work', entryId: 'entry', bodyHash: '', excerpt: entry.body, source: entry.source, matchedBy: ['keyword'], reliable: true }], total: 1, sourceRevisions: { work: 1 }, status: 'fallback', modelFingerprint: null, message: '模型未就绪，使用关键词' }));
  const onSelect = vi.fn();
  const props = { workId: 'work', revision: 1, entries: [entry] as never, busy: false, onRetrieve: onRetrieve as never, onSelect };
  const view = render(<LocalReferencePanel {...props} />);
  expect(onRetrieve).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('本机参考查询'), { target: { value: '雨夜' } });
  fireEvent.click(screen.getByRole('button', { name: '查找写作参考' }));
  await screen.findByText('雨夜的原文描写'); expect(onSelect).not.toHaveBeenCalledWith(['entry']);
  fireEvent.click(screen.getByRole('checkbox')); expect(onSelect).toHaveBeenLastCalledWith(['entry']);
  expect(screen.getByText('模型未就绪，使用关键词')).toBeVisible();
  view.rerender(<LocalReferencePanel {...props} revision={2} />);
  await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith([]));
});
