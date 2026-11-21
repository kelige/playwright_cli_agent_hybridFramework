#!/usr/bin/env bash
set -e

SUITE="${1:-all}"

case "$SUITE" in
  all)
    shift || true
    echo "==> Running ALL tests (args: $*)"
    exec npx playwright test "$@"
    ;;
  smoke|sanity|regression|master|web|first-login|api|db|workflow|datadriven)
    shift
    echo "==> Running '$SUITE' tests (args: $*)"
    exec npm run "test:${SUITE}" -- "$@"
    ;;
  npx|npm|node|bash|sh|playwright)
    echo "==> Running custom command: $*"
    exec "$@"
    ;;
  *)
    echo "Error: Unknown test suite '$SUITE'"
    echo ""
    echo "Usage: $0 {all|smoke|sanity|regression|master|web|first-login|api|db|workflow|datadriven} [playwright-args...]"
    echo "       $0 npx playwright test <playwright-args...>   (run any command directly)"
    echo ""
    echo "Available test suites:"
    echo "  all         Run all tests (default)"
    echo "  smoke       Run smoke tests        (@smoke)"
    echo "  sanity      Run sanity tests       (@sanity)"
    echo "  regression  Run regression tests   (@regression)"
    echo "  master      Run master tests       (@master)"
    echo "  web         Run web tests          (project=chromium)"
    echo "  first-login Run first-login setup  (project=first-login)"
    echo "  api         Run API tests          (@api)"
    echo "  db          Run database tests     (@db)"
    echo "  workflow    Run the live workflow  (workflow projects)"
    echo "  datadriven  Run data-driven tests  (@datadriven)"
    exit 1
    ;;
esac
