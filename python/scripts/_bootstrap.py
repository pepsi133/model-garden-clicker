"""Make `mgclick` importable when a script is run directly from python/scripts/."""
import sys
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parent.parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))
