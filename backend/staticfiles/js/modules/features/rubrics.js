import { state } from '../core/state.js';
import { escapeHtml, formatNumber, btn, heading, table, date, emptyState, resourceError } from '../core/utils.js';

export function renderRubrics() {
  const rows = state.data.rubrics.map(rubric => `<tr><td><strong>${escapeHtml(rubric.title)}</strong><small>${escapeHtml(rubric.description || '')}</small></td><td>${escapeHtml(rubric.scale_type || 'both')}</td><td>${(rubric.criteria || []).length}</td><td>${(rubric.criteria || []).reduce((sum, criterion) => sum + (criterion.levels || []).length, 0)}</td><td>${date(rubric.updated_at)}</td><td><div class="table-actions">${btn('Ver', 'open-rubric', `data-id="${rubric.id}"`)}${btn('Editar', 'edit-rubric', `data-id="${rubric.id}"`)}</div></td></tr>`);
  return `${heading('Rúbricas', 'Definí criterios, ponderaciones y niveles para orientar la evaluación.', `${btn('Proponer con IA', 'generate-rubric')}${btn('Crear rúbrica', 'new-rubric', '', 'primary')}`)}${resourceError('rubrics', 'las rúbricas')}${table(['Rúbrica', 'Escala', 'Criterios', 'Niveles', 'Actualizada', 'Acciones'], rows, 'Todavía no creaste rúbricas.')}`;
}

export function renderRubricDetail() {
  const rubric = state.data.rubrics.find(item => String(item.id) === String(state.selectedRubric));
  if (!rubric) return '';
  const criteria = (rubric.criteria || []).map(criterion => `<article class="criterion-card"><div class="panel-head"><div><h3>${escapeHtml(criterion.name)}</h3><p>${escapeHtml(criterion.description || 'Sin descripción')} · Máximo ${escapeHtml(formatNumber(criterion.max_score))} · Ponderación ${escapeHtml(formatNumber(criterion.weight))}%</p></div>${btn('Agregar nivel', 'add-level', `data-criterion="${criterion.id}"`)}${btn('Editar criterio', 'edit-criterion', `data-id="${criterion.id}"`)}</div><div class="panel-body">${(criterion.levels || []).length ? (criterion.levels || []).map(level => `<div class="list-row"><div class="list-main"><strong>${escapeHtml(level.name)}</strong><small>${escapeHtml(level.description || '')}</small></div><span>${escapeHtml(formatNumber(level.score))} puntos</span>${btn('Editar', 'edit-level', `data-id="${level.id}"`)}</div>`).join('') : '<p>Sin niveles definidos.</p>'}</div></article>`).join('');
  const weightSum = (rubric.criteria || []).reduce((sum, item) => sum + Number(item.weight || 0), 0);
  const weightsOk = Math.abs(weightSum - 100) < 0.05;
  const weightNotice = (rubric.criteria || []).length ? `<div class="notice ${weightsOk ? 'notice-success' : 'notice-warning'}"><strong>Suma de ponderaciones: ${escapeHtml(formatNumber(Number(weightSum.toFixed(2))))}%.</strong> ${weightsOk ? 'La nota final pondera cada criterio según su porcentaje.' : 'Debería sumar 100%. Si no, la nota se calcula proporcionalmente (peso ÷ suma de pesos).'} ${weightsOk ? '' : btn('Normalizar a 100%', 'normalize-weights', `data-id="${rubric.id}"`, 'primary')}</div>` : '';
  return `${heading(rubric.title, `${rubric.description || 'Sin descripción'} · Escala ${rubric.scale_type}`, `${btn('Volver a rúbricas', 'navigate', 'data-view="rubrics"')}${btn('Agregar criterio', 'new-criterion', `data-rubric="${rubric.id}"`, 'primary')}`)}${weightNotice}${criteria || emptyState('Sin criterios', 'Agregá al menos dos criterios para poder usar esta rúbrica.')}`;
}
