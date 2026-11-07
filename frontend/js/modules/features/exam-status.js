import { state } from '../core/state.js';

/**
 * Estado de un examen (entrega de un estudiante) derivado de los datos reales,
 * sin inventar umbrales de nota:
 *  - pending:  la entrega todavía no tiene propuesta de corrección.
 *  - review:   hay una propuesta esperando la decisión docente (pending_review).
 *  - approved: el docente aprobó la devolución.
 *  - rejected: el docente rechazó la propuesta ("desaprobada").
 */
export const EXAM_STATUS = Object.freeze({
  pending: { label: 'Pendiente', plural: 'Pendientes', pill: 'inactive' },
  review: { label: 'A revisar', plural: 'A revisar', pill: 'pending_review' },
  approved: { label: 'Aprobada', plural: 'Aprobadas', pill: 'approved' },
  rejected: { label: 'Desaprobada', plural: 'Desaprobadas', pill: 'rejected' }
});

export const examCorrection = (submission) => state.data.corrections.find(item => String(item.submission) === String(submission.id)) || null;

export function examStatus(submission) {
  const correction = examCorrection(submission);
  if (correction?.status === 'approved' || submission.status === 'approved') return 'approved';
  if (correction?.status === 'rejected') return 'rejected';
  if (correction || ['review', 'processing'].includes(submission.status)) return 'review';
  return 'pending';
}
