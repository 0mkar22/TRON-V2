$InstallName = "TRON_Daemon"
$TronDir = Join-Path $HOME ".tron"
$ExeDest = Join-Path $TronDir "tron-bg.exe"
$ConfigFile = Join-Path $TronDir "config.json"
$StartupFolder = [Environment]::GetFolderPath('Startup')
$ShortcutPath = Join-Path $StartupFolder "$InstallName.lnk"

Write-Host "🚀 Welcome to the T.R.O.N. Enterprise Setup" -ForegroundColor Cyan
Write-Host "-------------------------------------------"

# 1. Ask for Workspace
$Workspace = Read-Host '📁 Enter the full path to your main Projects/Coding folder (e.g., C:\Users\YourName\Desktop)'

if ($Workspace -match "^[A-Za-z]:\\?$") {
    Write-Host "🚨 FATAL ERROR: You cannot watch an entire root drive ($Workspace). It will crash your operating system's file watchers!" -ForegroundColor Red
    Write-Host 'Please provide a specific folder, like C:\Users\YourName\Desktop\Projects' -ForegroundColor Yellow
    Pause
    exit
}

if (-Not (Test-Path $Workspace)) {
    Write-Host "🚨 FATAL ERROR: That folder does not exist!" -ForegroundColor Red
    Pause
    exit
}

# 2. Ask for Cloud Configuration
$CloudUrl = Read-Host '☁️  Enter the T.R.O.N. Cloud URL (e.g., https://tron-cloud-router.onrender.com)'
$ApiKey = Read-Host '🔑 Enter your team API Key'

Write-Host "`n⚙️ Installing to $TronDir..." -ForegroundColor Cyan

# 3. Create the secure hidden folder
if (-Not (Test-Path $TronDir)) {
    New-Item -ItemType Directory -Path $TronDir -Force | Out-Null
}

# 4. Generate the config.json
$ConfigJson = @{
    cloud_url = $CloudUrl.TrimEnd('/') # Prevents accidental trailing slashes
    api_key   = $ApiKey.Trim()
} | ConvertTo-Json

Set-Content -Path $ConfigFile -Value $ConfigJson -Force

# 5. Move the executable
if (-Not (Test-Path "$PWD\tron-bg.exe")) {
    Write-Host "🚨 FATAL ERROR: tron-bg.exe not found! Make sure you extracted the ZIP file." -ForegroundColor Red
    Pause
    exit
}
Copy-Item "$PWD\tron-bg.exe" -Destination $ExeDest -Force

# 6. Install to Windows Startup
Write-Host "⚙️ Adding T.R.O.N. to Windows Startup..." -ForegroundColor Cyan
$WshShell = New-Object -comObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $ExeDest
$Shortcut.Arguments = "`"$Workspace`""  
$Shortcut.WorkingDirectory = $TronDir
$Shortcut.Save()

# 7. Restart the background process
Write-Host "⚙️ Booting Daemon..." -ForegroundColor Cyan
Get-Process -Name "tron-bg" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process -FilePath $ExeDest -ArgumentList "`"$Workspace`"" -WindowStyle Hidden

Write-Host "`n✅ Installation Complete! T.R.O.N. is now running in the background." -ForegroundColor Green
Write-Host "👁️ You can close this window and start coding." -ForegroundColor Green
Pause