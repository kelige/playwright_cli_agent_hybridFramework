# Digital Evaluation System (ADMIEZO) — DB Test Prompts

**Application:** Digital Evaluation System (ADMIEZO)
**Database reference:** `prompts/db.sqlite3` — read-only snapshot of the KTR tenant database
**Verified schema:** 181 tables, 0 views (extracted directly from the snapshot)
**Access mode:** READ-ONLY. No INSERT, UPDATE, DELETE, DDL or migrations from tests.
**Framework:** Playwright + TypeScript, DB utilities under `utils/`, specs under `tests/db/`. Architecture: §1.

> This file replaces the OpenCart/MySQL DB prompt. No `oc_customer`, MySQL, or e-commerce tables belong here.

---

# 1. Rules That Apply To Every DB Test

1. Read the DB connection from `.env` only: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ENGINE`.
2. Never run writes. Block `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, `PRAGMA writable_schema`.
3. Every query must be parameterized. Never concatenate ids or emails into SQL.
4. Every query must filter by tenant scope. Nearly every table has a `tenant_id` column. Cross-tenant reads are a security failure, not a convenience.
5. Do not select secrets: `auth_user.password`, `security_securitypolicy.siem_webhook_ciphertext`, token/cipher columns, `evaluators_evaluatorfacetemplate.encrypted_template`.
6. Prefer validating aggregates and state fields over raw personal data.
7. Close the connection in `finally`, even when assertions fail.
8. The snapshot is for schema and query design. Assert against the environment's live DB only when approved.
9. Row counts below are from the snapshot and are not assertions. Assert per-record values from the test flow.
10. Verify the deployed engine and schema before coding; this snapshot is SQLite while production may differ in driver, not in table design.

## DB Testing Architecture (mandatory)

Every DB prompt in this file builds artifacts in this order. Never create the spec first.

```text
DB Test Prompt
      ↓
Analyze table(s) and key columns (prompts/db.sqlite3 snapshot; live engine per DB_ENGINE)
      ↓
DB configuration — .env only
      ↓
DB client utility — utils/dbClient.ts (one executeQuery, connection closed in finally)
      ↓
Query + test data — parameterized SQL in the spec; testdata/ + utils/helper.ts
      ↓
DB test — tests/db/<area>/<kebab-case>.spec.ts
      ↓
Run → diagnose the real failure → fix → re-run
```

### Layer map

| Artifact | Location | Convention |
| --- | --- | --- |
| DB configuration | `.env` | `DB_ENGINE`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, or `DB_SQLITE_PATH` |
| DB client | `utils/dbClient.ts` | `executeQuery(sql, params)` — the only connection code |
| DB spec | `tests/db/<area>/` | `<kebab-case>.spec.ts` |
| Test data | `testdata/` + `utils/helper.ts` | synthetic only |
| Schema reference | `prompts/db.sqlite3` | snapshot for query design, not the runtime target |

> **Blocked by design:** `utils/dbClient.ts` does not exist yet. Create it only after the team confirms the deployed engine and driver (`pg` is installed for PostgreSQL; the SQLite snapshot is reference-only) and approved read-only access. Until then, DB specs are marked blocked — never invent a client, driver, or connection string.

### Layer separation

```text
DB   → DB Client → Queries → Test Data → DB Tests
Web  → Page Objects → Custom Fixture → Utilities / Test Data → Web Tests
API  → Routes → Schemas → Utilities / Test Data → API Tests
```

Do not put SQL or DB client calls inside Web or API specs except in an explicitly combined scenario, and then in separate `test.step()` blocks.

### DB test rules

