# Digital Evaluation System (ADMIEZO) — API Test Prompts

**Application:** Digital Evaluation System (ADMIEZO)
**API Base URL:** `DVS_API_BASE_URL` from `.env` — per-university host, not fixed.
**Example deployment used for capture:** `https://harish.35-200-205-253.sslip.io/`
**Framework:** Playwright + TypeScript, `request` fixture, `api/endpoints/routes.ts`, `api/schemas/`. Architecture: §2.
**Capture source:** Live authenticated traffic for every role, 111 app endpoints, 84 response schemas generated.

---

# 0. Multi-University and Credential Bootstrap (read first)

0. **The workflow now starts on the Platform Admin console, not at a tenant Admin.**
   - Sign in at `PLATFORM_URL` (platform control plane), open **Platform → Universities → New university**, and provision the university. This is a live, human-in-the-loop step.
   - Capture the **Administrator handover** shown once: administrator email, one-time temporary password, and tenant URL (or subdomain derived from `PLATFORM_BASE_DOMAIN`).
   - Complete the university Admin first login (temporary → permanent password), then write the tenant URL and permanent Admin credentials to `.env`.
   - Provision endpoint: `POST /api/v1/enterprise/tenants` with `TenantProvisionIn`:
     `name`, `code`, `admin_email` (required); `admin_first_name`, `admin_last_name`, `subdomain`, `plan`, `enabled_modules`, `data_region`, branding and AI fields (optional).
   - Never persist, log, or commit the temporary password.
   - Automated driver: `npm run test:platform` (`tests/web/platform/university-bootstrap.spec.ts`). The remaining prompts below start at the newly created university's Admin.
1. Each university has its own host and API base URL. Workflow is identical; data differs.
2. Never hard-code host, tenant id, user id, programme id or any record id.
3. `.env` starts with **only** `DVS_API_BASE_URL` and the Admin credentials. Do not expect all role credentials up front.
4. RBAC users are created during the flow, in this order:
   User Manager → Chairman → Chief Examiner → Evaluator → Scanner Operator → Exam Invigilator (optional).
5. Each created user returns a one-time temporary password in the response. The test must:
   - capture the temporary password in memory,
   - log in with it,
   - complete the password-setup endpoint with `ChangeMe322!`,
   - store the new password in the run's env/secret store, never in source files.
6. Section 4 defines the exact provisioning chain.

```text
DVS_API_BASE_URL=            # per-university host
DVS_ADMIN_EMAIL=
DVS_ADMIN_PASSWORD=
# role credentials are produced by the test run, not seeded in .env
```

---

# 1. Verified Endpoint Inventory

Every route below was observed in real traffic. Canonical path only; query variants are listed in `RouteBuilders`.

## Platform control plane (platform host, `PLATFORM_URL`)
| Method | Path | Observed status |
| ------ | ---- | --------------- |
| POST | `/api/v1/enterprise/tenants` | 200 (creates tenant + first administrator handover) |
| GET | `/api/v1/enterprise/tenants` | 200 |
| GET | `/api/v1/enterprise/control-plane` | 200 |
| GET | `/api/v1/enterprise/control-plane/audit` | 200 |
| POST | `/api/v1/enterprise/tenants/switch` | 200 |
| PATCH | `/api/v1/enterprise/tenants/{tenantId}` | 200 |
| POST | `/api/v1/enterprise/tenants/{tenantId}/administrator/reset-password` | 200 |
| POST | `/api/v1/enterprise/institutions` | 200 |

## Authentication
| Method | Path | Observed status |
| ------ | ---- | --------------- |
| POST | `/api/v1/auth/login` | 200, 401 |
| POST | `/api/v1/auth/logout` | 200, 401 |
| GET | `/api/v1/auth/me` | 200, 401 |
| GET | `/api/v1/auth/csrf` | 200 |
| GET | `/api/v1/auth/sso/providers` | 200 |
| GET | `/api/v1/auth/notifications` | 200, 502 |
| GET | `/api/v1/auth/security-context` | 200 |
| POST | `/api/v1/auth/step-up` | 200 |
| POST | `/api/v1/auth/password/complete-setup` | 200 |

