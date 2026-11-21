import "dotenv/config";
import { expect, test } from "@playwright/test";
import { platformBaseUrl } from "../../utils/platformClient";
import { runUniversityMatrix } from "../../utils/universityMatrix";

/**
 * Multi-university run: provisions N tenants on the platform control plane and
 * drives each one in its own Playwright child process, then writes a master
 * dashboard plus per-university reports.
 *
 * Each tenant gets its own `.env`, run state, defect log, HTML/JUnit report,
 * Allure results, custom dashboard and log, so parallel runs cannot interleave.
 *
 * Run with:
 *   npm run test:matrix                       # 100 universities, 10 concurrent
 *   npm run test:matrix -- --count=5 --concurrency=2
 *
 * Source: prompts/KTR_API_TEST_PROMPTS.md §13 and the single-university
 * platform bootstrap in tests/web/platform/university-bootstrap.spec.ts.
 */
test.describe("University matrix @matrix", () => {
  test.skip(!platformBaseUrl(), "Set PLATFORM_URL to the platform console.");
  test.skip(
    !process.env.PLATFORM_ADMIN_EMAIL || !process.env.PLATFORM_ADMIN_PASSWORD,
    "Set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD.",
  );
  test.skip(!process.env.PLATFORM_BASE_DOMAIN, "Set PLATFORM_BASE_DOMAIN.");
  test.skip(
    !process.env.DVS_ROLE_NEW_PASSWORD && !process.env.DVS_UNIVERSITY_ADMIN_PASSWORD,
    "Set DVS_ROLE_NEW_PASSWORD for the provisioned administrators.",
  );
  test.skip(
    process.env.DVS_ALLOW_WRITES !== "true",
    "Set DVS_ALLOW_WRITES=true to provision universities.",
  );

  test("creates and runs every university in parallel", async () => {
    // Provisioning 100 tenants plus their workflows runs far beyond the default
    // test budget, so the driver owns its own duration.
    test.setTimeout(0);

    const count = Math.max(1, Math.floor(Number(process.env.DVS_MATRIX_COUNT ?? 100)));
    const concurrency = Math.max(
      1,
      Math.floor(Number(process.env.DVS_MATRIX_CONCURRENCY ?? 10)),
    );

    const evaluate = process.env.DVS_MATRIX_EVALUATE === "true";
    const summary = await runUniversityMatrix(count, concurrency, evaluate);

    test.info().annotations.push({
      type: "matrix",
      description: `${summary.count} universities, ${summary.passed} passed, ${summary.failed} failed`,
    });

    expect(summary.results.length, "every requested university has a result").toBe(count);

    const allowFailures = process.env.DVS_MATRIX_ALLOW_FAILURES === "true";
    if (summary.failed > 0 && !allowFailures) {
      throw new Error(
        `${summary.failed} of ${summary.results.length} universities failed. ` +
          `See ${summary.paths.index}. Set DVS_MATRIX_ALLOW_FAILURES=true to report without failing.`,
      );
    }
  });
});
