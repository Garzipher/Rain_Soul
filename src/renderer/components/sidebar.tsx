import { Icon, type IconName } from './icon';
import type { AuthorProfileController } from '../hooks/use-author-profile';
import { SidebarProfile } from './sidebar-profile';
import { useRef } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { AnimatedCollapse } from '../motion/animated-collapse';
import { motionTokens, seconds } from '../motion/tokens';

export type Page = 'shelf' | 'work' | 'knowledge' | 'sessions' | 'settings';
export interface SidebarProps { expanded: boolean; page: Page; onToggle: () => void; onNavigate: (page: Page) => void; author?: AuthorProfileController; locked?: boolean }
const entries: { page: Page; label: string; icon: IconName }[] = [
  { page: 'shelf', label: '作品集', icon: 'books' },
  { page: 'knowledge', label: '知识库', icon: 'knowledge' },
  { page: 'sessions', label: '需求会话', icon: 'chat' },
];

/** 导航始终可供键盘操作，收起时以可访问名称保留入口。 */
export function Sidebar({ expanded, page, onToggle, onNavigate, author, locked }: SidebarProps) {
  const toggle = useRef<HTMLButtonElement>(null);
  return <>
    <AnimatePresence>{expanded && <m.button key="scrim" className="sidebar-scrim" aria-label="关闭侧栏" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: seconds(motionTokens.menuEnter) }} onClick={onToggle} />}</AnimatePresence>
    <aside className="rail">
      <div className="rail-header">
        <button ref={toggle} className="sidebar-toggle" aria-label={expanded ? '收起侧栏' : '展开侧栏'} aria-expanded={expanded} onClick={onToggle}>
          <span className="hamburger" aria-hidden="true"><span /><span /><span /></span>
        </button>
        <span className={`rail-brand ${expanded ? 'is-visible' : ''}`} aria-hidden={!expanded}><span className="brand-mark" aria-hidden="true" /><span className="brand-copy">RainSoul</span></span>
      </div>
      <AnimatedCollapse open={expanded} triggerRef={toggle}><SidebarProfile author={author} locked={locked} /></AnimatedCollapse>
      <nav aria-label="主导航">
        {entries.map((entry) => <button key={entry.page} aria-label={entry.label} title={entry.label} aria-current={page === entry.page || (page === 'work' && entry.page === 'shelf') ? 'page' : undefined} onClick={() => onNavigate(entry.page)}>
          <Icon name={entry.icon} /><span className="rail-label" aria-hidden={!expanded}>{entry.label}</span>
        </button>)}
      </nav>
      <div className="rail-bottom"><button aria-label="设置" aria-current={page === 'settings' ? 'page' : undefined} title="设置" onClick={() => onNavigate('settings')}><Icon name="settings" /><span className="rail-label" aria-hidden={!expanded}>设置</span></button></div>
    </aside>
  </>;
}
