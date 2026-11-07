import { api } from '../core/api-client.js';
import { state, content } from '../core/state.js';
import { listFrom, errorText, escapeHtml } from '../core/utils.js';
import { toast, updateChrome } from '../core/ui.js';
import { render } from '../core/router.js';
import { loadedResources, reloadLoadedResources, reloadResources } from './resources.js';

async function settleWithConcurrency(resources, concurrency = 4) {
  const results = new Array(resources.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, resources.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= resources.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await api.list(resources[index][1]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

const OVERVIEW_CACHE_KEY = 'maestria.overview.v1';
const OVERVIEW_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

export function readOverviewCache() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(OVERVIEW_CACHE_KEY) || 'null');
    if (!cached || cached.uid !== state.profile?.user_id || Date.now() - cached.at > OVERVIEW_CACHE_MAX_AGE_MS) return null;
    return cached.data;
  } catch { return null; }
}

function writeOverviewCache(data) {
  try { sessionStorage.setItem(OVERVIEW_CACHE_KEY, JSON.stringify({ uid: state.profile?.user_id, at: Date.now(), data })); } catch { /* almacenamiento lleno o bloqueado */ }
}

export async function refreshCore({ onOverviewReady, overviewPromise } = {}) {
  // El resumen trae cursos y evaluaciones compactos y los contadores exactos del panel.
  // Las demás listas se piden bajo demanda (data/resources.js); aquí solo se actualizan las ya cargadas.
  const overviewTask = (overviewPromise || api.get('dashboard/overview/')).then(
    value => ({ status: 'fulfilled', value }),
    reason => ({ status: 'rejected', reason }),
  );
  const resourcesTask = reloadLoadedResources();
  const overviewResult = await overviewTask;

  state.errors = Object.fromEntries(Object.entries(state.errors).filter(([key]) => key.startsWith('admin_') || key.startsWith('institution_') || loadedResources().includes(key)));
  if (overviewResult.status === 'fulfilled') {
    const fullListsLoaded = loadedResources();
    state.data.overview = overviewResult.value;
    if (!fullListsLoaded.includes('courses')) state.data.courses = listFrom(overviewResult.value.courses);
    if (!fullListsLoaded.includes('assessments')) state.data.assessments = listFrom(overviewResult.value.assessments);
    delete state.errors.overview;
    writeOverviewCache(overviewResult.value);
    try { onOverviewReady?.(overviewResult.value); } catch {
      // A presentation callback must not turn a successful API response into a data failure.
    }
  } else {
    state.data.overview = null;
    state.errors.overview = errorText(overviewResult.reason);
  }

  await resourcesTask;
  state.loading = false;
  updateChrome();
}

export async function refreshAdmin() {
  const resources = [
    ['users', 'admin/users/'], ['institutions', 'admin/institutions/'],
    ['memberships', 'admin/institution-memberships/'], ['messages', 'admin/contact-messages/'],
    ['audit', 'admin/audit-events/'], ['providers', 'admin/ai-providers/']
  ];
  const results = await settleWithConcurrency(resources, 4);
  results.forEach((result, index) => {
    const [key] = resources[index];
    if (result.status === 'fulfilled') state.data.admin[key] = listFrom(result.value);
    else state.errors[`admin_${key}`] = errorText(result.reason);
  });
}

export async function refreshInstitutionScope() {
  const memberships = (state.profile?.memberships || []).filter(item => item.status === 'active' && ['institution_admin', 'department_admin'].includes(item.role));
  if (!memberships.length || ['admin', 'superadmin'].includes(state.profile?.role)) return;
  const results = await Promise.allSettled([api.list('admin/institutions/'), api.list('admin/institution-memberships/')]);
  if (results[0].status === 'fulfilled') state.data.admin.institutions = listFrom(results[0].value);
  else state.errors.institution_scope = errorText(results[0].reason);
  if (results[1].status === 'fulfilled') state.data.admin.memberships = listFrom(results[1].value);
  else state.errors.institution_memberships = errorText(results[1].reason);
}

