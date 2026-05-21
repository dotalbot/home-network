# Network inventory discovery

## Goal

Create a first-pass home LAN device inventory from safe discovery methods and document how to continue discovery without giving broad sudo access to automation.

## Scope

- Record observed devices from passive neighbour cache, gentle ICMP, mDNS, and light TCP checks.
- Label obvious device roles and dashboards.
- Document least-privilege options for `arp-scan` and `nmap`.

## Non-goals

- No vulnerability scanning.
- No password/login attempts.
- No brute forcing or directory fuzzing.
- No internet/Tailscale scanning.

## Verification strategy

- Validate YAML syntax for inventory files.
- Run `git diff --check`.
- Keep changes docs/inventory-only.

## Risks / rollback

- Device names/IPs are snapshots and may change with DHCP.
- Unknown devices should be verified before making firewall or access-control decisions.
