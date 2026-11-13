# Digital Evaluation System (ADMIEZO) — Web Test Prompts

**Application:** Digital Evaluation System (ADMIEZO)
**Application URL:** `DVS_WEB_BASE_URL` from `.env` — the base URL is **per university**, not fixed.
**Capture examples:** `https://ktr.35-200-205-253.sslip.io/` (tenant "KTR") and `https://harish.35-200-205-253.sslip.io/` (tenant "harish")
**Framework:** Follow `playwright-mcp-context.md` (single source of truth for HOW tests are built) and the Web Testing Architecture in §2 below.
**Capture method:** Live browser flows monitored role by role. Every prompt below comes from observed UI behavior.

> **Canonical file.** This is the only Web prompt file. Any copy that hard-codes a single tenant URL is an older draft — do not merge it back.

---

# 0. Multi-University Model (read first)

- The product supports **N universities**, each on its own base URL.
- `ktr` is one university created for capture. It is not a permanent target.
- **The workflow is identical for every university.** Only the data differs: tenant name, users, programmes, schemes, sessions, papers, centres, scripts.
- Never hard-code the university URL, tenant name or tenant data in specs.
  - Base URL: `DVS_WEB_BASE_URL`.
  - Tenant/user data: `.env` or `testdata/`.
- Every prompt below is a **template for the shared workflow**, not KTR-only behavior.

---

# 1. Capture Status

| # | Role / Area | Status | Evidence |
| - | ----------- | ------ | -------- |
| 1 | Admin — login, password set, exam configuration, papers, centres, access governance, marking schemes | Captured | 05:16–05:30 UTC |
| 2 | Chairman — login, nominations gate, chief master, register chief examiner, nominate chief | Captured (bug fixed) | 06:45–06:50 UTC |
| 3 | Chief Examiner — accept nomination, evaluator master, manage team, allocation, attendance, moderation, live monitoring | Captured | 06:50–07:10 UTC |
| 4 | User Manager — user management, add university user, role + module access, sensitive-action verify | Captured | 06:56–07:00 UTC |
| 5 | Scanner Operator — digitization, QP selection, upload capture, submit script, packet review, submit packet | Captured | 07:00–07:04 UTC |
| 6 | Admin — evaluation security policy | Captured | 07:09–07:10 UTC |
| 7 | Evaluator — evaluation desk, secure check, face enrollment, marking screen, pause/exit | Captured | 07:10–07:17 UTC |
| 8 | Evaluator — submit evaluation, report send, moderation outcomes | **Pending** — submit control not visible on recording device; submission completed elsewhere | — |
| 9 | Exam Invigilator and other optional roles | Optional — only if the role is exposed in Access Governance | — |
| 10 | Cross-university isolation | Pending second tenant | — |
| 11 | Full end-to-end on second tenant (`harish`) — Admin → Chairman → Chief → Evaluator → User Manager → Scanner → allocation → secure evaluation | Captured, submission pending | 09:20–09:58 UTC |

**Resolved blocker:** Chairman → Register Chief Examiner now completes (profile → subjects → record created, **Edit profile** available, nomination issued). Remove any `test.fixme()` previously added for this step.

**Still uncovered:** evaluator submission after the timer ends, report generation/send, Chief moderation approval/rework, Chairman report forwarding, Admin final report, second-tenant isolation.

> **Role note:** **Examination Controller is not a provisionable role in the current build.** Do not create it, do not assert its landing page, and do not include it in test matrices. Keep it only as legacy/optional context if an older tenant still has the account.

---

# 2. Common Requirements

For every prompt:

- Create Playwright UI tests using TypeScript.
- Use the existing framework: Page Objects (`pages/`), custom fixtures (`fixtures/pageFixtures.ts`), utilities (`utils/`).
- Inspect the live page before writing locators.
- Use the correct role account and prerequisite state.
- Read URLs and credentials from `.env` only.
- Use synthetic test data on the authorized staging tenant.
- Verify the business outcome, not only that a button was clicked.
- Prefer `getByRole` / `getByLabel` / `getByText`; avoid nth-child CSS chains.
- Use auto-waiting; no `waitForTimeout()`.
- Do not invent menus, fields, messages, roles or permissions.
- Do not create duplicate Page Objects, fixtures or utilities.
- The app is a single-page app: the URL stays on the tenant root for all in-app navigation. Assert on headings, regions and visible text.
- Temporary passwords are single-use handover secrets. Never commit, log or persist them.
- Sensitive actions require the actor's own password or authenticator code. Never store those in test code.

## Web Testing Architecture (mandatory)

Every Web prompt in this file builds artifacts in this order. Never create the spec first.

