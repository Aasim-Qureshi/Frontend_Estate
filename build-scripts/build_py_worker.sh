#!/usr/bin/env bash
set -euo pipefail
# Build script for Python worker using Nuitka
# Produces: build/python_exe
# Run from project root: ./build-scripts/build_py_worker.sh

########################################
# Activate virtualenv
########################################
if [ -f ".venv/bin/activate" ]; then
    echo "[BUILD] Activating virtual environment..."
    source .venv/bin/activate
else
    echo "[ERROR] No virtualenv found at .venv"
    exit 1
fi

########################################
# Install Nuitka + helpers
########################################
echo "[BUILD] Installing Nuitka..."
pip install --upgrade pip
pip install nuitka ordered-set zstandard

########################################
# Fix nodriver encoding issue
########################################
echo "[BUILD] Checking nodriver encoding..."

NODRIVER_PATH=$(python - <<'PY'
import nodriver, os
print(os.path.dirname(nodriver.__file__))
PY
)

NETWORK_FILE="$NODRIVER_PATH/cdp/network.py"

if [ -f "$NETWORK_FILE" ]; then
  echo "[BUILD] Found network.py at $NETWORK_FILE"

  # Detect encoding
  ENCODING=$(file -b "$NETWORK_FILE")
  echo "[BUILD] network.py encoding: $ENCODING"

  if [[ "$ENCODING" != *"UTF-8"* ]]; then
    echo "[BUILD] Converting network.py to UTF-8..."
    iconv -f ISO-8859-1 -t UTF-8 "$NETWORK_FILE" -o "$NETWORK_FILE.tmp"
    mv "$NETWORK_FILE.tmp" "$NETWORK_FILE"
    echo "[BUILD] Conversion complete."
  else
    echo "[BUILD] network.py already UTF-8."
  fi
else
  echo "[BUILD] network.py not found, skipping encoding fix."
fi


########################################
# Clean old artifacts
########################################
echo "[BUILD] Cleaning old Nuitka artifacts..."
rm -rf build/python_exe
rm -rf build/nuitka_build
mkdir -p build/python_exe

########################################
# Config
########################################
ENTRY_FILE="src/scripts/core/build_launcher.py"
NUITKA_OUT="build/nuitka_build"
OUTPUT_NAME="excec_worker"

########################################
# Run Nuitka with PYTHONPATH set
########################################
echo "[BUILD] Running Nuitka..."
cd src && python -m nuitka \
  --standalone \
  --follow-imports \
  --include-package=nodriver \
  --include-package-data=nodriver \
  --include-package=scripts \
  --output-dir="../${NUITKA_OUT}" \
  --output-filename="${OUTPUT_NAME}" \
  --assume-yes-for-downloads \
  scripts/core/build_launcher.py && cd ..

########################################
# Determine output folder
########################################
DIST_FOLDER="${NUITKA_OUT}/build_launcher.dist"

if [ ! -d "${DIST_FOLDER}" ]; then
  echo "[ERROR] Nuitka did not produce ${DIST_FOLDER}"
fi

########################################
# Copy to Electron resource folder
########################################
echo "[BUILD] Copying Nuitka output to build/python_exe..."
cp -r "${DIST_FOLDER}/"* build/python_exe/
chmod -R +x build/python_exe || true

echo "[SUCCESS] Python worker built with Nuitka -> build/python_exe"
