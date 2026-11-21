import "dotenv/config";
import * as fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ApiSession, okJson, type Json } from "../../../utils/apiClient";
import { RouteBuilders, Routes } from "../../../api/endpoints/routes";
import { check } from "../../../utils/defectLog";
import { roleCredentials, signInRole } from "../../../utils/roleSignIn";

/**
 * Scanner Operator test cases — docs/testcases/06-scanner-operator.csv.
 * Signs in with the Scanner's own account; defects are recorded, not thrown.
 */

const scanner = roleCredentials("scanner_operator");
const tenant = (process.env.WEB_APP_URL ?? "").replace(/\/+$/, "");
const writes = process.env.DVS_ALLOW_WRITES === "true";

/** 1x1 PNG used as a synthetic scanned page. */
const PAGE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Reads the ids saved by the workflow. */
function runIds(): Record<string, string> {
  try {
    const state = JSON.parse(
      fs.readFileSync("playwright/.auth/dvs-run-state.json", "utf-8"),
    ) as { ids?: Record<string, string> };
    return state.ids ?? {};
  } catch {
    return {};
  }
}

test.describe("Scanner Operator test cases", () => {
  test.skip(!tenant, "Run `npm run test:platform` so the workflow provisions a university.");
  test.skip(!scanner.email || !scanner.password, "No Scanner account yet; run `npm run test:platform`.");

  test.use({ storageState: { cookies: [], origins: [] } });

  test("SCN-01/02/03 workspace and centre scope @scanner-operator @testcase", async ({ page }) => {
    const state = await signInRole(page, "scanner_operator");
    expect(state, "Scanner post-login state").toBe("shell");

    await check(
      "SCN-02/03",
      {
        role: "scanner-operator",
        area: "workspace",
        severity: "S1",
        title: "The Digitization workspace or its operating centre is missing",
        expected: "only Digitization, with the assigned operating centre",
      },
      async () => {
        const nav = page.getByRole("navigation", { name: "Primary navigation" });
        await expect(nav.getByRole("button", { name: "Digitization", exact: true })).toBeVisible();
        for (const foreign of ["Access governance", "Evaluation desk", "Allocation engine"]) {
          await expect(nav.getByRole("button", { name: foreign, exact: true })).toHaveCount(0);
        }
        await nav.getByRole("button", { name: "Digitization", exact: true }).click();
        await expect(page.getByText(/Operating centre/i).first()).toBeVisible({ timeout: 30_000 });
      },
    );
  });

  test("SCN-04/05/07 identity and authorization @scanner-operator @testcase", async () => {
    await check(
      "SCN-04",
      {
        role: "scanner-operator",
        area: "identity",
        severity: "S2",
        title: "The Scanner role is not reported",
        expected: "role = scanner_operator",
      },
      async () => {
        const session = await ApiSession.login(scanner.email, scanner.password);
        try {
          const me = await okJson(await session.get(Routes.AUTH_ME), "auth/me");
          expect(me.role).toBe("scanner_operator");
        } finally {
          await session.dispose();
        }
      },
    );

    await check(
      "SCN-05",
      {
        role: "scanner-operator",
        area: "authorization",
        severity: "S1",
        title: "The receiving catalog is readable without a session",
        expected: "401",
      },
      async () => {
        const { request } = await import("@playwright/test");
        const api = await request.newContext({ baseURL: `${tenant}/`, ignoreHTTPSErrors: true });
        try {
          const response = await api.get(Routes.RECEIVING_GUIDED_CATALOG.replace(/^\//, ""));
          expect([401, 403]).toContain(response.status());
        } finally {
          await api.dispose();
        }
      },
    );

    await check(
      "SCN-07",
      {
        role: "scanner-operator",
        area: "authorization",
        severity: "S1",
        title: "The Scanner can reach evaluator or admin routes",
        expected: "refused",
      },
      async () => {
        const session = await ApiSession.login(scanner.email, scanner.password);
        try {
          for (const route of [Routes.CONFIGURATION_CATALOG, Routes.CHIEF_SUMMARY]) {
            const response = await session.get(route);
            expect([401, 403], `${route} as scanner`).toContain(response.status());
          }
        } finally {
          await session.dispose();
        }
      },
    );
  });

  test("SCN-10/11/12/13 receiving catalog and paper selection @scanner-operator @testcase", async () => {
    const session = await ApiSession.login(scanner.email, scanner.password);
    try {
      await check(
        "SCN-10/11/12",
        {
          role: "scanner-operator",
          area: "receiving",
          severity: "S1",
          title: "The receiving catalog or paper settings are unavailable",
          expected: "enabled catalog with the centre and paper settings",
        },
        async () => {
          const catalog = await okJson(
            await session.get(Routes.RECEIVING_GUIDED_CATALOG),
            "receiving catalog",
          );
          expect(catalog.enabled).toBe(true);
          expect(catalog.centre?.id).toBeTruthy();

          const papers = await okJson(
            await session.get(Routes.RECEIVING_SUBJECT_PAPERS),
            "subject papers",
          );
          const rows = (papers.papers ?? []) as Json[];
          expect(rows.length, "selectable papers").toBeGreaterThan(0);
          for (const row of rows.slice(0, 3)) {
            expect(row).toHaveProperty("pages_per_script");
          }
        },
      );

      await check(
        "SCN-13",
        {
          role: "scanner-operator",
          area: "receiving",
          severity: "S2",
          title: "A draft paper is selectable for scanning",
          expected: "only submitted papers are listed",
        },
        async () => {
          const papers = await okJson(
            await session.get(Routes.RECEIVING_SUBJECT_PAPERS),
            "subject papers",
          );
          const drafts = ((papers.papers ?? []) as Json[]).filter(
            (paper) => String(paper.status ?? "").toLowerCase() === "draft",
          );
          expect(drafts).toHaveLength(0);
        },
      );
    } finally {
      await session.dispose();
    }
  });

  test("SCN-20..34 capture, storage and packet submission @scanner-operator @testcase", async () => {
    test.skip(!writes, "Set DVS_ALLOW_WRITES=true to capture and submit a packet.");

    const ids = runIds();
    const session = await ApiSession.login(scanner.email, scanner.password);
    try {
      const papers = await okJson(await session.get(Routes.RECEIVING_SUBJECT_PAPERS), "subject papers");
      const paper =
        ((papers.papers ?? []) as Json[]).find((row) => row.id === ids.paper) ??
        ((papers.papers ?? []) as Json[])[0];
      if (!paper) {
        await check(
          "SCN-20",
          {
            role: "scanner-operator",
            area: "capture",
            severity: "S1",
            title: "No submitted paper is available to scan",
            expected: "the workflow's paper is selectable",
          },
          async () => {
            throw new Error("The receiving catalog returned no paper for this centre.");
          },
        );
        return;
      }

      const pages = Number(paper.pages_per_script ?? 1);
      let scriptId = "";
      let groupId = "";
      let version = 1;

      await check(
        "SCN-20/21/22/23/24/25/26",
        {
          role: "scanner-operator",
          area: "capture",
          severity: "S1",
          title: "Script capture or storage fails",
          expected: "script registered, pages stored, scan complete, state stored",
        },
        async () => {
          const script = await okJson(
            await session.post(Routes.RECEIVING_SUBJECT_SCRIPTS, {
              paper_id: paper.id,
              idempotency_key: randomUUID(),
            }),
            "create script",
          );
          scriptId = script.script_id;
          groupId = script.group_id;
          version = Number(script.version ?? 1);

          const sha256 = createHash("sha256").update(PAGE_PNG).digest("hex");
          for (let page = 1; page <= pages; page += 1) {
            const intent = await okJson(
              await session.post(Routes.REPOSITORY_MANUAL_SCAN_UPLOAD, {
                script_id: scriptId,
                page_number: page,
                content_type: "image/png",
                maximum_bytes: PAGE_PNG.length,
              }),
              `upload intent ${page}`,
            );
            const put = await session.api.put(intent.upload_url, {
              data: PAGE_PNG,
              headers: intent.headers,
            });
            expect(put.status(), `page ${page} upload`).toBe(201);
            await okJson(
              await session.post(RouteBuilders.repositoryUploadFinalize(intent.id), {
                version: intent.version,
                sha256,
                byte_size: PAGE_PNG.length,
              }),
              `finalize ${page}`,
            );
          }

          await okJson(
            await session.post(RouteBuilders.repositoryScriptCompleteScan(scriptId), {
              version,
              page_count: pages,
            }),
            "complete scan",
          );
        },
      );

      await check(
        "SCN-30/31/32/33/34",
        {
          role: "scanner-operator",
          area: "packet",
          severity: "S1",
          title: "Packet submission or its guards fail",
          expected: "complete packet submits once and becomes ready; incomplete/double submit refused",
        },
        async () => {
          const stored = await okJson(
            await session.get(RouteBuilders.receivingSubjectScripts(paper.id)),
            "script status",
          );
          expect(stored).toBeTruthy();

          const submitted = await okJson(
            await session.post(RouteBuilders.receivingSubjectGroupSubmit(groupId)),
            "submit packet",
          );
          expect(submitted.submitted).toBe(true);
          expect(submitted.closed).toBe(true);

          const again = await session.post(RouteBuilders.receivingSubjectGroupSubmit(groupId));
          expect([400, 409]).toContain(again.status());
        },
      );
    } finally {
      await session.dispose();
    }
  });
});
