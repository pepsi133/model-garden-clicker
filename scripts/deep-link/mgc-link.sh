#!/bin/sh
# Print a Model Garden Clicker deep link (the popup page's own URL).
#   mgc-link.sh PROJECT[,PROJECT...] [MODELS]
# MODELS is a comma list of slugs or "latest"; absent ticks nothing.
# The default extension id is the Chrome Web Store install's; an unpacked
# copy has another id, which MGC_EXTENSION_ID sets.
# The link fills the popup's form after a confirmation and never starts a
# run. The extension validates every value and refuses more than 23
# projects or 13 models; this script checks nothing.
set -eu
[ $# -ge 1 ] || { echo "usage: $0 PROJECT[,PROJECT...] [MODELS]" >&2; exit 2; }
id=${MGC_EXTENSION_ID:-fmfhgpbcpacoddjpfemghhpinhodcglp}
keys="projects=$1"
[ -n "${2:-}" ] && keys="$keys&models=$2"
echo "chrome-extension://$id/popup/popup.html?tab=1&v=1&$keys"
