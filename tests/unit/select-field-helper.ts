import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** 通过真实键盘和选项交互选择 Radix 下拉，不伪造 change 或替换组件。 */
export async function chooseSelect(trigger: HTMLElement, optionName: string | RegExp): Promise<void> {
  // jsdom 没有布局滚动；这里只补浏览器边界，选择及焦点仍由真实组件处理。
  if (!HTMLElement.prototype.scrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value() {} });
  }
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown', code: 'ArrowDown' });
  const option = await screen.findByRole('option', { name: optionName });
  await userEvent.setup().click(option);
}