## Tenant context and configuration (Admin)
| Method | Path | Observed status |
| ------ | ---- | --------------- |
| GET | `/api/v1/enterprise/domain-context` | 200, 403, 428 |
| GET | `/api/v1/enterprise/form-fields` | 200, 403 |
| GET | `/api/v1/operations/overview` | 200 |
| GET | `/api/v1/phase4/i18n` | 200 |
| GET | `/api/v1/configuration/catalog` | 200 |
| GET | `/api/v1/configuration/readiness` | 200 |
| POST | `/api/v1/configuration/programmes` | 200 |
| POST | `/api/v1/configuration/regulations` | 200 |
| POST | `/api/v1/configuration/academic-years` | 200 |
| POST | `/api/v1/configuration/sessions` | 200 |
| POST | `/api/v1/configuration/courses` | 200 |
| POST | `/api/v1/configuration/subjects` | 200 |
| POST | `/api/v1/configuration/papers` | 200 |
| GET | `/api/v1/configuration/papers/{paperId}/question-content` | 200 |
| POST | `/api/v1/configuration/papers/{paperId}/setup-sections` | 200 |
| POST | `/api/v1/configuration/papers/{paperId}/submit` | 200 |
| GET/POST | `/api/v1/configuration/papers/{paperId}/documents/question_paper` | 200 |
| POST | `/api/v1/configuration/papers/{paperId}/documents/evaluation_scheme` | 200 |
| GET | `/api/v1/ai-evaluation/catalog` | 403 (module disabled) |

## Security and users
| Method | Path | Observed status |
| ------ | ---- | --------------- |
| GET | `/api/v1/security/catalog` | 200 |
| POST | `/api/v1/security/memberships` | 200 |
| PUT | `/api/v1/security/policy` | 200 |

## Chairman
| Method | Path | Observed status |
| ------ | ---- | --------------- |
| GET | `/api/v1/chairman/catalog` | 200 |
| GET | `/api/v1/chairman/history` | 200 |
| GET | `/api/v1/chairman/my-nominations` | 200 |
| POST | `/api/v1/chairman/nominations` | 200 |
| POST | `/api/v1/chairman/nominations/{nominationId}/accept` | 200 |

## Chief Examiner
| Method | Path | Observed status |
| ------ | ---- | --------------- |
| GET | `/api/v1/chief/summary` | 200, 500, 502 |
| GET | `/api/v1/chief/evaluator-history` | 200 |
| GET | `/api/v1/chief/moderation/report` | 200 |
| POST | `/api/v1/chief/team/nominations` | 200 |
| GET/POST | `/api/v1/evaluator-management` | 200 |
| GET | `/api/v1/evaluator-management/chiefs/me/team` | 200 |
| GET | `/api/v1/evaluator-management/enrollment-policy` | 200 |
| GET/POST | `/api/v1/evaluator-management/face/login` | 200 |
| GET | `/api/v1/evaluator-management/face/status` | 200 |
| POST | `/api/v1/evaluator-management/face/verify-access` | 200 |

## Allocation
| Method | Path | Observed status |
| ------ | ---- | --------------- |
| GET | `/api/v1/allocation/catalog` | 200 |
| GET | `/api/v1/allocation/examiner-batches` | 200 |
| GET | `/api/v1/allocation/examiner-batches/{batchId}/subject-groups` | 200, 400 |
| POST | `/api/v1/allocation/examiner-batches/{batchId}/allocate-subject-group` | 200 |
| POST | `/api/v1/allocation/assignments/{assignmentId}/action` | 200, 423 |
| GET | `/api/v1/allocation/assignments/{assignmentId}/viewer` | 200 |
| POST | `/api/v1/assignment-governance/assignments/{assignmentId}/lock` | 200 |

