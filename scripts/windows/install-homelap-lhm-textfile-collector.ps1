# Install LibreHardwareMonitor textfile collector for homelap.
# Run in an elevated PowerShell window on homelap.

$ErrorActionPreference = 'Stop'

$Principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this from an elevated PowerShell window: right-click PowerShell, Run as administrator.'
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$BaseDir = 'C:\ProgramData\windows_exporter\librehardwaremonitor'
$BinDir = Join-Path $BaseDir 'bin'
$OutputDir = 'C:\ProgramData\windows_exporter\textfile_inputs'
$CollectorPath = 'C:\ProgramData\windows_exporter\collect-homelap-lhm-sensors.ps1'
$ZipPath = Join-Path $BaseDir 'LibreHardwareMonitor.zip'
$ExtractDir = Join-Path $BaseDir 'extract'
$Url = 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v0.9.6/LibreHardwareMonitor.zip'
$ExpectedSha256 = '086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001'
$TaskName = 'Collect homelap LibreHardwareMonitor sensors'

New-Item -ItemType Directory -Force -Path $BaseDir, $BinDir, $OutputDir | Out-Null

Write-Host 'Downloading LibreHardwareMonitor v0.9.6...'
Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $ZipPath
$ActualSha256 = (Get-FileHash -Algorithm SHA256 $ZipPath).Hash.ToLowerInvariant()
if ($ActualSha256 -ne $ExpectedSha256) {
    throw "LibreHardwareMonitor.zip SHA256 mismatch. Expected $ExpectedSha256 but got $ActualSha256"
}

Remove-Item -Recurse -Force $ExtractDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $ExtractDir | Out-Null
Expand-Archive -Force -Path $ZipPath -DestinationPath $ExtractDir
Copy-Item -Force -Recurse (Join-Path $ExtractDir '*') $BinDir

@'
# Collect homelap hardware sensors via LibreHardwareMonitor and emit Prometheus textfile metrics.
# Runtime path: C:\ProgramData\windows_exporter\collect-homelap-lhm-sensors.ps1
# Output path:  C:\ProgramData\windows_exporter\textfile_inputs\homelap_lhm.prom

$ErrorActionPreference = 'Stop'

$MonitoredHost = 'homelap'
$BaseDir = 'C:\ProgramData\windows_exporter\librehardwaremonitor'
$BinDir = Join-Path $BaseDir 'bin'
$OutputDir = 'C:\ProgramData\windows_exporter\textfile_inputs'
$OutputFile = Join-Path $OutputDir 'homelap_lhm.prom'
$TempFile = Join-Path $OutputDir 'homelap_lhm.prom.tmp'

function Escape-PromLabel([string]$Value) {
    if ($null -eq $Value) { return '' }
    return (($Value -replace '\\', '\\') -replace '"', '\"' -replace "`n", ' ' -replace "`r", ' ')
}

function Add-Line([System.Collections.Generic.List[string]]$Lines, [string]$Line) {
    [void]$Lines.Add($Line)
}

function Load-LhmAssemblies([string]$Directory) {
    if (-not (Test-Path (Join-Path $Directory 'LibreHardwareMonitorLib.dll'))) {
        throw "LibreHardwareMonitorLib.dll not found in $Directory"
    }
    Get-ChildItem -Path $Directory -Filter '*.dll' -File | Sort-Object Name | ForEach-Object {
        try { [void][System.Reflection.Assembly]::LoadFrom($_.FullName) } catch { }
    }
    [void][System.Reflection.Assembly]::LoadFrom((Join-Path $Directory 'LibreHardwareMonitorLib.dll'))
}

function Update-HardwareTree($Hardware) {
    $Hardware.Update()
    foreach ($SubHardware in $Hardware.SubHardware) {
        Update-HardwareTree $SubHardware
    }
}

