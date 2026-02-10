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

# Function: Convert Arbitrary Encodings → UTF-8 (IMPROVED)
function Convert-FilesToUTF8($path) {
    Write-Host "[BUILD-WIN] Converting ALL Python files to UTF-8 (recursive, forced)..."

    $files = Get-ChildItem -Path $path -Recurse -Include *.py -File
    $convertedCount = 0
    
    foreach ($file in $files) {
        try {
            # Read raw bytes
            $raw = [System.IO.File]::ReadAllBytes($file.FullName)
            
            # Skip empty files
            if ($raw.Length -eq 0) { continue }
            
            # Try to decode with multiple encodings
            $text = $null
            $encodings = @("utf-8", "windows-1252", "latin1", "windows-1256", "iso-8859-1", "cp437")
            
            foreach ($encName in $encodings) {
                try {
                    $enc = [System.Text.Encoding]::GetEncoding($encName)
                    $testText = $enc.GetString($raw)
                    
                    # Verify it's valid text (contains mostly printable characters)
                    if ($testText -match '[^\x00-\x7F\x80-\xFF]' -eq $false) {
                        $text = $testText
                        if ($encName -ne "utf-8") {
                            Write-Host "  • Converting ($encName): $($file.FullName)"
                            $convertedCount++
                        }
                        break
                    }
                }
                catch { 
                    continue
                }
            }

            # Fallback: treat as latin1 (never fails)
            if ($text -eq $null) {
                $text = [System.Text.Encoding]::GetEncoding("latin1").GetString($raw)
                Write-Host "  • Forcing latin1: $($file.FullName)"
                $convertedCount++
            }

            # Always rewrite as UTF-8 (even if already UTF-8, to ensure BOM-less UTF-8)
            $utf8NoBOM = New-Object System.Text.UTF8Encoding $false
            [System.IO.File]::WriteAllText($file.FullName, $text, $utf8NoBOM)
        }
        catch {
            Write-Host "  !! ERROR processing $($file.FullName): $_"
        }
    }

    Write-Host "[BUILD-WIN] Converted $convertedCount files. Encoding conversion complete."
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
& $PythonExe -m pip install nuitka ordered-set zstandard nodriver

# 3.5) FIND NODRIVER PATH
Write-Host "[BUILD-WIN] Locating nodriver package..."

$pythonCode = @"
import nodriver, os
print(os.path.dirname(nodriver.__file__))
"@

$nodriverPath = ($pythonCode | & $PythonExe -).Trim()

if (-not (Test-Path $nodriverPath)) {
    Fail "nodriver package not found in venv. Install failed."
}

Write-Host "[BUILD-WIN] nodriver located at: $nodriverPath"

# 3.6) CONVERT ENTIRE NODRIVER PACKAGE TO UTF-8
Convert-FilesToUTF8 $nodriverPath

# 3.7) ALSO CONVERT PROJECT SCRIPTS TO UTF-8
$scriptsPath = Join-Path $ProjectRoot "src\scripts"
if (Test-Path $scriptsPath) {
    Write-Host "[BUILD-WIN] Converting project scripts to UTF-8..."
    Convert-FilesToUTF8 $scriptsPath
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