## Marking (Evaluator)
| Method | Path | Observed status |
| ------ | ---- | --------------- |
| GET | `/api/v1/marking/assignments/{assignmentId}/workspace` | 200 |
| POST | `/api/v1/marking/assignments/{assignmentId}/open` | 200 |
| GET/POST | `/api/v1/marking/assignments/{assignmentId}/acknowledgements` | 200 |
| GET | `/api/v1/marking/assignments/{assignmentId}/ai-analysis` | 200 |
| POST | `/api/v1/marking/evaluations/{evaluationId}/marks` | 200 |
| POST | `/api/v1/workflow/assignments/{assignmentId}/drafts` | 200 |

## Marking schemes
| Method | Path | Observed status |
| ------ | ---- | --------------- |
| GET | `/api/v1/rubrics/catalog` | 200 |
| POST | `/api/v1/rubrics/schemes` | 200 |
| POST | `/api/v1/rubrics/schemes/{schemeId}/transition` | 200 |

## Scanning / receiving (Scanner Operator)
| Method | Path | Observed status |
| ------ | ---- | --------------- |
| GET | `/api/v1/scanning/catalog` | 200 |
| GET | `/api/v1/receiving/guided/catalog` | 200 |
| GET | `/api/v1/receiving/guided/reports/config` | 200 |
| GET | `/api/v1/receiving/guided/subject-papers` | 200 |
| GET/POST | `/api/v1/receiving/guided/subject-scripts` | 200 |
| POST | `/api/v1/receiving/guided/subject-groups/{groupId}/submit` | 200 |
| POST | `/api/v1/repository/manual-scan/uploads` | 200 |
| POST | `/api/v1/repository/uploads/{uploadId}/finalize` | 200 |
| POST | `/api/v1/repository/scripts/{scriptId}/complete-scan` | 200 |

## Operations / phase 4
| Method | Path | Observed status |
| ------ | ---- | --------------- |
| GET | `/api/v1/phase4/catalog` | 200 |
| POST | `/api/v1/phase4/centres` | 200 |
| POST | `/api/v1/phase4/centres/{centreId}/action` | 200 |
| POST | `/api/v1/phase4/centres/{centreId}/readiness` | 200 |
| GET | `/api/v1/phase4/hierarchy-monitoring` | 200, 403, 502 |
| POST | `/api/v1/phase4/evaluation/location` | 200 |
| GET | `/api/v1/phase4/remote-security/policy` | 200, 404 |
| POST | `/api/v1/phase4/remote-security/sessions` | 200 |
| POST | `/api/v1/phase4/remote-security/sessions/{sessionId}/heartbeat` | 200 |
| POST | `/api/v1/phase4/remote-security/sessions/{sessionId}/resume` | 200 |
| POST | `/api/v1/phase4/remote-security/events` | 200 |
| GET | `/api/v1/phase4/remote-support/inbox` | 200, 403, 404, 500, 502 |
| GET | `/api/v1/evaluation-workflow/catalog` | 200, 502 |

---

# 2. Common Requirements

- TypeScript + Playwright `request` fixture.
- Import routes from `api/endpoints/routes.ts`; never inline unknown URLs.
- Authenticate once per role, reuse cookies/token.
- Validate status, JSON structure, business fields and side effects.
- Use `RouteBuilders` for path/query values.
- Keep independent tests independent; chain only in workflow prompts.
- Never log passwords, temporary passwords, tokens, biometrics or candidate data.
- Use synthetic data; clean up created records where an API exists.
- If a route or field is missing from this file, mark the test blocked instead of guessing.

## API Testing Architecture (mandatory)

Every API prompt in this file builds artifacts in this order. Never create the spec first.

```text
API Test Prompt
      ↓
Analyze endpoint / route (method, path, query, body) from observed traffic
      ↓
Route — api/endpoints/routes.ts (Routes, RouteBuilders, RouteMethods)
      ↓
Schema — api/schemas/<route>_api_schema.json
      ↓
Test data — testdata/ + utils/helper.ts, utils/dataGenerator.ts
      ↓
Utilities — utils/ (reuse before creating)
      ↓
API test — tests/api/<area>/<kebab-case>.spec.ts
      ↓
Run → diagnose the real failure → fix → re-run
```

### Layer map

