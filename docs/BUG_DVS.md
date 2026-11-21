# BUG_DVS — Defect Log

Every defect observed by the automated role suites is appended here by `utils/defectLog.ts`.
Run all role test cases with one command:

```bash
npm run testcases
```

A run never stops on a defect: the finding is recorded, the test continues, and the final
summary reports how many records were added.

**Severity**

| Level | Meaning |
| --- | --- |
| S1 | Blocks the workflow (a role cannot finish its business outcome) |
| S2 | Blocks one outcome (a step or validation is wrong) |
| S3 | Degraded behaviour with a workaround |
| S4 | Cosmetic / text |

**Status:** `Open` · `Confirmed` · `Fixed` · `Won't fix`

---

## Notes

- A missing step-up answers `428` (precondition required), not `401/403`; an unknown login answers
  `422`, not `401`. Test-side expectation errors must be corrected and removed so this log stays
  trustworthy.
- Test case IDs come from `docs/testcases/*.csv` and `docs/testcases/DVS-TESTCASES.xlsx`.

---

## Index

| ID | Date | Role | Area | Severity | Title | Status |
| --- | --- | --- | --- | --- | --- | --- |
| DVS-MWN647X2-KME7 | 2026-11-19 | platform-admin | authorization | S1 | A tenant session can read the control plane | Open |
| DVS-MWN6C9DS-02NO | 2026-11-19 | admin | papers | S1 | Paper creation or the pass-marks validation fails | Open |
| DVS-MWN6C9LK-P7KE | 2026-11-19 | admin | papers | S1 | The paper cannot be configured, uploaded and submitted | Open |
| DVS-MWN6C9PQ-6QEJ | 2026-11-19 | admin | marking schemes | S1 | The marking scheme cannot be created and frozen | Open |
| DVS-MWN6CVR0-IJ0R | 2026-11-19 | chief | nomination | S1 | Nomination acceptance does not unlock the Chief scope | Open |
| DVS-MWN6D3X3-CH2U | 2026-11-19 | chief | allocation | S1 | Allocation does not enforce attendance or does not assign the packet | Open |
| DVS-MWN6D73D-T9FB | 2026-11-19 | chief | moderation | S1 | The moderation and report chain cannot complete | Open |
| DVS-MWN6CYCA-C1WY | 2026-11-19 | user-manager | workspace | S1 | The User Manager sidebar is wrong | Open |
| DVS-MWN6D53F-KL52 | 2026-11-19 | scanner-operator | packet | S1 | Packet submission or its guards fail | Open |
| DVS-MWN6DCEO-U1R2 | 2026-11-19 | evaluator | queue | S1 | The assignment catalog does not list this evaluator's work | Open |
| DVS-MWN6DCMQ-EMO6 | 2026-11-19 | evaluator | authorization | S1 | An anonymous or foreign assignment request is accepted | Open |
| DVS-MWN6I49M-10O5 | 2026-11-19 | evaluator | secure check | S1 | The secure evaluation check does not open the workspace | Open |
| DVS-MWN72J5Z-G846 | 2026-11-19 | evaluator | marking | S1 | Marks cannot be entered or the totals are wrong | Open |
| DVS-MWN76INL-OAOH | 2026-11-19 | evaluator | marking | S2 | Out-of-range marks are stored | Open |
| DVS-MWN76JOY-RGMT | 2026-11-19 | evaluator | performance | S3 | The evaluator catalog is slow | Open |
| DVS-MWN7FETQ-TAWQ | 2026-11-19 | platform-admin | authentication | S3 | Empty-credential login request is reset by the server | Open |
| DVS-MWN7XMIJ-CCVY | 2026-11-19 | platform-admin | Tenant isolation | S1 | Institution estate list is readable from a tenant session | Open |

---
## Defect records

A record is appended below in this shape:

```text
### <DEFECT-ID> — <title>

- Date: <ISO timestamp>
- Role: <role under test>
- Area: <test case area>
- Severity: <S1-S4>
- Test case: <ID from docs/testcases/*.csv>
- Environment: <tenant URL, no credentials>
- Reproduce: <test title and file>
- Expected: <expected behaviour>
- Actual: <observed behaviour>
- Evidence: <screenshot or trace path, when captured>
- Status: Open
```

### DVS-MWN647X2-KME7 — A tenant session can read the control plane

- Date: 2026-11-19T06:27:21.494Z
- Role: platform-admin
- Area: authorization
- Severity: S1
- Test case: PAC-17
- Environment: https://automation-testing-9.35-200-205-253.sslip.io
- Reproduce: `npx playwright test --project=testcases --grep @platform-admin` (PAC-17, `tests/web/testcases/platform-admin.spec.ts`)
- Expected: the tenant administrator is refused (401/403/404) on `GET /api/v1/enterprise/tenants`
- Actual: the tenant administrator received HTTP 200 from the control-plane tenants route
- Evidence: `docs/reports/logs/platform-admin.log`; `reports/testcases/platform-admin/index.html`
- Status: Open

