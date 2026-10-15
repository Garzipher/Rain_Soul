/** 首批只分发核对过的短摘录；学习讲解独立整理，不代表原作者观点或评分。 */
export interface GlobalSourceStarter {
  id: string; workTitle: string; author: string; chapter: string; workUrl: string; chapterUrl: string;
  fetchedAt: string; alternateTitle?: string; rightsFact: string;
  metrics: { label: string; value: string; observedAt: string }[];
  excerpts: { text: string; paragraphIndex: number; categoryKey: string;
    annotation: { technique: string; usage: string; exercise: string } }[];
}
const observedAt = '2026-10-15T10:06:37Z';
const rightsFact = '晋江官方第1章本次可公开读取；页面标明版权所有，未取得整章、整本或开放再分发许可。本包仅保留署名短摘录用于写法学习，不保存章节全文。';
export const globalSourceStarters: readonly GlobalSourceStarter[] = [
  {
    id: 'jjwxc-7387062-ch1-20261015', workTitle: '从小妾到翻译官[年代]', author: '浣若君', chapter: '第1章 纳妾',
    workUrl: 'https://m.jjwxc.net/book2/7387062', chapterUrl: 'https://m.jjwxc.net/book2/7387062/1', fetchedAt: observedAt, rightsFact,
    metrics: [
      { label: '收藏', value: '16020', observedAt }, { label: '营养液', value: '19568', observedAt }, { label: '书评', value: '8468', observedAt },
    ],
    excerpts: [
      { text: '1949年7月，西州，炎热的傍晚。', paragraphIndex: 1, categoryKey: 'narrative', annotation: {
        technique: '用时间、地点和气候三个坐标开场，先帮助读者定位，再进入事件。短句不展开解释，给后续行动留出节奏。',
        usage: '适合年代叙事或换场开头。只有时地信息会影响人物选择时才值得写，避免每章都机械报时。',
        exercise: '为一场发生在冬季车站的离别写一句开场，只给出时间、地点和一项天气感受，不沿用原句词语。',
      } },
      { text: '酷暑炎夏，男孩却穿一件厚实的长衫，脚趾顶破了鞋，大脚趾露在外面。', paragraphIndex: 4, categoryKey: 'character', annotation: {
        technique: '天气与穿着形成反差，破鞋这一可见细节呈现处境，让读者从物件推断困窘，而非直接评价人物。',
        usage: '适合初次出场或生活状态发生变化的场景。细节应来自视角人物能观察到的范围，不能代替完整的人物动机。',
        exercise: '写一个在雨天候诊的人，用衣物和随身物件暗示他的处境，不出现“贫穷”“可怜”，控制在两句。',
      } },
    ],
  },
  {
    id: 'jjwxc-3688109-ch1-20261015', workTitle: '在艰苦岁月里当阿姐', author: '九紫', chapter: '第1章',
    alternateTitle: '清澈女大的六零年代（本次章节页页首显示的旧名）',
    workUrl: 'https://m.jjwxc.net/book2/3688109', chapterUrl: 'https://m.jjwxc.net/book2/3688109/1', fetchedAt: observedAt, rightsFact,
    metrics: [
      { label: '收藏', value: '38965', observedAt }, { label: '营养液', value: '116558', observedAt }, { label: '书评', value: '21270', observedAt },
    ],
    excerpts: [
      { text: '“水英！水英！我地娘哎，水英羊水破了要生了！”', paragraphIndex: 1, categoryKey: 'language', annotation: {
        technique: '以重复呼喊和急迫口语直接启动现场，先让读者听见危机，再补背景。称呼同时交代人物之间的熟悉程度。',
        usage: '适合突发事件的开场。口语来自具体人物及地域，不宜把方言当作随意添加的装饰，也要给读者理解空间。',
        exercise: '写一句暴雨断电时邻居的呼喊，包含一个具体行动诉求；不用本段的人名、事件和口头禅。',
      } },
      { text: '伴随着一阵推搡，陆红阳被人从昏沉中推醒。', paragraphIndex: 3, categoryKey: 'narrative', annotation: {
        technique: '从触觉和身体动作切入主角的感知，用“被推醒”的有限信息保持短暂悬念，让读者与人物一起认识环境。',
        usage: '适合意识恢复或陌生场景的视角进入。随后应给出可观察线索，避免长期依靠含糊感制造悬念。',
        exercise: '用声音或温度写一个人在陌生房间醒来的第一句；下一句补一件可观察物品，不直接说明身在何处。',
      } },
    ],
  },
];
export function findGlobalSourceStarter(id: string) { return globalSourceStarters.find(item => item.id === id); }
export function globalSourceStarterText(source: GlobalSourceStarter) { return source.excerpts.map(item => item.text).join('\n'); }
