# Test Cases Run Summary

- Date: 2026-11-19T10:50:16.346Z
- Command: npm run testcases -- --role=platform-admin
- Roles run: platform-admin
- Roles passed: 0/1
- Tests: 24 passed, 2 failed, 0 skipped
- Defects this run: 2 (new bug records: 0)
- Total duration: 22s
- Cases covered: 228/1073 (21.2%)
- Automated: 207, Live/HITL: 21, Pending: 845

| Role | Status | Duration | Defects | HTML report | Dashboard | Log |
| --- | --- | --- | --- | --- | --- | --- |
| platform-admin | FAIL | 22s | 2 | [open](../../reports/testcases/platform-admin/index.html) | [open](../../custom-report/testcases/platform-admin/index.html) | [log](./logs/platform-admin.log) |

## Defects by role

### platform-admin: 2 defects

- [S1] DVS-MWNFHYJH-8EZ1 — Institution estate list is readable from a tenant session
- [S1] DVS-MWNFIAYD-HP25 — A tenant session can read the control plane

## Locations

- Bugs: docs/BUG_DVS.md
- Coverage: docs/reports/testcase-coverage.md / .json
- Pending cases: docs/reports/testcase-pending.csv
- Test cases: docs/testcases/DVS-TESTCASES.xlsx
- Playwright reports: reports/testcases/<role>/index.html
- Custom dashboards: custom-report/testcases/<role>/index.html
- JUnit: reports/testcases/<role>/results.xml
- Failure media: test-results/testcases/<role>/
