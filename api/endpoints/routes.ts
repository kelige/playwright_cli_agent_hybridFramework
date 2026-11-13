/**
 * DVS (Digital Evaluation System) API routes.
 *
 * Verified against a live authenticated session on the `harish` university tenant.
 * Every entry below was observed in real network traffic. Do not add routes that
 * were not observed. Per-university API host comes from `DVS_API_BASE_URL`.
 */

export const API_BASE_URL = process.env.DVS_API_BASE_URL ?? '';

export const Routes = {
  // ---------------------------------------------------------------------------
  // Authentication / identity
  // ---------------------------------------------------------------------------
  AUTH_LOGIN: '/api/v1/auth/login', // POST
  AUTH_LOGOUT: '/api/v1/auth/logout', // POST
  AUTH_ME: '/api/v1/auth/me', // GET
  AUTH_CSRF: '/api/v1/auth/csrf', // GET
  AUTH_SSO_PROVIDERS: '/api/v1/auth/sso/providers', // GET
  AUTH_NOTIFICATIONS: '/api/v1/auth/notifications', // GET
  AUTH_SECURITY_CONTEXT: '/api/v1/auth/security-context', // GET
  AUTH_STEP_UP: '/api/v1/auth/step-up', // POST
  AUTH_PASSWORD_COMPLETE_SETUP: '/api/v1/auth/password/complete-setup', // POST

  // ---------------------------------------------------------------------------
  // Enterprise / tenant context
  // ---------------------------------------------------------------------------
  ENTERPRISE_DOMAIN_CONTEXT: '/api/v1/enterprise/domain-context', // GET
  ENTERPRISE_FORM_FIELDS: '/api/v1/enterprise/form-fields', // GET ?form_key=

  // ---------------------------------------------------------------------------
  // Operations overview (admin/controller)
  // ---------------------------------------------------------------------------
  OPERATIONS_OVERVIEW: '/api/v1/operations/overview', // GET
  PHASE4_I18N: '/api/v1/phase4/i18n', // GET

  // ---------------------------------------------------------------------------
  // Academic configuration (Admin)
  // ---------------------------------------------------------------------------
  CONFIGURATION_CATALOG: '/api/v1/configuration/catalog', // GET
  CONFIGURATION_READINESS: '/api/v1/configuration/readiness', // GET
  CONFIGURATION_PROGRAMMES: '/api/v1/configuration/programmes', // POST
  CONFIGURATION_REGULATIONS: '/api/v1/configuration/regulations', // POST
  CONFIGURATION_ACADEMIC_YEARS: '/api/v1/configuration/academic-years', // POST
  CONFIGURATION_SESSIONS: '/api/v1/configuration/sessions', // POST
  CONFIGURATION_COURSES: '/api/v1/configuration/courses', // POST
  CONFIGURATION_SUBJECTS: '/api/v1/configuration/subjects', // POST
  CONFIGURATION_PAPERS: '/api/v1/configuration/papers', // POST
  CONFIGURATION_PAPER_QUESTION_CONTENT: '/api/v1/configuration/papers/{paperId}/question-content', // GET
  CONFIGURATION_PAPER_SETUP_SECTIONS: '/api/v1/configuration/papers/{paperId}/setup-sections', // POST
  CONFIGURATION_PAPER_SUBMIT: '/api/v1/configuration/papers/{paperId}/submit', // POST
  CONFIGURATION_PAPER_QUESTION_PAPER:
    '/api/v1/configuration/papers/{paperId}/documents/question_paper', // GET, POST
  CONFIGURATION_PAPER_EVALUATION_SCHEME:
    '/api/v1/configuration/papers/{paperId}/documents/evaluation_scheme', // POST

  // ---------------------------------------------------------------------------
  // Evaluator management (Chief)
  // ---------------------------------------------------------------------------
  EVALUATOR_MANAGEMENT: '/api/v1/evaluator-management', // GET, POST
  EVALUATOR_TEAM: '/api/v1/evaluator-management/chiefs/me/team', // GET
  EVALUATOR_ENROLLMENT_POLICY: '/api/v1/evaluator-management/enrollment-policy', // GET
  EVALUATOR_FACE_LOGIN: '/api/v1/evaluator-management/face/login', // GET, POST
  EVALUATOR_FACE_STATUS: '/api/v1/evaluator-management/face/status', // GET
  EVALUATOR_FACE_VERIFY_ACCESS: '/api/v1/evaluator-management/face/verify-access', // POST

  // ---------------------------------------------------------------------------
  // Chairman
  // ---------------------------------------------------------------------------
  CHAIRMAN_CATALOG: '/api/v1/chairman/catalog', // GET ?subject_id=
  CHAIRMAN_HISTORY: '/api/v1/chairman/history', // GET
  CHAIRMAN_MY_NOMINATIONS: '/api/v1/chairman/my-nominations', // GET
  CHAIRMAN_NOMINATIONS: '/api/v1/chairman/nominations', // POST
  CHAIRMAN_NOMINATION_ACCEPT: '/api/v1/chairman/nominations/{nominationId}/accept', // POST

  // ---------------------------------------------------------------------------
  // Chief examiner
  // ---------------------------------------------------------------------------
  CHIEF_SUMMARY: '/api/v1/chief/summary', // GET
  CHIEF_EVALUATOR_HISTORY: '/api/v1/chief/evaluator-history', // GET
  CHIEF_MODERATION_REPORT: '/api/v1/chief/moderation/report', // GET ?summary=true
  CHIEF_TEAM_NOMINATIONS: '/api/v1/chief/team/nominations', // POST

  // ---------------------------------------------------------------------------
  // Allocation
  // ---------------------------------------------------------------------------
  ALLOCATION_CATALOG: '/api/v1/allocation/catalog', // GET
  ALLOCATION_EXAMINER_BATCHES: '/api/v1/allocation/examiner-batches', // GET
  ALLOCATION_SUBJECT_GROUPS: '/api/v1/allocation/examiner-batches/{batchId}/subject-groups', // GET
  ALLOCATION_ALLOCATE_SUBJECT_GROUP:
    '/api/v1/allocation/examiner-batches/{batchId}/allocate-subject-group', // POST
  ALLOCATION_ASSIGNMENT_ACTION: '/api/v1/allocation/assignments/{assignmentId}/action', // POST
  ALLOCATION_ASSIGNMENT_VIEWER: '/api/v1/allocation/assignments/{assignmentId}/viewer', // GET
  ASSIGNMENT_LOCK: '/api/v1/assignment-governance/assignments/{assignmentId}/lock', // POST

  // ---------------------------------------------------------------------------
  // Marking / evaluation workspace (Evaluator)
  // ---------------------------------------------------------------------------
  MARKING_WORKSPACE: '/api/v1/marking/assignments/{assignmentId}/workspace', // GET
  MARKING_OPEN: '/api/v1/marking/assignments/{assignmentId}/open', // POST
  MARKING_ACKNOWLEDGEMENTS: '/api/v1/marking/assignments/{assignmentId}/acknowledgements', // GET, POST
  MARKING_AI_ANALYSIS: '/api/v1/marking/assignments/{assignmentId}/ai-analysis', // GET
  MARKING_MARKS: '/api/v1/marking/evaluations/{evaluationId}/marks', // POST
  WORKFLOW_DRAFTS: '/api/v1/workflow/assignments/{assignmentId}/drafts', // POST

  // ---------------------------------------------------------------------------
  // Marking schemes / rubrics
  // ---------------------------------------------------------------------------
  RUBRICS_CATALOG: '/api/v1/rubrics/catalog', // GET
  RUBRICS_SCHEMES: '/api/v1/rubrics/schemes', // POST
  RUBRICS_SCHEME_TRANSITION: '/api/v1/rubrics/schemes/{schemeId}/transition', // POST

  // ---------------------------------------------------------------------------
  // Scanning / receiving (Scanner Operator)
  // ---------------------------------------------------------------------------
  SCANNING_CATALOG: '/api/v1/scanning/catalog', // GET
  RECEIVING_GUIDED_CATALOG: '/api/v1/receiving/guided/catalog', // GET
  RECEIVING_REPORTS_CONFIG: '/api/v1/receiving/guided/reports/config', // GET
  RECEIVING_SUBJECT_PAPERS: '/api/v1/receiving/guided/subject-papers', // GET
  RECEIVING_SUBJECT_SCRIPTS: '/api/v1/receiving/guided/subject-scripts', // GET, POST ?paper_id=
  RECEIVING_SUBJECT_GROUP_SUBMIT: '/api/v1/receiving/guided/subject-groups/{groupId}/submit', // POST
  REPOSITORY_MANUAL_SCAN_UPLOAD: '/api/v1/repository/manual-scan/uploads', // POST
  REPOSITORY_UPLOAD_FINALIZE: '/api/v1/repository/uploads/{uploadId}/finalize', // POST
  REPOSITORY_SCRIPT_COMPLETE_SCAN: '/api/v1/repository/scripts/{scriptId}/complete-scan', // POST

  // ---------------------------------------------------------------------------
  // Security / access governance (Admin, User Manager)
  // ---------------------------------------------------------------------------
  SECURITY_CATALOG: '/api/v1/security/catalog', // GET
  SECURITY_MEMBERSHIPS: '/api/v1/security/memberships', // POST
  SECURITY_POLICY: '/api/v1/security/policy', // PUT

  // ---------------------------------------------------------------------------
  // Phase 4 operational catalog
  // ---------------------------------------------------------------------------
  PHASE4_CATALOG: '/api/v1/phase4/catalog', // GET ?section=
  PHASE4_CENTRES: '/api/v1/phase4/centres', // POST
  PHASE4_CENTRE_ACTION: '/api/v1/phase4/centres/{centreId}/action', // POST
  PHASE4_CENTRE_READINESS: '/api/v1/phase4/centres/{centreId}/readiness', // POST
  PHASE4_HIERARCHY_MONITORING: '/api/v1/phase4/hierarchy-monitoring', // GET
  PHASE4_EVALUATION_LOCATION: '/api/v1/phase4/evaluation/location', // POST
  PHASE4_REMOTE_SECURITY_POLICY: '/api/v1/phase4/remote-security/policy', // GET
  PHASE4_REMOTE_SECURITY_SESSIONS: '/api/v1/phase4/remote-security/sessions', // POST
  PHASE4_REMOTE_SECURITY_HEARTBEAT: '/api/v1/phase4/remote-security/sessions/{sessionId}/heartbeat', // POST
  PHASE4_REMOTE_SECURITY_RESUME: '/api/v1/phase4/remote-security/sessions/{sessionId}/resume', // POST
  PHASE4_REMOTE_SECURITY_EVENTS: '/api/v1/phase4/remote-security/events', // POST
  PHASE4_REMOTE_SUPPORT_INBOX: '/api/v1/phase4/remote-support/inbox', // GET

  // ---------------------------------------------------------------------------
  // Evaluation workflow catalog
  // ---------------------------------------------------------------------------
  EVALUATION_WORKFLOW_CATALOG: '/api/v1/evaluation-workflow/catalog', // GET
  AI_EVALUATION_CATALOG: '/api/v1/ai-evaluation/catalog', // GET (403 when module disabled)
} as const;

