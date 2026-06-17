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

    # Load dependency DLLs first. Some may fail if already loaded or platform-specific; the main library load below is authoritative.
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

    foreach ($Hardware in $Computer.Hardware) {
        Update-HardwareTree $Hardware
    }
    Start-Sleep -Milliseconds 750
    foreach ($Hardware in $Computer.Hardware) {
        Update-HardwareTree $Hardware
    }

    $Rows = [System.Collections.Generic.List[object]]::new()
    foreach ($Hardware in $Computer.Hardware) {
        Collect-HardwareTree $Hardware $Rows
    }

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
    if ($null -ne $Computer) {
        try { $Computer.Close() } catch { }
    }
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
