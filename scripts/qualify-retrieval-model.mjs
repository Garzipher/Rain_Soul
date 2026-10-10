import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import process from 'node:process';
import console from 'node:console';
import { performance } from 'node:perf_hooks';
import { setInterval, clearInterval, setTimeout, clearTimeout } from 'node:timers';

// 资格试验仅读取公开模型和隔离依赖，不访问作者作品或产品运行配置。
const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), '..');
const temporary = join(root, '.tmp-model-qualification');
const prefix = '为这个句子生成表示以用于检索相关文章：';
const manifest = [
  ['config.json', 716, 'd4193ead3a810fd694fa8a31d7fc72fbaebc0668b603e398734bf2f6538ff42f'],
  ['tokenizer.json', 439125, '48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26'],
  ['tokenizer_config.json', 367, 'e6f3b96db926a37d4039995fbf5ad17de158dfb8f6343d607e4dbaad18d75f5a'],
  ['special_tokens_map.json', 125, 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3'],
  ['onnx/model_quantized.onnx', 24010842, '15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc'],
];

// 在推理前固定原创夹具与相关身份；属于开发者预标注，仍需独立人工审核。
const knowledgeTexts = [
  '环境烘托：人物独坐空房，窗外冷雨打在玻璃上，用阴冷景物映照寂寞心情。',
  '动作显情绪：他把衣角攥成一团又松开，用微小身体动作表现等待时的不安。',
  '对话潜台词：角色嘴上说随便，手却把礼物抱紧，话语与行为的差异表达真实愿望。',
  '伏笔回收：开篇一枚断齿钥匙在结尾打开暗柜，让早先的细节参与解决冲突。',
  '有限视角：叙事只呈现主角能看见和知道的信息，其他人的动机留给读者推测。',
  '场景转场：前一场以门铃结束，后一场以来客鞋上的泥开头，靠共同细节自然连接。',
  '节奏放慢：危急决定之前描写呼吸、指尖和钟摆，延长关键瞬间的主观感受。',
  '节奏加速：追逐中压缩说明，使用连续短句和动作，使阅读速度贴近紧迫事件。',
  '人物弧光：曾经逃避责任的人在高潮主动保护同伴，以行动完成价值选择的变化。',
  '冲突升级：每次试图解决问题都付出更高代价，让主人公可选的退路逐渐减少。',
  '信息悬念：先展示一个反常结果，暂缓解释原因，促使读者追问到底发生了什么。',
  '戏剧反讽：读者知道杯中有毒而人物仍要饮用，信息差产生紧张感。',
  '感官细节：写老屋时加入木头霉味和地板吱响，让场景通过嗅觉听觉显得具体。',
  '场景目标：每一场给人物一个想达到的目的，并用阻碍迫使他采取新的行动。',
  '开放结尾：解决故事的核心矛盾，保留人物未来的选择空间，使余味继续延伸。',
  '人物外貌：选取与生活经历相关的疤痕和衣物细节，避免罗列身高五官。',
  '人物性格：让角色面对难以两全的选择，用付出的代价显现价值排序。',
  '人物关系：通过称呼改变和座位距离呈现两个人的亲疏变化。',
  '人物弱点：能力强的人仍会误判亲密关系，弱点制造可信的阻力。',
  '人物动机：为目标给出具体损失与需求，让读者理解他为什么不能放弃。',
  '空间调度：先交代出口和障碍的位置，再写人物移动，避免打斗中方向混乱。',
  '时间顺序：明确一天中的时刻与事件间隔，检查赶路和通信是否来得及。',
  '倒叙：从关键后果切入再回到事情起点，提前建立读者的兴趣。',
  '插叙：当前事件触发一段相关回忆，回忆结束后返回原场景的动作。',
  '预叙：简短暗示未来将付出的代价，不能提前解释全部结果。',
  '多线叙事：不同人物围绕同一问题行动，用共同事件在关键节点汇合。',
  '双线对照：一条线追求成功，另一条线承受代价，让两条经历互相解释。',
  '章节钩子：章末留下具体未完成行动，使下一章有明确承接对象。',
  '章节开场：从角色正在做的事情切入，避免先解释整段背景。',
  '故事中点：新证据颠覆主角对目标的理解，迫使行动方向改变。',
  '高潮：把最困难的价值选择与最终行动放在同一场景完成。',
  '结局：交代核心行动的后果与角色关系的改变，不替读者解释全部主题。',
  '世界规则：提前展示能力的限制和代价，高潮不能突然增加万能能力。',
  '设定融入：让人物在完成目标时遇到规则，用行动展示世界如何运行。',
  '角色命名：保证同场人物名字在发音与字形上可区分，减少阅读混淆。',
  '背景信息：只交代当前理解行动必须知道的历史，余下信息随剧情展开。',
  '场景气氛：选取同一情绪方向的光线、声音和物件，维持场景整体感。',
  '情绪转折：让新事实先改变人物的理解，再改变他的动作和语气。',
  '喜剧情境：严肃人物试图维持体面却不断遇到小失误，反差产生幽默。',
  '悲剧情境：人物为了守住珍惜的东西做出选择，却因此失去另一重要关系。',
  '比喻：把陌生感受联系到读者能感知的具体事物，避免多个比喻互相冲突。',
  '拟人：赋予景物适量动作，让环境参与情绪表达而不掩盖主体。',
  '排比：平行句式集中推进同一情绪，长段落应避免重复意思。',
  '反复：同一句话在不同场景再次出现，因处境变化产生新的含义。',
  '象征：一个反复出现的物件与人物经验关联，其含义由情节逐步建立。',
  '意象：把声音、颜色与情绪记忆联系起来，形成可辨认的作品体验。',
  '白描：用少量准确名词和动作呈现状态，减少形容词堆叠。',
  '长句：表达连续思考与复杂关联时可延长句子，但要保留清楚的主干。',
  '短句：表达停顿与突然变化，短句与长句搭配避免单调。',
  '词语选择：使用确切动词替换模糊副词，先明确角色到底做了什么。',
  '标点节奏：通过句号与逗号安排停顿，避免用连续省略号替代情绪变化。',
  '段落组织：每段围绕同一动作或观察展开，转移主体时及时分段。',
  '对话归属：多人对话及时标明说话者，辅以动作避免全部使用他说。',
  '对话声音：不同角色在用词、句长和回避话题上保持各自习惯。',
  '对话删减：保留会改变关系或行动的信息，删掉无目的问候。',
  '心理描写：从眼前刺激引发具体联想，避免人物凭空做长篇自我分析。',
  '内心独白：保持与人物年龄和知识范围相符的表达，不替他发表作者议论。',
  '叙述距离：靠近人物时呈现即时感受，拉远时概括时间和事件。',
  '第一人称：叙述者的偏见和遗漏可成为线索，但不能知道没见过的私事。',
  '第三人称：提前选定视角范围，切换人物意识时给出清楚界限。',
  '不可靠叙述：让讲述者的解释与外部证据冲突，读者据此发现遗漏。',
  '主题：让反复出现的选择与后果表达关切，减少直接说教。',
  '细节筛选：优先留下会改变理解或后续行动的细节，删去无功能装饰。',
  '重复信息：删除前后段已经表达过的事实，只保留新变化。',
  '说明与场景：不重要的经过概括，影响关系的关键决定展开成场景。',
  '情节因果：后一事件由前一行动触发，不能只靠巧合推进全部转折。',
  '巧合：巧合可以带来问题，解决主要矛盾应依靠已经建立的行动。',
  '反转：新解释必须能重新理解已有证据，不能靠临时补充关键事实。',
  '红鲱鱼：误导线索有真实来源，揭晓后仍解释它为什么存在。',
  '悬疑公平性：关键证据在揭晓前出现，让读者有机会进行推理。',
  '恋爱关系：通过具体帮助和分歧累积信任，避免只靠外貌判断亲密。',
  '家庭关系：同一件家务背后可有不同期待，冲突来自角色理解不一致。',
  '友情关系：让同伴在不方便时仍做出支持，行动证明友谊。',
  '师徒关系：老师的限制和学生的误解推动成长，不能无限代替学生解题。',
  '对手关系：双方追求有交集的资源，差异在手段和价值选择。',
  '群像结构：为主要人物分配不同功能，保证各自行动影响共同结果。',
  '配角：除帮助主角外保留自己的目标，使行动不只服务剧情需求。',
  '反派：明确他相信的理由和实现方式，不能仅用坏解释全部行为。',
  '场景结尾：人物带着新决定或更大问题离开，使下一场有推进力。',
  '场景删改：没有新信息、关系变化或行动结果的场景可以合并删除。',
  '写作计划：先写可执行的小场景目标，避免把完成整部作品作为日常任务。',
  '初稿：先完成主要行动链，细节修饰留给后续修订。',
  '修订顺序：先处理结构和因果，再调整句子与标点，避免局部返工。',
  '朗读检查：读出句子可发现呼吸不顺与说话归属不清。',
  '校对：逐项检查人名、数字、时刻和地名的一致性。',
  '版本记录：重要修改前保存可恢复版本，注明修改目标。',
  '阅读笔记：区分原文摘录和自己的分析，保留来源定位。',
  '仿写练习：借鉴结构与技巧，换用原创情境和人物，不照搬未授权表达。',
  '素材权利：公开可阅读不等于可任意复制出版，使用前确认授权范围。',
  '创作伦理：描写真实人物时避免暴露不必要的私人资料。',
  '日常观察：记录具体动作和声音，避免只写抽象情绪评价。',
  '采访记录：区分受访者原话与整理者解释，核对关键事实。',
  '地点调查：记录距离、方向与可通行路线，为空间描述提供依据。',
  '历史考证：年代、制度和日常用品分别查证，避免混用时代。',
  '人物档案：记录习惯与经历，并标出尚未确定的设定。',
  '时间线：用事件日期和间隔检查多线故事是否一致。',
  '大纲调整：变更重要事件时同步检查伏笔与后续行动的依赖。',
  '伏笔清单：记录埋设位置与回收状态，避免线索长期无回应。',
  '学习复盘：记录修改前后的效果和失败原因，下次练习验证是否改进。',
  '作者休息：在长期写作中安排可持续的工作节奏，避免疲劳降低校对注意力。',
];
const knowledge = knowledgeTexts.map((body, index) => ({ id: `k${String(index + 1).padStart(3, '0')}`, body }));
const acceptance = [
  ['语义', '想让空荡房间里的冷天气映出一个人的寂寞，有什么写法？', 'k001'],
  ['语义', '不用直接写很紧张，怎样让读者从小动作看出不安？', 'k002'],
  ['语义', '人物说的和心里想的不一样，怎么让读者明白？', 'k003'],
  ['语义', '开头留下的小物件如何在最后发挥作用？', 'k004'],
  ['语义', '讲故事时不提前透露主角不知道的事情，应该怎样控制信息？', 'k005'],
  ['语义', '换到另一个场面时怎样让读起来不生硬？', 'k006'],
  ['语义', '一个重要决定只用了一秒，我想让读者感觉这一刻很漫长。', 'k007'],
  ['语义', '逃跑追赶那一段想读起来更急促，该怎样调整句子？', 'k008'],
  ['语义', '开头胆怯逃避的人最后主动扛起责任，怎样安排这种成长？', 'k009'],
  ['语义', '怎么让主人公越来越没有退路，解决困难越来越昂贵？', 'k010'],
  ['语义', '先让人看到怪事却不马上解释，怎么吸引继续阅读？', 'k011'],
  ['语义', '读者已知道危险而当事人还蒙在鼓里，可以怎样制造紧张？', 'k012'],
  ['语义', '老房子不想只写看起来破旧，怎样加入味道和声响？', 'k013'],
  ['语义', '一场戏总像流水账，怎么给角色一个要达成的目的和阻碍？', 'k014'],
  ['语义', '主问题已经解决，但想留一点让人继续想象的余地，结尾怎么写？', 'k015'],
  ['关键词', '人物外貌 疤痕衣物', 'k016'], ['关键词', '人物性格 价值排序', 'k017'],
  ['关键词', '人物关系 称呼距离', 'k018'], ['关键词', '人物弱点 误判', 'k019'],
  ['关键词', '人物动机 损失需求', 'k020'], ['关键词', '空间调度 出口障碍', 'k021'],
  ['关键词', '时间顺序 事件间隔', 'k022'], ['关键词', '倒叙 关键后果', 'k023'],
  ['关键词', '插叙 当前回忆', 'k024'], ['关键词', '预叙 未来代价', 'k025'],
  ['无相关', '量子计算机怎样使用纠错码保护逻辑量子比特？', null],
  ['无相关', '怎样调整柴油发动机喷油泵的供油提前角？', null],
  ['无相关', '急性阑尾炎手术麻醉前需要哪些检验指标？', null],
  ['无相关', '求解椭圆积分的数值算法应怎样控制误差？', null],
  ['无相关', '铝合金热处理淬火温度与晶界析出有何关系？', null],
].map(([group, text, target], index) => ({ id: `q${index + 1}`, group, text, relevantIds: target ? [target] : [] }));
const calibration = [
  ['每个角色的语言习惯怎样写出区别？', 'k054'], ['叙述者说谎怎么让读者从证据发现？', 'k061'],
  ['意外转折要怎样让先前出现的线索说得通？', 'k068'], ['怎样避免每个关键问题都靠偶然解决？', 'k067'],
  ['修改稿子先调整整体结构还是先改每句话？', 'k083'], ['让坏人的行动有可信的理由而不只是坏。', 'k078'],
  ['幻想能力的代价和边界什么时候交代？', 'k033'], ['好多角色的故事如何在同一个事件碰面？', 'k026'],
  ['写完以后朗读能发现哪类句子问题？', 'k084'], ['借鉴名家的叙事技法但不复制原句，如何练习？', 'k088'],
  ['石墨烯晶格缺陷怎样改变电子迁移率？', null], ['核磁共振成像的射频脉冲怎样设计？', null],
  ['大豆根瘤菌固氮效率受哪些土壤元素影响？', null], ['电力变压器绕组绝缘局部放电如何检测？', null],
  ['航天器轨道倾角如何通过变轨机动改变？', null], ['蛋白质折叠的自由能如何数值计算？', null],
  ['碳酸锂期货跨期套利应计算哪些保证金成本？', null], ['心脏瓣膜置换后抗凝药的剂量怎样监测？', null],
  ['大型压缩机叶轮喘振边界如何测量？', null], ['水泥熟料烧成过程中硅酸三钙如何形成？', null],
].map(([text, target], index) => ({ id: `c${index + 1}`, text, relevantIds: target ? [target] : [] }));

function keywordCandidates(text) {
  const terms = new Set();
  for (const match of text.toLowerCase().matchAll(/[\p{Script=Han}]{2,}|[a-z0-9]{2,}/gu)) {
    if (/\p{Script=Han}/u.test(match[0])) for (let index = 0; index < match[0].length - 1; index++) terms.add(match[0].slice(index, index + 2));
    else terms.add(match[0]);
  }
  return knowledge.map(entry => ({ id: entry.id, score: [...terms].filter(term => entry.body.toLowerCase().includes(term)).length }))
    .filter(entry => entry.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).map(entry => entry.id);
}
async function evaluateQuality(extractor, tokenizer) {
  assert.equal(knowledge.length, 100); assert.equal(acceptance.length, 30);
  const fixture = { knowledge, acceptance, calibration, annotation: '开发者在推理前固定相关ID；独立真人标注复核未完成' };
  const fixtureHash = createHash('sha256').update(JSON.stringify(fixture)).digest('hex');
  await writeFile(join(temporary, 'quality-fixture.json'), JSON.stringify(fixture, null, 2));
  const embed = async texts => {
    const vectors = [];
    for (let offset = 0; offset < texts.length; offset += 16) vectors.push(...(await extractor(texts.slice(offset, offset + 16), { pooling: 'cls', normalize: true })).tolist());
    return vectors;
  };
  for (const entry of knowledge) assert.ok(tokenizer(entry.body, { add_special_tokens: false, truncation: false }).input_ids.data.length <= 400);
  const documents = await embed(knowledge.map(entry => entry.body));
  const queries = [...calibration, ...acceptance];
  const queryVectors = await embed(queries.map(query => prefix + query.text));
  const cosine = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  const raw = queries.map((query, index) => ({ ...query,
    semantic: knowledge.map((entry, j) => ({ id: entry.id, score: cosine(queryVectors[index], documents[j]) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)),
    keyword: keywordCandidates(query.text) }));
  const calibrated = raw.slice(0, calibration.length);
  // 阈值仅看独立校准集：选择能拒绝全部校准负例的最小阈值，正例覆盖另报告。
  const threshold = Math.min(1, Math.max(...calibrated.filter(query => !query.relevantIds.length).map(query => query.semantic[0].score)) + 0.0001);
  const positiveCalibrationRecall = calibrated.filter(query => query.relevantIds.length).map(query => query.semantic.filter(hit => hit.score >= threshold).slice(0, 5).some(hit => query.relevantIds.includes(hit.id)) ? 1 : 0);
  const { rankKnowledge } = await import(pathToFileURL(join(root, 'src/workers/retrieval/ranking.ts')));
  const entries = knowledge.map(entry => ({ workId: 'fixture', entryId: entry.id, bodyHash: createHash('sha256').update(entry.body).digest('hex'), excerpt: entry.body, source: '原创资格夹具', categoryId: 'writing', tagIds: [] }));
  const chunks = knowledge.map((entry, index) => ({ workId: 'fixture', entryId: entry.id, chunkIndex: 0, excerpt: entry.body, vector: documents[index] }));
  const results = raw.slice(calibration.length).map((query, index) => {
    const semantic = query.semantic.filter(hit => hit.score >= threshold).slice(0, 5);
    const hybrid = rankKnowledge({ entries, categories: [], keywords: query.keyword.map(entryId => ({ workId: 'fixture', entryId })), chunks,
      queryVector: queryVectors[index + calibration.length], threshold, mode: 'hybrid', filter: { workId: 'fixture', tagIds: [] } }).slice(0, 5);
    const recall = ids => query.relevantIds.length ? query.relevantIds.filter(id => ids.includes(id)).length / query.relevantIds.length : null;
    return { id: query.id, group: query.group, text: query.text, relevantIds: query.relevantIds,
      keywordTop5: query.keyword.slice(0, 5), semanticTop5: semantic, hybridTop5: hybrid.map(hit => ({ id: hit.entryId, score: hit.score, semanticScore: hit.semanticScore, matchedBy: hit.matchedBy })),
      keywordRecall: recall(query.keyword.slice(0, 5)), semanticRecall: recall(semantic.map(hit => hit.id)), hybridRecall: recall(hybrid.map(hit => hit.entryId)),
      reliableSemanticFalsePositive: !query.relevantIds.length && semantic.length > 0, maxSemantic: query.semantic[0] };
  });
  const paraphrases = results.filter(query => query.group === '语义');
  const average = field => paraphrases.reduce((sum, query) => sum + query[field], 0) / paraphrases.length;
  const summary = { fixtureHash, annotation: fixture.annotation, knowledgeCount: knowledge.length, acceptanceCount: acceptance.length, calibrationCount: calibration.length,
    threshold, calibrationPositiveRecall: positiveCalibrationRecall.reduce((a, b) => a + b, 0) / positiveCalibrationRecall.length,
    semanticParaphraseRecall: average('semanticRecall'), keywordParaphraseRecall: average('keywordRecall'), hybridParaphraseRecall: average('hybridRecall'),
    noRelevantFalsePositiveQueries: results.filter(query => query.reliableSemanticFalsePositive).length,
    failureQueries: results.filter(query => query.hybridRecall === 0 || query.reliableSemanticFalsePositive).map(query => query.id), results };
  summary.meetsNumericTargets = summary.hybridParaphraseRecall >= 0.8 && summary.hybridParaphraseRecall >= summary.keywordParaphraseRecall && summary.noRelevantFalsePositiveQueries <= 1;
  await writeFile(join(temporary, `quality-${workerData.mode}${workerData.wasm ? '-wasm' : ''}.json`), JSON.stringify({ ...summary, calibration: calibrated }, null, 2));
  return summary;
}

async function runQualification() {
  const baselineRss = process.memoryUsage().rss;
  const started = performance.now();
  const checks = [];
  for (const [file, bytes, sha256] of manifest) {
    const body = await readFile(join(temporary, 'model', file));
    assert.equal(body.length, bytes, `${file} 长度不匹配`);
    assert.equal(createHash('sha256').update(body).digest('hex'), sha256, `${file} 校验失败`);
    checks.push({ file, bytes, sha256 });
  }
  let networkAttempts = 0;
  const denyNetwork = () => { networkAttempts++; throw new Error('资格试验禁止联网'); };
  globalThis.fetch = denyNetwork;
  for (const name of ['http', 'https', 'net', 'tls', 'dns']) {
    const module = (await import(`node:${name}`)).default;
    for (const method of ['request', 'get', 'connect', 'createConnection', 'lookup', 'resolve', 'resolve4', 'resolve6']) {
      if (typeof module[method] === 'function') module[method] = denyNetwork;
    }
  }
  const requireRuntime = createRequire(join(temporary, 'runtime', 'package.json'));
  let transformers;
  if (workerData.production) {
    transformers = createRequire(join(root, 'dist/desktop/retrieval-runtime.cjs'))('./retrieval-runtime.cjs');
  } else
  if (workerData.wasm) {
    const webRuntime = await import(pathToFileURL(join(temporary, 'runtime/node_modules/onnxruntime-web/dist/ort.wasm.min.mjs')).href);
    globalThis[Symbol.for('onnxruntime')] = webRuntime;
    transformers = await import(pathToFileURL(join(temporary, workerData.direct ? 'direct-wasm.mjs' : 'transformers-wasm.mjs')).href);
    webRuntime.env.wasm.numThreads = 1;
    webRuntime.env.wasm.proxy = false;
    webRuntime.env.wasm.wasmBinary = await readFile(join(temporary, 'runtime/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'));
    webRuntime.env.wasm.wasmPaths = { mjs: pathToFileURL(join(temporary, 'runtime/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs')).href };
  } else transformers = requireRuntime('@huggingface/transformers');
  assert.equal(requireRuntime('onnxruntime-node/package.json').version, '1.30.0');
  const transformersPackage = JSON.parse(await readFile(join(temporary, 'runtime/node_modules/@huggingface/transformers/package.json'), 'utf8'));
  assert.equal(transformersPackage.version, '4.3.1');
  const { env, pipeline, AutoTokenizer } = transformers;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  env.useFSCache = false;
  const modelPath = join(temporary, 'model');
  if (workerData.wasm && !workerData.direct && !workerData.production) {
    env.useCustomCache = true;
    env.customCache = {
      async match(request) {
        const file = manifest.find(([name]) => request.replaceAll('\\', '/').endsWith(`/${name}`));
        if (!file) return undefined;
        return new globalThis.Response(await readFile(join(modelPath, file[0])));
      },
      async put() { throw new Error('资格试验禁止写入隐式缓存'); },
    };
  }
  let peakRss = Math.max(baselineRss, process.memoryUsage().rss);
  const sample = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
  let extractor;
  try {
    const tokenizer = await AutoTokenizer.from_pretrained(modelPath, { local_files_only: true });
    const tokenize = text => tokenizer(text, { padding: false, truncation: false }).input_ids.data.length;
    const query = '如何用天气变化暗示人物内心的孤独？';
    const queryTokens = tokenize(prefix + query);
    assert.ok(queryTokens <= 512);
    assert.ok(tokenize('雨'.repeat(401)) > 400);
    const loadedExtractor = await pipeline('feature-extraction', modelPath, {
      local_files_only: true, dtype: 'q8', device: workerData.wasm ? 'auto' : 'cpu',
      session_options: workerData.wasm ? { executionProviders: ['wasm'] } : { intraOpNumThreads: 2, interOpNumThreads: 1 },
    });
    extractor = Object.assign(async (...args) => {
      const output = await loadedExtractor(...args);
      return { ...output, tolist: () => Array.from({ length: output.dims[0] }, (_, row) => Array.from(output.data.slice(row * 512, (row + 1) * 512))) };
    }, { dispose: () => loadedExtractor.dispose() });
    const coldLoadMs = performance.now() - started;
    assert.ok(coldLoadMs <= 30000, '模型校验与加载超过30秒预算');
    const texts = [prefix + query, '窗外冷雨敲击玻璃，他独自坐在空房间，借环境描写映照人物孤独的心境。', '数据库事务使用原子提交，失败时回滚修改。'];
    const beforeInference = performance.now();
    const output = await extractor(texts, { pooling: 'cls', normalize: true });
    const inferenceMs = performance.now() - beforeInference;
    assert.deepEqual(output.dims, [3, 512]);
    const vectors = output.tolist();
    const norms = vectors.map(vector => Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)));
    for (const vector of vectors) assert.ok(vector.every(Number.isFinite));
    for (const norm of norms) assert.ok(Math.abs(norm - 1) < 1e-5);
    const repeated = (await extractor(texts, { pooling: 'cls', normalize: true })).tolist();
    const repeatMaxDifference = Math.max(...vectors.flatMap((vector, i) => vector.map((value, j) => Math.abs(value - repeated[i][j]))));
    assert.ok(repeatMaxDifference < 1e-5);
    const cosine = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
    const similarities = [cosine(vectors[0], vectors[1]), cosine(vectors[0], vectors[2])];
    assert.ok(similarities[0] > similarities[1], '真实中文示例语义排序失败');
    assert.equal(networkAttempts, 0);
    const quality = workerData.quality ? await evaluateQuality(extractor, tokenizer) : null;
    assert.equal(networkAttempts, 0);
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    assert.ok(peakRss - baselineRss <= 1.5 * 1024 ** 3, '宿主RSS增量超过1.5GiB预算');
    return { status: 'passed', timestamp: new Date().toISOString(), mode: workerData.mode,
      platform: process.platform, arch: process.arch, versions: process.versions,
      modelRevision: '75c43b069aac4d136ba6bc1122f995fedcfd2781',
      runtime: { ...(workerData.production ? { tokenizers: '0.2.0', implementation: 1 } : { transformers: '4.3.1' }), onnxruntime: workerData.wasm ? '1.31.0-dev.20260914-8d85527a0' : '1.30.0', backend: workerData.wasm ? 'wasm-cpu' : 'native' }, checks,
      dimensions: output.dims, pooling: 'cls', normalized: true, prefix, queryTokens,
      norms, similarities, repeatMaxDifference, coldLoadMs, inferenceMs,
      baselineRss, peakRss, rssIncrease: peakRss - baselineRss, networkAttempts,
      networkEvidence: 'JS fetch/http/https/net/tls/dns入口拦截；不是系统级抓包证明',
      ...(quality ? { quality } : {}), limitation: '预标注夹具不等于真人复核；非生产包/干净系统验收' };
  } finally { clearInterval(sample); await extractor?.dispose(); }
}