- Import `{ test, expect }` from `@playwright/test` directly.
- Call `dotenv.config()` at the top of the spec; read the connection from `.env` only.
- Use the single `executeQuery` from `utils/dbClient.ts`; no per-test connection setup.
- Tag titles `@master @db` (`npm run test:db` greps `@db`).
- Wrap each verification group in `await test.step('N) description', ...)`.
- Every query is parameterized and filtered by `tenant_id`. No string-concatenated ids or emails.
- READ-ONLY: no `INSERT`, `UPDATE`, `DELETE`, `DDL`, or migrations. Row counts in this file are snapshot facts, not assertions.
- Assert stored values, state transitions and audit rows — not secrets or unnecessary personal data (see §1 rules 5–6).
- Missing connection config or engine detail → `test.skip()` / blocked, naming the gap. Never guess the driver.

---

# 2. Role → Table Map

| Role | Primary tables | Cross-check tables |
| ---- | -------------- | ------------------ |
| Admin (university_admin) | `auth_user`, `tenancy_membership`, `tenancy_institution`, `tenancy_tenantaccount`, `tenancy_tenantdomain`, `configuration_*` | `core_auditevent`, `security_securitypolicy` |
| User Manager | `tenancy_membership`, `auth_user` | `core_auditevent` |
| Chairman | `configuration_subject`, `configuration_paper`, `configuration_paperdocument` | `evaluators_evaluator`, `rubrics_markingscheme` |
| Chief Examiner | `evaluators_evaluator`, `evaluators_expertise`, `evaluators_evaluatorhistory` | `allocation_assignment`, `phase4_attendancerecord` |
| Evaluator | `marking_evaluation`, `marking_questionmark`, `marking_evaluationcomment` | `allocation_assignment`, `phase4_attendancerecord` |
| Scanner Operator | `scanning_scanbatch`, `repository_scriptasset`, `receiving_packet`, `receiving_preparedpacket` | `custody_script`, `scan_processing_processingrun` |
| Exam Invigilator (optional) | `phase4_attendancerecord`, `phase4_centres` | `configuration_examsession` |
| Security / Audit | `core_auditevent`, `security_securitypolicy`, `identity_auth_*` | `evaluators_evaluatoridentityverification` |

Canonical role values observed in `tenancy_membership.role`: `university_admin`, `chairman`, `user_manager`, `evaluator`, `scanner_operator`.

---

# 3. Verified Tables and Columns (key subset)

## Identity and tenancy

| Table | Key columns |
| ----- | ----------- |
| `auth_user` | `id`, `email`, `first_name`, `last_name`, `is_active`, `last_login`, `date_joined`, `is_staff`, `is_superuser` |
| `tenancy_membership` | `id`, `user_id → auth_user.id`, `role`, `is_active`, `institution_id → tenancy_institution.id`, `operational_centre_id`, `must_change_password`, `enabled_modules`, `permissions`, `custom_fields` |
| `tenancy_institution` | `id`, `tenant_id`, `name`, `code`, `kind`, `parent_id`, `is_active` |
| `tenancy_tenantaccount` | `id`, `slug`, `status`, `plan`, `enabled_modules`, `root_institution_id`, `brand_name` |
| `tenancy_tenantdomain` | `id`, `hostname`, `kind`, `status`, `is_primary`, `tenant_account_id` |

## Academic configuration

| Table | Key columns |
| ----- | ----------- |
| `configuration_programme` | `id`, `tenant_id`, `code`, `name`, `regulation_record_id → configuration_regulation.id`, `is_active`, `version` |
| `configuration_regulation` | `id`, `tenant_id`, `code`, `title`, `effective_from`, `effective_to`, `is_active` |
| `configuration_academicyear` | `id`, `tenant_id`, `label`, `starts_on`, `ends_on`, `is_active` |
| `configuration_academicyearregulation` | `academic_year_id`, `regulation_id`, `is_active` |
| `configuration_term` | `id`, `tenant_id`, `academic_year_id`, label/sequence/date columns |
| `configuration_examsession` | `id`, `tenant_id`, `name`, `programme_id`, `academic_year_id`, `term_record_id`, `evaluation_starts_at`, `evaluation_ends_at`, `status`, `is_active` |
| `configuration_course` | `id`, `tenant_id`, `code`, `name`, `programme_id`, `regulation_id`, `duration_terms`, `is_active` |
| `configuration_subject` | `id`, `tenant_id`, `code`, `name`, `semester`, `programme_id`, `course_id`, `session_ids`, `source_academic_year_id`, `is_legacy_scheme_subject`, `is_active` |
| `configuration_paper` | `id`, `tenant_id`, `code`, `title`, `max_marks`, `pass_marks`, `valuation_rounds`, `moderation_required`, `rules`, `status`, `paper_type`, `session_id`, `subject_id`, `submitted_at`, `frozen_at` |
| `configuration_paperdocument` | `id`, `paper_id`, `kind`, `file_name`, `content_type`, `byte_size`, `file_data`, `uploaded_by_id` |
| `configuration_question` | `id`, `paper_id`, question identity/marks/order columns |

