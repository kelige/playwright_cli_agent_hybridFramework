# DVS Utility Files — Exact Implementation Prompts

**Target folder:** `utils/`  
**Framework:** Existing Playwright + TypeScript DVS project.

## Common Requirements

For every prompt below:
- Inspect the existing `package.json`, `tsconfig.json`, module system and `utils/` folder first.
- Create/update only the requested file.
- Use existing dependencies already installed in the project.
- Do not add dependencies unless explicitly approved.
- Do not add extra methods, classes, interfaces, constants, validation, logging or behavior beyond each prompt.
- Preserve the exact class/function/method names and return structures specified.
- Use beginner-friendly TypeScript.
- Do not create additional files unless explicitly requested.
- Do not include real DVS credentials, student data, script content or confidential information.
- Return only the complete code for the requested file when implementing an individual prompt.

---

# 1. Create `helper.ts`

## Prompt

Create or update `utils/helper.ts`.

Create and export a class named `Helper` with exactly these static methods:

### 1.1 `getDvsTestRunId(): string`

- Generate a unique identifier suitable for a test run.
- Use a timestamp plus a short random suffix.
- Return a string.
- Do not use real university/student identifiers.

### 1.2 `getAcademicConfigurationData()`

Return exactly this object structure with clearly synthetic values:

- `programmeCode: "DVS-AUTO-BCA"`
- `programmeName: "Automation Test - Bachelor of Computer Applications"`
- `regulationCode: "DVS-AUTO-REG-01"`
- `regulationTitle: "Automation Test Regulation"`
- `academicYear: "2098-99"`
- `termName: "Semester 1"`
- `termSequence: 1`
- `examSessionName: "DVS Automation Session 01"`
- `courseCode: "DVS-AUTO-COURSE-01"`
- `courseName: "Automation Test Course"`

These are test-only labels, not real university configuration.

### 1.3 `getPaperConfigurationData()`

Return exactly this object structure:

- `paperCode: "DVS-AUTO-KAN001"`
- `paperTitle: "Automation Test Paper"`
- `subjectCode: "DVS-AUTO-SUB001"`
- `subjectName: "Automation Test Subject"`
- `maximumMarks: 100`
- `passingMarks: 35`
- `scriptsPerPacket: 2`
- `pagesPerScript: 4`

Use these values only for isolated synthetic test data. If the application requires different values, adapt the test data file rather than silently changing this helper contract.

### 1.4 `getRoleEnvironmentKey(role: string)`

- Return the environment variable names for the known role:
  - `admin` → `DVS_ADMIN_EMAIL`, `DVS_ADMIN_PASSWORD`
  - `chairman` → `DVS_CHAIRMAN_EMAIL`, `DVS_CHAIRMAN_PASSWORD`
  - `chief` → `DVS_CHIEF_EMAIL`, `DVS_CHIEF_PASSWORD`
  - `evaluator` → `DVS_EVALUATOR_EMAIL`, `DVS_EVALUATOR_PASSWORD`
  - `scanningOperator` → `DVS_SCANNING_OPERATOR_EMAIL`, `DVS_SCANNING_OPERATOR_PASSWORD`
- Return names only, not secret values.
- Do not invent credentials.
- Keep the return shape consistent for every role.

## Expected Result

`utils/helper.ts` exports `Helper` with the four exact static methods and only synthetic non-secret test values.

---

# 2. Create `dataGenerator.ts`

## Prompt

Create or update `utils/dataGenerator.ts`.

Use the existing `@faker-js/faker` dependency. Import Faker from:

`@faker-js/faker`

Create and export a class named `RandomDataUtil`.

Implement exactly these static methods:

## 2.1 Person / Test Account Data

- `getFirstName(): string`
- `getLastName(): string`
- `getFullName(): string`
- `getEmail(): string`
- `getPhoneNumber(): string`
- `getDepartment(): string`
- `getInstitutionName(): string`
- `getExperienceYears(): number`
- `getDailyCapacity(): number`

Use corresponding Faker person/company/phone APIs. Use a reserved test email domain or the team's approved test domain; do not generate an address that could belong to a real person. Do not create actual login credentials.

## 2.2 Academic / Examination Data

- `getProgrammeCode(): string`
- `getCourseCode(): string`
- `getSubjectCode(): string`
- `getPaperCode(): string`
- `getAcademicYear(): string`
- `getExamSessionName(): string`
- `getSubjectName(): string`
- `getPaperTitle(): string`

Use clear synthetic prefixes such as `DVS-AUTO`. Academic codes should be uppercase and stable in format. Do not use actual university identifiers.

## 2.3 Date and Time

- `getCurrentDate(): string`
- `getRecentDate(days: number = 10): string`
- `getFutureDate(years: number = 1): string`
- `getPastDate(years: number = 1): string`

Return ISO date format `YYYY-MM-DD`. Use date-fns/Luxon only if already installed; otherwise use native JavaScript Date methods. Do not add dependencies.

## 2.4 Script and Packet Data

- `getScriptId(): string`
- `getPacketReference(): string`
- `getTestRunReference(): string`
- `getPageCount(min: number = 1, max: number = 10): number`
- `getScriptsPerPacket(min: number = 1, max: number = 10): number`

Generate synthetic identifiers and bounded integers. Do not generate real student registration numbers or real answer-script IDs.

