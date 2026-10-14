// 两个 Electron evaluate 回调保持独立，无测试进程的闭包依赖。
function restoreSearchWindow({ BrowserWindow }) {
  const window = BrowserWindow.getAllWindows()[0];
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
  return { visible: window.isVisible(), focused: window.isFocused(), minimized: window.isMinimized(),
    backgroundThrottling: window.webContents.getBackgroundThrottling() };
}
function readSearchWindow({ BrowserWindow }) {
  const window = BrowserWindow.getAllWindows()[0];
  return { visible: window.isVisible(), focused: window.isFocused(), minimized: window.isMinimized(),
    backgroundThrottling: window.webContents.getBackgroundThrottling() };
}
function isSearchDisplayValid(state) { return state.visible === true && state.minimized === false; }
function assertSearchDisplayValid(state, stage) {
  if (!isSearchDisplayValid(state)) throw new Error(`环境无效：${stage}搜索测量窗口被隐藏或最小化；${JSON.stringify(state)}`);
}
module.exports = { restoreSearchWindow, readSearchWindow, isSearchDisplayValid, assertSearchDisplayValid };