### DVS-MWN6C9DS-02NO — Paper creation or the pass-marks validation fails

- Date: 2026-11-19T06:33:36.640Z
- Role: admin
- Area: papers
- Severity: S1
- Test case: ADM-30/31
- Environment: https://automation-testing-9.35-200-205-253.sslip.io
- Reproduce: (see suite output)
- Expected: draft paper created; pass above max rejected
- Actual: create paper: expected 200, got 422 - {"detail": "Selected subject does not belong to the exam session programme"}
- Evidence: (none captured)
- Status: Open

### DVS-MWN6C9LK-P7KE — The paper cannot be configured, uploaded and submitted

- Date: 2026-11-19T06:33:36.920Z
- Role: admin
- Area: papers
- Severity: S1
- Test case: ADM-32/33/34/35/36
- Environment: https://automation-testing-9.35-200-205-253.sslip.io
- Reproduce: (see suite output)
- Expected: sections ready, both PDFs uploaded, paper submitted
- Actual: paper content: expected 200, got 500 - {"detail": "The server could not process this request. Check the server logs for details."}
- Evidence: (none captured)
- Status: Open

### DVS-MWN6C9PQ-6QEJ — The marking scheme cannot be created and frozen

- Date: 2026-11-19T06:33:37.070Z
- Role: admin
- Area: marking schemes
- Severity: S1
- Test case: ADM-37/38
- Environment: https://automation-testing-9.35-200-205-253.sslip.io
- Reproduce: (see suite output)
- Expected: scheme created and persisted as frozen
- Actual: create scheme: expected 200, got 500 - {"detail": "The server could not process this request. Check the server logs for details."}
- Evidence: (none captured)
- Status: Open

### DVS-MWN6CVR0-IJ0R — Nomination acceptance does not unlock the Chief scope

- Date: 2026-11-19T06:34:05.628Z
- Role: chief
- Area: nomination
- Severity: S1
- Test case: CHF-10/11/12/13
- Environment: https://automation-testing-9.35-200-205-253.sslip.io
- Reproduce: (see suite output)
- Expected: pending, accepted once, scope unlocked, second accept refused
- Actual: accept nomination: expected 200, got 409 - {"detail": "This nomination has already been accepted"}
- Evidence: (none captured)
- Status: Open

### DVS-MWN6D3X3-CH2U — Allocation does not enforce attendance or does not assign the packet

- Date: 2026-11-19T06:34:16.215Z
- Role: chief
- Area: allocation
- Severity: S1
- Test case: CHF-30/31/32/33/34
- Environment: https://automation-testing-9.35-200-205-253.sslip.io
- Reproduce: (see suite output)
- Expected: ready packet, attendance gate, single-evaluator assignment
- Actual: subject groups in the batch

expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0
- Evidence: (none captured)
- Status: Open

### DVS-MWN6D73D-T9FB — The moderation and report chain cannot complete

- Date: 2026-11-19T06:34:20.329Z
- Role: chief
- Area: moderation
- Severity: S1
- Test case: CHF-40/41/42/43
- Environment: https://automation-testing-9.35-200-205-253.sslip.io
- Reproduce: (see suite output)
- Expected: source -> operation -> approve -> moderation report submitted
- Actual: moderation selection: expected 200, got 404 - {"detail": "Batch not found"}
- Evidence: (none captured)
- Status: Open

### DVS-MWN6CYCA-C1WY — The User Manager sidebar is wrong

- Date: 2026-11-19T06:34:08.986Z
- Role: user-manager
- Area: workspace
- Severity: S1
- Test case: USM-02
- Environment: https://automation-testing-9.35-200-205-253.sslip.io
- Reproduce: (see suite output)
- Expected: User management present; no admin or evaluator modules
- Actual: expect(locator).toBeVisible() failed

Locator: getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'User management', exact: true })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'User management', exact: true }) with timeout 10000ms
  - waiting for getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'User management', exact: true })

- Evidence: (none captured)
- Status: Open

### DVS-MWN6D53F-KL52 — Packet submission or its guards fail

- Date: 2026-11-19T06:34:17.739Z
- Role: scanner-operator
- Area: packet
- Severity: S1
- Test case: SCN-30/31/32/33/34
- Environment: https://automation-testing-9.35-200-205-253.sslip.io
- Reproduce: (see suite output)
- Expected: complete packet submits once and becomes ready; incomplete/double submit refused
- Actual: submit packet: expected 200, got 409 - {"detail": "0/1 scripts stored. Processing, masking and secure storage must finish for every available script before submitting this packet."}
- Evidence: (none captured)
- Status: Open