## People and eligibility

| Table | Key columns |
| ----- | ----------- |
| `evaluators_evaluator` | `id`, `tenant_id`, `evaluator_code`, `display_name`, `email`, `institution_name`, `department`, `designation`, `qualification`, `years_experience`, `daily_capacity`, `status`, `user_id → auth_user.id` |
| `evaluators_expertise` | `id`, `evaluator_id`, `subject_id`, `level`, `verified`, `years_experience` |
| `evaluators_evaluatorhistory` | `id`, `evaluator_id`, `action`, `from_status`, `to_status`, `actor_id`, `reason` |
| `evaluators_evaluatorfacetemplate` | `id`, `evaluator_id`, `encrypted_template`, `template_digest`, `status`, `last_verified_at` |
| `evaluators_evaluatoridentityverification` | `id`, `evaluator_id`, `assignment_id`, `verified`, `liveness_verified`, `access_granted`, `similarity_score`, `model_version` |
| `phase4_attendancerecord` | `id`, `evaluator_id`, `session_id`, `role`, `checked_in_at`, `checked_out_at`, `active_seconds`, `idle_seconds`, `exception` |

## Allocation and marking

| Table | Key columns |
| ----- | ----------- |
| `allocation_assignment` | `id`, `tenant_id`, `batch_id`, `evaluator_id`, `backup_evaluator_id`, `script_id`, `valuation_round`, `status`, `progress_percent`, `assigned_at`, `started_at`, `submitted_at`, `due_at`, `is_flagged`, `last_page` |
| `allocation_assignmenthistory` | `id`, `assignment_id`, `action`, `actor_id`, `from_evaluator_id`, `to_evaluator_id`, `reason`, `snapshot` |
| `allocation_evaluationbatch` | `id`, `tenant_id`, batch code/status columns |
| `marking_evaluation` | `id`, `tenant_id`, `assignment_id`, `scheme_id`, `status`, `total_marks`, `last_page`, `started_at`, `submitted_at`, `checksum`, `version`, `timer_ends_at`, `timer_remaining_ms`, `bosc_checks` |
| `marking_questionmark` | `id`, `tenant_id`, `evaluation_id`, `question_id`, `rubric_criterion_id`, `marks`, `outcome`, `adjustment`, `step_marks`, `requires_attention`, `examiner_confirmed`, `actor_id`, `supersedes_id` |
| `marking_evaluationcomment` | `id`, `evaluation_id`, `question_id`, `page_number`, `kind`, `body`, `actor_id` |
| `marking_evaluationrejectionrequest` | `id`, `evaluation_id`, `paper_id`, `evaluator_id`, `reason`, `status`, `admin_id`, `decided_at`, `admin_response` |

## Marking schemes

| Table | Key columns |
| ----- | ----------- |
| `rubrics_markingscheme` | `id`, `tenant_id`, `paper_id`, `version`, `title`, `status`, `content_digest`, `created_by_id`, `approved_by_id`, `approved_at`, `frozen_by_id`, `frozen_at` |
| `rubrics_rubriccriterion` | `id`, `scheme_id`, `question`/criterion columns, max marks |
| `rubrics_instructionacknowledgement` | `id`, acknowledgement of examiner instructions |

