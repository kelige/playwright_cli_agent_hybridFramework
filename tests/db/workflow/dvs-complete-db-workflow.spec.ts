import "dotenv/config";
import { test, expect } from "@playwright/test";
import { dbConfig, executeQuery, type DbEngine } from "../../../utils/dbClient";

type Row = Record<string, unknown>;

const asNumber = (value: unknown): number => Number(value ?? 0);

async function scalar(sql: string, params: readonly unknown[] = []): Promise<number> {
  const rows = await executeQuery<Row>(sql, params);
  return asNumber(rows[0]?.c);
}

async function expectZero(sql: string, params: readonly unknown[], label: string): Promise<void> {
  expect(await scalar(sql, params), label).toBe(0);
}

const REQUIRED_TABLES = [
  "auth_user",
  "tenancy_membership",
  "tenancy_institution",
  "tenancy_tenantaccount",
  "configuration_programme",
  "configuration_regulation",
  "configuration_academicyear",
  "configuration_term",
  "configuration_examsession",
  "configuration_course",
  "configuration_subject",
  "configuration_paper",
  "configuration_paperdocument",
  "configuration_question",
  "evaluators_evaluator",
  "evaluators_expertise",
  "allocation_assignment",
  "allocation_evaluationbatch",
  "marking_evaluation",
  "marking_questionmark",
  "custody_script",
  "repository_scriptasset",
  "scanning_scanbatch",
  "receiving_packet",
  "security_securitypolicy",
  "core_auditevent",
  "phase4_attendancerecord",
] as const;

