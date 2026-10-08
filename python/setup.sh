#!/usr/bin/env bash
# Idempotent setup: creates python/.venv and installs requirements.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$HERE/.venv"

if [ ! -x "$VENV/bin/python" ]; then
    echo "Creating virtualenv at $VENV"
    python3 -m venv "$VENV"
else
    echo "Virtualenv already exists at $VENV"
fi

"$VENV/bin/python" -m pip install --quiet --upgrade pip
"$VENV/bin/python" -m pip install --quiet -r "$HERE/requirements.txt"

echo
echo "Installed: selenium $("$VENV/bin/python" -c 'import selenium; print(selenium.__version__)')"
echo
echo "Note: on first run Selenium Manager downloads a chromedriver matching"
echo "/usr/bin/google-chrome into ~/.cache/selenium (outside this repo)."
echo
echo "Next steps:"
echo "  1. cp $HERE/config.example.json $HERE/config.local.json   # then edit it"
echo "  2. $VENV/bin/python $HERE/scripts/login.py                 # log in once"
echo "  3. $VENV/bin/python $HERE/scripts/recon.py --project <PROJECT_ID>"
