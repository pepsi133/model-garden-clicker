#!/bin/sh
# Runs every extension test with node. Usage: sh extension/test/run.sh
# Needs jsdom under extension/test/node_modules: cd extension/test && npm install
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

for t in worker-harness.mjs content-guard.cjs main-loop.cjs dialog-step.cjs model-step.cjs questionnaire-step.cjs step-by-step.cjs selectors.cjs ui-pages.cjs; do
  echo "=== $t"
  if node "$t"; then :; else echo "FAIL $t"; fail=1; fi
done

echo "==="
if [ "$fail" = 0 ]; then echo "ALL TEST FILES PASSED"; else echo "SOME TESTS FAILED"; fi
exit $fail
