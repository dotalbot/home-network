# Jellyoffice headless Wi-Fi failover

Jellyoffice is a Raspberry Pi Zero 2 W sensor node with no Ethernet. It may be moved between two locations with different Wi-Fi SSIDs that are out of range of each other, so both networks must be preloaded before moving the device.

## Design

- Raspberry Pi OS 13 on jellyoffice uses NetworkManager (`nmcli`).
- Store both Wi-Fi profiles as system NetworkManager connections.
- Enable `autoconnect` on both profiles.
- Give the preferred/current network a higher autoconnect priority.
- Do not store Wi-Fi credentials in Git.
- Configure profiles from Tailscale SSH or console so a WLAN reconnect does not strand the operator.

## Source-managed helper

Repo helper:

```bash
scripts/jellyoffice/configure-wifi-failover
```

Copy or pull the repo on jellyoffice, then run:

```bash
cd /path/to/home-network
sudo scripts/jellyoffice/configure-wifi-failover \
  --ssid "SSID at location A" \
  --ssid "SSID at location B"
```

The script prompts securely for each Wi-Fi password. Do not put passwords on the command line.

By default the script does not bounce Wi-Fi. It only writes NetworkManager profiles and reloads NetworkManager.

To test activation from a safe Tailscale SSH or local console session:

```bash
sudo scripts/jellyoffice/configure-wifi-failover \
  --ssid "SSID at location A" \
  --ssid "SSID at location B" \
  --activate
```

## Verification

On jellyoffice:

```bash
nmcli -f NAME,TYPE,AUTOCONNECT,AUTOCONNECT-PRIORITY connection show | grep -E '(^NAME|jellyoffice-wifi-)'
nmcli -f GENERAL.STATE,GENERAL.CONNECTION,IP4.ADDRESS device show wlan0
iw dev wlan0 link
systemctl is-active enviro-publisher.service
```

Expected:

- `jellyoffice-wifi-1` and `jellyoffice-wifi-2` exist.
- Both have `autoconnect: yes`.
- The first SSID has higher autoconnect priority than the second.
- `wlan0` is connected to whichever configured SSID is reachable.
- `enviro-publisher.service` remains active after reconnection.
- Tailscale returns after the new Wi-Fi gets internet.

From jellybase/Prometheus after moving the device:

```bash
curl -fsG --data-urlencode 'query=mqtt_temperature{monitored_host="jellyoffice"}' \
  http://192.168.1.2:9090/api/v1/query
```

## Operational notes

- If both SSIDs are visible, NetworkManager prefers the higher priority profile.
- If only one is visible, NetworkManager connects to the visible one.
- If the device is moved out of range, it may take a short time for Wi-Fi, Tailscale, MQTT, and Prometheus metrics to recover.
- If a password changes, rerun the helper for both SSIDs so the profile set remains known-good.
- Keep a monitor/keyboard fallback or Tailscale SSH path available during first setup.

## Recovery if Wi-Fi is misconfigured

If jellyoffice becomes unreachable after a move:

1. Bring it back within range of a known-good SSID if possible.
2. If still unreachable, attach console/keyboard or mount the SD card on another machine.
3. Remove or repair NetworkManager profiles under:

```text
/etc/NetworkManager/system-connections/
```

4. Reboot and rerun the helper with correct SSIDs/passwords.
