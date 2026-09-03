import { useEffect, useRef, type ReactElement } from 'react';

export interface DocumentToolAction {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface DocumentToolGroup {
  id: 'excel' | 'docx' | 'hwp';
  label: string;
  actions: readonly DocumentToolAction[];
}

function DocumentIcon({ kind }: { kind: DocumentToolGroup['id'] }): ReactElement {
  const label = kind === 'excel' ? 'X' : kind === 'docx' ? 'W' : '한';
  return <span className={`document-tool-icon is-${kind}`} aria-hidden="true"><i />{label}</span>;
}

export function DocumentToolMenus({ groups }: { groups: readonly DocumentToolGroup[] }): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dismiss = (event: Event) => {
      rootRef.current?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((menu) => {
        if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
      });
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const menu = rootRef.current?.querySelector<HTMLDetailsElement>('details[open]');
      if (!menu) return;
      menu.open = false;
      menu.querySelector('summary')?.focus();
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
      document.removeEventListener('keydown', escape, true);
    };
  }, []);
  return <div ref={rootRef} className="document-tool-menus" aria-label="문서 가져오기와 내보내기">
    {groups.map((group) => <details key={group.id} className={`document-tool-menu is-${group.id}`} onToggle={(event) => {
      const opened = event.currentTarget;
      if (opened.open) rootRef.current?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((menu) => { if (menu !== opened) menu.open = false; });
    }}>
      <summary aria-label={`${group.label} 문서 도구 열기`}>
        <DocumentIcon kind={group.id} />
        <span>{group.label}</span>
        <b aria-hidden="true">⌄</b>
      </summary>
      <div className="document-tool-menu__panel">
        {group.actions.map((action) => <button key={action.id} type="button" disabled={action.disabled} onClick={(event) => {
          const menu = event.currentTarget.closest('details');
          if (menu) menu.open = false;
          action.onClick();
        }}>{action.label}</button>)}
      </div>
    </details>)}
  </div>;
}
