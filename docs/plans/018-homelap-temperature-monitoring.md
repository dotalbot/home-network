# 018 - homelap temperature monitoring follow-up

Status: runtime deployed; observing before alerting
Date captured: 2026-06-14
Last updated: 2026-06-16

## Context

`homelap` is the user's heavily used Windows 11 laptop in the same room as `jellyoffice`.
It is already monitored via `windows_exporter` over Tailscale:

- hostname: `homelap`
- Tailscale IP: `100.122.230.90`
- Prometheus scraper: `jellybase` (`100.125.86.118`)
- exporter port: `9182`
- firewall: broad MSI-created `windows_exporter` rule disabled; narrow allow rule permits jellybase Tailscale only
- current exporter collectors: `cpu,cs,logical_disk,memory,net,os,system,textfile`
- textfile collector directory: `C:\ProgramData\windows_exporter\textfile_inputs`
- thermal collector script: `C:\ProgramData\windows_exporter\collect-homelap-thermal.ps1`
- thermal scheduled task: `Collect homelap thermal metric`, running as `SYSTEM` every 1 minute
- Prometheus scrape cadence: `15s` with `10s` timeout

Grafana was updated so `homelap` appears in:

- Host Observability dashboard
- Jellyoffice Environment dashboard, under same-room context
- Host Observability thermal panels: ACPI thermal-zone temperature, probe success, and thermal trend
- Jellyoffice Environment thermal panels: homelap ACPI thermal-zone and office-room-vs-homelap thermal comparison only; full homelap CPU/memory/disk host stats live in Host Observability

## Temperature discovery result

The user ran this on `homelap`:

```powershell
Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature | Select-Object InstanceName,@{Name="Celsius";Expression={[math]::Round(($_.CurrentTemperature / 10) - 273.15, 1)}}
```

Observed output:

```text
InstanceName            Celsius
------------            -------
ACPI\ThermalZone\THM0_0    86.1
```

Interpretation:

- Native Windows WMI exposes an ACPI thermal-zone value.
- Treat it as potentially useful but not yet trustworthy.
- Windows laptop ACPI thermal-zone values can be high, static, or firmware-specific rather than true CPU package temperature.
- Graph and observe before alerting.

## User preference for resumption

When this task is resumed, the user wants to increase capture frequency to the same level as the servers.
If that causes performance impact on the heavily used laptop, roll back to the lower-frequency laptop profile.

Practical interpretation:

- Move `homelap` scrape/capture from `5m` to server-like cadence, probably `15s` to match current Prometheus global/server interval.
- Start with temperature textfile generation at the same cadence only if it remains cheap.
- Watch scrape duration and laptop impact.
- Rollback path: return scrape interval and scheduled temperature collection to `5m`.

## Current runtime status

Completed on 2026-06-16:

- PowerShell textfile collector installed on `homelap` and verified locally.
- `windows_exporter` reconfigured with the `textfile` collector.
- Local exporter verified to expose:
  - `homelap_acpi_thermal_zone_temperature_celsius`
  - `homelap_acpi_thermal_zone_probe_success`
  - `windows_exporter_collector_success{collector="textfile"} 1`
- Scheduled task `Collect homelap thermal metric` ran successfully with `LastTaskResult = 0`.
- Prometheus on `jellybase` recreated so it sees the updated `15s` windows_exporter scrape config.
- Prometheus verified with:
  - `up{job="windows_exporter",monitored_host="homelap"} == 1`
  - `homelap_acpi_thermal_zone_probe_success == 1`
  - scrape duration around `0.012s` after the change
- Grafana dashboard JSON updated with observational thermal panels.

Do not add temperature alerts yet. Continue to graph and observe whether the ACPI value tracks real laptop load/fan/room behavior.

## Proposed implementation steps

### 1. Add textfile collector support on homelap

Create directory:

```powershell
New-Item -ItemType Directory -Force -Path "C:\ProgramData\windows_exporter\textfile_inputs"
```

Create script:

```powershell
@'
$OutDir = "C:\ProgramData\windows_exporter\textfile_inputs"
$OutFile = Join-Path $OutDir "homelap_thermal.prom"
$TmpFile = "$OutFile.tmp"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$zones = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue

$lines = @()
$lines += "# HELP homelap_acpi_thermal_zone_temperature_celsius ACPI thermal-zone temperature reported by Windows WMI."
$lines += "# TYPE homelap_acpi_thermal_zone_temperature_celsius gauge"
$lines += "# HELP homelap_acpi_thermal_zone_probe_success Whether the ACPI thermal-zone probe succeeded."
$lines += "# TYPE homelap_acpi_thermal_zone_probe_success gauge"

if ($zones) {
    foreach ($zone in $zones) {
        $name = ($zone.InstanceName -replace '\\','_' -replace '"','')
        $celsius = [math]::Round(($zone.CurrentTemperature / 10) - 273.15, 1)
        $lines += "homelap_acpi_thermal_zone_temperature_celsius{monitored_host=`"homelap`",zone=`"$name`"} $celsius"
    }
    $lines += "homelap_acpi_thermal_zone_probe_success{monitored_host=`"homelap`"} 1"
} else {
    $lines += "homelap_acpi_thermal_zone_probe_success{monitored_host=`"homelap`"} 0"
}

$lines | Set-Content -Path $TmpFile -Encoding ascii
Move-Item -Force $TmpFile $OutFile
'@ | Set-Content -Path "C:\ProgramData\windows_exporter\collect-homelap-thermal.ps1" -Encoding UTF8
```

Run once:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\ProgramData\windows_exporter\collect-homelap-thermal.ps1"
Get-Content "C:\ProgramData\windows_exporter\textfile_inputs\homelap_thermal.prom"
```

### 2. Enable windows_exporter textfile collector

Need to modify/reinstall/start windows_exporter so it includes `textfile` and points at:

```text
C:\ProgramData\windows_exporter\textfile_inputs
```

Exact flag/installer syntax should be verified against the installed `windows_exporter 0.30.5` service parameters before changing it.

Current intended collector set after change:

```text
cpu,cs,logical_disk,memory,net,os,system,textfile
```

### 3. Schedule the temperature script

Create a Windows Scheduled Task running as SYSTEM or an admin-capable local context.

Initial user preference on resume:

- server-like frequency, likely every 15 seconds if Windows Task Scheduler supports the desired repetition reliably
- otherwise use the nearest safe scheduler cadence and rely on Prometheus scrape frequency

Rollback:

- change repetition to 5 minutes
- or disable task
- or remove textfile collector from exporter

### 4. Update Prometheus config

Change `homelap` scrape interval from `5m` to server-like cadence.
Current server/global interval in repo is `15s`.

Files likely involved:

- `inventory/hosts.yml`
- `docker/appdata/prometheus/config/prometheus.yml`
- maybe alert rules if adding temp/probe alerts later

Do not add temperature alerts initially. Observe first.

### 5. Update Grafana

Add panels to:

- Host Observability: homelap ACPI thermal-zone temperature
- Jellyoffice Environment: same-room comparison between `jellyoffice` ambient room temperature and `homelap` ACPI thermal-zone temperature

Suggested PromQL:

```promql
homelap_acpi_thermal_zone_temperature_celsius{monitored_host="homelap"}
```

Probe success:

```promql
homelap_acpi_thermal_zone_probe_success{monitored_host="homelap"}
```

### 6. Verification checklist

Before declaring complete:

- Local `homelap_thermal.prom` contains valid Prometheus text.
- `http://127.0.0.1:9182/metrics` on homelap includes `homelap_acpi_thermal_zone_temperature_celsius`.
- Jellybase Prometheus query returns the metric.
- Grafana panels render.
- Scrape duration remains low.
- User confirms laptop feels unaffected.

Suggested performance checks:

```promql
windows_exporter_scrape_duration_seconds{job="windows_exporter",monitored_host="homelap"}
```

and compare before/after the frequency/textfile change.

## Rollback plan

If performance impact or noisy data appears:

1. Return Prometheus scrape interval to `5m`.
2. Change scheduled task repetition to `5m`, or disable it.
3. Remove `textfile` collector from windows_exporter if needed.
4. Keep Grafana panels but allow them to show stale/no data, or remove them in a follow-up.

## Do not forget

- Keep Windows exporter firewall locked to jellybase Tailscale only.
- Do not enable heavy collectors like `process`, full event logs, or broad `service` inventory for this temperature task.
- Treat ACPI temperature as observational until validated over time.
