import { parseHTML } from 'linkedom';
import { expect, it } from 'vitest';
import { captureBoundedDom } from '../../src/main/render-dom-capture';

it('捕获动态正文和结构，转义文本与属性且保留中文', () => {
  const { document }=parseHTML('<html><body><article><p>原文</p></article></body></html>');
  const paragraph=document.createElement('p'); paragraph.textContent='续写 < & 中文'; paragraph.setAttribute('title','"出处"');
  document.querySelector('article')!.append(paragraph);
  const html=captureBoundedDom(document,{maxDomNodes:20000,maxDomBytes:5*1024*1024});
  expect(html).toContain('续写 &lt; &amp; 中文'); expect(html).toContain('title="&quot;出处&quot;"');
  expect(parseHTML(html).document.querySelectorAll('p')).toHaveLength(2);
});
it('超过节点预算先拒绝，不访问outerHTML', () => {
  const { document }=parseHTML('<html><body><p>一</p><p>二</p></body></html>');
  Object.defineProperty(document.documentElement,'outerHTML',{get(){throw new Error('不应生成无限DOM');}});
  expect(()=>captureBoundedDom(document,{maxDomNodes:3,maxDomBytes:1024})).toThrow(/节点/);
});
it('按UTF8与转义后字节计算边界，拒绝大文本和大属性', () => {
  const { document }=parseHTML('<html><body>汉字</body></html>');
  const html=captureBoundedDom(document,{maxDomNodes:20,maxDomBytes:1024}); const bytes=Buffer.byteLength(html);
  expect(captureBoundedDom(document,{maxDomNodes:20,maxDomBytes:bytes})).toBe(html);
  expect(()=>captureBoundedDom(document,{maxDomNodes:20,maxDomBytes:bytes-1})).toThrow(/容量/);
  document.body.textContent='&'.repeat(1000);
  expect(()=>captureBoundedDom(document,{maxDomNodes:20,maxDomBytes:1100})).toThrow(/容量/);
  document.body.textContent='正文'; document.body.setAttribute('data-value','x'.repeat(2000));
  expect(()=>captureBoundedDom(document,{maxDomNodes:20,maxDomBytes:1000})).toThrow(/容量/);
});
it('深层节点用有界迭代遍历，空文档与非法限额拒绝', () => {
  const { document }=parseHTML('<html><body></body></html>'); let node=document.body;
  for(let i=0;i<1200;i++){const child=document.createElement('div');node.append(child);node=child;}
  expect(captureBoundedDom(document,{maxDomNodes:2000,maxDomBytes:20000})).toContain('<div>');
  expect(()=>captureBoundedDom(document,{maxDomNodes:0,maxDomBytes:10})).toThrow();
});
