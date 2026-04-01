# =========================================================
# T.R.O.N. ENTERPRISE INSTALLER & DEFENDER WHITELIST
# Run this as Administrator
# =========================================================

Write-Host "🛡️ Starting T.R.O.N. Enterprise Installation..." -ForegroundColor Cyan

# 1. Check for Admin Privileges (Required to modify Windows Defender)
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "❌ ERROR: This script must be run as Administrator to configure Windows Defender." -ForegroundColor Red
    Exit
}

# 2. Build the Go Executable
Write-Host "🔨 Compiling T.R.O.N. Daemon..."
cd tron-daemon
go build -o tron-bg.exe -ldflags "-H=windowsgui" main.go

# 3. Get the exact, immutable cryptographic hash of the compiled binary
$BinaryPath = "$PWD\tron-bg.exe"
$FileHash = (Get-FileHash -Path $BinaryPath -Algorithm SHA256).Hash
Write-Host "✅ Binary Compiled. SHA256 Hash: $FileHash" -ForegroundColor Green

# 4. Whitelist the specific executable path in Windows Defender
Write-Host "🔐 Adding T.R.O.N. to Windows Defender Exclusions..."
Add-MpPreference -ExclusionProcess $BinaryPath
Add-MpPreference -ExclusionPath $PWD

# 5. Generate the Config Vault
$ConfigDir = "$env:USERPROFILE\.tron"
if (-Not (Test-Path $ConfigDir)) {
    New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
}

Write-Host "✅ T.R.O.N. successfully installed and whitelisted!" -ForegroundColor Green
Write-Host "Starting Background Service..."
Start-Process -WindowStyle Hidden -FilePath $BinaryPath