```text
Web Test Prompt (section below)
      ↓
Analyze the live page (role account + prerequisite state, MCP/CLI)
      ↓
Page Object — pages/<XxxPage>.ts
      ↓
Fixture wiring — fixtures/pageFixtures.ts (PageFixtures type + base.extend entry)
      ↓
Test data — testdata/ + utils/helper.ts, utils/dataGenerator.ts
      ↓
Utilities — utils/ (reuse before creating)
      ↓
Web test — tests/web/<area>/<kebab-case>.spec.ts
      ↓
Run → diagnose the real failure → fix → re-run
```

### Layer map

| Artifact | Location | Convention |
| --- | --- | --- |
| Page Object | `pages/` | `XxxPage.ts`, one class per file |
| Fixture | `fixtures/pageFixtures.ts` | add to `PageFixtures` type **and** `base.extend` |
| Web spec | `tests/web/<area>/` | `<kebab-case>.spec.ts` |
| Fixed data | `utils/helper.ts` | `Helper.getAcademicConfigurationData()`, `Helper.getPaperConfigurationData()` |
| Random data | `utils/dataGenerator.ts` | `RandomDataUtil` |
| Data files | `testdata/` | `.json` / `.csv` / `.xlsx` via `DataProvider` |

### Layer separation

```text
Web  → Page Objects → Custom Fixture → Utilities / Test Data → Web Tests
API  → Routes → Schemas → Utilities / Test Data → API Tests
DB   → DB Client → Queries → Utilities / Test Data → DB Tests
```

Do not put API requests or DB queries inside Web specs except in an explicitly combined scenario, and then in separate `test.step()` blocks.

### Page Object rules

- Own the locators and actions for one screen; keep test logic out of the class.
- Locator priority: `getByRole` → `getByLabel` → `getByText` → `getByPlaceholder` → `getByTestId` → CSS. No XPath, no `nth-child`, no auto-generated class chains.
- Every public method is documented; actions return `Promise<void>`; methods that navigate may return the next Page Object.
- Do not assert inside Page Objects (`isXxxExists()` checks are the only exception).
- Add the class to `fixtures/pageFixtures.ts` before any spec uses it.

### Fixture rules

