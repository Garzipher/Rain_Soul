/** 可在隔离世界中执行的纯函数，不依赖 Node 或页面提供的序列化器。 */
export function captureBoundedDom(document: Document, limits: {maxDomNodes:number;maxDomBytes:number}): string {
  if (!Number.isSafeInteger(limits.maxDomNodes) || limits.maxDomNodes<1 || !Number.isSafeInteger(limits.maxDomBytes) || limits.maxDomBytes<1 || !document.documentElement) throw new Error('DOM捕获限额或文档无效。');
  // 第一遍把节点与属性计入共同预算，不读取属性值或创建 outerHTML。
  const pending: Node[]=[document.documentElement]; let count=0;
  while(pending.length){
    const node=pending.pop()!; if(++count>limits.maxDomNodes) throw new Error('网页DOM节点超限。');
    if(node.nodeType===1){
      count+=(node as Element).attributes.length;
      if(count>limits.maxDomNodes) throw new Error('网页DOM节点超限。');
    }
    for(let child=node.lastChild;child;child=child.previousSibling) {
      if(pending.length+count>=limits.maxDomNodes) throw new Error('网页DOM节点超限。');
      pending.push(child);
    }
  }
  const output:string[]=[]; let bytes=0; const encoder=new TextEncoder();
  function append(text:string){
    if(text.length>limits.maxDomBytes-bytes) throw new Error('网页DOM容量超限。');
    for(let offset=0;offset<text.length;offset+=4096){
      const end=Math.min(text.length,offset+4096);
      // 避免分割UTF-16代理对导致计数与最终UTF-8不一致。
      const adjusted=end<text.length && /[\uD800-\uDBFF]/.test(text[end-1]) ? end-1 : end;
      const part=text.slice(offset,adjusted); bytes+=encoder.encode(part).length;
      if(bytes>limits.maxDomBytes) throw new Error('网页DOM容量超限。');
      output.push(part); offset=adjusted-4096;
    }
  }
  function escaped(text:string,attribute=false){
    if(text.length>limits.maxDomBytes-bytes) throw new Error('网页DOM容量超限。');
    append(text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(attribute?/"/g:/$^/g,'&quot;'));
  }
  const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const stack:(Node|string)[]=[document.documentElement];
  while(stack.length){
    const item=stack.pop()!; if(typeof item==='string'){append(item);continue;}
    if(item.nodeType===3){escaped(item.nodeValue??'');continue;}
    if(item.nodeType!==1) continue;
    const element=item as Element, tag=element.localName;
    if(!/^[a-zA-Z][a-zA-Z0-9:_-]*$/.test(tag)) throw new Error('网页元素名称无效。');
    append('<'+tag);
    const attributes=element.attributes;
    for(let index=0;index<attributes.length;index++){
      const attribute=attributes[index];
      if(!/^[a-zA-Z_:][a-zA-Z0-9:_.-]*$/.test(attribute.name)) throw new Error('网页属性名称无效。');
      append(' '); append(attribute.name); append('="'); escaped(attribute.value,true); append('"');
    }
    append('>'); if(voidTags.has(tag.toLowerCase())) continue;
    stack.push('</'+tag+'>');
    for(let child=item.lastChild;child;child=child.previousSibling)stack.push(child);
  }
  return output.join('');
}
