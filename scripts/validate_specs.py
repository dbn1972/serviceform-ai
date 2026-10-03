#!/usr/bin/env python3
"""Entry point named in ci/ARCHITECTURE-GATES.md. Delegates to scripts/gates/validate_specs.py."""
import pathlib
import runpy
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / "gates"))
runpy.run_path(str(pathlib.Path(__file__).resolve().parent / "gates" / "validate_specs.py"), run_name="__main__")
