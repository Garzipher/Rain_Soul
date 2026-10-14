import { Children, Fragment, isValidElement, useRef, useState, type AriaAttributes, type CSSProperties, type FocusEventHandler, type ReactNode } from 'react';
import * as Select from '@radix-ui/react-select';
import './select-field.css';

/** 只通知选择值，不伪造浏览器事件；兼容现有 event.target.value 调用。 */
export interface SelectValueEvent { target: { value: string; name?: string }; currentTarget: { value: string; name?: string } }

export interface SelectFieldProps extends AriaAttributes {
  value?: string | number | null;
  defaultValue?: string | number;
  onChange?: (event: SelectValueEvent) => void;
  onValueChange?: (value: string) => void;
  children?: ReactNode;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  form?: string;
  id?: string;
  label?: string;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
  autoFocus?: boolean;
  tabIndex?: number;
  onFocus?: FocusEventHandler<HTMLButtonElement>;
  onBlur?: FocusEventHandler<HTMLButtonElement>;
}

interface OptionProps { value?: string | number; disabled?: boolean; label?: string; children?: ReactNode }
interface Choice { kind: 'choice'; value: string; label: ReactNode; text: string; disabled: boolean }
interface ChoiceGroup { kind: 'group'; label: string; choices: Choice[] }
type SelectEntry = Choice | ChoiceGroup;

function optionText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (isValidElement<{ children?: ReactNode }>(node)) return optionText(node.props.children);
  return Children.toArray(node).map(item => optionText(item)).join('');
}

function choicesFrom(children: ReactNode, groupDisabled = false): SelectEntry[] {
  const choices: SelectEntry[] = [];
  Children.forEach(children, child => {
    if (!isValidElement<OptionProps>(child)) return;
    if (child.type === Fragment) { choices.push(...choicesFrom(child.props.children, groupDisabled)); return; }
    if (child.type === 'optgroup') {
      const entries = choicesFrom(child.props.children, groupDisabled || !!child.props.disabled);
      choices.push({ kind: 'group', label: child.props.label ?? '', choices: entries.flatMap(entry => entry.kind === 'choice' ? [entry] : entry.choices) });
      return;
    }
    if (child.type !== 'option') return;
    const text = child.props.label ?? optionText(child.props.children);
    choices.push({ kind: 'choice', value: String(child.props.value ?? text), label: child.props.label ?? child.props.children, text, disabled: groupDisabled || !!child.props.disabled });
  });
  return choices;
}

// 所有值统一编码，让“未分类”等真实空值选项也能正常选择。
const encodeValue = (value: string) => `choice:${value}`;

/** 单选下拉：共用键盘操作、滚动列表与弹层，并保留原有 option 声明。 */
export function SelectField({ value, defaultValue, onChange, onValueChange, children, disabled, required, name, form, label, placeholder = '请选择', className, ...triggerProps }: SelectFieldProps) {
  const entries = choicesFrom(children);
  const options = entries.flatMap(entry => entry.kind === 'choice' ? [entry] : entry.choices);
  const [internalValue, setInternalValue] = useState(() => String(defaultValue ?? options[0]?.value ?? ''));
  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState<HTMLElement | undefined>();
  const trigger = useRef<HTMLButtonElement>(null);
  const selectedValue = value === undefined ? internalValue : String(value ?? '');
  const selected = options.find(option => option.value === selectedValue);

  function update(next: string) {
    const decoded = next.slice('choice:'.length);
    setInternalValue(decoded);
    const target = { value: decoded, name };
    onChange?.({ target, currentTarget: target });
    onValueChange?.(decoded);
  }

  function renderChoice(choice: Choice) {
    return <Select.Item key={choice.value} value={encodeValue(choice.value)} disabled={choice.disabled} textValue={choice.text} className="select-field-option">
      <Select.ItemText>{choice.label}</Select.ItemText>
      <Select.ItemIndicator className="select-field-check"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.5 8 3 3 6-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></Select.ItemIndicator>
    </Select.Item>;
  }

  return <><Select.Root value={encodeValue(selectedValue)} onValueChange={update} open={open} disabled={disabled} onOpenChange={next => {
    // 原生模态 dialog 在 top layer；弹层必须留在同一个 dialog 内。
    if (next) setContainer(trigger.current?.closest('dialog') ?? undefined);
    setOpen(next);
  }}>
    <Select.Trigger {...triggerProps} ref={trigger} className={['select-field-trigger', className].filter(Boolean).join(' ')} aria-label={triggerProps['aria-label'] ?? label} aria-required={required || undefined}>
      <Select.Value>{selected?.label ?? placeholder}</Select.Value>
      <Select.Icon className="select-field-chevron"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4.5 6.5 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></Select.Icon>
    </Select.Trigger>
    <Select.Portal container={container}>
      <Select.Content position="popper" sideOffset={5} collisionPadding={12} className="select-field-content" onEscapeKeyDown={event => {
        event.preventDefault(); event.stopPropagation(); setOpen(false);
      }} onKeyDown={event => event.stopPropagation()}>
        <Select.ScrollUpButton className="select-field-scroll" aria-hidden="true">⌃</Select.ScrollUpButton>
        <Select.Viewport className="select-field-viewport">
          {entries.map((entry, index) => entry.kind === 'choice' ? renderChoice(entry) : <Select.Group key={`${entry.label}-${index}`}>
            <Select.Label className="select-field-group-label">{entry.label}</Select.Label>{entry.choices.map(renderChoice)}
          </Select.Group>)}
          {!options.length && <span className="select-field-empty">暂无选项</span>}
        </Select.Viewport>
        <Select.ScrollDownButton className="select-field-scroll" aria-hidden="true">⌄</Select.ScrollDownButton>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
    {(name || required) && <select className="select-field-native" name={name} form={form} required={required} disabled={disabled} value={selectedValue} tabIndex={-1} aria-hidden="true" onChange={event => update(encodeValue(event.target.value))} onInvalid={event => { event.preventDefault(); trigger.current?.focus(); }}>
      {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.text}</option>)}
    </select>}
  </>;
}