/**
 * Builders for routes that take path or query values.
 * Query shapes below match the exact keys observed in network traffic.
 */
export const RouteBuilders = {
  configurationCatalog: (tableKey: string, offset = 0, limit = 10) =>
    `/api/v1/configuration/catalog?table_key=${encodeURIComponent(tableKey)}&table_offset=${offset}&table_limit=${limit}`,

  enterpriseFormFields: (formKey: string) =>
    `/api/v1/enterprise/form-fields?form_key=${encodeURIComponent(formKey)}`,

  chairmanCatalog: (subjectId: string) =>
    `/api/v1/chairman/catalog?subject_id=${encodeURIComponent(subjectId)}`,

  allocationCatalog: (filters: Record<string, unknown>, offset = 0, limit = 10) =>
    `/api/v1/allocation/catalog?table_filters=${encodeURIComponent(JSON.stringify(filters))}` +
    `&table_key=assignments&table_offset=${offset}&table_limit=${limit}`,

  allocationCatalogWorkflow: (evaluatorDesk = true) =>
    `/api/v1/allocation/catalog?table_workflow=1${evaluatorDesk ? '&evaluator_desk=1' : ''}`,

  phase4Catalog: (section: 'assessment' | 'centres' | 'operations') =>
    `/api/v1/phase4/catalog?section=${section}`,

  chiefModerationSummary: '/api/v1/chief/moderation/report?summary=true',

  receivingSubjectScripts: (paperId: string) =>
    `/api/v1/receiving/guided/subject-scripts?paper_id=${encodeURIComponent(paperId)}`,

  configurationPaperQuestionContent: (paperId: string) =>
    `/api/v1/configuration/papers/${encodeURIComponent(paperId)}/question-content`,

  configurationPaperSetupSections: (paperId: string) =>
    `/api/v1/configuration/papers/${encodeURIComponent(paperId)}/setup-sections`,

  configurationPaperSubmit: (paperId: string) =>
    `/api/v1/configuration/papers/${encodeURIComponent(paperId)}/submit`,

  configurationPaperQuestionPaper: (paperId: string) =>
    `/api/v1/configuration/papers/${encodeURIComponent(paperId)}/documents/question_paper`,

  configurationPaperEvaluationScheme: (paperId: string) =>
    `/api/v1/configuration/papers/${encodeURIComponent(paperId)}/documents/evaluation_scheme`,

  allocationSubjectGroups: (batchId: string) =>
    `/api/v1/allocation/examiner-batches/${encodeURIComponent(batchId)}/subject-groups`,

  allocationAllocateSubjectGroup: (batchId: string) =>
    `/api/v1/allocation/examiner-batches/${encodeURIComponent(batchId)}/allocate-subject-group`,

  allocationAssignmentAction: (assignmentId: string) =>
    `/api/v1/allocation/assignments/${encodeURIComponent(assignmentId)}/action`,

  allocationAssignmentViewer: (assignmentId: string) =>
    `/api/v1/allocation/assignments/${encodeURIComponent(assignmentId)}/viewer?low_bandwidth=false`,

  assignmentLock: (assignmentId: string) =>
    `/api/v1/assignment-governance/assignments/${encodeURIComponent(assignmentId)}/lock`,

  markingWorkspace: (assignmentId: string) =>
    `/api/v1/marking/assignments/${encodeURIComponent(assignmentId)}/workspace`,

  markingOpen: (assignmentId: string) =>
    `/api/v1/marking/assignments/${encodeURIComponent(assignmentId)}/open`,

  markingAcknowledgements: (assignmentId: string) =>
    `/api/v1/marking/assignments/${encodeURIComponent(assignmentId)}/acknowledgements`,

  markingAiAnalysis: (assignmentId: string) =>
    `/api/v1/marking/assignments/${encodeURIComponent(assignmentId)}/ai-analysis`,

  markingMarks: (evaluationId: string) =>
    `/api/v1/marking/evaluations/${encodeURIComponent(evaluationId)}/marks`,

  workflowDrafts: (assignmentId: string) =>
    `/api/v1/workflow/assignments/${encodeURIComponent(assignmentId)}/drafts`,

  rubricsSchemeTransition: (schemeId: string) =>
    `/api/v1/rubrics/schemes/${encodeURIComponent(schemeId)}/transition`,

  chairmanNominationAccept: (nominationId: string) =>
    `/api/v1/chairman/nominations/${encodeURIComponent(nominationId)}/accept`,

  phase4CentreAction: (centreId: string) =>
    `/api/v1/phase4/centres/${encodeURIComponent(centreId)}/action`,

  phase4CentreReadiness: (centreId: string) =>
    `/api/v1/phase4/centres/${encodeURIComponent(centreId)}/readiness`,

  phase4RemoteSessionHeartbeat: (sessionId: string) =>
    `/api/v1/phase4/remote-security/sessions/${encodeURIComponent(sessionId)}/heartbeat`,

  phase4RemoteSessionResume: (sessionId: string) =>
    `/api/v1/phase4/remote-security/sessions/${encodeURIComponent(sessionId)}/resume`,

  repositoryUploadFinalize: (uploadId: string) =>
    `/api/v1/repository/uploads/${encodeURIComponent(uploadId)}/finalize`,

  repositoryScriptCompleteScan: (scriptId: string) =>
    `/api/v1/repository/scripts/${encodeURIComponent(scriptId)}/complete-scan`,

  receivingSubjectGroupSubmit: (groupId: string) =>
    `/api/v1/receiving/guided/subject-groups/${encodeURIComponent(groupId)}/submit`,
} as const;

