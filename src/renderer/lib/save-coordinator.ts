export interface SaveStatus { phase: 'clean' | 'dirty' | 'saving' | 'failed'; error: string | null }
/** 仅用于写入请求发出前的校验失败；此类失败可以直接重试最新草稿。 */
export class SaveValidationError extends Error {}
interface SaveOptions<T> {
  save: (snapshot: T) => Promise<void>;
  onStatusChange: (status: SaveStatus) => void;
  debounceMs?: number;
  maxWaitMs?: number;
}
export class SaveCoordinator<T> {
  status: SaveStatus = { phase: 'clean', error: null };
  private snapshot!: T;
  private generation = 0;
  private committed = 0;
  private dirtySince: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<void> | null = null;
  private failedFlight: { generation: number; snapshot: T } | null = null;
  private disposed = false;
  constructor(private readonly options: SaveOptions<T>) {}
  update(snapshot: T): void {
    if (this.disposed) throw new Error('保存协调器已释放');
    this.snapshot = snapshot;
    this.generation++;
    this.dirtySince ??= Date.now();
    if (this.status.phase === 'failed') return;
    this.setStatus('dirty');
    this.schedule();
  }
  async flush(): Promise<void> {
    this.clearTimer();
    if (this.disposed) throw new Error('保存协调器已释放');
    while (this.committed < this.generation) {
      if (this.status.phase === 'failed') throw new Error(this.status.error ?? '保存失败');
      await this.submit();
      this.clearTimer();
    }
  }
  async retry(): Promise<void> {
    if (this.status.phase === 'failed') {
      const failed = this.failedFlight;
      this.setStatus('dirty');
      if (failed) await this.submit(failed);
    }
    await this.flush();
  }
  dispose(): void { this.disposed = true; this.clearTimer(); }
  private clearTimer(): void { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  private setStatus(phase: SaveStatus['phase'], error: string | null = null): void {
    this.status = { phase, error };
    if (!this.disposed) this.options.onStatusChange(this.status);
  }
  private schedule(): void {
    this.clearTimer();
    if (this.pending || this.disposed || this.status.phase === 'failed') return;
    const remaining = (this.options.maxWaitMs ?? 4500) - (Date.now() - (this.dirtySince ?? Date.now()));
    this.timer = setTimeout(() => { void this.submit().catch(() => {}); }, Math.max(0, Math.min(this.options.debounceMs ?? 500, remaining)));
  }
  private async submit(replay?: { generation: number; snapshot: T }): Promise<void> {
    if (this.pending) return this.pending;
    if (this.committed === this.generation || this.disposed) return;
    const { generation, snapshot } = replay ?? { generation: this.generation, snapshot: this.snapshot };
    this.clearTimer();
    this.dirtySince = null;
    this.setStatus('saving');
    const operation = Promise.resolve().then(() => this.options.save(snapshot)).then(() => {
      this.committed = generation;
      this.failedFlight = null;
      this.setStatus(this.generation === generation ? 'clean' : 'dirty');
    }).catch((error: unknown) => {
      this.failedFlight = error instanceof SaveValidationError ? null : { generation, snapshot };
      this.setStatus('failed', error instanceof Error ? error.message : '保存失败');
      throw error;
    }).finally(() => {
      this.pending = null;
      if (this.committed < this.generation && this.status.phase !== 'failed') this.schedule();
    });
    this.pending = operation;
    return operation;
  }
}
