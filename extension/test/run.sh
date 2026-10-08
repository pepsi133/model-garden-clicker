#!/bin/sh
# Runs every extension test with node. Usage: sh extension/test/run.sh
# Needs jsdom under extension/test/node_modules: cd extension/test && npm install
# Exits non-zero when a file fails or when any check skipped (no recon dumps),
# unless MGC_ALLOW_SKIP=1 accepts the skips (the release workflow does).
set -u
cd "$(dirname "$0")" || exit 2
EXT=..
fail=0

echo "=== node --check on every extension .js file"
for f in $(find "$EXT" -name '*.js' -not -path '*/node_modules/*' | sort); do
  if node --check "$f"; then echo "ok   $f"; else echo "FAIL $f"; fail=1; fi
done

echo "=== the only Agree click path is clickAgreeGuarded"
# unguardedClick: defined once in dom.js, called once in actions.js, inside clickAgreeGuarded.
defs=$(grep -c 'D.unguardedClick = function' "$EXT/content/dom.js")
calls=$(grep -rn 'unguardedClick(' "$EXT" --include='*.js' --exclude-dir=node_modules --exclude-dir=test | grep -v 'D.unguardedClick = function' | grep -v '^\S*:\s*\*' | grep -v '//' | grep -v '"' )
ncalls=$(printf '%s\n' "$calls" | grep -c .)
inguard=$(awk '/A.clickAgreeGuarded = async function/,/^  };/' "$EXT/content/actions.js" | grep -c 'D.unguardedClick(')
agreeuses=$(grep -rn 'S.agreements.agreeButton()' "$EXT" --include='*.js' --exclude-dir=node_modules --exclude-dir=test | grep -c .)
agreeinguard=$(awk '/A.clickAgreeGuarded = async function/,/^  };/' "$EXT/content/actions.js" | grep -c 'S.agreements.agreeButton()')
printf '%s\n' "$calls"
if [ "$defs" = 1 ] && [ "$ncalls" = 1 ] && [ "$inguard" = 1 ] && [ "$agreeuses" = 1 ] && [ "$agreeinguard" = 1 ]; then
  echo "ok   unguardedClick defined once, called once, inside clickAgreeGuarded; agreeButton() consumed only there"
else
  echo "FAIL unguardedClick defs=$defs calls=$ncalls inGuard=$inguard agreeButton uses=$agreeuses inGuard=$agreeinguard"; fail=1
fi

# A test file whose checks skipped (the recon dumps under python/recon are
# gitignored, so on a fresh clone or in CI the dump-based proofs do not run)
# fails the run unless MGC_ALLOW_SKIP=1: a silent skip must never read as a
# pass. Each file's summary line reads "... (N passed, N failed, N skipped)".
allow_skip="${MGC_ALLOW_SKIP:-0}"
out=$(mktemp) || exit 2
for t in worker-harness.mjs content-guard.cjs main-loop.cjs dialog-step.cjs model-step.cjs questionnaire-step.cjs step-by-step.cjs selectors.cjs ui-pages.cjs; do
  echo "=== $t"
  node "$t" > "$out" 2>&1; rc=$?
  cat "$out"
  skipped=$(sed -n 's/.*, \([0-9][0-9]*\) skipped.*/\1/p' "$out" | tail -n 1)
  if [ "$rc" != 0 ]; then echo "FAIL $t"; fail=1
  elif [ -n "$skipped" ] && [ "$skipped" != 0 ]; then
    if [ "$allow_skip" = 1 ]; then echo "note $t: $skipped check(s) skipped, accepted because MGC_ALLOW_SKIP=1"
    else echo "FAIL $t: $skipped check(s) skipped (no recon dump of that shape under python/recon); set MGC_ALLOW_SKIP=1 to accept a run without the dumps"; fail=1
    fi
  fi
done
rm -f "$out"

echo "==="
if [ "$fail" = 0 ]; then echo "ALL TEST FILES PASSED"; else echo "SOME TESTS FAILED"; fi
exit $fail
