// Jenkinsfile
// Declarative Jenkins pipeline for Windows build agents
//
// Why every test was SKIPPED
// --------------------------
// `.env` is gitignored, so Jenkins checks out a repository with no environment
// configuration. The old browser stage then copied the blank `.env.example` into
// `.env`, and every spec starts with a guard like:
//
//   test.skip(!process.env.WEB_APP_URL, "Set WEB_APP_URL ...")
//   test.skip(process.env.DVS_ALLOW_WRITES !== "true", "...")
//
// With those values absent each test skips itself, Playwright exits 0, and the
// build looks green while nothing ran.
//
// Two kinds of configuration
// --------------------------
// Platform values are fixed and safe to store in a credential:
//   PLATFORM_URL, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD,
//   PLATFORM_BASE_DOMAIN, DVS_ROLE_NEW_PASSWORD, DVS_ALLOW_WRITES=true
//
// Tenant values belong to one university and change on every run:
//   WEB_APP_URL, DVS_ADMIN_EMAIL/PASSWORD, DVS_CHAIRMAN_*, DVS_CHIEF_*,
//   DVS_EVALUATOR_*, DVS_SCANNER_*, DVS_USER_MANAGER_*
// Provisioning writes them, so they must never be pinned in a credential.
//
// The pipeline therefore seeds `.env` from the platform credential only, blanks
// any stale tenant values, provisions a brand-new university, then runs the
// selected suite. Role logins come from the API role workflow, which is the run
// that creates the five role accounts and writes their logins into `.env`.
//
// Stages:
//   1. Checkout
//   2. Install Dependencies (npm ci)
//   3. Install Playwright Browser
//   4. Seed .env (platform credential) + blank stale tenant values + preflight
//   5. Provision a new university (only when the suite needs tenant values)
//   6. Run Playwright Tests
//   Post: archive + publish reports, verify cases executed, optional email