/** HTTP methods observed for each route constant. */
export const RouteMethods = {
  AUTH_LOGIN: 'POST',
  AUTH_LOGOUT: 'POST',
  AUTH_ME: 'GET',
  AUTH_CSRF: 'GET',
  AUTH_SSO_PROVIDERS: 'GET',
  AUTH_NOTIFICATIONS: 'GET',
  AUTH_SECURITY_CONTEXT: 'GET',
  AUTH_STEP_UP: 'POST',
  AUTH_PASSWORD_COMPLETE_SETUP: 'POST',
  ENTERPRISE_DOMAIN_CONTEXT: 'GET',
  ENTERPRISE_FORM_FIELDS: 'GET',
  OPERATIONS_OVERVIEW: 'GET',
  PHASE4_I18N: 'GET',
  CONFIGURATION_CATALOG: 'GET',
  CONFIGURATION_READINESS: 'GET',
  CONFIGURATION_PROGRAMMES: 'POST',
  CONFIGURATION_REGULATIONS: 'POST',
  CONFIGURATION_ACADEMIC_YEARS: 'POST',
  CONFIGURATION_SESSIONS: 'POST',
  CONFIGURATION_COURSES: 'POST',
  CONFIGURATION_SUBJECTS: 'POST',
  CONFIGURATION_PAPERS: 'POST',
  CONFIGURATION_PAPER_QUESTION_CONTENT: 'GET',
  CONFIGURATION_PAPER_SETUP_SECTIONS: 'POST',
  CONFIGURATION_PAPER_SUBMIT: 'POST',
  CONFIGURATION_PAPER_QUESTION_PAPER: 'GET/POST',
  CONFIGURATION_PAPER_EVALUATION_SCHEME: 'POST',
  EVALUATOR_MANAGEMENT: 'GET/POST',
  EVALUATOR_TEAM: 'GET',
  EVALUATOR_ENROLLMENT_POLICY: 'GET',
  EVALUATOR_FACE_LOGIN: 'GET/POST',
  EVALUATOR_FACE_STATUS: 'GET',
  EVALUATOR_FACE_VERIFY_ACCESS: 'POST',
  CHAIRMAN_CATALOG: 'GET',
  CHAIRMAN_HISTORY: 'GET',
  CHAIRMAN_MY_NOMINATIONS: 'GET',
  CHAIRMAN_NOMINATIONS: 'POST',
  CHAIRMAN_NOMINATION_ACCEPT: 'POST',
  CHIEF_SUMMARY: 'GET',
  CHIEF_EVALUATOR_HISTORY: 'GET',
  CHIEF_MODERATION_REPORT: 'GET',
  CHIEF_TEAM_NOMINATIONS: 'POST',
  ALLOCATION_CATALOG: 'GET',
  ALLOCATION_EXAMINER_BATCHES: 'GET',
  ALLOCATION_SUBJECT_GROUPS: 'GET',
  ALLOCATION_ALLOCATE_SUBJECT_GROUP: 'POST',
  ALLOCATION_ASSIGNMENT_ACTION: 'POST',
  ALLOCATION_ASSIGNMENT_VIEWER: 'GET',
  ASSIGNMENT_LOCK: 'POST',
  MARKING_WORKSPACE: 'GET',
  MARKING_OPEN: 'POST',
  MARKING_ACKNOWLEDGEMENTS: 'GET/POST',
  MARKING_AI_ANALYSIS: 'GET',
  MARKING_MARKS: 'POST',
  WORKFLOW_DRAFTS: 'POST',
  RUBRICS_CATALOG: 'GET',
  RUBRICS_SCHEMES: 'POST',
  RUBRICS_SCHEME_TRANSITION: 'POST',
  SCANNING_CATALOG: 'GET',
  RECEIVING_GUIDED_CATALOG: 'GET',
  RECEIVING_REPORTS_CONFIG: 'GET',
  RECEIVING_SUBJECT_PAPERS: 'GET',
  RECEIVING_SUBJECT_SCRIPTS: 'GET/POST',
  RECEIVING_SUBJECT_GROUP_SUBMIT: 'POST',
  REPOSITORY_MANUAL_SCAN_UPLOAD: 'POST',
  REPOSITORY_UPLOAD_FINALIZE: 'POST',
  REPOSITORY_SCRIPT_COMPLETE_SCAN: 'POST',
  SECURITY_CATALOG: 'GET',
  SECURITY_MEMBERSHIPS: 'POST',
  SECURITY_POLICY: 'PUT',
  PHASE4_CATALOG: 'GET',
  PHASE4_CENTRES: 'POST',
  PHASE4_CENTRE_ACTION: 'POST',
  PHASE4_CENTRE_READINESS: 'POST',
  PHASE4_HIERARCHY_MONITORING: 'GET',
  PHASE4_EVALUATION_LOCATION: 'POST',
  PHASE4_REMOTE_SECURITY_POLICY: 'GET',
  PHASE4_REMOTE_SECURITY_SESSIONS: 'POST',
  PHASE4_REMOTE_SECURITY_HEARTBEAT: 'POST',
  PHASE4_REMOTE_SECURITY_RESUME: 'POST',
  PHASE4_REMOTE_SECURITY_EVENTS: 'POST',
  PHASE4_REMOTE_SUPPORT_INBOX: 'GET',
  EVALUATION_WORKFLOW_CATALOG: 'GET',
  AI_EVALUATION_CATALOG: 'GET',
} as const;
