import "dotenv/config";
import { expect, test } from "@playwright/test";
import { runCase } from "../../../utils/caseRunner";
import { executeQuery, type DbEngine, dbConfig } from "../../../utils/dbClient";

type Row = Record<string, unknown>;

const scalar = async (sql: string, params: readonly unknown[] = []): Promise<number> => {
  const rows = await executeQuery<Row>(sql, params);
  return Number(rows[0]?.c ?? 0);
};

test.describe("University Admin database test cases", () => {
  test.describe.configure({ mode: "serial" });

  let engine: DbEngine = "sqlite";
  let tenantId = "";
  let dbReady = false;

  test.beforeAll(async () => {
    try {
      const config = dbConfig();
      engine = config.engine;
      dbReady = true;
    } catch {
      dbReady = false;
      return;
    }

    const explicit = process.env.DVS_TENANT_ID?.trim();
    if (explicit) {
      const known = await executeQuery<Row>(
        `SELECT tenant_id FROM tenancy_institution WHERE tenant_id = ? LIMIT 1`,
        [explicit],
      );
      if (known.length > 0) {
        tenantId = explicit;
        return;
      }
    }
    const rows = await executeQuery<Row>(
      `SELECT tenant_id FROM tenancy_institution
       WHERE kind = ? AND is_active
       ORDER BY created_at
       LIMIT 1`,
      ["university"],
    );
    tenantId = String(rows[0]?.tenant_id ?? "");
  });

  test.beforeEach(() => {
    test.skip(!dbReady, "Database credentials are not configured (DB_HOST / DB_NAME).");
    test.skip(!tenantId, "No active university tenant in the database.");
  });

  test("ADM-120 academic chain keeps every foreign key @admin @testcase @db", async () => {
    await runCase(
      "ADM-120",
      {
        title: "Academic chain has orphan or cross-tenant rows",
        expected: "every programme, regulation, year, session, course and subject resolves inside the tenant",
      },
      async () => {
        expect(["sqlite", "postgresql"]).toContain(engine);
        expect(
          await scalar(`SELECT count(*) AS c FROM configuration_programme WHERE tenant_id = ?`, [tenantId]),
          "programmes",
        ).toBeGreaterThan(0);

        const checks: Array<[string, string]> = [
          [
            "programmes with a missing regulation",
            `SELECT count(*) AS c FROM configuration_programme p
             LEFT JOIN configuration_regulation r ON r.id = p.regulation_record_id
             WHERE p.tenant_id = ? AND p.regulation_record_id IS NOT NULL AND r.id IS NULL`,
          ],
          [
            "programmes linked to another tenant's regulation",
            `SELECT count(*) AS c FROM configuration_programme p
             JOIN configuration_regulation r ON r.id = p.regulation_record_id
             WHERE p.tenant_id = ? AND r.tenant_id <> p.tenant_id`,
          ],
          [
            "subjects with a missing programme or a non-null course that does not exist",
            `SELECT count(*) AS c FROM configuration_subject s
             LEFT JOIN configuration_programme p ON p.id = s.programme_id
             LEFT JOIN configuration_course c ON c.id = s.course_id
             WHERE s.tenant_id = ? AND (p.id IS NULL OR (s.course_id IS NOT NULL AND c.id IS NULL))`,
          ],
          [
            "sessions with a missing programme",
            `SELECT count(*) AS c FROM configuration_examsession s
             LEFT JOIN configuration_programme p ON p.id = s.programme_id
             WHERE s.tenant_id = ? AND s.programme_id IS NOT NULL AND p.id IS NULL`,
          ],
          [
            "papers with a missing subject or session",
            `SELECT count(*) AS c FROM configuration_paper p
             LEFT JOIN configuration_subject s ON s.id = p.subject_id
             LEFT JOIN configuration_examsession x ON x.id = p.session_id
             WHERE p.tenant_id = ? AND (s.id IS NULL OR x.id IS NULL)`,
          ],
        ];

        for (const [label, sql] of checks) {
          expect(await scalar(sql, [tenantId]), label).toBe(0);
        }
      },
    );
  });

  test("ADM-121 paper version, status and documents persist @admin @testcase @db", async () => {
    await runCase(
      "ADM-121",
      {
        title: "Paper version, status or documents are incomplete",
        expected: "a paper with a valid version/status and both document kinds",
      },
      async () => {
        expect(
          await scalar(`SELECT count(*) AS c FROM configuration_paper WHERE tenant_id = ?`, [tenantId]),
          "papers",
        ).toBeGreaterThan(0);

        expect(
          await scalar(
            `SELECT count(*) AS c FROM configuration_paper
             WHERE tenant_id = ? AND (version < 1 OR status IS NULL OR trim(status) = ''
               OR max_marks <= 0 OR pass_marks < 0 OR pass_marks > max_marks)`,
            [tenantId],
          ),
          "papers with invalid version/status/marks",
        ).toBe(0);

        const documents = await scalar(
          `SELECT count(*) AS c FROM configuration_paperdocument WHERE tenant_id = ?`,
          [tenantId],
        );
        // The SQLite reference snapshot may omit binary documents; when documents
        // exist, require at least one paper to carry both required kinds.
        if (documents > 0) {
          const documented = await scalar(
            `SELECT count(*) AS c FROM (
               SELECT p.id
               FROM configuration_paper p
               JOIN configuration_paperdocument d ON d.paper_id = p.id
               WHERE p.tenant_id = ?
               GROUP BY p.id
               HAVING count(DISTINCT d.kind) >= 2
             ) documented`,
            [tenantId],
          );
          expect(documented, "papers with question paper and evaluation scheme").toBeGreaterThan(0);
        }
      },
    );
  });

  test("ADM-122 centre readiness and activation persist @admin @testcase @db", async () => {
    await runCase(
      "ADM-122",
      {
        title: "Centre readiness or activation is not persisted",
        expected: "an active centre with a go readiness decision and a valid version",
      },
      async () => {
        expect(
          await scalar(
            `SELECT count(*) AS c FROM phase4_centreprofile
             WHERE tenant_id = ? AND status = ? AND version >= 1`,
            [tenantId, "active"],
          ),
          "active centres",
        ).toBeGreaterThan(0);

        expect(
          await scalar(
            `SELECT count(*) AS c FROM phase4_centrereadiness
             WHERE tenant_id = ? AND decision = ?`,
            [tenantId, "go"],
          ),
          "go readiness records",
        ).toBeGreaterThan(0);

        expect(
          await scalar(
            `SELECT count(*) AS c FROM phase4_centreprofile c
             LEFT JOIN phase4_centrereadiness r ON r.centre_id = c.id
             WHERE c.tenant_id = ? AND c.status = ? AND r.id IS NULL`,
            [tenantId, "active"],
          ),
          "active centres without a readiness record",
        ).toBe(0);
      },
    );
  });

  test("ADM-123 evaluation policy values persist with one version per save @admin @testcase @db", async () => {
    await runCase(
      "ADM-123",
      {
        title: "Evaluation policy is missing or its values are out of range",
        expected: "one policy row per tenant with a valid version and persisted values",
      },
      async () => {
        expect(
          await scalar(`SELECT count(*) AS c FROM security_securitypolicy WHERE tenant_id = ?`, [tenantId]),
          "policy rows",
        ).toBe(1);

        expect(
          await scalar(
            `SELECT count(*) AS c FROM security_securitypolicy
             WHERE tenant_id = ? AND (version < 1 OR session_timeout_minutes <= 0
               OR maximum_concurrent_sessions < 1 OR step_up_minutes < 0
               OR failed_login_limit < 1 OR lockout_minutes < 1)`,
            [tenantId],
          ),
          "policy rows with invalid values",
        ).toBe(0);

        expect(
          await scalar(
            `SELECT count(*) AS c FROM security_securitypolicy
             WHERE tenant_id = ? AND evaluation_camera_required NOT IN (0, 1)`,
            [tenantId],
          ),
          "policies with a non-boolean camera flag",
        ).toBe(0);
      },
    );
  });
});
