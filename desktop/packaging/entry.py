"""Entry point used by PyInstaller (the package's __main__ cannot be run directly as a script)."""

import sys

from flourishive_desktop.app import main

sys.exit(main())
