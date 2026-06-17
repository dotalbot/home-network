# Roll back LibreHardwareMonitor textfile collector for homelap.
# Run in an elevated PowerShell window on homelap.

$ErrorActionPreference = 'Stop'
$TaskName = 'Collect homelap LibreHardwareMonitor sensors'
$CollectorPath = 'C:\ProgramData\windows_exporter\collect-homelap-lhm-sensors.ps1'
$BaseDir = 'C:\ProgramData\windows_exporter\librehardwaremonitor'
$OutputFile = 'C:\ProgramData\windows_exporter\textfile_inputs\homelap_lhm.prom'
$TempFile = 'C:\ProgramData\windows_exporter\textfile_inputs\homelap_lhm.prom.tmp'

$Principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this from an elevated PowerShell window: right-click PowerShell, Run as administrator.'
}

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Remove-Item -Force $CollectorPath -ErrorAction SilentlyContinue
Remove-Item -Force $OutputFile,$TempFile -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $BaseDir -ErrorAction SilentlyContinue

Write-Host 'Rolled back LibreHardwareMonitor collector. windows_exporter and the existing ACPI thermal collector were not changed.'
