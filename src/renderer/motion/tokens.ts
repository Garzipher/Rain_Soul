/** 时间以毫秒为唯一来源；脚本与 CSS 共用同一组令牌。 */
export const motionTokens = {
  press: 90, release: 150, menuEnter: 160, menuExit: 140,
  dialogEnter: 220, dialogExit: 160, page: 180, collapse: 200,
  enter: [0.16, 1, 0.3, 1] as const,
  exit: [0.4, 0, 1, 1] as const,
};
export const seconds = (milliseconds: number) => milliseconds / 1000;
