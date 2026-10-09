import { useCallback, useState } from 'react';
import type { Chapter, StructureAction, WorkDetail } from '../../shared/contracts';
import type { MenuEvent, StructureTarget } from '../components/chapter-tree';
import type { MenuItem, MenuState } from '../components/context-menu';
import type { StructureDialogState } from '../components/structure-dialog';

export function useStructureMenu(work: WorkDetail | null, draft: Chapter | null, onManage: (workId: string, action: StructureAction) => Promise<boolean>, onAddChapter: (volumeId?: string | null) => void, blocked: boolean) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dialog, setDialog] = useState<StructureDialogState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeDialog = useCallback(() => setDialog(null), []);
  function rename(target: StructureTarget) {
    const isWork = target.kind === 'work';
    setDialog({ heading: isWork ? '重命名作品' : '重命名分卷', field: isWork ? '作品名称' : '分卷名称', initialValue: target.title, submitLabel: '保存名称', onSubmit: (title) => onManage(isWork ? target.id : work!.id, isWork ? { type: 'renameWork', title } : { type: 'renameVolume', volumeId: target.id, title }) });
  }
  function remove(target: StructureTarget) {
    const chapters = target.kind === 'volume' ? work?.chapters.filter((chapter) => chapter.volumeId === target.id) ?? [] : [];
    // 删除预览采用作者当前可见草稿；实际删除仍须先保存成功。
    const chapterNames = chapters.map((chapter) => chapter.id === draft?.id ? draft.title.trim() || '未命名章节' : chapter.title);
    const range = target.kind === 'work' ? '整部作品及其卷、章节和正文' : target.kind === 'volume' ? `本卷及其 ${chapters.length} 个章节${chapters.length ? `（${chapterNames.join('、')}）` : ''}` : '本章及其正文';
    const heading = { work: '删除作品', volume: '删除卷及章节', chapter: '删除章节' }[target.kind];
    const action: StructureAction = target.kind === 'work' ? { type: 'deleteWork' } : target.kind === 'volume' ? { type: 'deleteVolume', volumeId: target.id } : { type: 'deleteChapter', chapterId: target.id };
    setDialog({ heading, description: `将删除“${target.title}”的${range}。数据仍保留在本机，可在设置中恢复。`, submitLabel: '确认删除', onSubmit: () => onManage(target.kind === 'work' ? target.id : work!.id, action) });
  }
  function showMenu(target: StructureTarget, event: MenuEvent) {
    event.preventDefault();
    if (blocked) return;
    const items: MenuItem[] = [];
    const workId = target.kind === 'work' ? target.id : work?.id;
    if (!workId) return;
    if (target.kind !== 'chapter') items.push({ label: '重命名', action: () => rename(target) });
    if (target.kind === 'volume') items.push({ label: '添加章节', action: () => onAddChapter(target.id) });
    if (target.kind !== 'work') {
      const siblings = target.kind === 'volume' ? work!.volumes : work!.chapters.filter((chapter) => chapter.volumeId === work!.chapters.find((chapter) => chapter.id === target.id)?.volumeId);
      const index = siblings.findIndex((item) => item.id === target.id);
      for (const direction of ['up', 'down'] as const) items.push({ label: direction === 'up' ? '上移' : '下移', disabled: direction === 'up' ? index <= 0 : index >= siblings.length - 1, action: () => { void onManage(workId, target.kind === 'volume' ? { type: 'moveVolume', volumeId: target.id, direction } : { type: 'moveChapter', chapterId: target.id, direction }); } });
    }
    if (target.kind === 'chapter') {
      const currentVolume = work!.chapters.find((chapter) => chapter.id === target.id)?.volumeId;
      items.push({ label: '移至无卷', disabled: currentVolume === null, action: () => { void onManage(workId, { type: 'setChapterVolume', chapterId: target.id, volumeId: null }); } });
      for (const volume of work!.volumes) items.push({ label: `移至分卷：${volume.title}`, disabled: volume.id === currentVolume, action: () => { void onManage(workId, { type: 'setChapterVolume', chapterId: target.id, volumeId: volume.id }); } });
    }
    items.push({ label: { work: '删除作品', volume: '删除分卷', chapter: '删除章节' }[target.kind], danger: true, action: () => remove(target) });
    const trigger = event.currentTarget;
    const bounds = trigger.getBoundingClientRect();
    const pointer = 'clientX' in event;
    setMenu({ trigger, items, x: pointer ? event.clientX : bounds.left, y: pointer ? event.clientY : bounds.bottom });
  }
  function addVolume() {
    if (!work || blocked) return;
    setDialog({ heading: '新建分卷', field: '分卷名称', submitLabel: '创建分卷', onSubmit: (title) => onManage(work.id, { type: 'createVolume', title }) });
  }
  return { menu, dialog, closeMenu, closeDialog, showMenu, addVolume };
}
