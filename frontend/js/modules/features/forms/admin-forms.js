import { state, modal } from '../../core/state.js';
import { escapeHtml, formField, textField, selectField, optionRows } from '../../core/utils.js';
import { openModal, modalForm, toast } from '../../core/ui.js';

export function adminUserForm(user = null) {
  const fields = `${user ? '' : formField('UUID de usuario existente en Supabase Auth', 'user_id', '', 'text', 'required placeholder="UUID de auth.users"', true)}${formField('Correo', 'email', user?.email || '', 'email', 'maxlength="254"', true)}${formField('Nombre completo', 'full_name', user?.full_name || '', 'text', 'maxlength="180"', true)}${selectField('Rol global', 'role', [{ value: 'teacher', label: 'Docente' }, { value: 'student', label: 'Estudiante' }, ...(['superadmin'].includes(state.profile?.role) ? [{ value: 'admin', label: 'Administrador' }, { value: 'superadmin', label: 'Superadministrador' }] : [])], user?.role || 'teacher')}${selectField('Estado', 'status', [{ value: 'active', label: 'Activo' }, { value: 'suspended', label: 'Suspendido' }, { value: 'deleted', label: 'Eliminado' }], user?.status || 'active')}${textField('Motivo de suspensión', 'suspension_reason', user?.suspension_reason || '')}`;
  openModal(user ? 'Editar perfil' : 'Crear perfil de identidad existente', modalForm(fields), user ? 'edit-admin-user' : 'new-admin-user', true);
  modal.dataset.recordId = user?.id || '';
}

export function institutionForm(item = null, scoped = false) {
  const fields = scoped
    ? `${formField('Nombre', 'name', item?.name || '', 'text', 'maxlength="180"', true)}${formField('Correo de contacto', 'contact_email', item?.contact_email || '', 'email', 'maxlength="254"')}`
    : `${formField('Nombre', 'name', item?.name || '', 'text', 'maxlength="180"', true)}${formField('Slug', 'slug', item?.slug || '', 'text', 'maxlength="120"', true)}${formField('Correo de contacto', 'contact_email', item?.contact_email || '', 'email', 'maxlength="254"')}${selectField('Estado', 'status', [{ value: 'active', label: 'Activa' }, { value: 'suspended', label: 'Suspendida' }, { value: 'archived', label: 'Archivada' }], item?.status || 'active')}`;
  openModal(item ? 'Editar institución' : 'Crear institución', modalForm(fields), scoped ? 'edit-institution-scope' : item ? 'edit-institution' : 'new-institution');
  modal.dataset.recordId = item?.id || '';
}

export function membershipForm(item = null, defaultInstitution = '') {
  const institutions = optionRows(state.data.admin.institutions.filter(row => row.status === 'active'), row => row.name);
  const globalAdmin = ['admin', 'superadmin'].includes(state.profile?.role);
  const roles = [{ value: 'teacher', label: 'Docente' }, { value: 'department_admin', label: 'Administrador de departamento' }, ...(globalAdmin ? [{ value: 'institution_admin', label: 'Administrador institucional' }] : [])];
  const fields = `${selectField('Institución', 'institution', institutions, item?.institution || defaultInstitution || '', true)}${formField('UUID de usuario existente', 'user_id', item?.user_id || '', 'text', `placeholder="UUID auth.users" ${item ? 'disabled' : ''}`, true)}${selectField('Rol institucional', 'role', roles, item?.role || 'teacher')}${selectField('Estado', 'status', [{ value: 'invited', label: 'Invitada' }, { value: 'active', label: 'Activa' }, { value: 'suspended', label: 'Suspendida' }], item?.status || 'active')}`;
  openModal(item ? 'Editar membresía' : 'Agregar membresía', modalForm(fields), item ? 'edit-membership' : 'new-membership');
  modal.dataset.recordId = item?.id || '';
}

export function messageForm(item) {
  const admins = state.data.admin.users.filter(user => ['admin', 'superadmin'].includes(user.role) && user.status === 'active').map(user => ({ value: user.user_id, label: `${user.full_name || user.email} (${user.email})` }));
  openModal('Gestionar mensaje de contacto', modalForm(`${formField('Remitente', 'name', item.name, 'text', 'disabled')}${formField('Correo', 'email', item.email, 'email', 'disabled')}${formField('Asunto', 'subject', item.subject, 'text', 'disabled')}${textField('Mensaje', 'message', item.message, 'disabled')}${selectField('Estado', 'status', [{ value: 'new', label: 'Nuevo' }, { value: 'in_progress', label: 'En gestión' }, { value: 'handled', label: 'Atendido' }, { value: 'spam', label: 'Spam' }], item.status)}${selectField('Responsable', 'assigned_to', optionRows(admins, user => user.label, true), item.assigned_to || '')}${textField('Notas internas (sólo administración)', 'internal_notes', item.internal_notes || '')}`), 'edit-message', true);
  modal.dataset.recordId = item.id;
}

export function providerForm(item = null) {
  const fields = `${selectField('Proveedor', 'provider', [{ value: 'mock', label: 'Mock' }, { value: 'gemini', label: 'Gemini' }, { value: 'openai', label: 'OpenAI' }, { value: 'ollama', label: 'Ollama' }], item?.provider || 'mock')}${formField('Modelo', 'model_name', item?.model_name || '', 'text', 'maxlength="120"')}${selectField('Habilitado', 'enabled', [{ value: 'true', label: 'Sí' }, { value: 'false', label: 'No' }], String(Boolean(item?.enabled)))}${formField('Prioridad', 'priority', item?.priority ?? 10, 'number', 'min="-32768" max="32767" step="1"')}${formField('Timeout (segundos)', 'timeout_seconds', item?.timeout_seconds ?? 60, 'number', 'min="5" max="85" step="1"')}${formField('Costo entrada USD / 1k tokens', 'input_usd_per_1k_tokens', item?.input_usd_per_1k_tokens ?? '', 'number', 'min="0" step="0.000001"')}${formField('Costo salida USD / 1k tokens', 'output_usd_per_1k_tokens', item?.output_usd_per_1k_tokens ?? '', 'number', 'min="0" step="0.000001"')}<div class="form-field full"><label class="check"><input type="checkbox" name="confirm_external_processing" value="true"><span>Confirmo que la institución autorizó enviar respuestas de estudiantes a este proveedor externo (obligatorio para habilitar Gemini, OpenAI u Ollama; sólo superadministración).</span></label></div>`;
  openModal(item ? 'Editar proveedor IA' : 'Configurar proveedor IA', modalForm(fields, 'Guardar proveedor'), item ? 'edit-provider' : 'new-provider', true);
  modal.dataset.recordId = item?.id || '';
}

