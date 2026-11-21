# BUG_DVS — Defect Log

### DVS-MWNFHYJH-8EZ1 — Institution estate list is readable from a tenant session

- Date: 2026-11-19T10:49:59.069Z
- Role: platform-admin
- Area: Tenant isolation
- Severity: S1
- Test case: PAC-118
- Environment: https://automation-testing-9.35-200-205-253.sslip.io
- Reproduce: (see suite output)
- Expected: 401/403/404 refusal
- Actual: expect(received).toContain(expected) // indexOf

Expected value: 200
Received array: [401, 403, 404]
- Evidence: (none captured)
- Status: Open

### DVS-MWNFIAYD-HP25 — A tenant session can read the control plane

- Date: 2026-11-19T10:50:15.157Z
- Role: platform-admin
- Area: authorization
- Severity: S1
- Test case: PAC-17
- Environment: https://automation-testing-9.35-200-205-253.sslip.io
- Reproduce: (see suite output)
- Expected: refused for a tenant administrator
- Actual: expect(received).toContain(expected) // indexOf

Expected value: 200
Received array: [401, 403, 404]
- Evidence: (none captured)
- Status: Open
