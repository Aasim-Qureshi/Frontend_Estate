#!/usr/bin/env bash
set -e

echo "[CLEAN] Starting cleanup script..."
echo "[CLEAN] Current dir before cd: $(pwd)"

echo "[CLEAN] Moved to: $(pwd)"

echo "[CLEAN] Removing build/nuitka_build..."
rm -rf build/nuitka_build/ && echo "[CLEAN] build/nuitka_build removed (or did not exist)"

echo "[CLEAN] Removing build/python_exe..."
rm -rf build/python_exe/ && echo "[CLEAN] build/python_exe removed (or did not exist)"

echo "[CLEAN] Removing dist/bundle.js..."
rm -f dist/bundle.js && echo "[CLEAN] dist/bundle.js removed (or did not exist)"

echo "[CLEAN] Removing dist/bundle.js.LICENSE.txt..."
rm -f dist/bundle.js.LICENSE.txt && echo "[CLEAN] dist/bundle.js.LICENSE.txt removed (or did not exist)"

echo "[CLEAN] Removing release/..."
rm -rf release/ && echo "[CLEAN] release/ removed (or did not exist)"

echo "[CLEAN] Cleanup complete."
