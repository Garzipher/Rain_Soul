export interface TextDifference { kind: 'equal' | 'delete' | 'insert'; text: string }
/** 有界 Unicode 差异；大范围改写显示完整替换，避免长稿构造无界矩阵。 */
export function diffText(before: string, after: string): TextDifference[] {
  const left = [...before], right = [...after], result: TextDifference[] = [];
  const append = (kind: TextDifference['kind'], text: string) => {
    if (!text) return;
    const last = result.at(-1);
    if (last?.kind === kind) last.text += text; else result.push({ kind, text });
  };
  let prefix = 0, suffix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - suffix - 1] === right[right.length - suffix - 1]) suffix++;
  append('equal', left.slice(0, prefix).join(''));
  const a = left.slice(prefix, left.length - suffix), b = right.slice(prefix, right.length - suffix);
  if ((a.length + 1) * (b.length + 1) > 250000) {
    append('delete', a.join('')); append('insert', b.join(''));
  } else {
    const width = b.length + 1, grid = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
      grid[i * width + j] = a[i] === b[j] ? grid[(i + 1) * width + j + 1] + 1 : Math.max(grid[(i + 1) * width + j], grid[i * width + j + 1]);
    }
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { append('equal', a[i++]); j++; }
      else if (i < a.length && (j === b.length || grid[(i + 1) * width + j] >= grid[i * width + j + 1])) append('delete', a[i++]);
      else append('insert', b[j++]);
    }
  }
  append('equal', suffix ? left.slice(left.length - suffix).join('') : '');
  return result;
}
