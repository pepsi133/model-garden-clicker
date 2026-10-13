#!/bin/sh
# Print a Model Garden Clicker deep link (the console form).
#   mgc-link.sh PROJECT[,PROJECT...] [MODELS]
# MODELS is a comma list of slugs or "latest"; absent ticks nothing.
# Set MGC_EXTENSION_ID to print the popup-page form as a second line.
# The link fills the popup's form after a confirmation and never starts a
# run. The extension validates every value and refuses more than 23
# projects or 13 models; this script checks nothing.
set -eu
[ $# -ge 1 ] || { echo "usage: $0 PROJECT[,PROJECT...] [MODELS]" >&2; exit 2; }
projects=$1
first=${projects%%,*}
keys="projects=$projects"
[ -n "${2:-}" ] && keys="$keys;models=$2"
echo "https://console.cloud.google.com/agent-platform/model-garden?project=$first#mgc=v1;$keys"
if [ -n "${MGC_EXTENSION_ID:-}" ]; then
  echo "chrome-extension://$MGC_EXTENSION_ID/popup/popup.html?tab=1&v=1&$(echo "$keys" | tr ';' '&')"
fi
