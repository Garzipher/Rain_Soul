import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileService } from '../../src/main/profile-service';
import { ProfileCommands } from '../../src/main/profile-commands';

describe('个人资料白名单命令', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rainsoul-profile-ipc-'));
  const service = new ProfileService(directory);
  afterEach(() => rmSync(directory, { recursive: true, force: true }));
  it('合法命令保存名称，拒绝通用文件路径和多余参数', async () => {
    const choose = vi.fn(async () => service.get()); const commands = new ProfileCommands(service, choose);
    expect(commands.accepts('chooseAvatar')).toBe(true); expect(commands.accepts('readFile')).toBe(false);
    await expect(commands.execute('setPenName', { penName: '雨魂' })).resolves.toMatchObject({ penName: '雨魂' });
    await expect(commands.execute('chooseAvatar', { path: 'C:\\secret.png' })).rejects.toThrow();
    await expect(commands.execute('getAuthorProfile', { extra: true })).rejects.toThrow();
    await expect(commands.execute('readFile', {})).rejects.toThrow();
    expect(choose).not.toHaveBeenCalled();
  });
  it('异步选图与其他资料命令串行执行，关闭等待队列完成', async () => {
    let release!: () => void;
    const commands = new ProfileCommands(service, () => new Promise(resolve => { release = () => resolve(service.get()); }));
    const first = commands.execute('chooseAvatar', {});
    await Promise.resolve();
    const second = commands.execute('setPenName', { penName: '后提交' });
    let drained = false; const done = commands.drain().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    release(); await first; await second; await done;
    expect(service.get().penName).toBe('后提交');
  });
  it('失败请求不会阻断后续合法请求', async () => {
    const commands = new ProfileCommands(service, async () => service.get());
    await expect(commands.execute('setPenName', { penName: 12 })).rejects.toThrow();
    await expect(commands.execute('clearAvatar', {})).resolves.toMatchObject({ avatarDataUrl: null });
  });
});
