// 覆盖率与真实 SQLite 同时启用时，8GB Windows 的首屏转换可能超过一秒。
// 只延长异步 DOM 等待预算，不延长产品保存/搜索的验收时限。
if (typeof document !== 'undefined') {
  const { configure } = await import('@testing-library/react');
  configure({ asyncUtilTimeout: 5000 });
}
export {};
