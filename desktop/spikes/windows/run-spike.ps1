# Flourishive DSC signing spike: guided run for Windows (v2, own log file).
# Run from the unzipped folder:
#   powershell -ExecutionPolicy Bypass -File .\spikes\windows\run-spike.ps1
#
# The token PIN is typed only at the hidden prompt of the signing step.
# It is never saved, logged or sent anywhere.

param([switch]$X86)   # use 32-bit Python, needed when the token driver is a 32-bit DLL

$ErrorActionPreference = 'Continue'
$env:PYTHONIOENCODING = 'utf-8'   # Windows console otherwise can't print some characters
Set-Location (Join-Path $PSScriptRoot '..\..')
$log = Join-Path (Get-Location) 'spike-report.txt'
Set-Content -Path $log -Value "Flourishive spike report $(Get-Date -Format s)" -Encoding UTF8

function Say($t, $color = 'Gray') { Write-Host $t -ForegroundColor $color; Add-Content -Path $log -Value $t -Encoding UTF8 }
function Step($t) { Say "`n=== $t ===" 'Cyan' }
# Runs a command, shows its output and copies it into the log.
function Run($cmd) {
  Say "> $cmd" 'DarkGray'
  & cmd /c "$cmd 2>&1" | ForEach-Object { Write-Host $_; Add-Content -Path $log -Value $_ -Encoding UTF8 }
  Say "(exit code $LASTEXITCODE)" 'DarkGray'
}

Step '0. This computer'
Say "Windows: $([System.Environment]::OSVersion.VersionString), 64-bit OS: $([Environment]::Is64BitOperatingSystem)"

Step '1. Checking uv (the Python tool runner)'
$env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  Say 'Installing uv...'
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
  $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
}
Run 'uv --version'

Step '2. Installing dependencies'
if ($X86) {
  Say 'Using 32-bit Python (matches a 32-bit token driver).' 'Yellow'
  $env:UV_PROJECT_ENVIRONMENT = '.venv32'
  Run 'uv python install cpython-3.12-windows-x86'
  $py = ' --python cpython-3.12-windows-x86'
  $pyArgs = @('--python', 'cpython-3.12-windows-x86')
} else { $py = ''; $pyArgs = @() }
Run "uv sync$py"

Step '3. Looking for the mToken driver files (plain Windows search)'
$dirs = @("$env:WINDIR\System32", "$env:WINDIR\SysWOW64", $env:ProgramFiles, ${env:ProgramFiles(x86)})
$found = foreach ($d in $dirs) {
  if ($d -and (Test-Path $d)) {
    Get-ChildItem -Path $d -Recurse -Depth 3 -Include '*pkcs11*.dll','*cryptoid*.dll','*mtoken*.dll' -ErrorAction SilentlyContinue
  }
}
if ($found) { $found | ForEach-Object { Say "  $($_.FullName)  ($([math]::Round($_.Length/1KB)) KB)" } }
else { Say '  No driver files found. Is the mToken CryptoID driver installed?' 'Yellow' }
Run "uv run$py python -u spikes/sign_with_token.py find-lib"

$lib = (Read-Host "`nPaste the FULL path of the mToken library (the CryptoID .dll) from the lists above").Trim('"')
Say "Library chosen: $lib"
if (-not (Test-Path $lib)) { Say "That file does not exist. Stopping." 'Red'; Read-Host 'Press Enter to close'; exit 1 }

Step '4. Listing the token and certificates (no PIN needed)'
Say 'Close the mToken Certificate Utility first if it is open.'
Run "uv run$py python -u spikes/sign_with_token.py list --lib `"$lib`""
$answer = Read-Host "`nDid you see a certificate marked [can sign]? (y/n)"
if ($answer -ne 'y') {
  Say 'Retrying with login: the HR lead types the PIN at the hidden prompt.' 'Yellow'
  uv run @pyArgs python -u spikes/sign_with_token.py list --lib "$lib" --login
}

Step '5. Signing the test letter'
Say 'The HR lead types the token PIN at the hidden prompt. Do NOT enter a wrong PIN repeatedly: the token locks.' 'Yellow'
# Not piped, so the hidden PIN prompt works normally; the result is checked below.
uv run @pyArgs python -u spikes/sign_with_token.py sign --lib "$lib"
Say "(exit code $LASTEXITCODE)"
$signed = Join-Path (Get-Location) 'spikes\out\signed.pdf'
if (Test-Path $signed) { Say "SIGNED FILE CREATED: $signed" 'Green' } else { Say 'NO SIGNED FILE WAS CREATED. Copy the red/white error text above into the chat.' 'Red' }

Step 'Done'
Say 'Send spike-report.txt back. If signed.pdf exists, open it in Adobe Acrobat Reader and screenshot the signature panel.'
Read-Host 'Press Enter to close'