| Artifact | Location | Convention |
| --- | --- | --- |
| Route constants | `api/endpoints/routes.ts` | `Routes` — canonical path only |
| Path / query builders | `api/endpoints/routes.ts` | `RouteBuilders` — exact observed query keys |
| Allowed methods | `api/endpoints/routes.ts` | `RouteMethods` |
| Response schema | `api/schemas/` | `<route>_api_schema.json`, Draft-07, validated with `ajv` |
| API spec | `tests/api/<area>/` | `<kebab-case>.spec.ts` |
| Fixed / random data | `utils/helper.ts`, `utils/dataGenerator.ts` | synthetic only |
| Data files | `testdata/` | `.json` / `.csv` / `.xlsx` via `DataProvider` |

### Layer separation

```text
API  → Routes → Schemas → Utilities / Test Data → API Tests
Web  → Page Objects → Custom Fixture → Utilities / Test Data → Web Tests
DB   → DB Client → Queries → Utilities / Test Data → DB Tests
```

Do not import Web page fixtures into API specs, and do not assert UI state from API tests.

### API test rules

- Import `{ test, expect }` from `@playwright/test` directly — never from `fixtures/pageFixtures` (that fixture is Web-only).
- Call `dotenv.config()` at the top of the spec; read `DVS_API_BASE_URL` from `.env`.
- Use `Routes` / `RouteBuilders` only; never inline a path or query string that is not in `routes.ts`.
- Authenticate once per role via `AUTH_LOGIN` and reuse the session (the app uses `DVS_API_AUTH_MODE=cookie_session`). Do not duplicate login logic across specs.
- Group tests in `test.describe`; use `test.describe.serial` only for chained workflows that share created ids.
- Tag titles `@master @api`, plus `@regression` / `@sanity` / `@end-to-end` where they apply (`npm run test:api` greps `@api`).
- Wrap each request/validation group in `await test.step('N) description', ...)`.
- Validate status code, JSON structure, required fields, business values, and the follow-up GET that proves persistence.
- Validate response shape against the matching schema in `api/schemas/` where one exists.
- Clean up created records only through an observed delete/transition route. If none exists, say so in the test instead of inventing one.
- Missing environment, route, or field → `test.skip()` / blocked, naming the exact gap. Never guess.

---

# 3. Authentication Prompts

## 3.1 Successful Login

1. `POST AUTH_LOGIN` with the real body shape:
```json
{
  "email": "<admin email>",
  "password": "<admin password>",
  "device_id": "<stable uuid>",
  "device_label": "Win32 · Browser",
  "platform": "Win32",
  "browser": "<user agent>"
}
```
2. Verify `200`.
3. Verify a session cookie is set and `GET AUTH_ME` returns the same identity.
4. Verify the response does not include the password.

## 3.2 Invalid Login

1. `POST AUTH_LOGIN` with a wrong password.
2. Verify `401` and body `{"detail": "Invalid email or password"}`.
3. Verify `GET AUTH_ME` returns `401`.

## 3.3 Account Lockout

1. Exceed `security_securitypolicy.failed_login_limit` (observed 6).
2. Verify subsequent login is rejected during `lockout_minutes` (observed 5).
3. Verify the lock is visible in the error behavior, not guessed.
4. Do not run lockout tests against shared accounts; use a dedicated synthetic user.

> Important: repeated failed logins locked the real admin during capture. Always use a disposable account for lockout tests.

## 3.4 CSRF, SSO and Notifications

1. `GET AUTH_CSRF` → verify `csrf_token` is a non-empty string.
2. `GET AUTH_SSO_PROVIDERS` → verify the array shape (empty array when no provider).
3. `GET AUTH_NOTIFICATIONS` → verify `unread_count` and `items`.
4. Treat `502` on notifications as a degraded-upstream case, not a functional assertion.

## 3.5 Step-up and Password Setup

1. `POST AUTH_STEP_UP` with `{"password": "...", "code": "..."}`; verify `step_up_expires_at`.
2. `POST AUTH_PASSWORD_COMPLETE_SETUP` with `{"new_password": "ChangeMe322!"}`; verify `{"ok": true}`.
3. Verify the temporary password no longer works and the new password does.

## 3.6 Logout