function Collect-HardwareTree($Hardware, [System.Collections.Generic.List[object]]$Rows) {
    foreach ($Sensor in $Hardware.Sensors) {
        if ($null -eq $Sensor.Value) { continue }
        $SensorType = [string]$Sensor.SensorType
        if ($SensorType -in @('Temperature', 'Fan')) {
            [void]$Rows.Add([PSCustomObject]@{
                SensorType = $SensorType
                HardwareType = [string]$Hardware.HardwareType
                Hardware = [string]$Hardware.Name
                Sensor = [string]$Sensor.Name
                Value = [double]$Sensor.Value
            })
        }
    }
    foreach ($SubHardware in $Hardware.SubHardware) {
        Collect-HardwareTree $SubHardware $Rows
    }
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$Lines = [System.Collections.Generic.List[string]]::new()
$ExitCode = 0
$TemperatureCount = 0
$FanCount = 0
$Computer = $null

try {
    Load-LhmAssemblies $BinDir
    $Computer = [LibreHardwareMonitor.Hardware.Computer]::new()
    $Computer.IsCpuEnabled = $true
    $Computer.IsGpuEnabled = $true
    $Computer.IsMemoryEnabled = $false
    $Computer.IsMotherboardEnabled = $true
    $Computer.IsStorageEnabled = $true
    $Computer.IsControllerEnabled = $false
    $Computer.IsNetworkEnabled = $false
    $Computer.IsBatteryEnabled = $false
    $Computer.IsPsuEnabled = $false
    $Computer.Open()
    foreach ($Hardware in $Computer.Hardware) { Update-HardwareTree $Hardware }
    Start-Sleep -Milliseconds 750
    foreach ($Hardware in $Computer.Hardware) { Update-HardwareTree $Hardware }
    $Rows = [System.Collections.Generic.List[object]]::new()
    foreach ($Hardware in $Computer.Hardware) { Collect-HardwareTree $Hardware $Rows }
    Add-Line $Lines '# HELP homelap_lhm_probe_success 1 if LibreHardwareMonitor collection completed, 0 otherwise.'
    Add-Line $Lines '# TYPE homelap_lhm_probe_success gauge'
    Add-Line $Lines 'homelap_lhm_probe_success{monitored_host="homelap"} 1'
    Add-Line $Lines '# HELP homelap_lhm_last_run_timestamp_seconds Unix timestamp of the last LibreHardwareMonitor collector run.'
    Add-Line $Lines '# TYPE homelap_lhm_last_run_timestamp_seconds gauge'
    Add-Line $Lines ('homelap_lhm_last_run_timestamp_seconds{monitored_host="homelap"} ' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
    Add-Line $Lines '# HELP homelap_lhm_temperature_celsius Temperature sensors from LibreHardwareMonitor.'
    Add-Line $Lines '# TYPE homelap_lhm_temperature_celsius gauge'
    Add-Line $Lines '# HELP homelap_lhm_fan_rpm Fan speed sensors from LibreHardwareMonitor.'
    Add-Line $Lines '# TYPE homelap_lhm_fan_rpm gauge'
    foreach ($Row in ($Rows | Sort-Object SensorType, HardwareType, Hardware, Sensor)) {
        $HardwareType = Escape-PromLabel $Row.HardwareType
        $HardwareName = Escape-PromLabel $Row.Hardware
        $SensorName = Escape-PromLabel $Row.Sensor
        $ValueText = $Row.Value.ToString('R', [System.Globalization.CultureInfo]::InvariantCulture)
        if ($Row.SensorType -eq 'Temperature') {
            # LibreHardwareMonitor can expose NVMe threshold constants (Warning/Critical) as temperature sensors,
            # and some unsupported CPU package sensors report exactly 0C. Do not export those as live temperatures.
            if ($Row.Sensor -match '^(Warning|Critical) Temperature$') { continue }
            if ($Row.Value -le 0) { continue }
            $TemperatureCount++
            Add-Line $Lines "homelap_lhm_temperature_celsius{monitored_host=`"$MonitoredHost`",hardware_type=`"$HardwareType`",hardware=`"$HardwareName`",sensor=`"$SensorName`"} $ValueText"
        } elseif ($Row.SensorType -eq 'Fan') {
            $FanCount++
            Add-Line $Lines "homelap_lhm_fan_rpm{monitored_host=`"$MonitoredHost`",hardware_type=`"$HardwareType`",hardware=`"$HardwareName`",sensor=`"$SensorName`"} $ValueText"
        }
    }
} catch {
    $ExitCode = 1
    $Lines.Clear()
    Add-Line $Lines '# HELP homelap_lhm_probe_success 1 if LibreHardwareMonitor collection completed, 0 otherwise.'
    Add-Line $Lines '# TYPE homelap_lhm_probe_success gauge'
    Add-Line $Lines 'homelap_lhm_probe_success{monitored_host="homelap"} 0'
    Add-Line $Lines '# HELP homelap_lhm_last_run_timestamp_seconds Unix timestamp of the last LibreHardwareMonitor collector run.'
    Add-Line $Lines '# TYPE homelap_lhm_last_run_timestamp_seconds gauge'
    Add-Line $Lines ('homelap_lhm_last_run_timestamp_seconds{monitored_host="homelap"} ' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
} finally {
    if ($null -ne $Computer) { try { $Computer.Close() } catch { } }
}
Add-Line $Lines '# HELP homelap_lhm_temperature_sensor_count Number of LibreHardwareMonitor temperature sensors exported.'
Add-Line $Lines '# TYPE homelap_lhm_temperature_sensor_count gauge'
Add-Line $Lines "homelap_lhm_temperature_sensor_count{monitored_host=`"$MonitoredHost`"} $TemperatureCount"
Add-Line $Lines '# HELP homelap_lhm_fan_sensor_count Number of LibreHardwareMonitor fan sensors exported.'
Add-Line $Lines '# TYPE homelap_lhm_fan_sensor_count gauge'
Add-Line $Lines "homelap_lhm_fan_sensor_count{monitored_host=`"$MonitoredHost`"} $FanCount"
[System.IO.File]::WriteAllLines($TempFile, $Lines, [System.Text.UTF8Encoding]::new($false))
Move-Item -Force $TempFile $OutputFile
exit $ExitCode
'@ | Set-Content -Encoding UTF8 -Path $CollectorPath

Write-Host 'Running collector once...'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $CollectorPath
$RunExit = $LASTEXITCODE

$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $CollectorPath + '"')
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

Write-Host 'Collector output:'
if (Test-Path (Join-Path $OutputDir 'homelap_lhm.prom')) {
    Get-Content (Join-Path $OutputDir 'homelap_lhm.prom') | Select-String 'homelap_lhm_probe_success|homelap_lhm_temperature_sensor_count|homelap_lhm_fan_sensor_count|homelap_lhm_temperature_celsius|homelap_lhm_fan_rpm' | Select-Object -First 40
} else {
    Write-Warning 'homelap_lhm.prom was not created.'
}

Write-Host 'Scheduled task state:'
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName,State
Get-ScheduledTaskInfo -TaskName $TaskName | Select-Object LastRunTime,LastTaskResult,NextRunTime

if ($RunExit -ne 0) {
    Write-Warning "First collector run exited with code $RunExit. The scheduled task was still installed; inspect homelap_lhm_probe_success and sensor counts above."
}