- Specs import `{ test, expect }` from `fixtures/pageFixtures` (path relative to the spec). Never import `@playwright/test` in a Web spec.
- Fixtures expose Page Objects only. Browser, context and page lifecycle stay with Playwright.
- Admin flows use `ensureAdminSession(page, loginPage)`; every other role signs in with its own account and prerequisite state.
- Base URL is read from `WEB_APP_URL` (the framework's name for the per-university URL; `DVS_WEB_BASE_URL` in `.env.example` is the same value and must stay in sync). Never hard-code a tenant URL.

### Web test rules

- One spec per workflow area under `tests/web/<area>/`; the title carries tags, e.g. `test('@master @web @admin creates a paper', ...)`.
- Wrap each flow section in `await test.step('N) description', ...)`.
- Assert the business outcome and the persisted state after refresh or reopen, not only that a control was clicked.
- State-changing specs stay gated behind `DVS_ENV` and `DVS_ALLOW_WRITES=true`; read-only specs run by default.
- Missing environment, credentials or prerequisite data → `test.skip()` naming the exact variable or precondition. Never fake a result.

## Environment Variables

Only the tenant URL and Admin credentials are seeded. Every other role is provisioned during the run.

```text
DVS_WEB_BASE_URL=          # per-university base URL
DVS_ADMIN_EMAIL=
DVS_ADMIN_PASSWORD=
```

Runtime credentials produced by the run (not committed, not seeded):

```text
DVS_CHAIRMAN_EMAIL / PASSWORD
DVS_CHIEF_EMAIL / PASSWORD
DVS_EVALUATOR_EMAIL / PASSWORD
DVS_SCANNER_EMAIL / PASSWORD
DVS_USER_MANAGER_EMAIL / PASSWORD
```

Rule: after provisioning, set every permanent password to `ChangeMe322!` and keep the values in the run's ephemeral store.

---

# 3. Login — Temporary Password and First-Time Password Set

Captured for Admin, Chairman, Chief Examiner, User Manager and Scanner Operator.

1. Open `DVS_WEB_BASE_URL`.
2. Verify the login page: heading **"Welcome back"**, subtitle **"Sign in to the evaluation control room."**, **Email address**, **Password**, **Sign in**, **Use a passkey**.
3. Enter the role email and the handover temporary password.
4. Submit.
5. Verify the **"Set your password"** screen: **New password**, **Confirm password**, password-requirements list.
6. Enter a strong password twice.
7. Click **Set password and continue**.
8. Verify the authenticated shell: tenant name, role sidebar, language selector, notification bell, **Sign out**, account settings.
9. Verify the temporary password cannot be reused and no reset prompt remains.

## Expected Result

A provisioned user signs in once with the temporary password, sets a permanent password, and lands in the role shell.

### Negative Variants

- Temporary password reused → rejected.
- Password/confirmation mismatch → rejected.
- Password under displayed requirements → rejected.
- Expired temporary password (handover sheet shows `Expires:`) → rejected.
- Password is case-sensitive: `ChangeME322!` failed while `ChangeMe322!` succeeded. Always use the exact case.
- Failed-login lockout is enforced. Observed defaults: `failed_login_limit = 6`, `lockout_minutes = 5` (Admin → Access governance → Policy). Use disposable accounts for lockout tests; never lock the primary Admin.

---

# 4. Invalid Login

1. Open the login page.
2. Enter an invalid email and/or password.
3. Submit.
4. Verify the message **"Invalid email or password"** (observed) and that the user stays on the login page.
5. Verify no authenticated navigation renders.
6. Verify the error does not confirm whether the account exists.

## Expected Result

Invalid credentials are rejected; protected content stays unreachable.

---

# 5. Logout and Session Protection

1. Sign in with a valid role account.
2. Click **Sign out** in the banner.
3. Verify the session ends and the login page is shown.
4. Navigate to the tenant root again.
5. Verify authentication is required.
6. Verify a protected action cannot be performed after logout.

## Expected Result

Logout revokes access to every protected screen.

---

# 6. Multi-University Data Isolation

Run only when a second synthetic university exists.

1. Sign in as Admin of university A.
2. Verify only A's programmes, schemes, sessions, papers, centres, users and scripts are visible.
3. Sign in as Admin of university B.
4. Verify B sees only B's data and the tenant name differs in the banner.
5. Attempt to reach a known A record while authenticated to B (only through documented routes).
6. Verify access is denied and no A data is disclosed.
7. Repeat for Chairman, Chief, Evaluator and Scanner scope.

## Expected Result

Workflow is identical across tenants, but data never crosses tenant boundaries.

---

# 7. Admin — Exam Configuration

Captured sequence: Degree / Programme → Scheme / Regulation → Academic years → Exam sessions → Subjects (old course + subject) → Papers.

## 7.1 Degree / Programme

1. Sign in as Admin.
2. Open sidebar **Exam configuration**.
3. Verify tabs: **Subjects**, **Degree / Programme**, **Scheme / Regulation**, **Academic years**, **Exam sessions**, **Papers**.
4. Click **Add Degree / Programme**.
5. Enter **Degree / Programme code** and **Degree / Programme name**.
6. Click **Create record**.
7. Verify the record appears and is selectable downstream.
8. Negative: duplicate code, empty code, empty name.

## 7.2 Scheme / Regulation

1. Open **Scheme / Regulation → Add Scheme / Regulation**.
2. Enter code and title; select **Applicable degrees / programmes**.
3. Click **Create record**.
4. Verify association and persistence after refresh.
5. Negative: duplicate code, no programme, empty title.

## 7.3 Academic Year

1. Open **Academic years → Add Academic year**.
2. Select **Scheme / regulation**, enter the year label.
3. Click **Create record**.
4. Verify it appears under the correct regulation and is selectable in **Exam sessions**.

## 7.4 Exam Session

1. Open **Exam sessions → Add Exam session**.
2. Select **Degree / Programme** and **Academic year**, enter **Session name**.
3. Click **Create record**.
4. Verify the session appears in the correct context and is selectable in **Subjects** and **Papers**.

## 7.5 Historical Course

1. Open **Subjects → Add Old Course**.
2. Select **Degree / programme**, **Old scheme**, enter **Course code** and **Course name** (placeholders `e.g. CSE-2017`, `e.g. Computer Science and Engineering`).
3. Click **Create old course**.
4. Verify it is selectable as **No course / branch** in subject creation.

## 7.6 Subject

1. Click **Add Subject**.
2. **Academic mapping:** Degree / Programme, Scheme / Regulation (optional), Academic year, Course / branch, Semester (`Sem 1`…`Sem 8`).
3. **Subject details:** code and name.
4. Select one or more **Sessions**.
5. Click **Create subject**.
6. Verify the full context label, for example `KAN001 - KANNADA / R-26 - REGULATION-2026 / BTECH - BACHLORS OF TECHNOLOGY / CSE - COMPUTER SCIENCE AND ENGINEERING / Sem 1 / 2026-2027`.
7. Verify it is selectable in **Papers**.

## Expected Result

Each configuration record persists once and is available to the next step in the chain.

### Captured sample data (synthetic, tenant-specific)

- Programme `BTECH` / `BACHLORS OF TECHNOLOGY`
- Regulation `R-26` / `REGULATION-2026`
- Academic year `2026-2027`
- Session `REGULAR SEM EXAM`
- Course `CSE` / `COMPUTER SCIENCE AND ENGINEERING`
- Subject `KAN001` / `KANNADA`

---

# 8. Admin — Paper with Question Paper and Sections

1. Open **Exam configuration → Papers → Add Paper**.
2. Select **Paper type**: `Regular / current scheme`, `Backlog / old scheme`, `Supplementary / old scheme`, `Carry-forward / old scheme`, `Equivalent / bridge`.
3. Select **Exam session** and **Subject**.
4. Enter **Paper code**, **Title**, **Maximum marks**, **Pass marks**, **Scripts per packet**, **Pages per script**.
5. Click **Create record**.
6. On the paper card click **Add PDF** → choose a PDF → **Upload PDF**.
7. Verify the card now exposes **Question paper**.
8. Click **Configure Sections** → **Save Section Configuration**.
9. Open **Configure Modules** and set each module split (observed options: `a(10) + b(10) = 20`, `a(7) + b(7) + c(6) = 20`, `a(5) + b(5) + c(5) + d(5) = 20`, `No subparts (Full question)`), and optionally **Custom Question Configuration**.
10. Click **Submit** and verify the submitted state.
11. Negative: pass marks > maximum marks, zero packet size, missing subject/session, invalid PDF type, module split not summing to the question marks.

## Expected Result

Paper is created with academic links and digitization settings, has a question paper attached, sections saved and is submitted.

### Captured sample

- `KAN001` / `KANNADA`, max `80`, pass `21`, scripts per packet `2`, pages per script `2`
- Section structure observed in evaluation: Section A (10 of 12, 2M each), Section B (5 of 7, 6M each), Section C (3 of 5, 10M each)

---

# 9. Admin — Evaluation Centres

1. Open **Access governance → Centres & camps**.
2. Complete **New operation** (centre name; centre code is generated).
3. Click **Run operation**.
4. Verify the centre row.
5. Click **Check readiness**, then **Activate**.
6. Verify the centre can be selected as **Operational centre** when creating users.

## Expected Result

Centre is created, readiness-checked, activated and assignable.

### Captured sample

- Name `ADMIEZO`; generated reference `CTR-56EDA572C3DE` (never hard-code generated IDs)

---

# 10. Admin — Access Governance and User Provisioning

Observed roles: **Chairman**, **User manager**, **Exam invigilator** (optional), **Scanner operator**, plus evaluator/chief-provisioned accounts. **Examination Controller is not offered in the current build** — do not assert it.

1. Open **Access governance → Access → Add user**.
2. Enter **First name**, **Last name**, **Institutional email**.
3. Select **Role**.
4. Select **Operational centre** (or **No operational centre**).
5. Review **Module access** defaults for the role.
6. Click **Create user**.
7. Verify the handover sheet: **User ID**, **Temporary password**, **Expires**, **Done**.
8. Verify the user row shows role, centre and module list.
9. Negative: duplicate email, invalid email, missing names, missing role.

## Expected Result

User is created with the correct role/centre/module scope and receives a single-use temporary password.

### Observed behaviour

- Creating a **Chairman** requires **Programme / Degree**.
- Creating a **Scanner operator** requires an **Operational centre**.
- Sensitive actions (creating users, saving policy) prompt for the actor's **Password** or **Authenticator code** and a **Verify** action.

### Captured synthetic accounts

- Tenant `ktr` (legacy): `ktrec1@gmail.com` (Examination controller — legacy only, role not offerable in current build), `ktrchair1@gmail.com` (Chairman), `ktrum1@gmail.com` (User manager), `ktrchief1@gmail.com` (Chief), `evaluator1@gmail.com` (Evaluator), `ktrscript1@gmail.com` (Scanner operator)
- Tenant `harish`: `harishchair1@gmail.com` (Chairman), `harishum1@gmail.com` (User manager), `harishchief1@gmail.com` (Chief), `harishevaluator1@gmail.com` (Evaluator), `harishscanner1@gmail.com` + `harishscript1@gmail.com` (Scanner operators)

Temporary passwords stay in the capture log only. Do not copy them into tests.

### Credential bootstrap rule

- `.env` starts with **only** `DVS_WEB_BASE_URL` and the Admin credentials. Do not expect every role credential up front.
- The test must provision each role in order, capture the temporary password from the handover sheet, then set the permanent password to `ChangeMe322!` for every provisioned user.
- Store runtime credentials outside source control (run-scoped secret store).
- Observed anomaly: one Scanner Operator was first created with role `evaluator` / module `evaluation`, then recreated as `scanner_operator` / `digitization`. Assert the intended role and treat the mismatch as a failure.

---

# 11. Admin — Marking Schemes

1. Open **Marking schemes → New scheme version**.
2. Select **Paper**, enter **Title**, upload **Scheme of evaluation PDF**.
3. Click **Save**.
4. Verify the version appears in the paper's scheme history.
5. Verify the evaluator's **Scheme of evaluation** reference opens the active version.
6. Negative: missing paper/title/PDF, duplicate title.

## Expected Result

A versioned marking reference is stored and served to the evaluator.

---

# 12. Chairman — Chief Master and Nomination

Captured on the fixed build.

## 12.1 Landing and nominations gate

1. Sign in as Chairman and complete the first-time password set.
2. Verify the blocking prompt with **Open Chief nominations**.
3. Click it and verify **Select a subject** (for example `KAN001 · KANNADA`), the chief list, and **Open Chief master**.

## 12.2 Register Chief Examiner

1. Open **Chief master → Register chief examiner**.
2. **Profile:** **Full name**, **Email**, **Institution**, **Department**, **Experience in years**.
3. Expand **Complete profile later** for **Mobile**, **Employee ID**, **Designation**, **Qualification**, **Employment type** (`Permanent`, `Contract`, `Visiting`).
4. Click **Continue**.
5. **Subjects:** select at least one subject (checkbox with the full context label); **Select visible** and **Filters (5)** are available.
6. Click **Register chief examiner**.
7. Verify success, the chief appears in **View profiles**, and **Edit profile** is available.
8. Verify registration does not itself issue login credentials.

## 12.3 Nominate Chief

1. Open **Chief nominations**, select the subject.
2. Click **Nominate** on the intended chief.
3. Verify the nomination status becomes awaiting acceptance.
4. Verify the handover sheet appears only when a login is provisioned (`Login email`, `Temporary password`, `Done`).
5. Verify the Chief sees the nomination in **Manage team**.

## Expected Result

Chief profile, expertise and nomination exist as separate, correctly scoped records.

### Observed field names

`display_name`, `email`, `institution_name`, `department`, `years_experience`, `mobile`, `employee_id`, `designation`, `qualification`, `employment_type`.

---

# 13. Chief Examiner — Acceptance, Team and Allocation

Captured sidebar: **Allocation engine**, **Evaluator master**, **Manage team**, **Attendance**, **Moderation**, **Moderation reports**, **Live monitoring**.

## 13.1 Accept nomination

1. Sign in as the nominated Chief, complete first-time password set.
2. Verify subject nominations table: **Subject**, **Status**, **Action** (`KAN001 · KANNADA`, `Awaiting your acceptance`).
3. Click **Accept nomination**.
4. Verify accepted scope and that restricted workspaces unlock.

## 13.2 Register Evaluator

1. Open **Evaluator master → Register evaluator**.
2. **Profile:** full name, email, institution, department, experience; optional details under **Complete profile later**.
3. Click **Continue**.
4. **Subjects:** select qualifying subjects (`Select visible`, filters).
5. Click **Continue**.
6. **Login:** choose whether to create a login (**Create login and issue a temporary password**) or **Later**.
7. Register, verify profile exists, **Edit profile / Deactivate** available.
8. Verify registration alone does not imply team membership or nomination.

## 13.3 Manage team and nominate

1. Open **Manage team**; verify the accepted subject card (`KANNADA`, `KAN001`, `Accepted`).
2. Select an eligible evaluator and click **Nominate**.
3. Verify the handover sheet with **Login email**, **Temporary password**, **Copy temporary password**, **Done**.
4. Verify the evaluator appears with nomination state.

## 13.4 Allocation

1. Open **Allocation engine**.
2. Verify a ready packet notice (for example "1 packet is ready. Choose a packet, select an available evaluator, then allocate.").
3. Select the **Examiner batch** and the **Select packet** option (shows stored/closed state, for example `2/2 stored, closed`).
4. Choose an eligible evaluator (shows eligibility blockers when ineligible).
5. Click **Allocate packet**.
6. Verify no partial assignment; every script in the packet is assigned to the same evaluator.
7. Verify an ineligible evaluator (absent, not in team, missing expertise, active packet) cannot be allocated.

## 13.5 Attendance, moderation and monitoring

1. Open **Attendance**; verify presence is driven by attendance state, not account activity.
2. Open **Moderation** and **Moderation reports**; verify only completed work is listed.
3. Open **Live monitoring**; verify evaluator session/heartbeat information is displayed.

## Expected Result

Chief has only accepted-subject scope, and allocation enforces every prerequisite before assigning a packet.

---

# 14. User Manager — User Management

1. Sign in as User Manager (first-time password set).
2. Open **User management**.
3. Click **Add user**; complete the sensitive-action check with **Password** or **Authenticator code** → **Verify**.
4. In **Add university user** enter first name, last name, email.
5. Select role: **Exam invigilator**, **Scanner operator**, and other exposed roles.
6. Select **Select active centre** (required for scanner) or no centre.
7. Review **Module access** for the role.
8. Click **Create user**.
9. Verify the handover sheet and the user row.
10. Negative: duplicate email, missing centre for scanner, missing required fields.

## Expected Result

User Manager provisions only permitted roles with correct centre and module scope.

---

# 15. Scanner Operator — Digitization

Captured sidebar: **Digitization**. Workspace tabs: **Digitize scripts**, **Approved rescans**.

## 15.1 Choose paper

1. Sign in as Scanner Operator.
2. Verify **Operating centre** and the workflow: **Choose paper → Capture pages → Processing & storage → Submit to chief → Approved rescans**.
3. Select **QP code** (`KAN001 - KANNAD`).
4. Verify paper settings appear: scripts per packet, pages per script.
5. Verify only the assigned centre's papers are selectable.

## 15.2 Capture by upload

1. Keep **Capture method: Upload**.
2. **First remaining page** → choose the image after the cut cover.
3. **Remaining script pages** → choose remaining pages in filename order.
4. Do not upload the cut cover.
5. Verify the page count matches the paper setting.
6. Click **Submit script**.
7. Verify script identity, page count and processing state.

## 15.3 Capture by scanner

1. Switch **Capture method: Scanner**.
2. Verify scanner status (`Scanner: Not verified` when no device is confirmed).
3. If a scanner is available, scan and verify page order and count.
4. If unavailable, mark the test environment-blocked; do not fake a scanner result.

## 15.4 Submit packet

1. Repeat capture until the packet is complete.
2. Open **Review packets** and verify packet identity and stored scripts.
3. Click **Submit packet**.
4. Verify the packet is submitted and appears as ready for Chief allocation.
5. Verify an incomplete packet cannot be allocated.

## Expected Result

Scripts are stored under the chosen QP with correct page counts, and a closed packet becomes allocation-ready.

---

# 16. Evaluator — Secure Evaluation Session and Camera

This is the part where the system presents the anonymised answer-script screen to the evaluator for marking, and asks for camera/face evidence.

## 16.1 Open assigned packet

1. Sign in as the nominated evaluator (first-time password set).
2. Verify **Evaluation desk** and the workflow: **Open your packet → Evaluate scripts → Submit evaluation → Send your report → Follow up**.
3. Verify assigned script counters, **Packet / subject group** selector and queue columns: **Script #**, **Subject / Paper**, **Round**, **Progress**, **Due**, **State**, **Controls**.
4. Verify only assigned scripts are listed; state is `Assigned`.

## 16.2 Face enrollment (camera)

1. On first entry verify **Register your face** — "Register once. On future logins, a quick face check verifies it's you."
2. Click **Open camera**; allow camera access when prompted.
3. Verify the **Face enrollment** dialog: **Camera required**, checks `Camera`, `Single face`, `Liveness`, `Quality`, buttons **Camera**, **Enroll**.
4. Complete enrollment and verify success.
5. Verify enrollment is one-time and later logins ask only for a quick face check.
6. Verify camera denial blocks the secure flow with a clear message.
7. Never bypass camera/face checks. Use Chromium fake media devices for automation and mark real-hardware checks environment-blocked.

## 16.3 Secure evaluation check

1. Click **EVALUATE** on an assigned script.
2. Verify dialog **Secure evaluation check** with subject/paper and session context, policy rows: **Webcam**, **Face**, **Displays**, **Headphones**, **Fullscreen**.
3. Tick **"I acknowledge that this evaluation session is monitored under institutional security policy."**
4. Click **Run security checks**.
5. Verify **Begin secure evaluation** enables only after checks pass.
6. Verify a failed check (camera off, extra display, missing fullscreen when required) blocks or pauses the session.

## 16.4 Evaluate the script

1. **Begin secure evaluation** and verify the evaluation workspace:
   - Header: subject and **Paper Code**, **Script 1 of N**, **Round**, progress percentage, timer, **AI analysis**, **Remarks**, **SOS Help**, **Full screen**.
   - Reference documents: **Question paper**, **Scheme of evaluation**, **Annotations**.
   - Viewer controls: **Previous page**, **Page** spinbutton, **of N**, **Next page**, theme, **Zoom out**, zoom percentage, **Zoom in**, **Fit to width**.
   - Script images labelled **Anonymous script page 1…N** (no candidate identity).
   - **Consolidated question marks** table grouped by section (Section A/B/C with attempt rules and marks per question).
2. Enter marks per question using **Marks for N** inputs; verify **Grand Total** and **Final Marks** update. Zero is a valid mark; unanswered questions record `0` with outcome `unanswered`.
3. Enter an out-of-range or negative mark (observed attempts `-8`, `8-`) and verify the app blocks it with an **OK** acknowledgement dialog and does not store the value.
4. Use **Annotations**, **Remarks**, **AI analysis** (where enabled) and verify they do not change submitted marks. In capture, **AI analysis** was disabled at assignment level while the tenant policy allowed it.
5. Verify **Submit evaluation** is unavailable until the timer ends ("Submission is available after the timer ends."). On the second-tenant capture the submit control was **not visible on the recording device**; submission was completed from another device. Treat that as device/session-specific, not as a removed feature.
6. Click **Pause evaluation**; verify the resume path asks for the actor's password/step-up, then **Run checks and resume** → **Verify** → **Continue to security check** → **Begin secure evaluation**. Progress and marks survive the pause.
7. Click **Pause evaluation → Save and exit** and verify **Exit this script?**: **Continue evaluation**, **Reason for exiting** (`Technical problem`, `Script is unreadable`, `Need clarification`, `Personal reason`, `Wrong script assigned`, `Time unavailable`, `Other`), **Save and exit**.
8. Save and exit; reopen and verify saved marks persist as a draft.
9. **Reject Paper** with a reason and verify it follows the review/exception flow.

## Expected Result

Only the assigned evaluator can open the anonymised script, marks save against the correct question and round, camera/security policy is enforced, and exit/reject actions are logged with a reason.

---

# 17. Evaluator — Submit, Report and Follow-up

Status: submission pending. The **Submit evaluation** control was not visible on the recording device in the second-tenant run; marks were saved as draft and submission was completed from another device. Capture the submit, report-send and follow-up screens on the device that has them before finalizing locators.

1. Complete all required questions for the script.
2. Wait for the timer to allow submission; click **Submit evaluation**.
3. Verify the script state changes from `Assigned`/in progress to submitted.
4. Verify one submitted script does not mark the whole packet complete.
5. Open **Send your report**; use **Generate report** / **Download report** and verify the export.
6. Send to Chief only after explicit confirmation; verify download-only does not send.
7. Open **Follow up**; verify rejected and rework items appear with reasons.
8. Sign in as Chief and verify submitted work appears in moderation.

## Expected Result

Submission, report delivery and follow-up are separate, traceable actions.

---

# 18. Admin — Evaluation Security Policy

1. Open **Access governance → Evaluation security**.
2. Verify session-protection controls: **Keep camera on**, **Require fullscreen**, **Record incident clips**, **Allow only one display**, **Pause on security issues** (field names observed: `evaluation_camera_required`, `evaluation_fullscreen_required`, `evaluation_event_recording`, `evaluation_single_screen_required`, `evaluation_pause_on_violation`).
3. Verify the session-protection inputs persisted by the same policy: **Session timeout (minutes)** `session_timeout_minutes`, **Concurrent sessions** `maximum_concurrent_sessions`, **Step-up validity (minutes)** `step_up_minutes`, **Failed login limit** `failed_login_limit`, **Lockout (minutes)** `lockout_minutes`, **Require MFA** `require_mfa`, **Require trusted device** `require_trusted_device`, **Enable DLP controls** `dlp_enabled`, `vpn_risk_threshold`, `alert_risk_threshold`.
4. Verify the evaluation-session fields: `evaluation_session_timeout_minutes`, `evaluation_heartbeat_seconds`, `evaluation_no_face_seconds`, `evaluation_retention_days`, `evaluation_identity_verification_required`, `evaluation_mobile_allowed`, `evaluation_require_resume_step_up`, `evaluation_allow_clipboard`, `evaluation_allow_download`, `evaluation_allow_print`, `evaluation_allow_screenshot`, `evaluation_inactivity_lock_enabled`, `evaluation_inactivity_minutes`, `evaluation_inactivity_lock_hours`, `min_evaluation_minutes`, and the `ai_evaluation_*` settings.
5. Click **Save evaluation policy**.
6. Complete the sensitive-action check (**Password** or **Authenticator code** → **Verify**).
7. Verify saved values persist after refresh and the policy `version` increments once per save.
8. Sign in as evaluator and verify the secure-evaluation dialog reflects the enabled policy.
9. Verify a disabled policy change is reflected on the next evaluation start.
10. Verify that disabling camera/fullscreen/single-display changes the evaluator dialog from "required" to "not required" and does not block evaluation.

## Expected Result

Admin policy controls drive the evaluator's secure-session checks.

---

# 19. Role-Based Login Matrix

Create one independent test per captured role:

| Role | Landing surface |
| ---- | --------------- |
| Admin | Exam configuration, Access governance, Marking schemes |
| Chairman | Chief nominations gate, Chief master |
| Chief Examiner | Chief Examiner Desk: Allocation engine, Evaluator master, Manage team, Attendance, Moderation, Moderation reports, Live monitoring |
| Evaluator | Evaluation desk |
| Scanner Operator | Digitization |
| User Manager | User management |

For each role:

1. Sign in; handle first-time password set.
2. Verify tenant name and role identity.
3. Verify the role's sidebar modules.
4. Verify another role's modules are absent.
5. Verify direct navigation does not bypass role checks.

## Expected Result

Each role sees only its own workspace and cannot reach restricted modules.

---

# 20. Data-Driven Login Tests

Load role rows from one external file:

- `testdata/dvs_role_logins.csv` / `.xlsx` / `.json`

Columns: `testName`, `role`, `emailEnvKey`, `passwordEnvKey`, `firstLogin`, `expected`.

Rules:

1. Resolve credentials from environment variables at runtime.
2. Never store passwords or temporary passwords in the data file.
3. Generate one test per row, tagged `@datadriven`.
4. Handle **Set your password** when `firstLogin: true`.
5. Validate the actual result against `expected`.

## Expected Result

One test per data row; real behaviour matches the expected outcome without exposing secrets.

---

# 21. UI Inventory (verified labels)

## Global shell

- Complementary: **Collapse sidebar**, **Primary navigation**, health text (`Evaluation core healthy`)
- Banner: tenant name, `No active examination session`, **Select language**, **Notifications**, **Sign out**, **Account settings**
- Document title: `ADMIEZO | Evaluation Operations`

## Sidebars by role

- Admin: **Exam configuration**, **Marking schemes**, **Access governance**
- Chairman: **Chief nominations**, **Chief master**
- Chief Examiner: **Allocation engine**, **Evaluator master**, **Manage team**, **Attendance**, **Moderation**, **Moderation reports**, **Live monitoring**
- Evaluator: **Evaluation desk**
- Scanner Operator: **Digitization**
- User Manager: **User management**

## Evaluation workspace

- Dialog: **Secure evaluation check**, policy rows **Webcam** / **Face** / **Displays** / **Headphones** / **Fullscreen**, acknowledgement checkbox, **Run security checks**, **Begin secure evaluation**
- Viewer: **Question paper**, **Scheme of evaluation**, **Annotations**, **Previous page**, **Go to page**, **Next page**, **Theme: auto**, **Zoom out**, **Zoom in**, **Fit to width**
- Marking: **Marks for {n}** textboxes, **Grand Total**, **Final Marks**
- Actions: **AI analysis**, **Remarks**, **SOS Help**, **Full screen**, **Reject Paper**, **Pause evaluation**, **Submit evaluation**
- Exit dialog: **Reason for exiting** options, **Save and exit**

## Face enrollment

- **Register your face**, **Open camera**, **Face enrollment** dialog, checks `Camera` / `Single face` / `Liveness` / `Quality`, **Enroll**

## Digitization

- **Digitize scripts**, **Approved rescans**, **QP code**, **Upload** / **Scanner**, **First remaining page**, **Remaining script pages**, **Choose first page**, **Submit script**, **Review packets**, **Submit packet**

> Stable handles observed: `name` attributes (`code`, `name`, `title`, `programme_id`, `programme_ids`, `regulation_id`, `academic_year_id`, `session_id`, `session_ids`, `subject_id`, `paper_type`, `max_marks`, `pass_marks`, `scripts_per_packet`, `pages_per_script`, `first_name`, `last_name`, `email`, `password`, `confirm`, `display_name`, `institution_name`, `department`, `years_experience`, `mobile`, `employee_id`, `designation`, `qualification`, `employment_type`, `scheme_pdf`, `file`, `packet-evaluator`, `evaluation_*`). Prefer role/label locators first, then these names.

---

# 22. Final Implementation Quality Criteria

- Cover real DVS workflows for every captured role.
- Never hard-code the university base URL, tenant name or tenant data.
- Use the correct role and prerequisite state.
- Reuse existing Page Objects, fixtures and utilities.
- Use live-verified locators.
- Use `test.step()` sections and meaningful assertions.
- Use synthetic data; keep credentials in `.env`.
- Verify persisted state after refresh/reopen.
- Separate create, upload, submit, activate, allocate, generate and send actions.
- Enforce camera/face/security policy checks; never bypass them. Use Chromium fake media devices and mark hardware-only checks environment-blocked.
- Mark unverified screens and permissions as blockers, not assumptions.