## Scanning and repository

| Table | Key columns |
| ----- | ----------- |
| `scanning_scanbatch` | `id`, `tenant_id`, `paper_id`, `scanner_id`, `reference`, `status`, `expected_scripts`, `completed_scripts`, `failed_scripts`, `operator_id` |
| `scanning_scannerdevice` | `id`, `tenant_id`, device/status columns |
| `custody_script` | `id`, `tenant_id`, paper/script identity columns |
| `repository_scriptasset` | `id`, `tenant_id`, `script_id`, `kind`, `page_number`, `storage_key`, `sha256`, `byte_size`, `mime_type`, `version`, `retention_until`, `legal_hold` |
| `repository_uploadintent` | id/status/expiry columns for upload intents |
| `receiving_packet` | `id`, `tenant_id`, `paper_id`, `barcode`, `expected_scripts`, `received_scripts`, `expected_pages_per_script`, `status`, `seal_number`, `received_by_id`, `received_at` |
| `receiving_preparedpacket` | `id`, `tenant_id`, `packet_id`, `paper_id`, `barcode`, `status`, `script_manifest`, `prepared_by_id`, `prepared_centre_id` |

## Security and audit

| Table | Key columns |
| ----- | ----------- |
| `security_securitypolicy` | `id`, `tenant_id`, `version`, `session_timeout_minutes`, `maximum_concurrent_sessions`, `step_up_minutes`, `failed_login_limit`, `lockout_minutes`, `require_mfa`, `require_trusted_device`, `dlp_enabled`, `evaluation_*` flags (camera, fullscreen, single screen, recording, pause on violation, heartbeat, retention, inactivity lock), `ai_*` settings |
| `core_auditevent` | `id`, `tenant_id`, `actor_id`, `action`, `aggregate_type`, `aggregate_id`, `payload`, `occurred_at`, `ip_address` |
| `identity_auth_loginattempt` | login attempt and outcome columns |
| `identity_auth_accesssession` | session, device and expiry columns |

---

# 4. DB Test Prompts

## 4.1 Admin — Programme → Regulation → Year → Session → Course → Subject chain

1. Create the chain through the UI (or API), capture every returned code/id.
2. Query each table by `tenant_id` and the created code.
3. Verify parent links.
4. Verify one row per created record.
5. Verify version/is_active defaults.

```sql
SELECT p.id, p.code, p.name, p.regulation_record_id
FROM configuration_programme p
WHERE p.tenant_id = ? AND p.code = ?;

SELECT r.id, r.code, r.title
FROM configuration_regulation r
WHERE r.tenant_id = ? AND r.code = ?;

SELECT ay.id, ay.label
FROM configuration_academicyear ay
WHERE ay.tenant_id = ? AND ay.label = ?;

SELECT s.id, s.name, s.programme_id, s.academic_year_id, s.status
FROM configuration_examsession s
WHERE s.tenant_id = ? AND s.name = ?;

SELECT c.id, c.code, c.programme_id, c.regulation_id
FROM configuration_course c
WHERE c.tenant_id = ? AND c.code = ?;

SELECT sub.id, sub.code, sub.programme_id, sub.course_id, sub.semester, sub.session_ids
FROM configuration_subject sub
WHERE sub.tenant_id = ? AND sub.code = ?;
```

### Expected Result

Exactly one row per created record, with the expected parent ids and tenant scope.

## 4.2 Admin — Paper, sections, question content, documents

1. Create and submit a paper through the app.
2. Query `configuration_paper` by code and tenant.
3. Verify `max_marks`, `pass_marks`, `status`, `submitted_at`, `paper_type`, `session_id`, `subject_id`.
4. Verify `configuration_question` rows match the configured sections.
5. Verify `configuration_paperdocument` rows exist for question paper and evaluation scheme.

