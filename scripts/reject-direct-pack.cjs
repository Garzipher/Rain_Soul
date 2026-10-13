/* global module */
/** 默认builder入口拒绝绕过来源与研究目录策略；授权入口显式替换该hook。 */
module.exports = async function rejectDirectPack() {
  throw new Error('禁止直接调用electron-builder，请通过scripts/pack-desktop.mjs执行正式门禁或显式无模型研究模式。');
};
