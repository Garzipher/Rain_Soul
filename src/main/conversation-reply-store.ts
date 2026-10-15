import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { conversationTurnSchema, type ConversationTurnRequest } from '../shared/conversations';

/** 仅保存已收到但尚未写入会话的回答，不包含服务配置或密钥。 */
export class ConversationReplyStore {
  private readonly directory: string;
  constructor(directory: string) { this.directory = resolve(directory); }
  private assertDirectory() {
    let current = this.directory;
    while (true) {
      if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('回答恢复目录不允许链接。');
      const parent = dirname(current); if (parent === current) break; current = parent;
    }
    mkdirSync(this.directory, { recursive: true });
  }
  private path(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('回答恢复标识无效。');
    return join(this.directory, `${hash}.json`);
  }
  readAll(): ConversationTurnRequest[] {
    this.assertDirectory();
    const requests: ConversationTurnRequest[] = [];
    for (const name of readdirSync(this.directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const file = join(this.directory, name), stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4_000_000) continue;
      try {
        const parsed = conversationTurnSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
        if (parsed.success && name === `${parsed.data.requestHash}.json`) requests.push(parsed.data);
      } catch { /* 保留损坏文件供人工恢复，不执行其中内容，也不阻断启动。 */ }
    }
    return requests;
  }
  save(request: ConversationTurnRequest) {
    this.assertDirectory();
    const validated = conversationTurnSchema.parse(request), content = JSON.stringify(validated);
    if (Buffer.byteLength(content, 'utf8') > 4_000_000) throw new Error('回答恢复内容过大。');
    const file = this.path(validated.requestHash);
    if (lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('回答恢复文件不允许链接。');
    const temporary = join(this.directory, `${validated.requestHash}.${randomUUID()}.tmp`);
    const handle = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(handle, content, 'utf8'); fsyncSync(handle); }
    finally { closeSync(handle); }
    renameSync(temporary, file);
  }
  remove(hash: string) {
    this.assertDirectory();
    const file = this.path(hash), stat = lstatSync(file, { throwIfNoEntry: false });
    if (!stat) return;
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('回答恢复文件无效。');
    unlinkSync(file);
  }
}
