import { state, $ } from '../core/state.js';
import { escapeHtml, statusLabel } from '../core/utils.js';
import { openModal, closeModal, toast } from '../core/ui.js';

export function correctionShareText() {
  const correction = state.currentCorrection;
  if (!correction) return '';
  const result = correction.status === 'approved' ? correction.final_result : correction.proposal;
  const lines = [
    `Devolución — ${correction.submission_title || 'Evaluación'}`,
    `Estudiante: ${state.currentSubmission?.student_display_name || state.currentSubmission?.student_name || 'Estudiante'}`,
    `Estado: ${statusLabel(correction.status)}`,
    '', result?.summary || '', '',
    ...(result?.criteria || []).map(item => `${item.criterion}: ${item.score}/${item.max_score}\n${item.justification || ''}${item.evidence ? `\nEvidencia: ${item.evidence}` : ''}`),
    '', correction.teacher_feedback || result?.feedback || ''
  ];
  return lines.join('\n').trim();
}

export async function copyCorrection() {
  const text = correctionShareText();
  if (!text) return;
  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
  else {
    const input = document.createElement('textarea'); input.value = text; document.body.appendChild(input); input.select();
    const copied = document.execCommand('copy'); input.remove(); if (!copied) throw new Error('El navegador no permitió copiar el texto.');
  }
  toast('Devolución copiada. Revisala antes de compartirla.');
}

export function correctionShareData() {
  const correction = state.currentCorrection;
  if (!correction || correction.status !== 'approved') return null;
  const proposal = correction.final_result || correction.proposal || {};
  const criteria = Array.isArray(proposal.criteria) ? proposal.criteria : [];
  const maxScore = criteria.reduce((sum, item) => sum + Number(item.max_score || 0), 0);
  const totalScore = Number.isFinite(Number(correction.total_score))
    ? Number(correction.total_score) : criteria.reduce((sum, item) => sum + Number(item.score || 0), 0);
  return {
    correction, proposal, criteria, maxScore, totalScore,
    studentName: state.currentSubmission?.student_display_name || state.currentSubmission?.student_name || 'Estudiante sin identificar',
    studentEmail: correction.student_email || state.currentSubmission?.student_email || ''
  };
}

export function approvedCorrectionShareText() {
  const data = correctionShareData();
  if (!data) return '';
  const { correction, proposal, criteria, maxScore, totalScore, studentName } = data;
  const formatScore = value => Number(value).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const lines = [
    'Devolución de MaestrIA',
    `Evaluación: ${correction.submission_title || 'Evaluación'}`,
    `Estudiante: ${studentName}`,
    `Puntaje final: ${formatScore(totalScore)} / ${formatScore(maxScore)} puntos`,
    '', 'Resumen', proposal.summary?.trim() || 'Sin resumen adicional.', '', 'Criterios de evaluación',
    ...criteria.flatMap(item => [
      `• ${item.criterion || 'Criterio'}: ${formatScore(item.score || 0)} / ${formatScore(item.max_score || 0)} puntos${item.level ? ` · ${item.level}` : ''}`,
      ...(item.justification?.trim() ? [`  ${item.justification.trim()}`] : [])
    ])
  ];
  if (Array.isArray(proposal.strengths) && proposal.strengths.length) lines.push('', 'Fortalezas observadas', ...proposal.strengths.map(item => `• ${item}`));
  if (Array.isArray(proposal.improvement_suggestions) && proposal.improvement_suggestions.length) lines.push('', 'Próximos pasos sugeridos', ...proposal.improvement_suggestions.map(item => `• ${item}`));
  const feedback = correction.teacher_feedback?.trim() || proposal.feedback?.trim();
  if (feedback) lines.push('', 'Retroalimentación', feedback);
  lines.push('', 'La calificación final fue revisada y aprobada por el docente.');
  return lines.join('\n');
}