1. `POST AUTH_LOGOUT`; verify `{"ok": true}`.
2. Reuse the old session against `AUTH_ME`; verify `401`.

---

# 4. Credential Bootstrap Chain (required order)

## 4.1 Admin creates User Manager

`POST SECURITY_MEMBERSHIPS`:
```json
{
  "first_name": "first",
  "last_name": "usermanager",
  "email": "harishum1@gmail.com",
  "role": "user_manager",
  "permissions": [],
  "enabled_modules": ["enterprise", "security"],
  "operational_centre_id": "<centre id>",
  "programme_id": null,
  "custom_fields": {}
}
```
1. Verify `200` and capture the temporary password from the response.
2. Log in, complete setup with `ChangeMe322!`.
3. Verify the membership row via `security/catalog`.

## 4.2 Admin/User Manager creates Chairman

```json
{
  "first_name": "first",
  "last_name": "chair",
  "email": "harishchair1@gmail.com",
  "role": "chairman",
  "permissions": [],
  "enabled_modules": ["configuration", "evaluators", "operations", "rubrics"],
  "operational_centre_id": "<centre id>",
  "programme_id": "<programme id>",
  "custom_fields": {}
}
```
Chairman requires `programme_id`. Verify it is rejected when null.

## 4.3 Scanner Operator

```json
{
  "role": "scanner_operator",
  "enabled_modules": ["digitization"],
  "operational_centre_id": "<centre id>"
}
```
Verify `operational_centre_id` is required for this role.

## 4.4 Chief and Evaluator

Chief and evaluator logins come from `evaluator-management` registration plus nomination, not from `security/memberships`:
1. `POST EVALUATOR_MANAGEMENT` (chief profile).
2. `POST CHAIRMAN_NOMINATIONS`.
3. Chief `POST CHAIRMAN_NOMINATION_ACCEPT`.
4. Chief registers evaluator via `POST EVALUATOR_MANAGEMENT`.
5. `POST CHIEF_TEAM_NOMINATIONS` returns `{"nominated": true, "credentials": {...}}`; capture the temporary credentials.
6. Log in as evaluator and complete setup with `ChangeMe322!`.

> Observed anomaly: one Scanner Operator user was created with `role: "evaluator"` and `enabled_modules: ["evaluation"]` before the correct `scanner_operator` record was created. Assert the intended role; treat mismatches as failures, not expected behavior.

---

# 5. Admin Configuration Prompts

## 5.1 Programme

`POST CONFIGURATION_PROGRAMMES` with `{"code": "...", "name": "..."}`.
1. Verify `200` and returned `id`.
2. `GET CONFIGURATION_CATALOG?table_key=programmes&table_offset=0&table_limit=10` and find the record.
3. Verify duplicate code is rejected per contract.

## 5.2 Regulation

`POST CONFIGURATION_REGULATIONS` with `{"code": "...", "title": "...", "programme_ids": ["..."]}`.
Verify returned `id` and programme mapping via the catalog.

## 5.3 Academic Year

`POST CONFIGURATION_ACADEMIC_YEARS` with regulation id and label. Verify returned `id` and `academic_years` table rows.

## 5.4 Exam Session

`POST CONFIGURATION_SESSIONS` with `programme_id`, `academic_year_id`, name. Response includes `id` and `version`. Verify `configuration/readiness` reflects the session.

## 5.5 Course and Subject

`POST CONFIGURATION_COURSES` with programme/regulation and code/name.
`POST CONFIGURATION_SUBJECTS` with programme, course, semester, session ids. Verify the returned `id` appears in the subject list with the full context label.

## 5.6 Paper

`POST CONFIGURATION_PAPERS` with the captured body shape:
```json
{
  "paper_type": "regular",
  "session_id": "<session id>",
  "subject_id": "<subject id>",
  "code": "KAN001",
  "title": "KANNADA",
  "max_marks": 80,
  "pass_marks": 21,
  "moderation_required": true,
  "rules": {
    "critical_change": true,
    "revaluation": true,
    "module_wise": false,
    "scripts_per_packet": 1,
    "pages_per_script": 2,
    "answer_selection": { "best_of_per_group": 0 }
  },
  "custom_fields": {}
}
```

