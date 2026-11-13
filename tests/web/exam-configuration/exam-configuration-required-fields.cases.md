# Exam Configuration Required-Field Cases

## Scope and safety

- Target: user-provided DVS staging URL from `WEB_APP_URL`.
- Roles: Admin and Chairman. Both roles reportedly have Exam configuration access.
- Test data: no new records. Tests stop after opening forms and inspecting constraints.
- Credentials: read only from `DVS_ADMIN_EMAIL`, `DVS_ADMIN_PASSWORD`, `DVS_CHAIRMAN_EMAIL`, and `DVS_CHAIRMAN_PASSWORD`.
- Evidence: current CLI login confirmed Admin access and an existing Programme. Existing records must remain unchanged.
- Requirement terms: **Native required** means browser-level `required`/`aria-required`; **Workflow required** means DVS setup requires field even if native marker was absent.

## Cases

| ID | Form / role | Inputs to inspect | Expected requirement / result |
|---|---|---|---|
| CFG-001 | Admin sign-in | Email address, Password | Both are required. Invalid/empty credentials must not open protected configuration. |
| CFG-002 | Chairman sign-in and access | Email address, Password; Exam configuration and Papers navigation | With approved Chairman credentials, sign in and confirm access. Skip clearly when Chairman credentials are absent; never reuse Admin credentials as Chairman. |
| CFG-003 | Degree / Programme | Programme code, Programme name | Both are Native required. Do not submit form. |
| CFG-004 | Scheme / Regulation | Regulation code, title, applicable Programme(s) | Title is Native required. Code and applicable Programme(s) are Workflow required; verify mapping when records are available. |
| CFG-005 | Academic Year | Scheme / Regulation, Academic Year label | Academic Year label is Native required. Scheme / Regulation is Workflow required. |
| CFG-006 | Exam Session | Programme, Academic Year, Session name | All three are Native required. Check start/end date-time controls if present; never invent calendar values. |
| CFG-007 | Course | Programme, Scheme / Regulation, Course code, Course name | Programme, code, and name are Native required. Regulation depends on Programme and is Workflow required for the approved mapping. |
| CFG-008 | Subject | Programme, Academic Year, Semester, Subject code, Subject name; Regulation, Course, Exam sessions | Programme, year, semester, code, and name are Native required. Regulation, Course, and Exam sessions are optional in the inspected form. |
| CFG-009 | Paper | Paper type, Exam session, Subject, Paper code/title, maximum marks, passing marks, valuation rounds, inter-round difference threshold, component weights, grade thresholds, scripts per packet, pages per script, BOSC checks | Workflow requires core identity, mark rules, packet/page settings, and approved checks. Module-wise flag and round-two trigger are optional/conditional. Verify numeric limits: script/page values 1–500; BOSC check count 1–12; each check ≤160 characters. Do not invent policy defaults. |
| CFG-010 | Marking Scheme | Paper, title, PDF | Paper and title are Native required. PDF is a required workflow attachment but has no native `required` marker. Do not upload or save. |
| CFG-011 | User access | First name, last name, institutional email, role, centre, module permissions | Verify identity, role, scope, and module permissions; never accept defaults without review. Live Add user action opens re-authentication (password/authenticator code), so user fields remain unverified. Do not bypass MFA or create users. |
| CFG-012 | Centre | Centre name, code, location | All three are required in the earlier inspected form. Current Centres & camps view exposes no form controls, so reconfirm before asserting. Do not create or activate a centre. |
| CFG-013 | Cross-role safety | Admin and Chairman Paper configuration | Both roles can open the same configuration area per tester confirmation. Record any permission difference; do not modify shared records. |

## Run order

1. Run CFG-001 and CFG-003–CFG-010 as Admin.
2. Run CFG-002 and CFG-013 for Chairman when Chairman credentials exist.
3. Use synthetic values only for any later approved submission test; this suite never submits forms.
4. Report missing credentials as skipped and unobserved screens/constraints as unverified, not passed.

## Evidence limits

The live CLI confirmed Admin sign-in and Exam configuration navigation. It showed one existing Programme and no active examination session. It did not submit or alter records. The Paper form is disabled by missing session prerequisites. Chairman CLI credentials are not configured, so Chairman access remains unverified by automation until approved role credentials are supplied. Add user requires re-authentication; the Centres & camps view showed no form controls.

## Admin-stage workflow coverage

The following cases extend required-field checks into the Admin-stage exit criteria. They are **planned, not executed**. Use only approved synthetic data and real application templates/documents. Confirm expected validation wording and lifecycle states in the deployed build before automating assertions.

