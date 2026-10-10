import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { parseArticleDocument } from '../../src/main/web-article-core';
import { parseWebArticle } from '../../src/main/web-article';

const paragraphs = ['雨夜码头的灯光落在水里，岸边的人等待远方来信。'.repeat(8), '远处船鸣慢慢退去，雨水沿着旧木桩滑落。'.repeat(8)];
const html = `<html><head><title>雨夜码头</title></head><body><nav>导航广告</nav><article><h1>雨夜码头</h1>${paragraphs.map(text => `<p>${text}</p>`).join('')}<script>fetch('https://should-not-run.invalid')</script></article></body></html>`;
const parse = (input: string, type = 'text/html; charset=utf-8', maxNodes = 20000) => parseArticleDocument(Buffer.from(input), type, maxNodes);
describe('网页正文提取', () => {
  it('保留原文段落、标题，移除导航与脚本，不加载页面资源', () => {
    const result = parse(html);
    expect(result.title).toBe('雨夜码头');
    expect(result.paragraphs).toEqual(paragraphs);
    expect(JSON.stringify(result)).not.toMatch(/导航广告|fetch|should-not-run/);
  });
  it('支持实体与换行，HTML不是返回给作者的可执行内容', () => {
    const result = parse(html.replace(paragraphs[0], paragraphs[0] + '&lt;灯&gt;<br>船与岸 &amp; 风'));
    expect(result.paragraphs[0]).toContain('<灯>\n船与岸 & 风');
  });
  it('无显式编码时读取HTML声明，GB18030字节不误当UTF8', () => {
    const bytes = Buffer.concat([Buffer.from('<html><head><meta charset="gb18030"><title>'), Buffer.from([0xd3, 0xea]), Buffer.from('</title></head><body><article><p>'), Buffer.from([0xd3, 0xea]), Buffer.from('</p></article></body></html>')]);
    const result = parseArticleDocument(bytes, 'text/html', 20000);
    expect(result.title).toBe('雨');
    expect(result.paragraphs).toContain('雨');
  });
  it.each(['charset=unknown', 'charset=iso-8859-1'])('未知编码拒绝，不静默猜测：%s', charset => {
    expect(() => parse(html, `text/html; ${charset}`)).toThrow(/编码/);
  });
  it('坏字节、空正文、登录表单、实体声明和超限节点明确拒绝', () => {
    expect(() => parseArticleDocument(Buffer.from([0xff]), 'text/html; charset=utf-8', 20000)).toThrow(/编码/);
    expect(() => parse('<html><body><nav>主页</nav></body></html>')).toThrow(/正文/);
    expect(() => parse('<html><body><form><input type="password"></form></body></html>')).toThrow(/登录/);
    expect(() => parse('<!DOCTYPE html [<!ENTITY x SYSTEM "file:///secret">]><html/>')).toThrow(/实体/);
    expect(() => parse(html, 'text/html', 5)).toThrow(/节点/);
  });
  it('HTML实体解码后的控制字符也不能成为作者正文', () => {
    expect(() => parse(html.replace(paragraphs[0], paragraphs[0]+'&#1;'))).toThrow(/正文|字符/);
  });
  it('不支持的内容格式、无效解析限额和过长正文标题都拒绝', () => {
    expect(()=>parse(html,'application/json')).toThrow(/HTML/);
    expect(()=>parse(html,'text/html',0)).toThrow(/限额/);
    expect(()=>parse(html.replace(/雨夜码头/g,'字'.repeat(201)))).toThrow(/标题/);
    expect(()=>parse(html.replace(paragraphs[0],'字'.repeat(200001)))).toThrow(/容量/);
  });
});

describe('隔离解析生命周期', () => {
  const createWorker = () => new Worker(resolve('dist/desktop/web-article-worker.cjs'));
  it('真实Worker只返回提取文本，关闭后不留下后台任务', async () => {
    const result = await parseWebArticle(Buffer.from(html), 'text/html', new AbortController().signal, { deadline: Date.now() + 5000, maxNodes: 20000 }, { createWorker });
    expect(result.paragraphs).toEqual(paragraphs);
  });
  it('预先取消或deadline已过时不启动Worker', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(parseWebArticle(Buffer.from(html), 'text/html', controller.signal, { deadline: Date.now()+5000, maxNodes: 20000 }, { createWorker })).rejects.toThrow(/取消/);
    await expect(parseWebArticle(Buffer.from(html), 'text/html', new AbortController().signal, { deadline: Date.now()-1, maxNodes: 20000 }, { createWorker })).rejects.toThrow(/超时/);
  });
  it('解析中的取消与超时终止不返回晚结果', async () => {
    const workers: Worker[] = [], exits: Promise<unknown>[] = [];
    const stalled = () => { const worker = new Worker('setInterval(() => {}, 1000)', { eval: true }); workers.push(worker); exits.push(once(worker, 'exit')); return worker; };
    const controller = new AbortController();
    const pending = parseWebArticle(Buffer.from(html), 'text/html', controller.signal, { deadline: Date.now()+5000, maxNodes: 20000 }, { createWorker: stalled });
    controller.abort(); await expect(pending).rejects.toThrow(/取消/);
    await expect(parseWebArticle(Buffer.from(html), 'text/html', new AbortController().signal, { deadline: Date.now()+30, maxNodes: 20000 }, { createWorker: stalled })).rejects.toThrow(/超时/);
    await Promise.all(exits); expect(workers.every(worker => worker.threadId === -1)).toBe(true);
  });
  it('异常Worker消息不抛未捕获错误且终止任务', async () => {
    const malformed = () => new Worker("require('node:worker_threads').parentPort.once('message',()=>require('node:worker_threads').parentPort.postMessage(null))", { eval: true });
    await expect(parseWebArticle(Buffer.from(html), 'text/html', new AbortController().signal, { deadline: Date.now()+5000, maxNodes: 20000 }, { createWorker: malformed })).rejects.toThrow(/结果无效/);
  });
  it('启动失败、超大输入、坏结果和Worker错误可恢复', async () => {
    const args = [Buffer.from(html), 'text/html', new AbortController().signal, {deadline:Date.now()+5000,maxNodes:20000}] as const;
    await expect(parseWebArticle(...args,{createWorker:()=>{throw new Error('内部路径');}})).rejects.toThrow(/启动/);
    await expect(parseWebArticle(Buffer.alloc(5*1024*1024+1),args[1],args[2],args[3])).rejects.toThrow(/过大/);
    for(const reply of [{ok:true,data:{title:'标题',paragraphs:[3]}},{ok:false,message:'正文为空'},{ok:false,message:3}]) {
      const createWorker=()=>new Worker(`require('node:worker_threads').parentPort.once('message',()=>require('node:worker_threads').parentPort.postMessage(${JSON.stringify(reply)}))`,{eval:true});
      await expect(parseWebArticle(...args,{createWorker})).rejects.toThrow(/无效|为空|失败/);
    }
    await expect(parseWebArticle(...args,{createWorker:()=>new Worker("throw new Error('secret')",{eval:true})})).rejects.toThrow(/失败/);
  });
});
