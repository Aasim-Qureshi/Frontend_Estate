Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------- Config ----------
$ProjectRoot = (Get-Location).Path
$VenvPath = Join-Path $ProjectRoot ".venv"
$PythonExe = Join-Path $VenvPath "Scripts\python.exe"

$NuitkaOut = Join-Path $ProjectRoot "build\nuitka_build"
$FinalStage = Join-Path $ProjectRoot "build\win_python_exe"

$EntryFile = "scripts/core/build_launcher.py"
$OutputName = "excec_worker"

$ElectronBuilderArgs = @("--win","--x64")
# ----------------------------

Write-Host "[BUILD-WIN] Project root: $ProjectRoot"

function Fail([string]$msg) {
  Write-Error $msg
  Exit 1
}

# 1) FRONTEND BUILD
Write-Host "[BUILD-WIN] Running frontend build..."
if (-not (Test-Path "$ProjectRoot\package.json")) {
  Fail "package.json not found in project root."
}

npm run build
if ($LASTEXITCODE -ne 0) { Fail "Frontend build failed." }

# 2) ENSURE VENV
if (!(Test-Path $VenvPath)) {
  Write-Host "[BUILD-WIN] Creating virtual environment..."
  python -m venv $VenvPath
}

if (!(Test-Path $PythonExe)) {
  Fail "Python executable not found in venv at $PythonExe"
}

Write-Host "[BUILD-WIN] Using Python: $PythonExe"

# 3) INSTALL NUITKA + HELPERS
Write-Host "[BUILD-WIN] Installing Nuitka + dependencies..."
& $PythonExe -m pip install --upgrade pip
& $PythonExe -m pip install nuitka ordered-set zstandard

# 3.5) FIX NODRIVER ENCODING
Write-Host "[BUILD-WIN] Checking nodriver encoding..."

$nodriverPath = & $PythonExe - <<'PY'
import nodriver, os
print(os.path.dirname(nodriver.__file__))
PY

$nodriverPath = $nodriverPath.Trim()
$networkFile = Join-Path $nodriverPath "cdp\network.py"

if (Test-Path $networkFile) {
    Write-Host "[BUILD-WIN] Found network.py at $networkFile"

    try {
        Get-Content $networkFile -Encoding UTF8 -ErrorAction Stop | Out-Null
        Write-Host "[BUILD-WIN] network.py already UTF-8."
    }
    catch {
        Write-Host "[BUILD-WIN] Converting network.py to UTF-8..."
        $content = Get-Content $networkFile -Raw
        $content | Set-Content -Encoding UTF8 $networkFile
        Write-Host "[BUILD-WIN] Conversion complete."
    }
}
else {
    Write-Host "[BUILD-WIN] network.py not found, skipping encoding fix."
}

# 4) CLEAN OLD ARTIFACTS
Write-Host "[BUILD-WIN] Cleaning old build artifacts..."
Remove-Item -Recurse -Force $NuitkaOut -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $FinalStage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $FinalStage | Out-Null

# 5) RUN NUITKA
Write-Host "[BUILD-WIN] Running Nuitka standalone build..."
Push-Location src

& $PythonExe -m nuitka `
  --standalone `
  --follow-imports `
  --include-package=nodriver `
  --include-package-data=nodriver `
  --include-package=scripts `
  --output-dir="..\build\nuitka_build" `
  --output-filename="$OutputName" `
  --assume-yes-for-downloads `
  $EntryFile

if ($LASTEXITCODE -ne 0) {
  Pop-Location
  Fail "Nuitka build failed."
}

Pop-Location

# 6) COPY DIST TO ELECTRON RESOURCE FOLDER
$DistFolder = Join-Path $NuitkaOut "build_launcher.dist"

if (!(Test-Path $DistFolder)) {
  Fail "Nuitka output not found at $DistFolder"
}

Write-Host "[BUILD-WIN] Copying Nuitka output to $FinalStage..."
Copy-Item "$DistFolder\*" $FinalStage -Recurse -Force

# 7) RUN ELECTRON BUILDER
Write-Host "[BUILD-WIN] Running electron-builder..."
npx electron-builder @ElectronBuilderArgs

if ($LASTEXITCODE -ne 0) {
  Fail "electron-builder failed."
}

Write-Host "[SUCCESS] Windows build complete. Check the /release folder."