pipeline {
  agent any
  options { timestamps() }
  parameters {
    choice(
      name: 'TEST_SUITE',
      choices: [
        'test:master',
        'test:smoke',
        'test:sanity',
        'test:regression',
        'test:web',
        'test:datadriven',
        'test:api',
        'test:db',
        'testcases',
        'test:platform'
      ],
      description: 'Select the test suite to run'
    )
    choice(
      name: 'BROWSER',
      choices: ['chromium', 'firefox', 'webkit'],
      description: 'Browser to install. Only `chromium` has a project in playwright.config.ts.'
    )
    choice(
      name: 'MODE',
      choices: ['headless', 'headed'],
      description: 'Headless is required when the agent has no interactive desktop'
    )
    booleanParam(
      name: 'PROVISION_UNIVERSITY',
      defaultValue: true,
      description: 'Create a brand-new university before the run. Needed by every tenant suite.'
    )
    booleanParam(
      name: 'PROVISION_ROLES',
      defaultValue: true,
      description: 'Also run the API role workflow, so the five role logins exist.'
    )
    string(
      name: 'ENV_CREDENTIAL_ID',
      defaultValue: 'dvs-platform-env',
      description: 'Secret file credential holding the PLATFORM section of .env only'
    )
    string(
      name: 'NOTIFY_TO',
      defaultValue: 'vinayjenkins1@gmail.com',
      description: 'Primary email recipient for the build summary (blank = only the team lead)'
    )
    string(
      name: 'TEAM_LEAD_TO',
      defaultValue: 'pallavijhadav1@gmail.com',
      description: 'Team lead recipient. Always notified alongside NOTIFY_TO (blank disables email)'
    )
  }
  environment {
    CI = '1'
    NODE_ENV = 'test'
    PW_TEST_HTML_REPORT_OPEN = 'never'
  }
  stages {
    stage('🔄 Checkout') {
      steps {
        checkout scm
      }
    }

    stage('📦 Install Dependencies') {
      steps {
        powershell 'npm ci'
      }
    }

    stage('🤖 Install Playwright Browser') {
      steps {
        // `--with-deps` installs OS libraries on Linux and is not wanted on a
        // Windows agent, so only the selected browser is installed.
        powershell "npx playwright install ${params.BROWSER}"
      }
    }

    stage('🔐 Seed .env') {
      steps {
        script {
          try {
            withCredentials([file(credentialsId: params.ENV_CREDENTIAL_ID, variable: 'DVS_ENV_FILE_SOURCE')]) {
              powershell 'Copy-Item -LiteralPath $env:DVS_ENV_FILE_SOURCE -Destination .env -Force'
              echo "Loaded the platform section of .env from credential '${params.ENV_CREDENTIAL_ID}'"
            }
          } catch (err) {
            echo "Credential '${params.ENV_CREDENTIAL_ID}' is unavailable: ${err.message}"
            def hasEnv = powershell(returnStatus: true, script: 'if (Test-Path .env) { exit 0 } else { exit 1 }') == 0
            if (!hasEnv) {
              error """
.env is missing and credential '${params.ENV_CREDENTIAL_ID}' could not be read.

Every spec in this suite skips itself when the environment is absent, which is
why this build reported success with zero tests executed.

Fix one of these, then rebuild:
  1. Jenkins > Manage Jenkins > Credentials > add a Secret file holding the
     PLATFORM values only (see the header of this Jenkinsfile), and point
     ENV_CREDENTIAL_ID at it.
  2. Or place a filled .env in '${env.WORKSPACE}' on the agent.
"""
            }
          }

          // A previous run left another university's URL and logins behind. They
          // must be blanked, or this run would test that university instead of
          // the one about to be provisioned.
          powershell 'node scripts/ci-blank-tenant.mjs'
        }
        // Fails now, before any test starts, if the platform values are missing.
        // `test:db` reads the database only, so it needs no platform or tenant keys.
        script {
          if (params.TEST_SUITE == 'test:db') {
            powershell "node scripts/ci-preflight.mjs ${params.TEST_SUITE} --require=db"
          } else {
            powershell "node scripts/ci-preflight.mjs ${params.TEST_SUITE} --require=platform"
          }
        }
      }
    }

    stage('🏫 Provision University') {
      when {
        expression {
          // `test:platform` provisions by itself and `test:db` needs no tenant.
          return params.PROVISION_UNIVERSITY &&
            !(params.TEST_SUITE in ['test:platform', 'test:db'])
        }
      }
      options { timeout(time: 90, unit: 'MINUTES') }
      steps {
        script {
          // Creates a university, completes the Admin first login and writes
          // WEB_APP_URL + the Admin credentials into .env.
          powershell 'npm run test:platform -- --bootstrap-only'

          if (params.PROVISION_ROLES && params.TEST_SUITE != 'test:api') {
            // The five role accounts are created by the API role workflow, which
            // writes their logins back into .env. Without this the role specs
            // skip themselves. `test:api` runs it again in the test stage.
            powershell 'npm run test:api'
          }
        }
      }
      post {
        always {
          script {
            // A skipped stage still runs its `post`, so only validate when this
            // stage actually provisioned something.
            def ran = params.PROVISION_UNIVERSITY &&
              !(params.TEST_SUITE in ['test:platform', 'test:db'])
            if (ran) {
              // Fails loudly when provisioning wrote nothing, so the suite cannot
              // silently fall back to all-skipped.
              powershell "node scripts/ci-preflight.mjs ${params.TEST_SUITE} --require=tenant"
            }
          }
        }
      }
    }

    stage('▶️ Run Playwright Tests') {
      options { timeout(time: 180, unit: 'MINUTES') }
      steps {
        script {
          def headless = params.MODE == 'headless'
          def headedFlag = headless ? '' : '--headed'
          def suite = params.TEST_SUITE

          // playwright.config.ts defines named projects, so `--browser` is
          // rejected at startup. Tags also span several projects: `@sanity` and
          // `@regression` live in the api/db/first-login projects, while
          // `@master` additionally covers workflow-api. Selecting one project
          // would resolve to zero tests, so every non-headed project is listed.
          def uiProjects = '--project=chromium --project=workflow-api --project=api --project=db --project=first-login'
          // The grep tags are quoted because a bare `@master` in PowerShell is
          // parsed as a splat variable, not a literal argument.
          def uiSuites = [
            'test:web'       : '--project=chromium',
            'test:master'    : "${uiProjects} --grep \"@master\"",
            'test:smoke'     : "${uiProjects} --grep \"@smoke\"",
            'test:sanity'    : "${uiProjects} --grep \"@sanity\"",
            'test:regression': "${uiProjects} --grep \"@regression\"",
            'test:datadriven': '--project=chromium --grep "@datadriven"'
          ]

          // These scripts select their own projects; adding `--project` here
          // would pull the web specs in as well.
          def scriptSuites = [
            'test:api'     : 'npm run test:api',
            'test:db'      : 'npm run test:db',
            'test:platform': 'npm run test:platform',
            'testcases'    : 'npm run testcases -- --no-open'
          ]

          if (!uiSuites.containsKey(suite) && !scriptSuites.containsKey(suite)) {
            error "Unknown suite '${suite}'. Update the suite map in the Jenkinsfile."
          }

          // The config builds every project from devices["Desktop Chrome"], so
          // selecting another browser would change nothing but install time.
          if (params.BROWSER != 'chromium') {
            echo "NOTE: playwright.config.ts defines Chromium-based projects only. " +
                 "Installing '${params.BROWSER}' but the run still uses Chromium."
          }

          // `platform` and `testcases` set headless:false inside the config, so
          // they need an interactive desktop even when MODE is headless.
          if (suite in ['test:platform', 'testcases'] && headless) {
            echo "NOTE: '${suite}' opens a headed browser (headless:false in playwright.config.ts). " +
                 "Run it on an agent with a desktop session."
          }

          def command = uiSuites.containsKey(suite)
            ? "npx playwright test ${uiSuites[suite]} ${headedFlag}".trim()
            : scriptSuites[suite]

          echo "Suite: ${suite}"
          echo "Command: ${command}"

          withEnv([
            "PLAYWRIGHT_HEADLESS=${headless}",
            'FACE_ENROLLMENT_TIMEOUT_MS=600000'
          ]) {
            powershell command
          }
        }
      }
    }
  }
  post {
    always {
      archiveArtifacts artifacts: 'reports/**,custom-report/**,allure-results/**,docs/reports/**,test-results/**', allowEmptyArchive: true
      junit testResults: 'reports/**/results.xml', allowEmptyResults: true
      allure includeProperties: false, results: [[path: 'allure-results']]
      publishHTML([
        allowMissing: true,
        alwaysLinkToLastBuild: true,
        keepAll: true,
        reportDir: 'reports',
        reportFiles: 'index.html',
        reportName: 'Playwright HTML Report'
      ])
      publishHTML([
        allowMissing: true,
        alwaysLinkToLastBuild: true,
        keepAll: true,
        reportDir: 'custom-report',
        reportFiles: 'index.html',
        reportName: 'Custom Test Report'
      ])
      // The milestone checklist: one green tick per business step, from the
      // university being created through to the Admin receiving the report.
      // Written by the workflow spec, so it only exists after that suite runs.
      publishHTML([
        allowMissing: true,
        alwaysLinkToLastBuild: true,
        keepAll: true,
        reportDir: 'docs/reports',
        reportFiles: 'workflow-summary.html',
        reportName: 'Workflow Milestones'
      ])
      // Fails the build when every case skipped itself, which is what happened
      // before .env was supplied. Runs last so reports publish first.
      script {
        // The per-role `testcases` runner writes reports/testcases/<role>/results.xml
        // instead of one combined file, so the whole tree is inspected there.
        def junitPath = params.TEST_SUITE == 'testcases' ? 'reports/testcases' : 'reports/results.xml'
        try {
          powershell "node scripts/ci-assert-ran.mjs ${junitPath}"
        } catch (err) {
          currentBuild.result = 'FAILURE'
          echo "Test-execution check failed: ${err.message}"
        }
      }

      // The summary is emailed on failure as well as success. A regression run
      // that breaks is exactly when the team needs the mail, so this cannot live
      // in the `success` block.
      script {
        // Both the primary recipient and the team lead get the summary. Blanks
        // are dropped and duplicates collapsed, so NOTIFY_TO can repeat the lead.
        def recipients = [params.NOTIFY_TO, params.TEAM_LEAD_TO]
          .findAll { it?.trim() }
          .collect { it.trim() }
          .unique()
          .join(',')

        if (!recipients) {
          echo 'NOTIFY_TO and TEAM_LEAD_TO are both blank, so no email is sent.'
          return
        }

        // Real counts from the JUnit file, so the mail states what was verified
        // instead of only "SUCCESS".
        def passed = 0
        def failed = 0
        def skipped = 0
        def total = 0
        try {
          def status = powershell(
            returnStatus: true,
            script: 'node scripts/ci-count-results.mjs reports/results.xml'
          )
          def counts = readFile('ci-counts.env').trim().split('\\n')
          counts.each { line ->
            def pair = line.split('=')
            if (pair.size() == 2) {
              if (pair[0] == 'TOTAL') total = pair[1].toInteger()
              if (pair[0] == 'PASSED') passed = pair[1].toInteger()
              if (pair[0] == 'FAILED') failed = pair[1].toInteger()
              if (pair[0] == 'SKIPPED') skipped = pair[1].toInteger()
            }
          }
        } catch (err) {
          echo "Could not read result counts: ${err.message}"
        }

        def colour = failed > 0 ? '#b91c1c' : '#15803d'
        def verdict = failed > 0 ? 'FAILURES PRESENT' : 'ALL PASSED'

        echo "Emailing the build summary to: ${recipients} (${passed} passed, ${failed} failed, ${skipped} skipped)"
        emailext(
          subject: "Jenkins: ${env.JOB_NAME} #${env.BUILD_NUMBER} - ${currentBuild.currentResult} - ${passed} passed / ${failed} failed",
          body: """
              <h2>Playwright Test Execution Report</h2>
              <p><b>Verdict:</b> <span style="color:${colour};font-weight:700">${verdict}</span></p>
              <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #dde3ea">
                <tr><td><b>Job</b></td><td>${env.JOB_NAME}</td></tr>
                <tr><td><b>Build</b></td><td>#${env.BUILD_NUMBER}</td></tr>
                <tr><td><b>Status</b></td><td>${currentBuild.currentResult}</td></tr>
                <tr><td><b>Test Suite</b></td><td>${params.TEST_SUITE}</td></tr>
                <tr><td><b>Browser</b></td><td>${params.BROWSER}</td></tr>
                <tr><td><b>Total cases</b></td><td>${total}</td></tr>
                <tr><td><b>Passed</b></td><td style="color:#15803d;font-weight:700">${passed}</td></tr>
                <tr><td><b>Failed</b></td><td style="color:${failed > 0 ? '#b91c1c' : '#5d6b7a'};font-weight:700">${failed}</td></tr>
                <tr><td><b>Skipped</b></td><td>${skipped}</td></tr>
              </table>
              <p style="margin-top:18px">
                <a href="${env.BUILD_URL}">Open Jenkins Build</a> |
                <a href="${env.BUILD_URL}Playwright_20HTML_20Report">Playwright HTML Report</a> |
                <a href="${env.BUILD_URL}Custom_20Test_20Report">Custom Report</a> |
                <a href="${env.BUILD_URL}Workflow_20Milestones">Workflow Milestones</a>
              </p>
          """,
          to: recipients,
          from: 'vinayjenkins1@gmail.com',
          replyTo: recipients,
          mimeType: 'text/html'
        )
      }
    }
  }
}