```sql
SELECT id, code, title, max_marks, pass_marks, status, paper_type, session_id, subject_id, submitted_at
FROM configuration_paper
WHERE tenant_id = ? AND code = ?;

SELECT count(*) AS questions
FROM configuration_question
WHERE paper_id = ?;

SELECT kind, file_name, content_type, byte_size, uploaded_by_id
FROM configuration_paperdocument
WHERE paper_id = ?;
```

### Expected Result

Paper state and question/document rows match the submitted configuration.

## 4.3 Admin / User Manager — Provisioned users and roles

1. Create one user per role with a unique email.
2. Query `auth_user` and `tenancy_membership` by email.
3. Verify `must_change_password = true` on first provisioning.
4. Verify role and `enabled_modules`.
5. Verify `operational_centre_id` for scanner-type roles.
6. After the user sets a password, verify `must_change_password = false`.

```sql
SELECT u.id, u.email, u.first_name, u.last_name, u.is_active, u.date_joined
FROM auth_user u
WHERE u.email = ?;

SELECT m.role, m.is_active, m.must_change_password, m.enabled_modules,
       m.operational_centre_id, m.institution_id
FROM tenancy_membership m
JOIN auth_user u ON u.id = m.user_id
WHERE u.email = ?;
```

### Expected Result

One user, one active membership with the expected role, modules and centre.

## 4.4 User Manager — Sensitive action audit

1. Perform a sensitive action (create user, save security policy).
2. Query `core_auditevent` by aggregate/action and time window.
3. Verify actor, action, aggregate id and timestamp.

```sql
SELECT action, aggregate_type, aggregate_id, actor_id, occurred_at
FROM core_auditevent
WHERE tenant_id = ?
ORDER BY occurred_at DESC
LIMIT 10;
```

### Expected Result

The sensitive action has a matching audit row with the correct actor and target.

## 4.5 Chairman — Chief profile, expertise and nomination

1. Register a chief with two subjects through the app.
2. Query `evaluators_evaluator` by email.
3. Verify one `evaluators_expertise` row per selected subject.
4. Query `allocation_*`/nomination storage for the subject nomination.
5. Verify the nomination state after acceptance.

```sql
SELECT id, evaluator_code, display_name, email, status, user_id
FROM evaluators_evaluator
WHERE tenant_id = ? AND email = ?;

SELECT e.subject_id, e.level, e.verified
FROM evaluators_expertise e
JOIN evaluators_evaluator ev ON ev.id = e.evaluator_id
WHERE ev.email = ?;

SELECT id, action, from_status, to_status, actor_id, created_at
FROM evaluators_evaluatorhistory
WHERE evaluator_id = ?
ORDER BY created_at;
```

### Expected Result

Profile, expertise rows and status history match the recorded flow.

## 4.6 Chief — Acceptance and attendance

1. Accept the nomination as the chief.
2. Query `phase4_attendancerecord` after check-in.
3. Verify `checked_in_at` set, `checked_out_at` null.
4. Record check-out and verify `checked_out_at` set.
5. Verify presence is not inferred from `auth_user.last_login`.

```sql
SELECT id, evaluator_id, role, checked_in_at, checked_out_at, active_seconds, idle_seconds
FROM phase4_attendancerecord
WHERE evaluator_id = ?
ORDER BY created_at DESC;
```

### Expected Result

Attendance rows reflect check-in/check-out exactly as performed.

## 4.7 Chief — Allocation

1. Allocate a ready packet to an eligible evaluator.
2. Query `allocation_assignment` by `batch_id`.
3. Verify every script in the batch has one assignment row.
4. Verify `status`, `evaluator_id`, `assigned_at`, `valuation_round`.
5. Verify no duplicate `script_id` for the same batch/round.