export async function loadProfile() {
  const session = await api.validSession();
  if (!session) {
    api.clearSession();
    window.location.replace('../acceso.html');
    return false;
  }

  try {
    // The backend is the authority for identity, role and account status.
    // Never synthesize a teacher profile when this request fails.
    const profile = await api.get('me/');
    if (!profile || !profile.user_id || !profile.role) {
      throw new Error('El backend devolvió un perfil incompleto. No se puede abrir el espacio docente.');
    }
    state.profile = profile;
  } catch (error) {
    state.profile = null;
    if (error?.status === 401) {
      api.clearSession();
      window.location.replace('../acceso.html');
      return false;
    }
    if (error?.status === 403) {
      content.innerHTML = `
        <section class="panel" role="alert">
          <div class="panel-body">
            <div class="empty-state">
              <div class="empty-icon" aria-hidden="true">!</div>
              <h2>Acceso no disponible</h2>
              <p>Tu cuenta no tiene permisos para ingresar al espacio docente. Si creés que es un error, contactá al administrador de tu institución.</p>
              <a class="btn btn-secondary" href="../index.html">Volver al sitio</a>
            </div>
          </div>
        </section>`;
      return false;
    }

    const message = errorText(error);
    content.innerHTML = `
      <section class="panel" role="alert">
        <div class="panel-body">
          <div class="empty-state">
            <div class="empty-icon" aria-hidden="true">!</div>
            <h2>No pudimos iniciar tu espacio</h2>
            <p>No fue posible verificar tu perfil con el servidor. No se inició ninguna sesión docente local.</p>
            <p class="form-error">${escapeHtml(message)}</p>
            <div class="modal-actions">
              <button class="btn btn-primary" id="retry-workspace-init" type="button">Reintentar</button>
              <a class="btn btn-secondary" href="../index.html">Volver al sitio</a>
            </div>
          </div>
        </div>
      </section>`;
    return false;
  }

  const metadataName = String(session.user?.user_metadata?.full_name || '').trim();
  if (!state.profile.full_name && metadataName) {
    state.profile = { ...state.profile, full_name: metadataName };
  }
  let savedFeedbackStyle = 'constructivo';
  try {
    const localPreference = localStorage.getItem('maestria-feedback-style');
    if (['formal', 'constructivo', 'motivador'].includes(localPreference)) savedFeedbackStyle = localPreference;
  } catch { /* El almacenamiento local puede estar restringido. */ }
  state.feedbackStyle = ['formal', 'constructivo', 'motivador'].includes(session.user?.user_metadata?.maestria_feedback_style)
    ? session.user.user_metadata.maestria_feedback_style : savedFeedbackStyle;
  try { localStorage.setItem('maestria-feedback-style', state.feedbackStyle); } catch { /* La preferencia también queda en memoria. */ }

  if (state.profile.role === 'student') {
    content.innerHTML = `<section class="panel" role="alert"><div class="panel-body"><div class="empty-state"><div class="empty-icon" aria-hidden="true">!</div><h2>Acceso docente no disponible</h2><p>Esta cuenta no tiene permisos para ingresar al espacio docente.</p><a class="btn btn-secondary" href="../index.html">Volver al sitio</a></div></div></section>`;
    return false;
  }
  return true;
}

export async function loadAssessmentEditor(id) {
  const payload = await api.get(`assessments/${id}/editor/`);
  state.assessmentEditor = payload;
  return payload;
}

export async function loadCorrectionForSubmission(submissionId) {
  const summary = state.data.corrections.find(item => String(item.submission) === String(submissionId));
  if (!summary) return null;
  return api.get(`corrections/${summary.id}/`);
}

export async function afterWrite(message, keys = []) {
  toast(message);
  // El resumen del dashboard es barato y mantiene los contadores actualizados tras cada escritura.
  try {
    const overview = await api.get('dashboard/overview/');
    state.data.overview = overview;
    delete state.errors.overview;
    writeOverviewCache(overview);
  } catch {
    // El resumen es complementario: no hacer fallar la operación de escritura por él.
  }
  if (keys.includes('admin') && state.profile) {
    if (['admin', 'superadmin'].includes(state.profile.role)) await refreshAdmin();
    else if (['institution_admin', 'department_admin'].includes(state.profile.role)) await refreshInstitutionScope();
  }
  // Recarga solo las listas afectadas (pasadas por el llamador), no todas las cargadas.
  await reloadResources(keys);
  if (state.view === 'course') state.view = 'course';
  if (state.view === 'assessment') {
    try { state.assessmentEditor = await loadAssessmentEditor(state.selectedAssessment); } catch (error) { toast(errorText(error), 'error'); }
  }
  if (state.view === 'correction' && state.selectedCorrection) {
    try { state.currentCorrection = await api.get(`corrections/${state.selectedCorrection}/`); } catch (error) { toast(errorText(error), 'error'); }
  }
  render();
}
