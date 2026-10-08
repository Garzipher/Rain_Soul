const invalid = () => new Error('头像必须为静态 PNG、JPEG 或 WebP，尺寸有效且不超过 4000 万像素。');
function dimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 40_000_000) throw invalid();
  return { width, height };
}

function png(bytes: Buffer) {
  let offset = 8, image = false;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset), end = offset + size + 12;
    if (end > bytes.length) throw invalid();
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (offset === 8) {
      if (type !== 'IHDR' || size !== 13) throw invalid();
      dimensions(bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12));
    } else if (type === 'IHDR') throw invalid();
    // APNG 的帧可能声明不同尺寸；首版头像只接受静态图。
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) throw invalid();
    if (type === 'IDAT' && size) image = true;
    if (type === 'IEND') {
      if (size || !image || end !== bytes.length) throw invalid();
      return;
    }
    offset = end;
  }
  throw invalid();
}

function jpeg(bytes: Buffer) {
  let offset = 2, frame = false, scan = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) throw invalid();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!frame || !scan || offset !== bytes.length) throw invalid();
      return;
    }
    if (offset + 2 > bytes.length) throw invalid();
    const size = bytes.readUInt16BE(offset), end = offset + size;
    if (size < 2 || end > bytes.length) throw invalid();
    const sof = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
    if (sof) {
      if (frame || ![0xc0, 0xc1, 0xc2].includes(marker) || size < 8 || size !== 8 + 3 * bytes[offset + 7]) throw invalid();
      dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
      frame = true;
    }
    // 不接受 DNL 重定义高度，也不接受层次或重复帧绕过首个 SOF。
    if ([0xdc, 0xd8, 0xde, 0xdf].includes(marker)) throw invalid();
    offset = end;
    if (marker === 0xda) {
      if (!frame || size < 6) throw invalid();
      scan = true;
      // 跳过熵编码数据；FF00 是转义，FFD0-D7 是重启标记。
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        let next = offset + 1;
        while (bytes[next] === 0xff) next++;
        const value = bytes[next];
        if (value === 0 || (value >= 0xd0 && value <= 0xd7)) { offset = next + 1; continue; }
        break;
      }
    }
  }
  throw invalid();
}

function webp(bytes: Buffer) {
  if (bytes.length < 20 || bytes.readUInt32LE(4) + 8 !== bytes.length) throw invalid();
  let offset = 12, frame: { width: number; height: number } | undefined, canvas: typeof frame;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8, end = start + size;
    if (end + (size % 2) > bytes.length) throw invalid();
    if (type === 'VP8X') {
      if (offset !== 12 || size !== 10 || (bytes[start] & 2)) throw invalid();
      canvas = dimensions(bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1);
    }
    if (type === 'ANIM' || type === 'ANMF') throw invalid();
    if (type === 'VP8 ' || type === 'VP8L') {
      if (frame) throw invalid();
      if (type === 'VP8 ') {
        if (size < 10 || (bytes[start] & 1) || bytes.toString('hex', start + 3, start + 6) !== '9d012a') throw invalid();
        frame = dimensions(bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff);
      } else {
        if (size < 5 || bytes[start] !== 0x2f || (bytes[start + 4] & 0xe0)) throw invalid();
        const bits = bytes.readUInt32LE(start + 1);
        frame = dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      }
    }
    offset = end + (size % 2);
  }
  if (offset !== bytes.length || !frame || (canvas && (canvas.width !== frame.width || canvas.height !== frame.height))) throw invalid();
}

/** 解析所有尺寸声明，先限制解码成本；像素内容仍由原生解码器校验。 */
export function validateAvatarHeader(bytes: Buffer): void {
  if (bytes.length >= 8 && bytes.toString('hex', 0, 8) === '89504e470d0a1a0a') return png(bytes);
  if (bytes.length >= 2 && bytes.readUInt16BE(0) === 0xffd8) return jpeg(bytes);
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return webp(bytes);
  throw invalid();
}
