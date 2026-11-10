import { state, $ } from '../core/state.js';
import { api } from '../core/api-client.js';
import { escapeHtml, btn, heading, initials, statusPill, statusLabel, formValues, errorText } from '../core/utils.js';
import { toast, updateChrome } from '../core/ui.js';
import { render } from '../core/router.js';

export function renderProfile() {
  const profile = state.profile || {};
  const isAdmin = ['admin', 'superadmin'].includes(profile.role);
  const memberships = profile.memberships || [];
  const style = state.feedbackStyle || 'constructivo';
  const preferenceSection = isAdmin ? '' : `<h2 class="profile-section-title">Preferencias pedagógicas</h2><div class="form-grid"><div class="form-field full"><label for="profile-feedback-style">Tono predeterminado de las devoluciones</label><select id="profile-feedback-style" name="feedback_style"><option value="formal" ${style === 'formal' ? 'selected' : ''}>Formal / académico</option><option value="constructivo" ${style === 'constructivo' ? 'selected' : ''}>Constructivo / orientador</option><option value="motivador" ${style === 'motivador' ? 'selected' : ''}>Motivador / empático</option></select><small class="field-hint">Se propone para nuevas correcciones.</small></div></div>`;
  const membershipsSection = !isAdmin && memberships.length ? `<h2 class="profile-section-title">Membresías institucionales</h2>${memberships.map(item => `<div class="list-row"><div class="list-main"><strong>${escapeHtml(item.institution__name || 'Institución')}</strong><small>${escapeHtml(item.role)} · ${escapeHtml(item.status)}</small></div>${statusPill(item.status)}</div>`).join('')}` : '';
  return `${heading('Mi perfil', isAdmin ? 'Datos de tu cuenta administrativa y preferencias de apariencia.' : 'Personalizá los datos visibles y las preferencias pedagógicas asociadas a tu cuenta.', btn('Cerrar sesión', 'logout', '', 'secondary'))}
    <form id="profile-settings-form" class="panel profile-settings-panel profile-settings-panel-limited"><div class="panel-body">
      <div class="entity-cell profile-summary"><span class="profile-avatar">${profile.avatar ? `<img src="${escapeHtml(profile.avatar)}" alt="">` : escapeHtml(initials(profile.full_name || profile.email))}</span><div class="profile-summary-copy"><strong>${escapeHtml(profile.full_name || (isAdmin ? 'Administrador' : 'Docente'))}</strong><small>${escapeHtml(profile.email || '')}</small></div>
        <div class="profile-avatar-actions"><label class="btn btn-secondary btn-small" for="profile-avatar-file">${profile.avatar ? 'Cambiar foto' : 'Subir foto'}</label><input class="visually-hidden" id="profile-avatar-file" type="file" accept="image/jpeg,image/png,image/webp" data-profile-avatar>${profile.avatar ? btn('Quitar foto', 'profile-avatar-remove', '', 'secondary') : ''}<small class="field-hint">JPG, PNG o WebP. Se recorta en cuadrado y se reduce automáticamente.</small></div></div>
      <h2>Datos de la cuenta</h2><div class="form-grid">
        <div class="form-field"><label for="profile-display-name">Nombre y apellido</label><input id="profile-display-name" name="display_name" value="${escapeHtml(profile.full_name || '')}" maxlength="100" minlength="2" required></div>
        <div class="form-field"><label for="profile-email-readonly">Correo electrónico</label><input id="profile-email-readonly" value="${escapeHtml(profile.email || '')}" disabled readonly><small class="field-hint">El correo se administra desde Supabase Auth.</small></div>
        <div class="form-field"><label>Rol global</label><input value="${escapeHtml(profile.role || 'teacher')}" disabled></div>
        <div class="form-field"><label>Estado de cuenta</label><input value="${escapeHtml(statusLabel(profile.status))}" disabled></div>
      </div>
      ${preferenceSection}
      <section class="profile-appearance"><div><h2>Apariencia</h2><p>Elegí el tema que te resulte más cómodo para trabajar.</p></div><button class="btn btn-secondary" type="button" id="theme-toggle-profile"><span aria-hidden="true">◐</span> <span id="theme-label-profile">${document.documentElement.dataset.theme === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro'}</span></button></section>
      ${membershipsSection}
      <p class="form-error" id="profile-error" role="alert"></p><p class="form-success" id="profile-success" role="status"></p>
      <div class="modal-actions"><button class="btn btn-primary" type="submit">Guardar cambios</button></div>
    </div></form>`;
}

const AVATAR_SIZE = 256;
const MAX_AVATAR_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_AVATAR_CHARS = 200000;

/** Recorta al centro en cuadrado y reduce a 256 px; devuelve un data URL (WebP o JPEG). */
async function avatarDataUrl(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Elegí una imagen JPG, PNG o WebP.');
  if (file.size > MAX_AVATAR_SOURCE_BYTES) throw new Error('La imagen supera los 10 MB. Elegí una más liviana.');
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('No se pudo leer la imagen. Probá con otra foto.'); }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE; canvas.height = AVATAR_SIZE;
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close?.();
  let url = canvas.toDataURL('image/webp', 0.85);
  // Navegadores sin codificador WebP devuelven PNG: se usa JPEG, más liviano.
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.85);
  if (url.length > MAX_AVATAR_CHARS) url = canvas.toDataURL('image/jpeg', 0.7);
  if (url.length > MAX_AVATAR_CHARS) throw new Error('La imagen sigue siendo demasiado grande. Probá con otra foto.');
  return url;
}

async function saveAvatar(avatar) {
  const result = avatar ? await api.put('me/avatar/', { avatar }) : await api.delete('me/avatar/');
  state.profile = { ...state.profile, avatar: result?.avatar || '' };
  updateChrome();
  render();
}

export async function uploadProfileAvatar(input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    await saveAvatar(await avatarDataUrl(file));
    toast('Foto de perfil actualizada.');
  } catch (error) {
    toast(`No se pudo guardar la foto: ${errorText(error)}`, 'error');
  } finally { input.value = ''; }
}

export async function removeProfileAvatar() {
  try { await saveAvatar(''); toast('Foto de perfil quitada.'); }
  catch (error) { toast(`No se pudo quitar la foto: ${errorText(error)}`, 'error'); }
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
  } finally { if (button) { button.disabled = false; button.textContent = 'Guardar cambios'; } }
}
