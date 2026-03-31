$InstallName = "TRON_Daemon"
$ExePath = "$PWD\tron-bg.exe"
$StartupFolder = [Environment]::GetFolderPath('Startup')
$ShortcutPath = Join-Path $StartupFolder "$InstallName.lnk"

# NEW: Ask the developer for their workspace (using single quotes for safety)
$Workspace = Read-Host '📁 Enter the full path to your main Projects/Coding folder (e.g., C:\Users\YourName\Desktop)'

# 🛡️ THE FAILSAFE: Block root drives
if ($Workspace -match "^[A-Za-z]:\\?$") {
    Write-Host "🚨 FATAL ERROR: You cannot watch an entire root drive ($Workspace). It will crash your operating system's file watchers!" -ForegroundColor Red
    Write-Host 'Please provide a specific folder, like C:\Users\YourName\Desktop\Projects' -ForegroundColor Yellow
    exit
}

if (-Not (Test-Path $Workspace)) {
    Write-Host "🚨 FATAL ERROR: That folder does not exist!" -ForegroundColor Red
    exit
}

Write-Host "⚙️ Building invisible binary..." -ForegroundColor Cyan
go build -ldflags "-H=windowsgui" -o tron-bg.exe main.go

Write-Host "⚙️ Installing T.R.O.N. to Windows Startup..." -ForegroundColor Cyan

$WshShell = New-Object -comObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $ExePath
$Shortcut.Arguments = "`"$Workspace`""  # Pass the workspace as an argument!
$Shortcut.WorkingDirectory = $PWD
$Shortcut.Save()

Write-Host "✅ Installed! Starting background process for: $Workspace" -ForegroundColor Green
Start-Process -FilePath $ExePath -ArgumentList "`"$Workspace`""
Write-Host "👁️ Global Daemon is active. You can close this window." -ForegroundColor Green