Then:
1. `POST CONFIGURATION_PAPER_SETUP_SECTIONS` with `version`, `sections[]`, `question_parts`, `question_marks` (real shape captured; sections carry `section_id`, `question_count`, `attempt_count`, `marks_per_question`, `question_marks`).
2. Upload question paper: `POST CONFIGURATION_PAPER_QUESTION_PAPER` (multipart `file`).
3. Upload scheme: `POST CONFIGURATION_PAPER_EVALUATION_SCHEME`.
4. `POST CONFIGURATION_PAPER_SUBMIT`.
5. `GET CONFIGURATION_PAPER_QUESTION_CONTENT` and verify `paper_version` and readiness.
6. Negative: pass marks > max marks, missing session/subject, zero pages per script.

## 5.7 Centre

`POST PHASE4_CENTRES`:
```json
{
  "name": "ADMIEZO",
  "location": "DAVANAGERE",
  "capacity": 0,
  "workstation_count": 0,
  "schedule": {},
  "security_controls": ["restricted-entry", "secure-lan"]
}
```
Then `POST PHASE4_CENTRE_READINESS`, then `POST PHASE4_CENTRE_ACTION` (`action: activate` per UI). Verify status transitions.

## 5.8 Security policy

`PUT SECURITY_POLICY` with the full body shape captured, including:
`session_timeout_minutes`, `maximum_concurrent_sessions`, `step_up_minutes`, `failed_login_limit`, `lockout_minutes`, `require_mfa`, `require_trusted_device`, `dlp_enabled`, all `evaluation_*` flags, `ai_evaluation_*`.
1. Send current `id` and `version`.
2. Verify `version` increments by one.
3. Verify a stale version is rejected.
4. Verify `GET PHASE4_REMOTE_SECURITY_POLICY` returns the persisted values.

---

# 6. Chairman Prompts

## 6.1 Catalog and nominations

1. `GET CHAIRMAN_CATALOG` → verify `subjects` and `rows`.
2. `GET CHAIRMAN_CATALOG?subject_id=<id>` → verify the filtered chief list.
3. `GET CHAIRMAN_MY_NOMINATIONS` → verify items and status.
4. `POST CHAIRMAN_NOMINATIONS` with the subject and chief → verify `id` and status `pending`.
5. `POST CHAIRMAN_NOMINATION_ACCEPT` as the chief (via the same route) → verify status `accepted`.

## 6.2 Chief profile

`POST EVALUATOR_MANAGEMENT` with the captured fields: `display_name`, `email`, `institution_name`, `department`, `years_experience`, optional `mobile`, `employee_id`, `designation`, `qualification`, `employment_type`, plus subject ids.
Verify the response id and that registration alone does not create a login.

## 6.3 Marking scheme

1. `POST RUBRICS_SCHEMES` with paper id, title and document.
2. `POST RUBRICS_SCHEMES/{id}/transition` to freeze/approve per contract.
3. `GET RUBRICS_CATALOG` and verify the active version.

---

# 7. Chief Prompts

1. `GET CHIEF_SUMMARY` → verify profile, subjects and counters. Treat `500/502` as degraded upstream, not a pass.
2. `GET EVALUATOR_MANAGEMENT` → verify evaluator list.
3. `GET EVALUATOR_TEAM` (`/chiefs/me/team`) → verify chief and team members.
4. `POST CHIEF_TEAM_NOMINATIONS` → verify `nominated: true` and credentials only for new logins.
5. `GET ALLOCATION_EXAMINER_BATCHES` → verify batches in accepted subject scope.
6. `GET ALLOCATION_SUBJECT_GROUPS` → verify groups.
7. `POST ALLOCATION_ALLOCATE_SUBJECT_GROUP` with the group id → verify allocation result.
8. `POST ALLOCATION_ASSIGNMENT_ACTION` with `{"version": n, "action": "start" | "progress", "page": n, "progress_percent": n}` → verify accepted transitions and `423` on a locked assignment.
9. `GET CHIEF_MODERATION_REPORT?summary=true` → verify counters.
10. `GET CHIEF_EVALUATOR_HISTORY` → verify history entries.

