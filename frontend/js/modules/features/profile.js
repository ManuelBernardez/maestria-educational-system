import { state, $ } from '../core/state.js';
import { api } from '../core/api.js';
import { escapeHtml, btn, heading, initials, statusPill, statusLabel, formValues, errorText } from '../core/utils.js';
import { toast, updateChrome } from '../core/ui.js';

export function renderProfile() {
  const profile = state.profile || {};
  const isAdmin = ['admin', 'superadmin'].includes(profile.role);
  const memberships = profile.memberships || [];
  const style = state.feedbackStyle || 'constructivo';
  const preferenceSection = isAdmin ? '' : `<h2 class="profile-section-title">Preferencias pedagógicas</h2><div class="form-grid"><div class="form-field full"><label for="profile-feedback-style">Tono predeterminado de las devoluciones</label><select id="profile-feedback-style" name="feedback_style"><option value="formal" ${style === 'formal' ? 'selected' : ''}>Formal / académico</option><option value="constructivo" ${style === 'constructivo' ? 'selected' : ''}>Constructivo / orientador</option><option value="motivador" ${style === 'motivador' ? 'selected' : ''}>Motivador / empático</option></select><small class="field-hint">Se propone para nuevas correcciones.</small></div></div>`;
  const membershipsSection = !isAdmin && memberships.length ? `<h2 class="profile-section-title">Membresías institucionales</h2>${memberships.map(item => `<div class="list-row"><div class="list-main"><strong>${escapeHtml(item.institution__name || 'Institución')}</strong><small>${escapeHtml(item.role)} · ${escapeHtml(item.status)}</small></div>${statusPill(item.status)}</div>`).join('')}` : '';
  return `${heading('Mi perfil', isAdmin ? 'Datos de tu cuenta administrativa y preferencias de apariencia.' : 'Personalizá los datos visibles y las preferencias pedagógicas asociadas a tu cuenta.', btn('Cerrar sesión', 'logout', '', 'secondary'))}
    <form id="profile-settings-form" class="panel profile-settings-panel" style="max-width:820px"><div class="panel-body">
      <div class="entity-cell profile-summary"><span class="profile-avatar">${escapeHtml(initials(profile.full_name || profile.email))}</span><div><strong>${escapeHtml(profile.full_name || (isAdmin ? 'Administrador' : 'Docente'))}</strong><small>${escapeHtml(profile.email || '')}</small></div></div>
      <h2>Datos de la cuenta</h2><div class="form-grid">
        <div class="form-field"><label for="profile-display-name">Nombre y apellido</label><input id="profile-display-name" name="display_name" value="${escapeHtml(profile.full_name || '')}" maxlength="100" minlength="2" required></div>
        <div class="form-field"><label for="profile-email-readonly">Correo electrónico</label><input id="profile-email-readonly" value="${escapeHtml(profile.email || '')}" disabled readonly><small class="field-hint">El correo se administra desde Supabase Auth.</small></div>
        <div class="form-field"><label>Rol global</label><input value="${escapeHtml(profile.role || 'teacher')}" disabled></div>
        <div class="form-field"><label>Estado de cuenta</label><input value="${escapeHtml(statusLabel(profile.status))}" disabled></div>
      </div>
      ${preferenceSection}
      <section class="profile-appearance"><div><h2>Apariencia</h2><p>Elegí el tema que te resulte más cómodo para trabajar.</p></div><button class="btn btn-secondary" type="button" id="theme-toggle-profile"><span aria-hidden="true">◐</span> <span id="theme-label-profile">${document.documentElement.dataset.theme === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro'}</span></button></section>
      <div class="notice" style="margin-top:18px">La autenticación y las credenciales se administran mediante Supabase Auth.</div>
      ${membershipsSection}
      <p class="form-error" id="profile-error" role="alert"></p><p class="form-success" id="profile-success" role="status"></p>
      <div class="modal-actions"><button class="btn btn-primary" type="submit">Guardar cambios</button></div>
    </div></form>`;
}

export async function saveProfilePreferences(form) {
  const errorNode = $('#profile-error'); const successNode = $('#profile-success');
  if (errorNode) errorNode.textContent = ''; if (successNode) successNode.textContent = '';
  const values = formValues(form); const cleanName = String(values.display_name || '').trim().replace(/\s+/g, ' ');
  if (cleanName.length < 2 || cleanName.length > 100) { if (errorNode) errorNode.textContent = 'Ingresá un nombre de entre 2 y 100 caracteres.'; return; }
  const feedbackStyle = ['formal', 'constructivo', 'motivador'].includes(values.feedback_style) ? values.feedback_style : 'constructivo';
  const button = form.querySelector('[type="submit"]');
  if (button) { button.disabled = true; button.textContent = 'Guardando…'; }
  try {
    const session = await api.validSession();
    if (!session?.access_token) throw new Error('La sesión expiró. Volvé a iniciar sesión.');
    const updatedUser = await api.authUserRequest('PUT', { data: { ...(session.user?.user_metadata || {}), full_name: cleanName, maestria_feedback_style: feedbackStyle } }, session.access_token);
    if (updatedUser?.id) api.setSession({ ...session, user: updatedUser });
    else api.setSession({ ...session, user: { ...(session.user || {}), user_metadata: { ...(session.user?.user_metadata || {}), full_name: cleanName, maestria_feedback_style: feedbackStyle } } });
    state.profile = { ...state.profile, full_name: cleanName };
    state.feedbackStyle = feedbackStyle;
    try { localStorage.setItem('maestria-feedback-style', feedbackStyle); } catch { /* Preferencia conservada en la sesión actual. */ }
    updateChrome();
    if (successNode) successNode.textContent = 'Preferencias guardadas en tu cuenta.';
    toast('Perfil actualizado.');
  } catch (error) {
    if (errorNode) errorNode.textContent = `No se pudieron guardar las preferencias: ${errorText(error)}`;
  } finally { if (button) { button.disabled = false; button.textContent = 'Guardar preferencias'; } }
}