```sql
SELECT script_id, evaluator_id, status, valuation_round, assigned_at
FROM allocation_assignment
WHERE batch_id = ?
ORDER BY script_id;

SELECT script_id, count(*) AS rows
FROM allocation_assignment
WHERE batch_id = ?
GROUP BY script_id
HAVING count(*) > 1;
```

### Expected Result

One assignment per script, no duplicates, correct evaluator and round.

## 4.8 Scanner Operator — Scan batch, script assets, packet

1. Capture a script through Digitization and submit the packet.
2. Query `scanning_scanbatch` and `repository_scriptasset`.
3. Verify page count equals `pages_per_script`.
4. Verify `mime_type`, `sha256` and `byte_size` are set per page.
5. Query `receiving_preparedpacket` / `receiving_packet` and verify `expected_scripts` vs `received_scripts`.

```sql
SELECT id, reference, status, expected_scripts, completed_scripts, failed_scripts
FROM scanning_scanbatch
WHERE tenant_id = ? AND paper_id = ?;

SELECT script_id, count(*) AS pages
FROM repository_scriptasset
WHERE script_id = ?
GROUP BY script_id;

SELECT barcode, expected_scripts, received_scripts, expected_pages_per_script, status
FROM receiving_packet
WHERE tenant_id = ? AND paper_id = ?;
```

### Expected Result

Page counts and packet counters match the capture, with a hash per stored page.

## 4.9 Evaluator — Evaluation session and marks

1. Open the assigned script and enter marks.
2. Query `marking_evaluation` by `assignment_id`.
3. Verify `status`, `total_marks`, `timer_ends_at`, `checksum`.
4. Query `marking_questionmark` and verify one row per marked question.
5. Verify `outcome` and `marks` per question.
6. Verify `marking_questionmark.supersedes_id` when a mark is revised.
7. Verify `marking_evaluation.submitted_at` stays null while submission is pending.

```sql
SELECT id, assignment_id, status, total_marks, last_page, started_at, submitted_at,
       timer_ends_at, timer_remaining_ms, checksum, version
FROM marking_evaluation
WHERE assignment_id = ?;

SELECT question_id, marks, outcome, adjustment, requires_attention, examiner_confirmed, supersedes_id
FROM marking_questionmark
WHERE evaluation_id = ?
ORDER BY sequence;
```

### Expected Result

Marks and totals persist per question, and the evaluation stays unfinished until submission.

> Current field note: on the captured run the evaluation was marked in progress; the submission control was not available on the recording device, and submission was completed elsewhere. Assert `submitted_at` only after the submit action succeeds.

## 4.10 Evaluator — Face verification evidence

1. Enroll the face and complete a secure evaluation check.
2. Query `evaluators_evaluatorfacetemplate` for the enrolled template status.
3. Query `evaluators_evaluatoridentityverification` for the verification attempt.

```sql
SELECT evaluator_id, status, template_digest, last_verified_at
FROM evaluators_evaluatorfacetemplate
WHERE evaluator_id = ?;

SELECT evaluator_id, assignment_id, verified, liveness_verified, access_granted,
       similarity_score, model_version, attempt_number, expires_at
FROM evaluators_evaluatoridentityverification
WHERE evaluator_id = ?
ORDER BY created_at DESC;
```

### Expected Result

Enrollment and verification evidence exist with the expected decision fields.

> Never select `encrypted_template` or raw biometric payloads.

## 4.11 Admin — Security policy persistence

1. Change policy values in the UI and save.
2. Query `security_securitypolicy` for the tenant.
3. Verify each changed column and `version` increment.
4. Verify values persist after refresh.

```sql
SELECT version, session_timeout_minutes, maximum_concurrent_sessions, step_up_minutes,
       failed_login_limit, lockout_minutes, require_mfa, require_trusted_device, dlp_enabled,
       evaluation_camera_required, evaluation_fullscreen_required, evaluation_single_screen_required,
       evaluation_event_recording, evaluation_pause_on_violation, evaluation_session_timeout_minutes
FROM security_securitypolicy
WHERE tenant_id = ?;
```

