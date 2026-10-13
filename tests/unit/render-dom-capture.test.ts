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
it('忽略注释且void元素无闭合标签，代理对跨4096边界仍精确计算UTF8', () => {
  const { document }=parseHTML('<html><body><!--不属于正文--><br><img src="x"><p></p></body></html>');
  const paragraph=document.querySelector('p')!; paragraph.textContent='a'.repeat(4095)+'😀汉字';
  const html=captureBoundedDom(document,{maxDomNodes:20,maxDomBytes:10000});
  expect(html).toContain('a'.repeat(4095)+'😀汉字'); expect(html).not.toContain('不属于正文'); expect(html).not.toContain('</br>');
  const bytes=Buffer.byteLength(html); expect(captureBoundedDom(document,{maxDomNodes:20,maxDomBytes:bytes})).toBe(html);
  expect(()=>captureBoundedDom(document,{maxDomNodes:20,maxDomBytes:bytes-1})).toThrow(/容量/);
});
it.each([{maxDomNodes:1.5,maxDomBytes:10},{maxDomNodes:1,maxDomBytes:0},{maxDomNodes:1,maxDomBytes:NaN}])('无效预算拒绝：%o', limits => {
  const { document }=parseHTML('<html></html>'); expect(()=>captureBoundedDom(document,limits)).toThrow(/限额/);
});
it('空文档与非法元素或属性名称拒绝，不能序列化为注入标记', () => {
  const { document }=parseHTML('<html><body>正文</body></html>');
  expect(()=>captureBoundedDom({documentElement:null} as unknown as Document,{maxDomNodes:20,maxDomBytes:1000})).toThrow(/文档/);
  Object.defineProperty(document.body,'localName',{value:'bad tag',configurable:true});
  expect(()=>captureBoundedDom(document,{maxDomNodes:20,maxDomBytes:1000})).toThrow(/元素名称/);
  Object.defineProperty(document.body,'localName',{value:'body'});
  Object.defineProperty(document.body,'attributes',{value:[{name:'bad attr',value:'正文'}]});
  expect(()=>captureBoundedDom(document,{maxDomNodes:20,maxDomBytes:1000})).toThrow(/属性名称/);
});
it('属性计入整体节点预算，超限前不读取或物化属性集合', () => {
  const { document }=parseHTML('<html><body></body></html>');
  const attributes={length:1000000,get 0(){throw new Error('不应读取超限属性');}};
  Object.defineProperty(document.body,'attributes',{value:attributes});
  expect(()=>captureBoundedDom(document,{maxDomNodes:20,maxDomBytes:1000})).toThrow(/节点/);
});
it('逐项读取属性，字节预算用尽后不访问后续属性', () => {
  const { document }=parseHTML('<html><body></body></html>');
  const attributes={length:2,0:{name:'title',value:'汉'.repeat(100)},get 1(){throw new Error('不应读取后续属性');}};
  Object.defineProperty(document.body,'attributes',{value:attributes});
  expect(()=>captureBoundedDom(document,{maxDomNodes:20,maxDomBytes:30})).toThrow(/容量/);
});
it('节点与属性共同预算的精确边界可捕获，少一个配额则拒绝', () => {
  const { document }=parseHTML('<html lang="zh"><body title="汉字" data-source="&"></body></html>');
  const html=captureBoundedDom(document,{maxDomNodes:5,maxDomBytes:1000});
  expect(html).toContain('title="汉字"'); expect(html).toContain('data-source="&amp;"');
  expect(()=>captureBoundedDom(document,{maxDomNodes:4,maxDomBytes:1000})).toThrow(/节点/);
  const bytes=Buffer.byteLength(html);
  expect(captureBoundedDom(document,{maxDomNodes:5,maxDomBytes:bytes})).toBe(html);
  expect(()=>captureBoundedDom(document,{maxDomNodes:5,maxDomBytes:bytes-1})).toThrow(/容量/);
});