export function openCorrectionShareModal() {
  const data = correctionShareData();
  if (!data) { toast('Sólo se pueden compartir devoluciones aprobadas.', 'error'); return; }
  const possibleScore = data.maxScore.toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const totalScore = data.totalScore.toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const body = `<div class="correction-share-content"><p class="eyebrow">DEVOLUCIÓN APROBADA</p><h3>${escapeHtml(data.studentName)} · ${escapeHtml(data.correction.submission_title || 'Evaluación')}</h3><div class="correction-share-score"><span>Puntaje final</span><strong>${escapeHtml(totalScore)} <small>/ ${escapeHtml(possibleScore)} puntos</small></strong></div><p class="muted">MaestrIA prepara el contenido, pero no envía mensajes automáticamente.</p><div class="form-field full"><label for="correction-share-email">Correo del estudiante (opcional)</label><input id="correction-share-email" type="email" autocomplete="email" value="${escapeHtml(data.studentEmail)}" placeholder="estudiante@ejemplo.com"></div><p id="correction-share-error" class="form-error" role="alert"></p><p id="correction-share-notice" class="form-success" role="status" aria-live="polite"></p><div class="modal-actions correction-share-actions"><button class="btn btn-primary" type="button" data-share-action="email">Preparar correo</button><button class="btn btn-secondary" type="button" data-share-action="whatsapp">Abrir WhatsApp</button><button class="btn btn-secondary" type="button" data-share-action="print">Imprimir / PDF</button><button class="btn btn-secondary" type="button" data-share-action="copy">Copiar devolución</button></div><p class="field-hint">Verificá el destinatario y el contenido antes de confirmar el envío desde tu aplicación.</p></div>`;
  openModal('Compartir o guardar', body, 'share-correction', true);
  window.setTimeout(() => $('#correction-share-email')?.focus(), 50);
}

export async function handleShareAction(action) {
  const errorNode = $('#correction-share-error'); const notice = $('#correction-share-notice');
  if (errorNode) errorNode.textContent = ''; if (notice) notice.textContent = '';
  const data = correctionShareData(); const text = approvedCorrectionShareText();
  if (!data || !text) { if (errorNode) errorNode.textContent = 'La devolución ya no está disponible para compartir.'; return; }
  if (action === 'email') {
    const email = String($('#correction-share-email')?.value || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { if (errorNode) errorNode.textContent = 'Revisá el correo ingresado o dejalo vacío.'; return; }
    const recipient = email ? email.split('@').map((part, index) => index === 0 ? encodeURIComponent(part) : encodeURIComponent(part)).join('@') : '';
    // Muchos clientes de correo truncan o rechazan enlaces mailto muy largos (~2000 caracteres).
    const MAX_MAILTO_BODY = 1500;
    let body = text;
    let clipboardNote = '';
    if (text.length > MAX_MAILTO_BODY) {
      body = `${text.slice(0, MAX_MAILTO_BODY).replace(/\s+\S*$/, '')}…\n\n[La devolución completa está copiada en el portapapeles: pegala acá antes de enviar.]`;
      try { await navigator.clipboard.writeText(text); clipboardNote = ' El texto completo quedó copiado: pegalo en el cuerpo del correo.'; }
      catch { clipboardNote = ' El texto es largo: usá «Copiar devolución» y pegalo en el correo.'; }
    }
    window.location.href = `mailto:${recipient}?subject=${encodeURIComponent(`Devolución de evaluación: ${data.correction.submission_title || 'MaestrIA'}`)}&body=${encodeURIComponent(body)}`;
    if (notice) notice.textContent = `Se solicitó abrir un borrador de correo.${clipboardNote}`;
  } else if (action === 'whatsapp') {
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
    if (notice) notice.textContent = 'WhatsApp se abrió con el texto preparado.';
  } else if (action === 'copy') {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const input = document.createElement('textarea'); input.value = text; document.body.appendChild(input); input.select();
        const copied = document.execCommand('copy'); input.remove(); if (!copied) throw new Error('copy');
      }
      if (notice) notice.textContent = 'Devolución copiada.';
    } catch { if (errorNode) errorNode.textContent = 'No se pudo copiar. Habilitá el permiso del portapapeles o seleccioná el texto manualmente.'; }
  } else if (action === 'print') {
    closeModal(true); window.print();
  }
}