### Expected Result

Stored policy equals the saved values and the version increments once per save.

## 4.12 Cross-role audit trail

1. Complete one action per role.
2. Query `core_auditevent` ordered by time.
3. Verify each action has an actor, aggregate and timestamp.
4. Verify events are tenant-scoped.

```sql
SELECT actor_id, action, aggregate_type, aggregate_id, occurred_at
FROM core_auditevent
WHERE tenant_id = ?
ORDER BY occurred_at;
```

### Expected Result

Every captured action has one audit event and no event leaks another tenant.

## 4.13 Multi-University Isolation

1. Run the same query for two tenant ids.
2. Verify result sets are disjoint.
3. Verify record counts differ per tenant where expected.

```sql
SELECT tenant_id, count(*) AS programmes FROM configuration_programme GROUP BY tenant_id;
SELECT tenant_id, count(*) AS users FROM tenancy_membership GROUP BY tenant_id;
```

### Expected Result

No shared records between tenants; every row carries the correct `tenant_id`.

---

# 5. Table Inventory (181 tables, verified)

Identity and tenancy: `auth_user`, `auth_group`, `auth_permission`, `auth_user_groups`, `auth_user_user_permissions`, `auth_group_permissions`, `tenancy_tenantaccount`, `tenancy_tenantdomain`, `tenancy_institution`, `tenancy_membership`, `tenancy_customfielddefinition`, `tenancy_customfieldrecord`, `identity_auth_accesssession`, `identity_auth_authenticationhistory`, `identity_auth_authenticationmethod`, `identity_auth_deviceauthorization`, `identity_auth_loginattempt`, `identity_auth_oidcprovider`, `identity_auth_otpchallenge`, `identity_auth_passkeycredential`, `identity_auth_trusteddevice`

Configuration: `configuration_programme`, `configuration_regulation`, `configuration_academicyear`, `configuration_academicyearregulation`, `configuration_term`, `configuration_examsession`, `configuration_course`, `configuration_subject`, `configuration_paper`, `configuration_paperdocument`, `configuration_question`, `configuration_evaluationcentre`, `configuration_evaluationevent`, `configuration_calendaroverlapexception`, `configuration_configurationapproval`, `configuration_configurationchangeapproval`, `configuration_configurationchangerequest`, `configuration_configurationrevision`

People and eligibility: `evaluators_evaluator`, `evaluators_evaluatoravailability`, `evaluators_evaluatorfacetemplate`, `evaluators_evaluatorhistory`, `evaluators_evaluatoridentityverification`, `evaluators_evaluatorimportbatch`, `evaluators_evaluatorimportrow`, `evaluators_expertise`, `eligibility_eligibilityhistory`, `eligibility_eligibilityrecord`, `eligibility_verificationapproval`, `eligibility_verificationcase`, `eligibility_verificationdocument`

Allocation: `allocation_allocationpolicy`, `allocation_allocationproposal`, `allocation_allocationrun`, `allocation_assignment`, `allocation_assignmenthistory`, `allocation_evaluationbatch`, `assignment_assignmentapproval`, `assignment_assignmentgovernancepolicy`, `assignment_assignmentlock`, `assignment_securereassignmentrequest`

Marking: `marking_annotation`, `marking_evaluation`, `marking_evaluationcomment`, `marking_evaluationrejectionrequest`, `marking_questionmark`, `marking_questionpageanchor`, `marking_rescanbatch`, `rubrics_markingscheme`, `rubrics_rubriccriterion`, `rubrics_instructionacknowledgement`, `rubrics_schemeclarification`, `rubrics_schemehistory`, `valuation_finalmark`, `valuation_finalmarkcandidate`, `valuation_revealauthorization`, `valuation_valuationcomparison`, `valuation_valuationresult`, `workflow_draftsnapshot`, `workflow_evaluationextension`, `workflow_evaluationworkflow`, `workflow_workflowtransition`

