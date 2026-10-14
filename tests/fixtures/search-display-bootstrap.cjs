// Playwright 的 loader 会重设 disable-features；本预加载必须排在它之后、ready 之前。
// 仅搜索性能测试引入，不影响正式程序的显示策略。
const { app } = require('electron');
if (app.isReady()) throw new Error('搜索显示配置必须在 Electron ready 前执行。');
const features = [...new Set(app.commandLine.getSwitchValue('disable-features').split(',').map(value => value.trim()).filter(Boolean))];
if (!features.includes('CalculateNativeWinOcclusion')) features.push('CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-features', features.join(','));
if (!app.commandLine.getSwitchValue('disable-features').split(',').includes('CalculateNativeWinOcclusion')) {
  throw new Error('搜索显示配置未生效，停止性能测量。');
}
