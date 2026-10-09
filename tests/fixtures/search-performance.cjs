const Database = require('better-sqlite3');
const { createHash } = require('node:crypto');

const seed = 0x5261696e;
const themes = ['雨夜描写', '月光景物', '雪地足迹', '灯塔守望', '车站重逢', '内心独白', '紫色海岸线', '凌晨旧钟楼',
  '无声河流', '人物神态描写', 'riverboat', 'CloudSky', '2048年', '旧信细节', '青石小路', '潮汐回声'];
const tagNames = ['性能标签甲', '性能标签乙'];
const normalize = text => text.normalize('NFC').toLowerCase();
function stableId(kind, index) {
  const bytes = createHash('sha256').update(`${seed}:${kind}:${index}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 一百万字是可复现的性能数据基线，不是作者作品的长度限制。 */
function seedSearchProject(filename, workId) {
  const db = new Database(filename, { fileMustExist: true });
  let state = seed;
  const filler = [...'山川草木天地远近春秋云海光影心梦晨暮声路水石花叶'];
  const body = (theme, length) => {
    let text = theme;
    while (text.length < length) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      text += filler[(state >>> 0) % filler.length];
    }
    return text;
  };
  const rows = [];
  const tags = tagNames.map((name, index) => ({ id: stableId('tag', index), name }));
  try {
    if (db.prepare('SELECT id FROM work_meta').get()?.id !== workId) throw new Error('性能夹具只能填入指定隔离作品。');
    const category = db.prepare("SELECT id FROM category WHERE system_key='uncategorized' AND deleted_at IS NULL").get();
    if (!category || db.prepare('SELECT COUNT(*) AS count FROM chapter').get().count !== 1
      || db.prepare('SELECT COUNT(*) AS count FROM knowledge_entry').get().count !== 0) throw new Error('性能夹具只接受空白新作品。');
    db.pragma('foreign_keys=ON');
    db.transaction(() => {
      db.prepare('DELETE FROM search_document').run(); db.prepare('DELETE FROM chapter').run();
      const chapterInsert = db.prepare('INSERT INTO chapter(id,title,document_json,word_count,sort_order) VALUES(?,?,?,?,?)');
      const searchInsert = db.prepare('INSERT INTO search_document VALUES(?,?,?,?,?,?,?,?)');
      for (let chapterIndex = 0; chapterIndex < 100; chapterIndex++) {
        const chapterId = stableId('chapter', chapterIndex), title = `性能正文第${String(chapterIndex + 1).padStart(3, '0')}章`;
        const content = [];
        for (let paragraphIndex = 0; paragraphIndex < 20; paragraphIndex++) {
          const index = chapterIndex * 20 + paragraphIndex, paragraphId = stableId('paragraph', index);
          const text = body(themes[index % themes.length], 500);
          const id = `p:${chapterId}:${paragraphId}`;
          content.push({ type: 'paragraph', attrs: { id: paragraphId }, content: [{ type: 'text', text }] });
          searchInsert.run(id, 'paragraph', chapterId, paragraphId, title, text, title, normalize(`${text}\n${title}\n`));
          rows.push({ id, kind: 'paragraph', body: text, source: title, title, tagNames: [] });
        }
        chapterInsert.run(chapterId, title, JSON.stringify({ type: 'doc', content }), 10000, chapterIndex);
      }
      for (const tag of tags) db.prepare('INSERT INTO tag VALUES(?,?,NULL)').run(tag.id, tag.name);
      const knowledgeInsert = db.prepare('INSERT INTO knowledge_entry VALUES(?,?,?,?,NULL,1,NULL)');
      const tagInsert = db.prepare('INSERT INTO knowledge_tag VALUES(?,?)');
      for (let index = 0; index < 1000; index++) {
        const id = stableId('knowledge', index), text = body(themes[index % themes.length], 120);
        const source = `性能夹具参考${String(index).padStart(4, '0')}`;
        const selectedTags = tags.filter((_, position) => index % (position + 2) === 0);
        knowledgeInsert.run(id, text, source, category.id);
        for (const tag of selectedTags) tagInsert.run(id, tag.id);
        db.prepare('INSERT INTO knowledge_history VALUES(?,1,?,?)').run(id, text, source);
        const rowId = `k:${id}`;
        searchInsert.run(rowId, 'knowledge', null, null, '', text, source, normalize(`${text}\n${source}\n${selectedTags.map(tag => tag.name).join('\n')}`));
        rows.push({ id: rowId, kind: 'knowledge', body: text, source, title: '', tagNames: selectedTags.map(tag => tag.name) });
      }
      db.prepare('UPDATE work_meta SET updated_at=?').run('2026-10-09T00:00:00.000Z');
    }).immediate();
    if (db.pragma('foreign_key_check').length) throw new Error('性能夹具外键校验失败。');
    const totals = db.prepare('SELECT COUNT(*) AS chapters,SUM(word_count) AS words FROM chapter').get();
    const counted = rows.filter(row => row.kind === 'paragraph').reduce((sum, row) => sum + [...row.body].filter(char => /[\p{Script=Han}A-Za-z0-9]/u.test(char)).length, 0);
    if (totals.chapters !== 100 || totals.words !== 1000000 || counted !== 1000000) throw new Error('性能夹具统计字数不匹配。');
    db.pragma('wal_checkpoint(TRUNCATE)');
    return { seed, chapterCount: 100, paragraphCount: 2000, wordCount: counted, knowledgeCount: 1000, rows, tagNames };
  } finally { db.close(); }
}

const queries = ['雨', '月', '雪', '灯塔', '车站', '内心', '紫色海岸线', '凌晨旧钟楼', '无声河流', '人物神态描写',
  'riverboat', 'CloudSky', '2048', '青石小路', '不存在的银色飞艇'].map(text => ({ text, mode: 'all', tags: [] }));
queries.push(...[
  { text: '雨', tags: [tagNames[0]] }, { text: '雨', tags: [tagNames[1]] }, { text: '雨', tags: [...tagNames] },
  { text: '人物神态描写', tags: [...tagNames] }, { text: '描写', tags: [...tagNames] },
].map(query => ({ ...query, mode: 'knowledge' })));

/** 从生成数据做独立穷举核对，不调用产品的 Repository 或 SQL 搜索实现。 */
function expectedResults(fixture, query) {
  const text = normalize(query.text);
  const matched = fixture.rows.filter(row => (query.mode === 'all' || row.kind === 'knowledge')
    && normalize(`${row.body}\n${row.source}\n${row.tagNames.join('\n')}`).includes(text)
    && (row.kind === 'paragraph' || query.tags.every(tag => row.tagNames.includes(tag))))
    .sort((left, right) => left.kind.localeCompare(right.kind, 'en') || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)).slice(0, 200);
  return { knowledge: matched.filter(row => row.kind === 'knowledge').map(row => ({ body: row.body, source: row.source })),
    paragraphs: matched.filter(row => row.kind === 'paragraph').map(row => {
      const start = Math.max(0, normalize(row.body).indexOf(text) - 40);
      return { title: row.title, snippet: `${start ? '…' : ''}${row.body.slice(start, start + 240)}${row.body.length > start + 240 ? '…' : ''}` };
    }) };
}
module.exports = { seedSearchProject, expectedResults, queries };