Scanning, custody and repository: `scanning_scanbatch`, `scanning_scanjob`, `scanning_scannerdevice`, `scanning_scannererrorlog`, `scanning_scannermaintenancealert`, `scanning_guidedcapturerequest`, `scan_processing_processedpage`, `scan_processing_processingprofile`, `scan_processing_processingrun`, `scan_processing_scanqualityexception`, `custody_script`, `custody_barcoderecord`, `custody_barcodescan`, `custody_custodyevent`, `custody_custodytransfer`, `custody_reconciliationrun`, `repository_scriptasset`, `repository_uploadintent`, `receiving_bundle`, `receiving_dispatch`, `receiving_packet`, `receiving_preparedpacket`, `receiving_examattendanceentry`, `receiving_examattendancefinalbiometric`, `receiving_receiptconfirmation`, `receiving_receivingalert`, `receiving_receivingexception`

Anonymisation and integrity: `anonymisation_identitylink`, `anonymisation_identityresolutionapproval`, `anonymisation_identityresolutionrequest`, `anonymisation_maskingjob`, `anonymisation_maskregion`, `anonymisation_maskverification`, `integrity_integrityalert`, `integrity_integritycheck`, `integrity_integrityevidence`, `integrity_integritymanifest`, `security_securitypolicy`, `security_dlpincident`, `security_emergencyaccessgrant`, `security_encryptionkeymetadata`, `security_privilegedaccessrequest`, `security_securityalert`

Operations (phase4): `phase4_assessmentcontrolrecord`, `phase4_attendancerecord`, `phase4_centreprofile`, `phase4_centrereadiness`, `phase4_completionrecord`, `phase4_controlledauthorization`, `phase4_evaluationcamp`, `phase4_evaluationlocationcheckin`, `phase4_evidencepackage`, `phase4_integrationendpoint`, `phase4_internalmarksimport`, `phase4_knowledgearticle`, `phase4_localepreference`, `phase4_moderationcase`, `phase4_moderationoperation`, `phase4_moderationpolicy`, `phase4_moderationsample`, `phase4_notificationdelivery`, `phase4_operationalissue`, `phase4_presencesecurityevent`, `phase4_proctoringevidence`, `phase4_proctoringreview`, `phase4_recoverydrill`, `phase4_recoveryplan`, `phase4_remotesupportcommand`, `phase4_remotesupportsession`, `phase4_remunerationrule`, `phase4_remunerationstatement`, `phase4_requestimportbatch`, `phase4_requestimportrow`, `phase4_resulthandover`, `phase4_resultpublication`, `phase4_revaluationrequest`, `phase4_runtimeincident`, `phase4_secureevaluationsession`, `phase4_studentscriptrequest`, `phase4_universityapikey`, `phase4_workloadaction`

AI evaluation and discrepancy: `ai_evaluation_aianalysis`, `ai_evaluation_aiproviderconfiguration`, `ai_evaluation_aiquestionassessment`, `ai_evaluation_aiquestionguide`, `ai_evaluation_aireferenceasset`, `ai_evaluation_aireferencepack`, `ai_evaluation_aireferenceupload`, `discrepancy_discrepancycase`, `discrepancy_discrepancyresolution`, `discrepancy_examinerclarification`

Platform: `core_auditevent`, `core_idempotencyrecord`, `core_outboxevent`, `django_admin_log`, `django_content_type`, `django_migrations`, `django_session`

---

# 6. Final Implementation Quality Criteria

- Read-only connection and read-only SQL only.
- Parameterized queries with tenant filtering.
- No secrets or biometric payloads selected.
- Assertions compare real per-record values, not snapshot row counts.
- Connection closed in `finally`.
- Queries live in the DB spec or a shared DB utility, not duplicated.
- Unverified engines/schemas are marked blocked, not guessed.
- DB prompts stay in this file, apart from Web and API prompts.