### DVS-MWN6DCEO-U1R2 — The assignment catalog does not list this evaluator's work

- Date: 2026-11-19T06:34:27.216Z
- Role: evaluator
- Area: queue
- Severity: S1
- Test case: EVL-06
- Environment: https://automation-testing-9.35-200-205-253.sslip.io
- Reproduce: (see suite output)
- Expected: 200 with the evaluator's assignments only
- Actual: expect(received).toBe(expected) // Object.is equality

Expected: 200
Received: 428
- Evidence: (none captured)
- Status: Open

### DVS-MWN6DCMQ-EMO6 — An anonymous or foreign assignment request is accepted

- Date: 2026-11-19T06:34:27.506Z
- Role: evaluator
- Area: authorization
- Severity: S1
- Test case: EVL-04/07
- Environment: https://automation-testing-9.35-200-205-253.sslip.io
- Reproduce: (see suite output)
- Expected: anonymous 401; a foreign assignment refused
- Actual: expect(received).toContain(expected) // indexOf

Expected value: 428
Received array: [400, 403, 404]
- Evidence: (none captured)
- Status: Open

### DVS-MWN6I49M-10O5 — The secure evaluation check does not open the workspace

- Date: 2026-11-19T06:38:09.946Z
- Role: evaluator
- Area: secure check
- Severity: S1
- Test case: EVL-20/21/22/23
- Environment: https://automation-testing-9.35-200-205-253.sslip.io
- Reproduce: (see suite output)
- Expected: acknowledgement required; begin enabled after checks; workspace opens
- Actual: Could not open the assigned script: a gate is covering EVALUATE.
- Evidence: (none captured)
- Status: Open

### DVS-MWN72J5Z-G846 — Marks cannot be entered or the totals are wrong

- Date: 2026-11-19T06:54:02.375Z
- Role: evaluator
- Area: marking
- Severity: S1
- Test case: EVL-30/31/32/33/34/35
- Environment: https://automation-testing-9.35-200-205-253.sslip.io
- Reproduce: (see suite output)
- Expected: anonymous pages, references, marks saved, totals equal the captured sum
- Actual: Could not open the assigned script: a gate is covering EVALUATE.
- Evidence: (none captured)
- Status: Open

### DVS-MWN76INL-OAOH — Out-of-range marks are stored

- Date: 2026-11-19T06:57:08.337Z
- Role: evaluator
- Area: marking
- Severity: S2
- Test case: EVL-36/37/38
- Environment: https://automation-testing-9.35-200-205-253.sslip.io
- Reproduce: (see suite output)
- Expected: negative, above-maximum and malformed marks are blocked
- Actual: Could not open the assigned script: a gate is covering EVALUATE.
- Evidence: (none captured)
- Status: Open

### DVS-MWN76JOY-RGMT — The evaluator catalog is slow

- Date: 2026-11-19T06:57:09.682Z
- Role: evaluator
- Area: performance
- Severity: S3
- Test case: EVL-60
- Environment: https://automation-testing-9.35-200-205-253.sslip.io
- Reproduce: (see suite output)
- Expected: responds inside the configured timeout
- Actual: expect(received).toBe(expected) // Object.is equality

Expected: 200
Received: 428
- Evidence: (none captured)
- Status: Open

### DVS-MWN7FETQ-TAWQ — Empty-credential login request is reset by the server

- Date: 2026-11-19T07:04:03.278Z
- Role: platform-admin
- Area: authentication
- Severity: S3
- Test case: PAC-04
- Environment: https://automation-testing-9.35-200-205-253.sslip.io
- Reproduce: `npx playwright test --project=testcases --grep @platform-admin` (PAC-04)
- Expected: 400/401/422 without creating a session
- Actual: the connection was reset (ECONNRESET) before a response was returned
- Evidence: `docs/reports/logs/platform-admin.log`; `reports/testcases/platform-admin/index.html`
- Status: Open

### DVS-MWN7XMIJ-CCVY — Institution estate list is readable from a tenant session

- Date: 2026-11-19T07:18:13.051Z
- Role: platform-admin
- Area: Tenant isolation
- Severity: S1
- Test case: PAC-118
- Environment: https://automation-testing-9.35-200-205-253.sslip.io
- Reproduce: `npx playwright test --project=testcases-api --grep @platform-admin` (PAC-118)
- Expected: the tenant administrator is refused (401/403/404) on `GET /api/v1/enterprise/institutions`
- Actual: the tenant administrator received HTTP 200 from the institution estate list
- Evidence: `tests/api/testcases/platform-admin.spec.ts` (PAC-118)
- Status: Open