## 2.5 DVS Test Data Object Generators

Implement exactly these static methods:

- `generateAdminUserData()`
- `generateChairmanUserData()`
- `generateChiefProfileData()`
- `generateEvaluatorProfileData()`
- `generateAcademicConfigurationData()`
- `generateSubjectData()`
- `generatePaperData()`
- `generateScriptMetadata()`
- `generatePacketMetadata()`

Return structures must be based on the field names actually used by the existing DVS UI/API test data model. Before implementing:
1. Inspect existing DVS testdata files and project types.
2. If no field contract exists, use the following clearly synthetic neutral structures and do not claim they are backend API payloads.

`generateAdminUserData()`:
- `firstName`
- `lastName`
- `email`
- `role: "Admin"`

`generateChairmanUserData()`:
- `firstName`
- `lastName`
- `email`
- `role: "Chairman"`
- `programmeCode`

`generateChiefProfileData()`:
- `fullName`
- `email`
- `department`
- `institution`
- `dailyCapacity`
- `experienceYears`

`generateEvaluatorProfileData()`:
- `fullName`
- `email`
- `department`
- `institution`
- `dailyCapacity`
- `experienceYears`

`generateAcademicConfigurationData()`:
- `programmeCode`
- `programmeName`
- `regulationCode`
- `regulationTitle`
- `academicYear`
- `termName`
- `termSequence`
- `examSessionName`
- `courseCode`
- `courseName`

`generateSubjectData()`:
- `subjectCode`
- `subjectName`
- `courseCode`
- `semester`

`generatePaperData()`:
- `paperCode`
- `paperTitle`
- `subjectCode`
- `maximumMarks`
- `passingMarks`
- `scriptsPerPacket`
- `pagesPerScript`

`generateScriptMetadata()`:
- `scriptId`
- `paperCode`
- `pageCount`
- `testRunReference`

`generatePacketMetadata()`:
- `packetReference`
- `paperCode`
- `scriptIds`
- `testRunReference`

Use existing class methods instead of duplicating Faker logic.

## Expected Result

`utils/dataGenerator.ts` exports `RandomDataUtil` with the specified methods and synthetic DVS data generators. The generated objects are test data, not assumed API request bodies.

---

# 3. Create `DataReader.ts`

## Prompt

Create or update `utils/DataReader.ts`.

Use existing dependencies:
- `fs`
- `csv-parse`
- `xlsx`

Create and export a class named `DataProvider`.

Implement exactly these three static methods:

### 3.1 `readJson(filePath: string)`

- Read JSON using `fs.readFileSync(filePath, "utf8")`.
- Parse using `JSON.parse()`.
- Return parsed data.

### 3.2 `readCsv(filePath: string)`

- Read CSV using `fs.readFileSync(filePath)`.
- Parse using `parse()` from `csv-parse/sync`.
- Use:
  - `columns: true`
  - `skip_empty_lines: true`
- Return parsed data.

### 3.3 `readExcel(filePath: string)`

- Read workbook using `XLSX.readFile(filePath)`.
- Select first worksheet using `workbook.SheetNames[0]`.
- Get worksheet from `workbook.Sheets[sheetName]`.
- Convert with `XLSX.utils.sheet_to_json(worksheet, { header: 1 })`.
- Return resulting data.

Do not add other file formats, sheet-name parameters or additional methods.

## Expected Result

`utils/DataReader.ts` exports `DataProvider` with three static methods for JSON, CSV and Excel DVS test data.

---

# 4. Create `dbClient.ts` — Conditional

## Prompt

Do not create this file until the DVS team confirms database engine, version, connection details, driver dependency and approved access policy.

After confirmation:
1. Inspect existing dependencies.
2. Use the driver that matches the confirmed engine.
3. Read connection values from environment variables.
4. Prefer read-only access for test validation.
5. Use parameterized queries.
6. Close/release connection in a `finally` block.
7. Do not assume MySQL or copy the tutorial's `mysql2` connection values.
8. Do not add write helpers unless explicitly approved.
9. Do not add speculative table names or schema logic.

The exact function signature and driver must be selected only after the actual DVS database contract is provided.

## Expected Result

A DVS database helper is created only when the DB engine and approved access are known. If unknown, report blocked and do not create a fake client.

---

# 5. API Payload Generator — Conditional

Do not create API payload generators until the DVS API routes and request schemas are confirmed.

After API contract is supplied:
- Generate payloads only for verified request bodies.
- Match exact field names, types, required/optional properties and enum values.
- Keep secrets in environment variables.
- Use synthetic IDs only when the API contract allows caller-supplied IDs.
- Do not invent login, paper, script, allocation, marks or report payload structures.
- Create separate methods for valid and invalid payloads only when a specific endpoint contract exists.

## Expected Result

API payload helpers reflect the actual DVS API contract, not guessed shapes copied from FakeStore.

---

# Final Implementation Quality Criteria

Generated utilities must:
- Exist in `utils/` with exact requested filenames.
- Export exact class and method names.
- Match the required return structures.
- Reuse existing dependencies only.
- Use internal `RandomDataUtil` methods where applicable.
- Generate synthetic test data only.
- Never contain real credentials or real student/script data.
- Avoid extra logging or unrequested functionality.
- Leave DB/API utilities blocked until contracts are confirmed.
