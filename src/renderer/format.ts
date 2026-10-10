// Prikaz datuma i stanja izvoza, zajednički za listu poslova i karticu Izvozi.
import type { ExportStatus } from '../shared/jobs';

const dateTime = new Intl.DateTimeFormat('sr-Latn', { dateStyle: 'short', timeStyle: 'short' });
export const formatDateTime = (ms: number) => dateTime.format(ms);

export const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

export const STATUS_LABEL: Record<ExportStatus, string> = {
  never: 'Nije izvezen',
  current: 'Izvezen',
  changed: 'Menjan posle izvoza',
};