if (!isMainThread) {
  runQualification().then(result => parentPort.postMessage(result), error => {
    parentPort.postMessage({ status: 'failed', message: error.message, stack: error.stack });
  });
} else {
  await writeFile(join(temporary, 'qualification-boot.json'), JSON.stringify({ versions: process.versions, argv: process.argv, runAsNode: process.env.ELECTRON_RUN_AS_NODE }));
  let electronApp;
  if (process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE) {
    const electronRequire = createRequire(join(root, 'package.json'));
    electronApp = electronRequire('electron').app;
    electronApp.setPath('userData', join(temporary, 'electron-user-data'));
    // 模型不依赖窗口API；避免主模块顶层等待whenReady形成启动死锁。
  }
  const mode = electronApp ? 'electron-main-worker' : process.versions.electron ? 'electron-node-worker' : 'node-worker';
  try {
    const result = await new Promise((accept, reject) => {
      const worker = new Worker(pathToFileURL(scriptPath), { workerData: { mode, quality: process.argv.includes('--quality'), wasm: process.argv.includes('--wasm'), direct: process.argv.includes('--direct'), production: process.argv.includes('--production') } });
      const timeout = setTimeout(() => { void worker.terminate(); reject(new Error('真实模型加载/试验超过60秒')); }, 60000);
      worker.once('error', reject);
      worker.once('message', message => { clearTimeout(timeout); void worker.terminate(); accept(message); });
      worker.once('exit', code => { clearTimeout(timeout); if (code !== 0) reject(new Error(`资格Worker退出：${code}`)); });
    });
    await writeFile(join(temporary, `qualification-${mode}${process.argv.includes('--wasm') ? '-wasm' : ''}${process.argv.includes('--direct') ? '-direct' : ''}${process.argv.includes('--production') ? '-production' : ''}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'passed') process.exitCode = 1;
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { electronApp?.exit(process.exitCode ?? 0); }
}
