# 素材智能工作区原型

## 范围

此次仅修改独立 Demo，不连接实际网页、模型或作者数据。白色双栏阅读布局：原文区域独立滚动，十二段示例分四页；审核列表可滚动；知识参考每页三条。跨页勾选保留，批次审核和入库独立于阅读分页。部分入库后下一批重新选择尚未入库段落并清空旧审核。关键词按示例正文与出处匹配，停用模型后新摘录仍可找到。语义排序只是模拟。

## 开源流程对照

2026-10-10 查询 GitHub 仓库元信息及 README：

- [Karakeep](https://github.com/karakeep-app/karakeep)：约 2.96 万 star。收藏网页、保存高亮、自动标签/摘要、全文与语义搜索。借鉴阅读摘录与知识检索闭环。
- [Omnivore](https://github.com/omnivore-app/omnivore)：README 明确高亮、笔记、标签、离线阅读及长文阅读位置记录，采用 Mozilla Readability 提取可读正文。借鉴安静的阅读界面与原文可追溯。
- [MarkItDown](https://github.com/microsoft/markitdown)：内容转 Markdown 的转换层，不能直接代替写作手法分析与摘录审核。
- [Jina Reader](https://github.com/jina-ai/reader)：网页转模型友好文本的参考方案；本项目没有调用其云端转换服务。

上述不是专门的小说拆书产品，也未声称直接采用其源码。RainSoul 增加写作手法、仿写练习、人工审核和写作参考，而不是只保存摘要。正式实现应另外核验依赖许可证、网页提取质量与本机模型质量。

## 打开与验证

运行 `node scripts/preview-source-demo.mjs` 后访问 http://127.0.0.1:4174/rainsoul-source-intelligence.html；也可直接打开 docs/demos/rainsoul-source-intelligence.html。刷新清除模拟状态。

原型回归覆盖：选段绑定、入库后关键词回退、参考复制取消、正文候选过期、空态、窄窗侧栏、原文/知识分页、跨页勾选、短窗口滚动、部分入库后切批。新增原型采用浏览器交互回归；正式模型和发布安装矩阵不属于此次原型验证。