---

# 8. Evaluator Prompts

## 8.1 Workspace

1. `GET ALLOCATION_CATALOG?evaluator_desk=1&table_key=assignments&table_offset=0&table_limit=10` → verify assigned rows.
2. `POST MARKING_OPEN` → verify `evaluation_id`.
3. `GET MARKING_WORKSPACE` → verify assignment, script, questions, scheme, timer fields.
4. `GET MARKING_ACKNOWLEDGEMENTS` and `POST` acknowledgement → verify scheme acknowledgement state.
5. `GET MARKING_AI_ANALYSIS` → verify `mode` (`disabled` in capture) and `enabled`.

## 8.2 Marks

`POST MARKING_MARKS` with the real shape:
```json
{
  "version": 1,
  "question_id": "<question uuid>",
  "marks": 2,
  "outcome": "evaluated",
  "adjustment": "none",
  "requires_attention": false,
  "examiner_confirmed": true,
  "rubric_criterion_id": null
}
```
1. Verify `200` and the returned mark row.
2. Verify a second update with the incremented `version`.
3. Verify a stale `version` is rejected.
4. Verify marks above the question maximum are rejected.
5. Verify `outcome: "unanswered"` stores zero without failing.
6. Verify `WORKFLOW_DRAFTS` saves progress.
7. Verify submission only exists after the timer allows it. In the captured run the submit control was not available on the recording device; submission was completed elsewhere. Do not assert a submit route until it is captured.

## 8.3 Face / secure session

1. `GET EVALUATOR_ENROLLMENT_POLICY` → verify `face_enrollment_required`.
2. `GET EVALUATOR_FACE_STATUS` → verify enrollment status.
3. `GET EVALUATOR_FACE_LOGIN` → verify `required` and evaluator id.
4. `POST EVALUATOR_FACE_LOGIN` → verify `access_granted`, `attendance_id`.
5. `POST EVALUATOR_FACE_VERIFY_ACCESS` → verify verification fields.
6. `POST PHASE4_REMOTE_SECURITY_SESSIONS` → verify session id and policy snapshot.
7. `POST .../heartbeat` → verify heartbeat accepted; test `evaluation_no_face_seconds` behavior.
8. `POST .../resume` after step-up → verify resume state.
9. `POST PHASE4_REMOTE_SECURITY_EVENTS` → verify each violation event is stored.
10. `POST PHASE4_EVALUATION_LOCATION` → verify location record.

Never send real biometric images. Use synthetic fixtures and mark hardware/liveness checks environment-blocked.

---

# 9. Scanner Operator Prompts

1. `GET SCANNING_CATALOG` → verify papers in the assigned centre.
2. `GET RECEIVING_GUIDED_CATALOG` → verify centre and enabled flag.
3. `GET RECEIVING_SUBJECT_PAPERS` → verify papers.
4. `GET RECEIVING_SUBJECT_SCRIPTS?paper_id=<id>` → verify groups.
5. `POST REPOSITORY_MANUAL_SCAN_UPLOAD` → verify upload intent and `upload_url`.
6. `POST REPOSITORY_UPLOADS/{id}/finalize` → verify status complete.
7. `POST RECEIVING_SUBJECT_SCRIPTS` → verify `script_id` and page count.
8. `POST REPOSITORY_SCRIPTS/{id}/complete-scan` → verify stored state.
9. `POST RECEIVING_SUBJECT_GROUP_SUBMIT` → verify submitted state.
10. Negative: wrong page count, unsupported mime type, duplicate submit.

---

# 10. Workflow and Reporting

1. `GET EVALUATION_WORKFLOW_CATALOG` → verify role-specific counters (`rework_pending`, `packets`, `available`).
2. `GET PHASE4_HIERARCHY_MONITORING` → verify chairman/chief monitoring blocks.
3. `GET OPERATIONS_OVERVIEW` → verify session and operational counters.
4. `GET PHASE4_REMOTE_SUPPORT_INBOX` → `403` is valid when the role has no accepted subject; assert the documented message.
5. Report generation/download routes were not captured. Mark report-delivery tests blocked until the route is observed.

