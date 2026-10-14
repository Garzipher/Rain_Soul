import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('锁文件保留SQLite预编译包的gypfile禁编译标志并由项目安装Electron运行时', () => {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const sqlite = lock.packages['node_modules/better-sqlite3'];
  const installed = JSON.parse(readFileSync('node_modules/better-sqlite3/package.json', 'utf8'));
  expect(sqlite.version).toBe(installed.version);
  expect(installed.gypfile).toBe(false);
  expect(sqlite.gypfile).toBe(installed.gypfile);
  const project = JSON.parse(readFileSync('package.json', 'utf8'));
  const electron = JSON.parse(readFileSync('node_modules/electron/package.json', 'utf8'));
  expect(project.scripts.postinstall).toBe('install-electron');
  expect(electron.bin['install-electron']).toBe('install.js');
});
