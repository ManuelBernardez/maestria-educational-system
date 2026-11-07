export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const content = $('#app-content');
export const modal = $('#modal-layer');
export const modalContent = $('#modal-content');
export const toastRegion = $('#toast-region');

export const state = {
  profile: null,
  view: 'dashboard',
  selectedCourse: null,
  selectedAssessment: null,
  assessmentOrigin: 'course',
  adminSearch: '',
  selectedSubmission: null,
  currentSubmission: null,
  assessmentEditor: null,
  selectedCorrection: null,
  currentCorrection: null,
  correctionOrigin: 'submissions',
  correctionDetailLoading: false,
  rubricProposal: null,
  questionProposal: null,
  search: '',
  selectedStudent: null,
  // Filtros de listados: viven en memoria mientras dura la sesión de la vista.
  courseFilters: { status: 'active', cycle: 'all', sort: 'pending', layout: 'cards' },
  examFilters: { course: 'all', status: 'all', limit: 50 },
  dashboardCourseFilter: 'all',
  studentCourseFilter: 'all',
  studentStatusFilter: 'active',
  assessmentStatusFilter: 'all',
  assessmentCourseFilter: 'all',
  submissionStatusFilter: 'all',
  submissionCourseFilter: 'all',
  correctionsStatusFilter: 'all',
  correctionsCourseFilter: 'all',
  feedbackStyle: 'constructivo',
  selectedInstitution: null,
  adminMessageSearch: '',
  adminMessageStatus: '',
  adminTab: 'users',
  data: {
    overview: null, courses: [], students: [], enrollments: [], assessments: [],
    rubrics: [], submissions: [], corrections: [],
    admin: { users: [], institutions: [], memberships: [], messages: [], audit: [], providers: [] }
  },
  errors: {},
  modalKind: null,
  modalBusy: false,
  loading: true
};