---

# 11. Error and Status Behavior (observed)

| Status | Use |
| ------ | --- |
| 200 | Normal success on every captured route |
| 400 | Invalid relationship, e.g. subject-groups without batch |
| 401 | No/expired session, bad login |
| 403 | Module disabled (`ai-evaluation`), role without accepted subject, non-admin access |
| 423 | Assignment locked |
| 428 | Precondition required (`enterprise/domain-context` before tenant setup) |
| 500 / 502 | Upstream/degraded; never assert as success |

---

# 12. Schema Validation

Schemas generated from real responses live in `api/schemas/`:

`auth_login`, `auth_logout`, `auth_me`, `auth_csrf`, `auth_notifications`, `auth_security_context`, `auth_step_up`, `auth_password_complete_setup`, `auth_sso_providers`, `enterprise_domain_context`, `enterprise_form_fields`, `operations_overview`, `configuration_readiness`, `configuration_catalog`, `configuration_programme`, `configuration_regulation`, `configuration_academic_year`, `configuration_session`, `configuration_course`, `configuration_subject`, `configuration_paper`, `configuration_question_content`, `configuration_paper_sections`, `configuration_paper_submit`, `configuration_paper_document`, `evaluator_profile`, `evaluator_team`, `evaluator_enrollment_policy`, `face_login`, `face_status`, `face_verify_access`, `chairman_catalog`, `chairman_history`, `chairman_my_nominations`, `chairman_nomination`, `chairman_nomination_accept`, `chief_summary`, `chief_evaluator_history`, `chief_moderation_report`, `chief_team_nomination`, `allocation_catalog`, `allocation_examiner_batches`, `allocation_subject_groups`, `allocation_allocate_subject_group`, `allocation_assignment_action`, `allocation_assignment_viewer`, `assignment_lock`, `marking_workspace`, `marking_acknowledgements`, `marking_ai_analysis`, `marking_open`, `marking_marks`, `rubrics_catalog`, `rubrics_scheme`, `rubrics_scheme_transition`, `scanning_catalog`, `receiving_guided_catalog`, `receiving_reports_config`, `receiving_subject_papers`, `receiving_subject_scripts`, `receiving_subject_group_submit`, `repository_upload_intent`, `repository_upload_finalize`, `repository_script_complete`, `security_catalog`, `security_membership`, `security_policy`, `phase4_catalog`, `phase4_centre`, `phase4_centre_action`, `phase4_centre_readiness`, `phase4_hierarchy_monitoring`, `remote_security_policy`, `remote_security_session`, `remote_security_heartbeat`, `remote_security_resume`, `remote_security_event`, `evaluation_location`, `evaluation_workflow_catalog`.

Each file is named `<name>_api_schema.json` and uses draft-07. Validate with AJV.

---

# 13. End-to-End API Workflows

## 13.1 Academic setup
programme → regulation → academic year → session → course → subject → paper → sections → documents → submit.

## 13.2 Provisioning
centre → readiness → activate → user manager → chairman → chief → evaluator → scanner operator.
Capture every temporary password and complete setup with `ChangeMe322!`.

## 13.3 Capture → allocation → evaluation
scan batch → upload intent → finalize → subject scripts → packet submit → allocation → assignment start/progress → open evaluation → marks → draft → submit (when route captured).

## 13.4 Secure evaluation
face status → face login → remote security session → heartbeat → violation event → pause → step-up → resume.

## 13.5 Cross-tenant isolation
Repeat identity and catalog reads against two tenants; verify no id from tenant A resolves in tenant B.

---

# 14. Final Quality Criteria

- Routes only from `api/endpoints/routes.ts`; no invented paths.
- Payloads from captured shapes where available; unverified payloads marked blocked.
- Status codes match the observed table.
- Schemas from real responses; regenerate per tenant if the contract differs.
- No secrets, biometrics, tokens or temporary passwords in logs or source.
- Temporary passwords captured in memory only, then replaced with `ChangeMe322!`.
- Login lockout tested only with disposable accounts.
- Web and DB prompts stay in their own files.
