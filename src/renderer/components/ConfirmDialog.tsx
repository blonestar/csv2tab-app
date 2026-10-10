// Mali modalni dijalog sa pitanjem i dugmadima (potvrda brisanja, isti fajl već uvezen, nesačuvane izmene).
import type { ReactNode } from 'react';

export interface DialogAction {
  label: string;
  testId: string;
  onClick: () => void;
  kind?: 'primary' | 'danger';
}

export function ConfirmDialog({ title, testId, actions, children }: { title: string; testId: string; actions: DialogAction[]; children: ReactNode }) {
  return (
    <div className="overlay">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
        <h2>{title}</h2>
        <div className="dialog-text">{children}</div>
        <div className="dialog-actions">
          {actions.map((a) => (
            <button key={a.testId} type="button" className={a.kind ? `btn ${a.kind}` : 'btn'} data-testid={a.testId} onClick={a.onClick}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