| ID | Workflow | Checks | Expected invariant |
|---|---|---|---|
| ADM-001 | Academic mapping | Programme, Regulation, Academic Year, Session, Course and Subject dependencies; invalid and mismatched parent selections | Saved records retain intended relationships; unrelated parent records cannot be selected or silently linked. |
| ADM-002 | Academic validation | Empty required fields, duplicate codes/labels, invalid date order, boundary lengths and invalid characters | Invalid data is blocked or clearly rejected; no duplicate or partial record appears. Exact limits remain `UNVERIFIED` until confirmed from live forms. |
| ADM-003 | Session readiness | No session, inactive/pending session and approved active session | Paper creation follows actual session prerequisites; pending/inactive state is visible and cannot be mistaken for ready. |
| ADM-004 | Paper validation | Required identity fields, mark values, valuation settings, component weights, grade thresholds, packet/page settings and BOSC checks | Invalid or incomplete paper cannot become submission-ready; policy values come only from approved rules. |
| ADM-005 | Paper relationships | Paper type, Session, Subject, Programme and Regulation compatibility | Paper remains linked to correct academic context after save, refresh and reopen. |
| IMP-001 | Template download | Download template from live import UI; inspect filename, format, headers and required columns | Use actual downloaded template; do not generate or assume schema. |
| IMP-002 | Import validation | Missing/renamed columns, empty required values, invalid codes, broken relationships, duplicate rows, malformed file and wrong file type | UI identifies rejected rows and reasons; invalid rows create no unintended records. Partial-import policy is `UNVERIFIED` until observed. |
| IMP-003 | Valid import | Approved dataset with ordered questions and approved marks; inspect row counts, created records and relationships | Accepted rows create only intended records; row-level results reconcile with created records. Do not retry after timeout before reconciling state. |
| IMP-004 | Import idempotency | Re-upload same file after checking existing records | Duplicate prevention or documented duplicate behavior matches application policy; no accidental duplicate paper/question records. |
| PAP-001 | PDF association | Attach approved paper PDF; reopen record and verify association | Correct PDF is associated with correct Paper; upload success alone does not imply question marks were configured. |
| PAP-002 | Marking scheme association | Add scheme with correct Paper, title and approved document; reopen | Scheme persists and remains linked to intended Paper; missing required attachment blocks readiness as deployed. |
| PAP-003 | Question pattern | Question identity, order, sub-questions, per-question marks, duplicate/missing numbers and total | Questions match official pattern; order is stable; configured total equals Paper maximum exactly. |
| PAP-004 | Submission readiness | Missing PDF, scheme, questions, mismatched totals, incomplete marks and valid complete setup | Every applicable blocker is visible; incomplete Paper cannot submit; valid submission yields verified status after reopen. |
| PAP-005 | Approval lifecycle | Submit, independent approval where present, unauthorized approval attempt | Submit and approval remain distinct; only authorized role can approve; status history persists. |
| USR-001 | Chairman dependency | Create only after Programme and Exam Configuration; assign correct Programme scope | Chairman inherits intended configuration and cannot see unrelated programme records. |
| USR-002 | Governance users | Exam Controller and User Manager forms; actual role, university/centre scope and module permissions | Save only scopes confirmed by live form and tester; each account sees only authorized modules and records. |
| USR-003 | Account onboarding | Generated/invited temporary credential, first login, forced password change, fresh login | Account activates through supported flow; never expose credentials in logs, screenshots, traces or source. Stop at MFA or unexpected onboarding behavior. |
| USR-004 | User validation | Duplicate email, missing identity, role/scope mismatch, disabled account and unauthorized access | Invalid setup is blocked; account role and scope persist; no privilege escalation. Re-auth/MFA must use approved flow. |
| CTR-001 | Centre creation | Centre name, unique code, location; required-field and duplicate-code checks | Correct centre appears in register with accurate details; duplicate/invalid centre is not silently created. |
| CTR-002 | Centre activation | Create centre, verify status, activate only through supported operation | Centre is explicitly Active before use; success toast alone is insufficient proof. |
| CTR-003 | Centre scope | Check centre selection in user access, attendance and operational workflows | Active centre is selectable where intended; centre-scoped users cannot access other centres. |
| EVD-001 | Evidence | Before/after screenshots at academic, paper, onboarding and centre gates | Full-page sanitized evidence proves each gate; no password, OTP, token, student data or script image appears. |

## Execution gate

Do not run state-changing cases until `DVS_ENV` explicitly identifies an authorized non-production environment, approved synthetic academic values and paper/marking documents exist, and required MFA/onboarding steps are available. Current `.env` has Admin credentials and matching host, but `DVS_ENV`, Chairman credentials and `DVS_ROLE_NEW_PASSWORD` are unset. Existing observed state has no active session; Paper creation was disabled. No approved import template, question-paper PDF, marking-scheme file or unique centre values are recorded in this workspace. Therefore `IMP-*`, `PAP-*`, `USR-*` creation/onboarding and `CTR-*` remain blocked; do not invent data or continue past re-authentication/MFA.
