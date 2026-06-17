# Collect homelap Windows physical disk health via native Storage cmdlets and emit Prometheus textfile metrics.
# Runtime path: C:\ProgramData\windows_exporter\collect-homelap-disk-health.ps1
# Output path:  C:\ProgramData\windows_exporter\textfile_inputs\homelap_disk_health.prom

$ErrorActionPreference = 'Stop'

$MonitoredHost = 'homelap'
$OutputDir = 'C:\ProgramData\windows_exporter\textfile_inputs'
$OutputFile = Join-Path $OutputDir 'homelap_disk_health.prom'
$TempFile = Join-Path $OutputDir 'homelap_disk_health.prom.tmp'

function Escape-PromLabel([string]$Value) {
    if ($null -eq $Value) { return '' }
    return (($Value -replace '\\', '\\') -replace '"', '\"' -replace "`n", ' ' -replace "`r", ' ')
}

function Add-Line([System.Collections.Generic.List[string]]$Lines, [string]$Line) {
    [void]$Lines.Add($Line)
}

function Health-To-Value($HealthStatus) {
    $Text = [string]$HealthStatus
    switch -Regex ($Text) {
        '^Healthy$' { return 1 }
        '^(Warning|Unhealthy|Unknown)$' { return 0 }
        default { return -1 }
    }
}

function Add-Reliability-Counter($Lines, $Labels, [string]$Name, $Value) {
    if ($null -eq $Value) { return }
    try {
        $Number = [double]$Value
        $ValueText = $Number.ToString('R', [System.Globalization.CultureInfo]::InvariantCulture)
        Add-Line $Lines "homelap_windows_disk_reliability_counter{$Labels,counter=`"$Name`"} $ValueText"
    } catch { }
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$Lines = [System.Collections.Generic.List[string]]::new()
$DiskCount = 0
$ExitCode = 0

try {
    $Disks = @(Get-PhysicalDisk -ErrorAction Stop)

    Add-Line $Lines '# HELP homelap_windows_disk_health_probe_success 1 if Windows disk health collection completed, 0 otherwise.'
    Add-Line $Lines '# TYPE homelap_windows_disk_health_probe_success gauge'
    Add-Line $Lines 'homelap_windows_disk_health_probe_success{monitored_host="homelap"} 1'
    Add-Line $Lines '# HELP homelap_windows_disk_health_last_run_timestamp_seconds Unix timestamp of the last Windows disk health collector run.'
    Add-Line $Lines '# TYPE homelap_windows_disk_health_last_run_timestamp_seconds gauge'
    Add-Line $Lines ('homelap_windows_disk_health_last_run_timestamp_seconds{monitored_host="homelap"} ' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
    Add-Line $Lines '# HELP homelap_windows_disk_health_status Windows Storage HealthStatus as 1=Healthy, 0=Warning/Unhealthy/Unknown, -1=unmapped.'
    Add-Line $Lines '# TYPE homelap_windows_disk_health_status gauge'
    Add-Line $Lines '# HELP homelap_windows_disk_operational_status Windows Storage OperationalStatus as 1=OK, 0=not OK, -1=unknown.'
    Add-Line $Lines '# TYPE homelap_windows_disk_operational_status gauge'
    Add-Line $Lines '# HELP homelap_windows_disk_reliability_counter Selected Get-StorageReliabilityCounter values for the physical disk.'
    Add-Line $Lines '# TYPE homelap_windows_disk_reliability_counter gauge'

    foreach ($Disk in $Disks) {
        $DiskCount++
        $DeviceId = Escape-PromLabel ([string]$Disk.DeviceId)
        $FriendlyName = Escape-PromLabel ([string]$Disk.FriendlyName)
        $MediaType = Escape-PromLabel ([string]$Disk.MediaType)
        $BusType = Escape-PromLabel ([string]$Disk.BusType)
        $HealthText = Escape-PromLabel ([string]$Disk.HealthStatus)
        $OpText = Escape-PromLabel (($Disk.OperationalStatus | ForEach-Object {[string]$_}) -join ',')
        $Labels = "monitored_host=`"$MonitoredHost`",device_id=`"$DeviceId`",friendly_name=`"$FriendlyName`",media_type=`"$MediaType`",bus_type=`"$BusType`""
        $HealthValue = Health-To-Value $Disk.HealthStatus
        Add-Line $Lines "homelap_windows_disk_health_status{$Labels,health_status=`"$HealthText`"} $HealthValue"
        $OpValue = if ($OpText -eq 'OK') { 1 } elseif ([string]::IsNullOrWhiteSpace($OpText)) { -1 } else { 0 }
        Add-Line $Lines "homelap_windows_disk_operational_status{$Labels,operational_status=`"$OpText`"} $OpValue"

        try {
            $Reliability = Get-StorageReliabilityCounter -PhysicalDisk $Disk -ErrorAction Stop
            Add-Reliability-Counter $Lines $Labels 'Temperature' $Reliability.Temperature
            Add-Reliability-Counter $Lines $Labels 'Wear' $Reliability.Wear
            Add-Reliability-Counter $Lines $Labels 'ReadErrorsTotal' $Reliability.ReadErrorsTotal
            Add-Reliability-Counter $Lines $Labels 'WriteErrorsTotal' $Reliability.WriteErrorsTotal
            Add-Reliability-Counter $Lines $Labels 'ReadErrorsUncorrected' $Reliability.ReadErrorsUncorrected
            Add-Reliability-Counter $Lines $Labels 'WriteErrorsUncorrected' $Reliability.WriteErrorsUncorrected
            Add-Reliability-Counter $Lines $Labels 'PowerOnHours' $Reliability.PowerOnHours
        } catch { }
    }
} catch {
    $ExitCode = 1
    $Lines.Clear()
    Add-Line $Lines '# HELP homelap_windows_disk_health_probe_success 1 if Windows disk health collection completed, 0 otherwise.'
    Add-Line $Lines '# TYPE homelap_windows_disk_health_probe_success gauge'
    Add-Line $Lines 'homelap_windows_disk_health_probe_success{monitored_host="homelap"} 0'
    Add-Line $Lines '# HELP homelap_windows_disk_health_last_run_timestamp_seconds Unix timestamp of the last Windows disk health collector run.'
    Add-Line $Lines '# TYPE homelap_windows_disk_health_last_run_timestamp_seconds gauge'
    Add-Line $Lines ('homelap_windows_disk_health_last_run_timestamp_seconds{monitored_host="homelap"} ' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
} finally {
    Add-Line $Lines '# HELP homelap_windows_disk_count Number of physical disks discovered by Get-PhysicalDisk.'
    Add-Line $Lines '# TYPE homelap_windows_disk_count gauge'
    Add-Line $Lines "homelap_windows_disk_count{monitored_host=`"$MonitoredHost`"} $DiskCount"
}

[System.IO.File]::WriteAllLines($TempFile, $Lines, [System.Text.UTF8Encoding]::new($false))
Move-Item -Force $TempFile $OutputFile
exit $ExitCode