test.describe("DVS complete DB workflow @smoke @master @db", () => {
  test.describe.configure({ mode: "serial" });

  let engine: DbEngine;
  let tenantId = "";

  test.beforeAll(async () => {
    const config = dbConfig();
    engine = config.engine;

    const explicitTenant = process.env.DVS_TENANT_ID?.trim();
    if (explicitTenant) {
      // DVS_TENANT_ID is written for the live API run and may not exist in this
      // database snapshot. Use it only when the snapshot actually contains it.
      const present = await executeQuery<Row>(
        `SELECT 1 AS ok FROM tenancy_institution WHERE tenant_id = ? LIMIT 1`,
        [explicitTenant],
      );
      if (present.length > 0) {
        tenantId = explicitTenant;
        return;
      }
      console.log(
        `DVS_TENANT_ID ${explicitTenant} is not in this database; using the first active university instead.`,
      );
    }

    const rows = await executeQuery<Row>(
      `SELECT tenant_id FROM tenancy_institution
       WHERE kind = ? AND is_active
       ORDER BY created_at
       LIMIT 1`,
      ["university"],
    );
    tenantId = String(rows[0]?.tenant_id ?? "");
    test.skip(!tenantId, "No active university institution in the database.");
  });

  test("1) connection, engine and schema inventory @smoke @sanity", async () => {
    await test.step("1) engine is a supported read-only engine", () => {
      expect(["sqlite", "postgresql"]).toContain(engine);
    });

    await test.step("2) every required workflow table is queryable", async () => {
      for (const table of REQUIRED_TABLES) {
        const rows = await executeQuery<Row>(`SELECT 1 AS ok FROM ${table} LIMIT 1`);
        expect(Array.isArray(rows), `table ${table}`).toBe(true);
      }
    });

    await test.step("3) tenant scope resolves to an active institution", async () => {
      expect(tenantId).not.toBe("");
      const institutions = await executeQuery<Row>(
        `SELECT id, tenant_id, kind, is_active FROM tenancy_institution
         WHERE tenant_id = ? AND kind = ? AND is_active`,
        [tenantId, "university"],
      );
      expect(institutions.length).toBeGreaterThan(0);

      const account = await executeQuery<Row>(
        `SELECT a.status, a.root_institution_id
         FROM tenancy_tenantaccount a
         JOIN tenancy_institution i ON i.id = a.root_institution_id
         WHERE i.tenant_id = ?`,
        [tenantId],
      );
      expect(account.length).toBeGreaterThan(0);
      expect(String(account[0].status)).toBe("active");
    });
  });

  test("2) identity and tenancy workflow @sanity", async () => {
    await test.step("1) one active university_admin membership exists", async () => {
      const admins = await executeQuery<Row>(
        `SELECT u.email, m.role, m.is_active, m.must_change_password, m.institution_id
         FROM auth_user u
         JOIN tenancy_membership m ON m.user_id = u.id
         WHERE m.role = ? AND m.is_active`,
        ["university_admin"],
      );
      expect(admins.length).toBeGreaterThan(0);
      for (const admin of admins) {
        expect(String(admin.email)).toContain("@");
        expect(Boolean(admin.is_active)).toBe(true);
        expect(Boolean(admin.must_change_password)).toBe(false);
      }
    });

    await test.step("2) every membership points at a real institution", async () => {
      await expectZero(
        `SELECT count(*) AS c
         FROM tenancy_membership m
         LEFT JOIN tenancy_institution i ON i.id = m.institution_id
         WHERE m.institution_id IS NOT NULL AND i.id IS NULL`,
        [],
        "memberships with a missing institution",
      );
      await expectZero(
        `SELECT count(*) AS c FROM tenancy_membership m
         JOIN tenancy_institution i ON i.id = m.institution_id
         WHERE i.tenant_id <> ?`,
        [tenantId],
        "memberships linked to another tenant's institution",
      );
    });

    await test.step("3) role values are non-empty and membership keys are unique", async () => {
      await expectZero(
        `SELECT count(*) AS c FROM tenancy_membership WHERE role IS NULL OR trim(role) = ''`,
        [],
        "memberships without a role",
      );
      await expectZero(
        `SELECT count(*) AS c FROM (
           SELECT user_id, institution_id, role, count(*) AS n
           FROM tenancy_membership
           GROUP BY user_id, institution_id, role
           HAVING count(*) > 1
         ) duplicates`,
        [],
        "duplicate memberships for the same user/role",
      );
    });
  });

  test("3) academic configuration chain @sanity @regression", async () => {
    await test.step("1) programme, regulation, year and term rows are tenant-scoped", async () => {
      expect(await scalar(`SELECT count(*) AS c FROM configuration_programme WHERE tenant_id = ?`, [tenantId])).toBeGreaterThan(0);
      await expectZero(
        `SELECT count(*) AS c FROM configuration_programme WHERE tenant_id <> ? OR trim(code) = ''`,
        [tenantId],
        "programmes outside the tenant or without a code",
      );
      await expectZero(
        `SELECT count(*) AS c FROM configuration_academicyear WHERE tenant_id <> ? OR trim(label) = ''`,
        [tenantId],
        "academic years outside the tenant or without a label",
      );
      await expectZero(
        `SELECT count(*) AS c FROM configuration_term t
         LEFT JOIN configuration_academicyear ay ON ay.id = t.academic_year_id
         WHERE t.tenant_id <> ? OR ay.id IS NULL OR ay.tenant_id <> t.tenant_id`,
        [tenantId],
        "terms with a missing or cross-tenant academic year",
      );
    });

    await test.step("2) programme correctly links to its regulation", async () => {
      await expectZero(
        `SELECT count(*) AS c FROM configuration_programme p
         LEFT JOIN configuration_regulation r ON r.id = p.regulation_record_id
         WHERE p.tenant_id = ? AND p.regulation_record_id IS NOT NULL AND r.id IS NULL`,
        [tenantId],
        "programmes with a missing regulation",
      );
      await expectZero(
        `SELECT count(*) AS c FROM configuration_programme p
         JOIN configuration_regulation r ON r.id = p.regulation_record_id
         WHERE p.tenant_id = ? AND r.tenant_id <> p.tenant_id`,
        [tenantId],
        "programmes linked to another tenant's regulation",
      );
      await expectZero(
        `SELECT count(*) AS c FROM (
           SELECT tenant_id, code FROM configuration_programme
           GROUP BY tenant_id, code HAVING count(*) > 1
         ) duplicates`,
        [],
        "duplicate programme codes within a tenant",
      );
    });

    await test.step("3) course, subject, session and paper parents resolve inside the tenant", async () => {
      const subjectParents = await executeQuery<Row>(
        `SELECT s.id, s.programme_id, s.course_id, p.tenant_id AS programme_tenant, c.tenant_id AS course_tenant
         FROM configuration_subject s
         LEFT JOIN configuration_programme p ON p.id = s.programme_id
         LEFT JOIN configuration_course c ON c.id = s.course_id
         WHERE s.tenant_id = ?`,
        [tenantId],
      );
      expect(subjectParents.length).toBeGreaterThan(0);
      for (const subject of subjectParents) {
        if (subject.programme_id) expect(subject.programme_tenant).toBe(tenantId);
        if (subject.course_id) expect(subject.course_tenant).toBe(tenantId);
      }

      await expectZero(
        `SELECT count(*) AS c FROM configuration_examsession s
         LEFT JOIN configuration_programme p ON p.id = s.programme_id
         WHERE s.tenant_id = ? AND s.programme_id IS NOT NULL AND p.id IS NULL`,
        [tenantId],
        "exam sessions with a missing programme",
      );

      const papers = await executeQuery<Row>(
        `SELECT p.code, s.tenant_id AS subject_tenant, x.tenant_id AS session_tenant, x.id AS session_row
         FROM configuration_paper p
         LEFT JOIN configuration_subject s ON s.id = p.subject_id
         LEFT JOIN configuration_examsession x ON x.id = p.session_id
         WHERE p.tenant_id = ?`,
        [tenantId],
      );
      expect(papers.length).toBeGreaterThan(0);
      for (const paper of papers) {
        expect(String(paper.code)).not.toBe("");
        expect(paper.subject_tenant, `paper ${paper.code} subject tenant`).toBe(tenantId);
        if (paper.session_row) expect(paper.session_tenant).toBe(tenantId);
      }
    });
  });

  test("4) paper, questions and documents workflow @sanity @regression", async () => {
    await test.step("1) marks and valuation rounds are sane", async () => {
      await expectZero(
        `SELECT count(*) AS c FROM configuration_paper
         WHERE tenant_id = ? AND (max_marks <= 0 OR pass_marks < 0 OR pass_marks > max_marks OR valuation_rounds < 1)`,
        [tenantId],
        "papers with invalid marks or rounds",
      );
    });

    await test.step("2) submitted papers carry a submission timestamp", async () => {
      await expectZero(
        `SELECT count(*) AS c FROM configuration_paper
         WHERE tenant_id = ? AND status IN ('frozen', 'submitted', 'approved') AND submitted_at IS NULL`,
        [tenantId],
        "submitted papers without a submitted_at value",
      );
    });

    await test.step("3) questions belong to a paper in the same tenant", async () => {
      await expectZero(
        `SELECT count(*) AS c FROM configuration_question q
         LEFT JOIN configuration_paper p ON p.id = q.paper_id
         WHERE q.tenant_id = ? AND (p.id IS NULL OR p.tenant_id <> q.tenant_id)`,
        [tenantId],
        "questions with a missing or cross-tenant paper",
      );
      await expectZero(
        `SELECT count(*) AS c FROM configuration_question q
         JOIN configuration_paper p ON p.id = q.paper_id
         WHERE q.tenant_id = ? AND q.max_marks > p.max_marks`,
        [tenantId],
        "questions marked above the paper maximum",
      );
      await expectZero(
        `SELECT count(*) AS c FROM configuration_paper p
         WHERE p.tenant_id = ? AND p.status = 'frozen'
           AND NOT EXISTS (SELECT 1 FROM configuration_question q WHERE q.paper_id = p.id)`,
        [tenantId],
        "frozen papers without questions",
      );
    });

    await test.step("4) paper documents point at a paper in the same tenant", async () => {
      await expectZero(
        `SELECT count(*) AS c FROM configuration_paperdocument d
         LEFT JOIN configuration_paper p ON p.id = d.paper_id
         WHERE p.id IS NULL OR p.tenant_id <> ?`,
        [tenantId],
        "paper documents with a missing or cross-tenant paper",
      );
    });
  });

  test("5) evaluator profile and expertise workflow @sanity @regression", async () => {
    await test.step("1) evaluator codes are unique and identity fields are present", async () => {
      await expectZero(
        `SELECT count(*) AS c FROM (
           SELECT tenant_id, evaluator_code FROM evaluators_evaluator
           GROUP BY tenant_id, evaluator_code HAVING count(*) > 1
         ) duplicates`,
        [],
        "duplicate evaluator codes within a tenant",
      );
      await expectZero(
        `SELECT count(*) AS c FROM evaluators_evaluator
         WHERE tenant_id = ? AND (trim(display_name) = '' OR trim(email) = '' OR status IS NULL)`,
        [tenantId],
        "evaluators missing a name, email or status",
      );
    });

    await test.step("2) evaluator logins resolve to auth_user when linked", async () => {
      await expectZero(
        `SELECT count(*) AS c FROM evaluators_evaluator e
         LEFT JOIN auth_user u ON u.id = e.user_id
         WHERE e.tenant_id = ? AND e.user_id IS NOT NULL AND u.id IS NULL`,
        [tenantId],
        "evaluators linked to a missing auth_user",
      );
    });

    await test.step("3) expertise rows reference same-tenant evaluators and subjects", async () => {
      await expectZero(
        `SELECT count(*) AS c FROM evaluators_expertise x
         LEFT JOIN evaluators_evaluator e ON e.id = x.evaluator_id
         LEFT JOIN configuration_subject s ON s.id = x.subject_id
         WHERE x.tenant_id = ? AND (e.id IS NULL OR s.id IS NULL OR e.tenant_id <> x.tenant_id OR s.tenant_id <> x.tenant_id)`,
        [tenantId],
        "expertise rows with a missing or cross-tenant parent",
      );
      await expectZero(
        `SELECT count(*) AS c FROM (
           SELECT evaluator_id, subject_id FROM evaluators_expertise
           GROUP BY evaluator_id, subject_id HAVING count(*) > 1
         ) duplicates`,
        [],
        "duplicate evaluator/subject expertise rows",
      );
    });
  });

  test("6) allocation and marking workflow @regression", async () => {
    await test.step("1) assignments reference same-tenant evaluators and real scripts", async () => {
      await expectZero(
        `SELECT count(*) AS c FROM allocation_assignment a
         LEFT JOIN evaluators_evaluator e ON e.id = a.evaluator_id
         LEFT JOIN custody_script s ON s.id = a.script_id
         WHERE a.tenant_id = ? AND (e.id IS NULL OR s.id IS NULL OR e.tenant_id <> a.tenant_id OR s.tenant_id <> a.tenant_id)`,
        [tenantId],
        "assignments with a missing or cross-tenant evaluator/script",
      );
      await expectZero(
        `SELECT count(*) AS c FROM (
           SELECT batch_id, script_id, valuation_round FROM allocation_assignment
           GROUP BY batch_id, script_id, valuation_round HAVING count(*) > 1
         ) duplicates`,
        [],
        "duplicate assignments for the same batch/script/round",
      );
      await expectZero(
        `SELECT count(*) AS c FROM allocation_assignment
         WHERE tenant_id = ? AND status IN ('submitted', 'completed') AND submitted_at IS NULL`,
        [tenantId],
        "completed assignments without a submitted_at value",
      );
    });

    await test.step("2) each assignment has at most one evaluation", async () => {
      await expectZero(
        `SELECT count(*) AS c FROM marking_evaluation e
         LEFT JOIN allocation_assignment a ON a.id = e.assignment_id
         WHERE e.tenant_id = ? AND (a.id IS NULL OR a.tenant_id <> e.tenant_id)`,
        [tenantId],
        "evaluations with a missing or cross-tenant assignment",
      );
      await expectZero(
        `SELECT count(*) AS c FROM (
           SELECT assignment_id FROM marking_evaluation
           GROUP BY assignment_id HAVING count(*) > 1
         ) duplicates`,
        [],
        "multiple evaluations for one assignment",
      );
      await expectZero(
        `SELECT count(*) AS c FROM marking_evaluation
         WHERE tenant_id = ? AND status = 'submitted' AND submitted_at IS NULL`,
        [tenantId],
        "submitted evaluations without a submitted_at value",
      );
    });

    await test.step("3) question marks stay within the question maximum", async () => {
      await expectZero(
        `SELECT count(*) AS c FROM marking_questionmark m
         LEFT JOIN marking_evaluation e ON e.id = m.evaluation_id
         LEFT JOIN configuration_question q ON q.id = m.question_id
         WHERE m.tenant_id = ? AND (e.id IS NULL OR e.tenant_id <> m.tenant_id OR q.id IS NULL)`,
        [tenantId],
        "marks with a missing or cross-tenant evaluation/question",
      );
      await expectZero(
        `SELECT count(*) AS c FROM marking_questionmark m
         JOIN configuration_question q ON q.id = m.question_id
         WHERE m.tenant_id = ? AND (m.marks IS NULL OR m.marks < 0 OR m.marks > q.max_marks)`,
        [tenantId],
        "question marks outside the valid range",
      );
    });
  });

  test("7) scanning, repository and receiving workflow @regression", async () => {
    await test.step("1) stored pages have hashes and unique page numbers", async () => {
      await expectZero(
        `SELECT count(*) AS c FROM repository_scriptasset a
         LEFT JOIN custody_script s ON s.id = a.script_id
         WHERE a.tenant_id = ? AND (s.id IS NULL OR s.tenant_id <> a.tenant_id)`,
        [tenantId],
        "assets with a missing or cross-tenant script",
      );
      await expectZero(
        `SELECT count(*) AS c FROM repository_scriptasset
         WHERE tenant_id = ? AND (page_number < 1 OR byte_size <= 0 OR sha256 IS NULL OR length(sha256) <> 64)`,
        [tenantId],
        "assets missing a page number, size or SHA-256",
      );
      await expectZero(
        `SELECT count(*) AS c FROM (
           SELECT script_id, page_number FROM repository_scriptasset
           GROUP BY script_id, page_number HAVING count(*) > 1
         ) duplicates`,
        [],
        "duplicate page numbers for one script",
      );
    });

    await test.step("2) scan batches and received packets keep valid counters", async () => {
      await expectZero(
        `SELECT count(*) AS c FROM scanning_scanbatch b
         LEFT JOIN configuration_paper p ON p.id = b.paper_id
         WHERE b.tenant_id = ? AND (p.id IS NULL OR p.tenant_id <> b.tenant_id)`,
        [tenantId],
        "scan batches with a missing or cross-tenant paper",
      );
      await expectZero(
        `SELECT count(*) AS c FROM scanning_scanbatch
         WHERE tenant_id = ? AND (completed_scripts < 0 OR failed_scripts < 0 OR completed_scripts > expected_scripts)`,
        [tenantId],
        "scan batches with impossible counters",
      );
      await expectZero(
        `SELECT count(*) AS c FROM receiving_packet r
         LEFT JOIN configuration_paper p ON p.id = r.paper_id
         WHERE r.tenant_id = ? AND (p.id IS NULL OR p.tenant_id <> r.tenant_id)`,
        [tenantId],
        "packets with a missing or cross-tenant paper",
      );
      await expectZero(
        `SELECT count(*) AS c FROM receiving_packet
         WHERE tenant_id = ? AND (received_scripts < 0 OR expected_scripts < 0 OR received_scripts > expected_scripts)`,
        [tenantId],
        "packets with impossible script counters",
      );
    });
  });

  test("8) security policy persistence workflow @sanity @regression", async () => {
    await test.step("1) exactly one policy exists per tenant", async () => {
      expect(await scalar(`SELECT count(*) AS c FROM security_securitypolicy WHERE tenant_id = ?`, [tenantId])).toBe(1);
    });

    await test.step("2) policy values are within safe ranges", async () => {
      await expectZero(
        `SELECT count(*) AS c FROM security_securitypolicy
         WHERE tenant_id = ? AND (version < 1 OR session_timeout_minutes <= 0
           OR maximum_concurrent_sessions < 1 OR step_up_minutes < 0
           OR failed_login_limit < 1 OR failed_login_limit > 20 OR lockout_minutes < 1)`,
        [tenantId],
        "security policy values outside the expected range",
      );
    });

    await test.step("3) evaluation security flags are boolean-like", async () => {
      await expectZero(
        `SELECT count(*) AS c FROM security_securitypolicy
         WHERE tenant_id = ? AND (evaluation_camera_required NOT IN (0, 1)
           OR evaluation_fullscreen_required NOT IN (0, 1)
           OR evaluation_single_screen_required NOT IN (0, 1))`,
        [tenantId],
        "evaluation security flags with a non-boolean value",
      );
    });
  });

  test("9) audit trail workflow @regression", async () => {
    await test.step("1) every audit event is complete and tenant-scoped", async () => {
      const events = await executeQuery<Row>(
        `SELECT actor_id, action, aggregate_type, occurred_at FROM core_auditevent WHERE tenant_id = ?`,
        [tenantId],
      );
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(String(event.action)).not.toBe("");
        expect(String(event.aggregate_type)).not.toBe("");
        expect(event.occurred_at).not.toBeNull();
      }
      await expectZero(
        `SELECT count(*) AS c FROM core_auditevent WHERE tenant_id <> ?`,
        [tenantId],
        "audit events outside the workflow tenant",
      );
    });

    await test.step("2) audit actors resolve to an existing user", async () => {
      await expectZero(
        `SELECT count(*) AS c FROM core_auditevent e
         LEFT JOIN auth_user u ON u.id = e.actor_id
         WHERE e.tenant_id = ? AND e.actor_id IS NOT NULL AND u.id IS NULL`,
        [tenantId],
        "audit events with a missing actor",
      );
    });

    await test.step("3) the sign-in action was audited", async () => {
      expect(
        await scalar(
          `SELECT count(*) AS c FROM core_auditevent WHERE tenant_id = ? AND action = ?`,
          [tenantId, "auth.login.succeeded"],
        ),
      ).toBeGreaterThan(0);
    });
  });

  test("10) cross-tenant isolation summary @sanity @regression", async () => {
    const joins: Array<{ label: string; sql: string }> = [
      {
        label: "course → programme",
        sql: `SELECT count(*) AS c FROM configuration_course c
              JOIN configuration_programme p ON p.id = c.programme_id
              WHERE p.tenant_id <> c.tenant_id`,
      },
      {
        label: "subject → course",
        sql: `SELECT count(*) AS c FROM configuration_subject s
              JOIN configuration_course c ON c.id = s.course_id
              WHERE c.tenant_id <> s.tenant_id`,
      },
      {
        label: "paper → session",
        sql: `SELECT count(*) AS c FROM configuration_paper p
              JOIN configuration_examsession x ON x.id = p.session_id
              WHERE x.tenant_id <> p.tenant_id`,
      },
      {
        label: "attendance → evaluator",
        sql: `SELECT count(*) AS c FROM phase4_attendancerecord r
              JOIN evaluators_evaluator e ON e.id = r.evaluator_id
              WHERE e.tenant_id <> r.tenant_id`,
      },
      {
        label: "asset → script",
        sql: `SELECT count(*) AS c FROM repository_scriptasset a
              JOIN custody_script s ON s.id = a.script_id
              WHERE s.tenant_id <> a.tenant_id`,
      },
    ];

    for (const join of joins) {
      await test.step(join.label, async () => {
        expect(await scalar(join.sql), `${join.label} leaks across tenants`).toBe(0);
      });
    }

    await test.step("every tenant id on core records is known", async () => {
      await expectZero(
        `SELECT count(*) AS c FROM tenancy_institution i
         LEFT JOIN tenancy_tenantaccount a ON a.root_institution_id = i.id
         WHERE i.tenant_id = ? AND i.kind = 'university' AND a.id IS NULL`,
        [tenantId],
        "root university without a tenant account",
      );
    });
  });
});
