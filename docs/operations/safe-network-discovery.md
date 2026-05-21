# Safe network discovery operations

## Principles

- Stay on the owned LAN range unless explicitly approved.
- Prefer passive discovery, ARP, mDNS, and low-rate TCP checks.
- Avoid vulnerability scripts, brute forcing, default credential checks, and broad UDP scans.
- Store discovered inventory in `inventory/devices.yml` and mark confidence.

## Sudo-free or least-privilege setup

This section documents optional future setup. Do not enable these automatically; the machine owner should run the setup commands deliberately.

`arp-scan` normally needs raw packet privileges because it sends and receives raw ARP frames on the LAN. Without either Linux capabilities or a narrow sudoers rule, an unprivileged user usually cannot run a real ARP scan.

`nmap` does not need special setup for our normal safe scan. TCP connect scans (`-sT`) run unprivileged. Elevated privileges are only needed for raw/SYN/OS-detection-style scans, which are noisier and should stay opt-in.

### Option A: Linux capabilities for arp-scan

Recommended for this setup: grant only the network capabilities needed by the `arp-scan` binary:

```bash
sudo setcap cap_net_raw,cap_net_admin+ep /usr/sbin/arp-scan
getcap /usr/sbin/arp-scan
```

Expected result:

```text
/usr/sbin/arp-scan cap_net_admin,cap_net_raw=ep
```

Then Hermes can run:

```bash
arp-scan --localnet --interface=eth0
```

If you want to revert:

```bash
sudo setcap -r /usr/sbin/arp-scan
```

### Option B: Passwordless sudo for one exact command

This is narrower than giving broad sudo. Create a sudoers drop-in with `visudo`:

```bash
sudo visudo -f /etc/sudoers.d/hermes-network-discovery
```

Example content, adjusting the username if needed:

```sudoers
jellybot ALL=(root) NOPASSWD: /usr/sbin/arp-scan --localnet --interface=eth0
```

Then Hermes can run only that exact command with sudo:

```bash
sudo -n /usr/sbin/arp-scan --localnet --interface=eth0
```

### nmap without sudo

Use TCP connect scans. They do not need raw packet privileges:

```bash
nmap -sT -Pn -T2 -p 22,53,80,443,445,1883,3000,5000,8000,8080,8123,9000,9443 192.168.1.0/24
```

For Tailscale, do not scan the full `100.64.0.0/10` CGNAT range. It is huge and noisy. Prefer explicit known Tailnet peer IPs from:

```bash
tailscale status
```

Current known reachable/non-offline Tailnet peer targets observed from `jellyberry`:

```text
100.68.81.120   jellyberry
100.66.185.90   ai
100.86.92.76    dominics-macbook-air
100.115.139.83  domphone
100.76.134.32   elenas-macbook-air
100.122.230.90  homelap
100.116.9.17    jellybackup
100.125.86.118  jellybase
100.90.175.59   jellyhome
100.80.9.106    lesters-mac-mini
```

Safe combined LAN + known Tailnet peer scan:

```bash
nmap -sT -Pn -T2 -p 22,53,80,443,445,1883,3000,5000,8000,8080,8123,9000,9443 --open 192.168.1.0/24 100.68.81.120 100.66.185.90 100.86.92.76 100.115.139.83 100.76.134.32 100.122.230.90 100.116.9.17 100.125.86.118 100.90.175.59 100.80.9.106
```

Avoid these unless explicitly approved:

```text
-sS   SYN scan, wants raw privileges
-O    OS detection, intrusive/noisy
-A    Aggressive detection
-sU   UDP scan, slow/noisy
--script vuln
```

## arp-scan vendor warning

If `arp-scan` reports:

```text
WARNING: Cannot open MAC/Vendor file ieee-oui.txt: Permission denied
WARNING: Cannot open MAC/Vendor file mac-vendor.txt: Permission denied
```

The scan can still discover IP/MAC pairs. The warning usually only affects vendor-name lookup.

Check file permissions:

```bash
ls -l /usr/share/arp-scan/ieee-oui.txt /etc/arp-scan/mac-vendor.txt
```

On this host the files are world-readable, so the warning is likely caused by `arp-scan` looking in a current directory where same-named files are not readable, or by an execution environment/path issue. A clean test is:

```bash
cd /tmp
sudo arp-scan --localnet --interface=eth0
```

This installed version supports explicit vendor files:

```bash
arp-scan --localnet --interface=eth0 \
  --ouifile=/usr/share/arp-scan/ieee-oui.txt \
  --macfile=/etc/arp-scan/mac-vendor.txt
```

If vendor names are not needed, use plain output:

```bash
arp-scan --plain --localnet --interface=eth0
```

## Safe recurring discovery command set

```bash
ip neigh show dev eth0
avahi-browse -art
nmap -sT -Pn -T2 -p 22,53,80,443,445,1883,3000,5000,8000,8080,8123,9000,9443 192.168.1.0/24
arp-scan --localnet --interface=eth0 --ouifile=/usr/share/arp-scan/ieee-oui.txt --macfile=/etc/arp-scan/mac-vendor.txt
```
