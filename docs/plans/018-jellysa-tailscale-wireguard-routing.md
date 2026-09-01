# 018 - jellysa Tailscale + WireGuard routing

Status: planned - documentation only, for operator review
Number: 018
Date created: 2026-09-01
Last updated: 2026-09-01

## Purpose of this document

This is a source plan for giving `jellysa` (remote South Africa Raspberry Pi) a
second, fail-safe network path by running `tailscale0` and `wg0` in parallel and
advertising nine approved remote routes into our tailnet. The design is
fail-closed for a host where losing Tailscale would strand access.

Nothing in this document has been executed. No host or endpoint was contacted,
no network probes or SSH were run, no sudo or service commands were issued, and
no git commit/push happened. Commands below are templates for operator use;

they must be reviewed and approved before any live execution.

## Supplied peer facts (verbatim)

| Fact | Value |
| --- | --- |
| jellysa WireGuard address | 10.10.10.105/32 |
| Remote WireGuard endpoint (UDP) | 154.126.215.194:13231 |
| Peer public key | h7zAUZaAvBpypPUlvKfuaLAdegfuFCMigp16Y7W7nGI= |
| Public key sensitivity | Not a secret; may be recorded in plain text |
| Private key | None available; none to be invented |

Remote routed subnets (nine total):

| Subnet | Site label |
| --- | --- |
| 192.168.11.0/24 | Andrews Farm |
| 192.168.21.0/24 | Andrews Farm |
| 192.168.31.0/24 | Andrews Farm |
| 192.168.12.0/24 | Pieter |
| 192.168.22.0/24 | Pieter |
| 192.168.13.0/24 | Other chicken farm |
| 192.168.23.0/24 | Other chicken farm |
| 192.168.33.0/24 | Other chicken farm |
| 192.168.14.0/24 | Lodge |

Important boundary note: the supplied `10.10.10.105/32` alone does NOT reveal
the peer's own tunnel IP or its return-routing expectations. Before finalizing
config we must obtain the peer's WireGuard tunnel address or confirm
server-side `AllowedIPs`/route behavior (see Unresolved peer questions).

## Architecture target

```text
Our tailnet                 jellysa (South Africa)                 Remote sites
+----------------+          +--------------------+          +---------------------+
| tailnet nodes  |  <=TS=>  | tailscale0         |          | Andrews Farm        |
| jellyhome      |          | wg0 10.10.10.105/32| <=WG=>   | Pieter              |
| jellybase      |          |                    |  UDP     | Other chicken farm  |
| (operators)    |          |                    |  13231   | Lodge               |
+----------------+          +--------------------+          +---------------------+
        |                         | advertises ONLY
        |                         | 9 remote routes
        v                         v
   tailnet ACLs          remote subnets reachable via jellysa as subnet router
```

- jellysa runs `tailscale0` and `wg0` simultaneously.
- jellysa advertises ONLY the nine remote routes above into our tailnet.
- Access is one-way initiated from our tailnet to explicitly approved remote
  destinations. No friend-initiated access into our tailnet.
- No default route. No `0.0.0.0/0`. No broad forwarding.
- Tailscale's subnet-router SNAT default is accounted for: connections
  initiated by approved tailnet nodes towards the remote subnets are normally
  SNATed to jellysa's egress address on `wg0`. Return packets are permitted as
  established traffic; new connections initiated from `wg0` towards the
  tailnet are blocked by the stateful forwarding policy.

## Current documented state (from repo inventory/plans, not live contact)

- `inventory/hosts.yml` records `jellysa`: South Africa Raspberry Pi Tailscale
  backup/sync node and exit-node candidate; `lan_ip: null`;
  `tailscale_ip: 100.120.89.41`; roles include `tailscale-node` and
  `tailscale-exit-node`; `node_exporter` scraped over Tailscale from jellybase
  at 5m/30s cadence; noted "do not use local-network scrape cadence".
- Plan 016 records: Debian 13 trixie aarch64 Pi kernel; tailnet DNS/IP
  `jellysa-1.cheetah-iwato.ts.net` / `100.120.89.41`; interactive SSH as
  `jellyfish`; sudo requires a password; exit-node prerequisite already met
  (IP forwarding enabled via `/etc/sysctl.d/99-tailscale-exit-node.conf`,
  Tailscale advertises exit-node capability).
- Spec 007 policy: "Do not enable UFW unless a backdoor path is verified and a
  host-specific firewall plan exists." jellysa is NOT on the UFW rollout list.
- Precedent for a second access path: plan 012 / ops doc
  `seedit4me-reverse-tunnel.md` established the rule that access-critical
  changes require a verified fallback path before mutation.
- No WireGuard or subnet-router documentation exists yet in the repo; the
  remote-subnet-routing design is greenfield.
## Design considerations (fail-closed review list)

1. Subnet-router SNAT default
   Tailscale subnet routers SNAT forwarded traffic by default. Good for
   one-way initiated access (remote subnets cannot originate back into our
   tailnet beyond what ACLs allow), but must be documented so debugging a
   remote-originated connection is not mistaken for a config error.

2. Targeted forwarding only
   IPv4 routing requires `net.ipv4.ip_forward=1`; jellysa may already require
   that global kernel switch for its documented Tailscale exit-node role.
   The global switch does not authorize traffic by itself. Enforce the narrow
   boundary with stateful nftables/iptables rules: allow NEW traffic only from
   `tailscale0` to `wg0` for the nine approved destination prefixes, allow only
   ESTABLISHED/RELATED return traffic from `wg0`, and reject every other
   `wg0` forwarding path. Never set `ip_forward=0` while the exit-node role is
   active, and never add a broad `wg0` Internet-forward rule.

3. ACL/grant policy
   Tailnet-side ACLs must grant only tailnet users/devices that are explicitly
   approved for these routes. Subnet route approval in the Tailscale admin
   console is a separate gate from host config; both must be in place before
   live advertising.

4. Remote subnet overlap checks
   The nine subnets must not collide with our LAN `192.168.1.0/24`,
   tailnet CGNAT `100.64.0.0/10`, or any other routed range. First pass:
   192.168.1x/2x/3x and 192.168.14.0/24 do not overlap tailnet/LAN, but a
   programmatic overlap check (ipcalc/python) against the full routed set is
   a preflight gate.

5. Preserve current Tailscale advertise-routes/exit-node settings
   jellysa currently advertises exit-node capability (plan 016). Snapshot the
   current prefs, use `tailscale set` to change the complete advertised-route
   list, explicitly preserve `--advertise-exit-node=true`, and read the prefs
   back after every change.

6. Current firewall backend
   Unknown at plan time; preflight must detect ufw/nftables/iptables/ufw
   status before any rule work. Per spec 007, do not enable a firewall unless
   a backdoor path is verified first.

7. rp_filter
   With two tunnel interfaces and policy routing, strict reverse-path
   filtering (`net.ipv4.conf.all.rp_filter=1`) can drop return traffic.
   Preflight must record current rp_filter; prefer per-interface loose
   filtering on `wg0` (or targeted policy rules) rather than disabling it
   globally.

8. MTU
   Tailscale0 default MTU typically 1280; wg0 default 1420. Verify the
   end-to-end MTU to `154.126.215.194` and set a tested MTU on `wg0`; a too
   high MTU causes black-hole packet loss on paths with small PMTU.

9. DNS independence
   Remote client/subnet DNS must not depend on our tailnet MagicDNS. Use IPs
   for the first verification milestones; only document remote DNS servers if
   the peer confirms them.

10. Endpoint reachability through the ordinary default route
    The wg0 config must NOT route `154.126.215.194` into the tunnel
    (no self-route / no table policies that capture the endpoint). Endpoint
    traffic must keep using the ordinary default route, or the tunnel can
    never establish.

11. Reboot persistence
    `wg0` must survive reboot (systemd-networkd/netplan/ifupdown or a wg-quick
    systemd unit), and the persisted Tailscale prefs must be idempotent so both
    interfaces come back automatically after reboot without operator
    intervention.
## Assumptions and unresolved peer questions

Assumptions (label explicitly; verify before execution):

- A1: jellysa's tailscale state matches `inventory/hosts.yml` and plan 016
  (tailnet/node `100.120.89.41`, exit-node advertised via
  `/etc/sysctl.d/99-tailscale-exit-node.conf`). Verify by preflight, never by
  assumption.
- A2: The peer at `154.126.215.194:13231` is the WireGuard peer that holds the
  private half of the supplied public key and serves the nine remote subnets.
  Confirm out-of-band before sending any traffic.
- A3: The nine subnets are served contiguously behind the single remote peer
  (one tunnel, multiple routes) rather than via nested/chained routing.
- A4: Our tailnet currently has NO other advertised subnet routes that could
  collide with the nine remote subnets. Verify against admin console.
- A5: jellysa's only verified backdoor access at plan time is Tailscale SSH;
  any firewall/mutation work must preserve it or establish a second path
  first (see "Two independent active access paths" below).
- A6: WireGuard port is UDP; no TCP fallback exists on the peer.

Unresolved peer questions (must be answered before live rollout):

- Q1: What is the peer's OWN WireGuard tunnel address/return-routing
  expectation? The supplied `10.10.10.105/32` is jellysa's address only; it
  does not reveal the peer tunnel IP or its `AllowedIPs` on the server side.
  Obtain the peer tunnel IP or confirm server-side AllowedIPs/route behavior,
  otherwise return traffic may never leave the peer.
- Q2: Which subnets are reachable ONLY through this peer, and is the peer a
  full router for all nine (as opposed to some subnets being behind a second
  hop)?
- Q3: Does the peer firewall restrict which source addresses may connect?
  Our tailnet egress will appear as `10.10.10.105` after SNAT; confirm this
  is acceptable to the peer.
- Q4: Is either side behind stateful NAT, and does the peer require a different
  keepalive? Use `PersistentKeepalive = 25` for the initial remote/NAT-safe
  rollout unless the peer explicitly confirms a different requirement.
- Q5: Are there any client networks inside the remote sites that overlap with
  the nine approved subnets, which would make route-by-route testing
  ambiguous?
- Q6: MTU support on the remote path (PPPoE/fragmentation issues) that forces
  a `wg0` MTU lower than 1420.
- Q7: DNS servers for the remote subnets, or is IP-only access acceptable for
  the first phase?

## Staged tasks (exact sequence, nothing executed yet)

Stage 0 - Read-only preflight (all checks, no mutation):

1. `tailscale status` with routes from another tailnet node
   (`tailscale status --json` on an operator node) - record current jellysa
   roles and advertised exit-node/route flags.
2. On jellysa over Tailscale SSH: `sudo tailscale debug prefs` and
   `tailscale ip -4` - snapshot prefs including `AdvertiseRoutes`,
   `AdvertiseExitNode`, `RunSSH`.
3. `ip -o addr; ip route show table all; ip rule show` - interface/route baseline.
4. `sysctl net.ipv4.ip_forward net.ipv4.conf.all.rp_filter
   net.ipv4.conf.default.rp_filter` plus per-interface values - forwarding and
   rp_filter baseline. Query `wg0` only after it exists.
5. Detect firewall backend: `command -v ufw nft iptables; sudo ufw status; sudo nft list ruleset` (inspect only).
6. `cat /etc/sysctl.d/99-tailscale-exit-node.conf` - confirm forwarding scope.
7. Verify a second access path exists per the gate below (two paths or
   on-site recovery).

Stage 1 - Backup/rollback artifacts (see next section).

Stage 2 - Create `wg0` config from templates below; apply with
`wg-quick up wg0` or the matching host net backend. Use the initial
`PersistentKeepalive = 25` to initiate a handshake without relying on a routed
payload. Verify `wg show wg0` lists the endpoint and a recent handshake before
adding or advertising a full remote /24.

Stage 3 - Route-by-route rollout: enable ONE approved subnet at a time
(starting with the most testable, e.g. `192.168.14.0/24` lodge), add it to
`AllowedIPs` on wg0, verify reachability from another tailnet node, then move
to the next. Never add all nine at once.

Stage 4 - Tailscale advertisement: after wg0 proves out for the first route,
use `tailscale set --advertise-routes=... --advertise-exit-node=true` with the
complete intended route list, read back the prefs, then SEPARATELY approve each
route in the Tailscale admin console (ACL/grant gate).

Stage 5 - ACL/grant policy: in the Tailscale admin console, restrict subnet
route access to explicitly approved tailnet users/devices; verify from an
approved and a non-approved node.

Stage 6 - Reboot persistence test: only after explicit approval, reboot
jellysa and verify `tailscale0` and `wg0` both come back, routes re-advertise,
handshake re-establishes, and remote subnets reachable again.

Stage 7 - Documentation/inventory update (including this plan's status), only
after live verification evidence is attached.
## Backup / rollback artifacts

Before any mutation, capture and verify (on jellysa, stored locally; ship a
copy to the repo's ops notes only after sanitization - never commit keys):

- `/etc/wireguard/wg0.conf` (if exists) - chmod 600, owner root.
- `/etc/systemd/network/*` or `/etc/network/interfaces` / netplan YAML - the
  host's actual network backend files.
- `/etc/sysctl.d/99-tailscale-exit-node.conf` - to restore forwarding scope.
- Prefs snapshot: `sudo tailscale debug prefs` saved to a dated file (contains
  no secrets - it is host state).
- Firewall state if present: `sudo nft list ruleset > backup-nft.txt` or
  `sudo ufw status verbose > backup-ufw.txt`.
- A dated manifest (`backup_YYYYMMDD_HHMM.txt`) listing every file captured
  with sha256sums, plus the exact Tailscale prefs in effect at backup time
  (from `tailscale debug prefs`).
- Rollback artifacts are ONLY usable if an access path survives: the backup
  tarball must include a `rollback.sh` that restores wg0 + sysctl + firewall
  from the captured files.

Restore procedure (template - MUST NOT be run now):
- If the WireGuard session breaks: `sudo wg-quick down wg0` (removes routes) restores
  tailscale-only routing immediately; no reboot needed.
- If handshake fails after a route add: remove the subnet again with
  `AllowedIPs` reverting to the previous set, then `wg syncconf wg0
  <(wg-quick strip wg0)`.
- If Tailscale route advertisement breaks: restore the captured route list and
  exit-node boolean with `sudo tailscale set`; if broader prefs changed, STOP
  and use a reviewed version-specific restore command rather than guessing.

## Two independent active access paths (gate before mutation)

Rule (from plan 012/ops precedent): do NOT mutate anything that can strand
jellysa unless either:

- (a) two independent active access paths to jellysa exist and are verified
  at the moment of mutation, OR
- (b) an on-site recovery procedure is confirmed (physical access to the
  Raspberry Pi in South Africa).

At plan time only ONE path is verified (Tailscale SSH). The WireGuard tunnel
itself is the second path under construction - so the FIRST wg0 bring-up must
happen while Tailscale is fully up and healthy, wg0 adds NO routing changes
until the handshake succeeds, and the tunnel is never configured such that
losing Tailscale would strand access (i.e. wg0 must never become the only
path). If Tailscale SSH is lost at any point before wg0 is proven, STOP and
use the on-site/peer recovery path; never attempt blind reconfiguration.

## Rollback watchdog design (tmux / at / systemd-run)

Purpose: guarantee that any mutation which degrades access is reversed
automatically unless an operator from ANOTHER tailnet node confirms success.

Design (armed BEFORE changes, cancelled ONLY after external verification):

1. On the operator machine (or a persistent jellysa tmux window if a separate
   control host is unavailable), open a tmux window dedicated to watch:
   `tmux new-session -d -s jwg-watch` and log to a file.
2. Prefer an unconditional rollback timer on jellysa: after N minutes
   (default 15) it restores the captured firewall/Tailscale state and takes
   `wg0` down unless explicitly cancelled. Separately, an operator on ANOTHER
   tailnet node verifies that jellysa remains reachable, the handshake is
   recent, and the approved route works. A local jellysa script cannot prove
   external Tailscale reachability, so it must not self-cancel based on local
   tests.
3. Arm the watchdog BEFORE the first mutation using one of:
   - `at now + 15 minutes -f /root/jwg-watchdog.sh` (if atd present), or
   - `systemd-run --on-active=15m --unit=jwg-watchdog /root/jwg-watchdog.sh`
     (systemd timer variant), or
   - foreground tmux loop: `tmux respawn-pane -t jwg-watch -k
     '/root/jwg-watchdog.sh --foreground'`.
4. After the change, an operator on a DIFFERENT tailnet node runs the
   verification checklist (see below) and only then cancels the watchdog:
   `atrm <job>` / `systemctl stop jwg-watchdog.timer` /
   `tmux kill-session -t jwg-watch`.
5. The watchdog is re-armed (fresh 15m window) after every single route add
   until the full set is proven; it is NEVER cancelled until verification
   from an external node passes.
## Config templates (placeholders, NOT live values; nothing applied)

### wg0.conf (jellysa)

```ini
# /etc/wireguard/wg0.conf  (chmod 600, root:root)
# WARNING: private key is a placeholder. No private key exists for this
# peer in this repo; obtain the real key out-of-band or generate with
# `wg genkey` ONLY under operator control.
[Interface]
# jellysa's own tunnel address (supplied)
Address = 10.10.10.105/32
# PLACEHOLDER - real private key goes here; never commit it
PrivateKey = <JELLYSA_WG_PRIVATE_KEY_PLACEHOLDER>
# start with 1420; lower only after PMTU testing (design item 8)
MTU = 1420
# Remote/NAT-safe initial default; change only if Q4 resolves differently.
PersistentKeepalive = 25

[Peer]
# Peer public key (supplied; public, not a secret)
PublicKey = h7zAUZaAvBpypPUlvKfuaLAdegfuFCMigp16Y7W7nGI=
# Remote endpoint (supplied)
Endpoint = 154.126.215.194:13231
# Route-by-route rollout: start with one peer-confirmed test host /32 inside
# the first approved remote subnet. Keepalive can establish the handshake;
# the /32 limits the first routed payload test. Expand to its /24 only after
# that test and the return path pass.
AllowedIPs = <FIRST_PEER_CONFIRMED_TEST_HOST/32>
```

Critical: until Q1 and the first approved test host are confirmed, do not send
payload traffic and do not add all nine /24s. `PersistentKeepalive` can prove
the cryptographic peer handshake without knowing the peer's tunnel address;
the peer's server-side `AllowedIPs` and return route must still be confirmed
before claiming routed connectivity.

### Forwarding scope (kernel switch plus narrow firewall authorization)

```ini
# /etc/sysctl.d/99-jellysa-wg-routing.conf (template)
# Preserve the live value required by the existing Tailscale exit-node role.
net.ipv4.ip_forward = 1
# If strict rp_filter breaks the asymmetric tunnel path, prefer a reviewed
# per-interface loose setting rather than disabling validation globally:
# net.ipv4.conf.wg0.rp_filter = 2
```

The exit-node file `/etc/sysctl.d/99-tailscale-exit-node.conf` already
enables forwarding for Tailscale exit-node use (plan 016). Preserve that
kernel prerequisite. Scope authorization with stateful firewall rules, not by
setting `ip_forward=0`, which would break both subnet routing and the existing
exit-node role.

Firewall intent (translate only after detecting the live backend):

```text
ALLOW  tailscale0 -> wg0  state NEW,ESTABLISHED  destination in APPROVED_REMOTE_PREFIXES
ALLOW  wg0 -> tailscale0  state ESTABLISHED,RELATED
DROP   wg0 -> tailscale0  state NEW
DROP   wg0 -> any-other-interface
```

The implementation must use an atomic nftables ruleset update or an equivalent
iptables/ufw transaction with an armed rollback timer. Do not paste these
pseudorules as commands.

### Tailscale advertisement (merge, do not drop exit-node flag)

```bash
# Template - NOT executed. Merge into current flags (see preflight prefs).
# Route-by-route: start with the first approved subnet only.
sudo tailscale set \
  --advertise-routes=192.168.14.0/24 \
  --advertise-exit-node=true
```

Use `tailscale set` rather than reconstructing `tailscale up` from memory.
Record the current prefs first, explicitly preserve the exit-node setting, and
read the prefs back after every change. If the installed Tailscale version has
different CLI semantics, STOP and use that version's local `--help` output.

Subnet approval in the Tailscale admin console is a SEPARATE step; an
advertised route is inert until approved there (design item 3).

### ACL / grant policy sketch (tailnet admin)

```hcl
# Example ACL intent - refine in admin console; not applied.
# "src": ["autogroup:member"], "dst": ["100.120.89.41:5201"] # path probes
# "src": ["<approved-node/tag>"], "dst": ["192.168.14.0/24:*"] # one-way
```

The remote subnets must appear as destinations ONLY after approval, and only
for explicitly approved tailnet sources. No rule may grant the remote peer
originating access back into our tailnet.
## Route-by-route rollout (never all nine at once)

Order (suggested, most testable first - adjust to operator preference):

1. `192.168.14.0/24` (lodge) - single /24, minimal blast radius.
2. `192.168.11.0/24` (Andrews Farm).
3. `192.168.21.0/24` (Andrews Farm).
4. `192.168.31.0/24` (Andrews Farm).
5. `192.168.12.0/24` (Pieter).
6. `192.168.22.0/24` (Pieter).
7. `192.168.13.0/24` (other chicken farm).
8. `192.168.23.0/24` (other chicken farm).
9. `192.168.33.0/24` (other chicken farm).

Per route:

- Preflight overlap check for that /24 vs all existing routes.
- Add the subnet to `AllowedIPs` in wg0.conf (or append to the tailscale
  advertise list only after wg0-level routing is proven for it).
- Reload the peer atomically with
  `sudo wg syncconf wg0 <(sudo wg-quick strip wg0)`, then update the complete
  advertised-route list with `tailscale set --advertise-routes=...` only after
  the WireGuard route works.
- Verify from ANOTHER tailnet node (see below).
- Re-arm/cancel the watchdog only after external verification.
- Record result in the plan's progress log before the next route.

## Verification from another tailnet node (never from jellysa itself)

Before cancelling any watchdog, an operator on a DIFFERENT tailnet node
(e.g. jellybase `100.125.86.118` or jellyhome `100.90.175.59`) must confirm
ALL of:

- `tailscale status` shows jellysa peer up (`100.120.89.41`).
- `tailscale status` (or admin console) shows the expected advertised
  routes for the current stage and their approved state.
- Path probe succeeds INTO an approved destination, e.g.:
  `ping -c 3 <target-in-approved-subnet>` and
  `ssh -o ConnectTimeout=5 <approved-user>@<target>` (only for approved
  services; do not probe unapproved subnets).
- Handshake is fresh on jellysa: `wg show wg0 latest-handshakes` is recent
  AND `wg show wg0 transfer-rx` is increasing for the probe traffic.
- Negative checks: route/policy inspection shows no route for any unapproved
  prefix; if the peer designates a safe negative-test host, an attempted NEW
  flow to it is denied. Do not probe arbitrary private addresses. Confirm
  `ip route show table all` contains no default route from wg0 and no
  `0.0.0.0/0` WireGuard `AllowedIPs` entry.
- From the admin console: no ACL rule grants remote-originated access into
  our tailnet (one-way direction held).
- rp_filter/MTU items show no drops (`wg show wg0` counters clean;
  `ip -s link show wg0` no excessive errors).

## Reboot test (only after explicit operator approval)

After the first full route passes external verification, and ONLY with
approved go-ahead:

1. Snapshot: preflight rerun (routes/flags/handshake).
2. Re-arm watchdog with a longer window (e.g. 30m).
3. `sudo reboot` jellysa.
4. Confirm: `tailscale0` and `wg0` both auto-start; handshake re-establishes
   without operator input; advertised routes reappear; the approved subnet is
   reachable from another node.
5. Record reboot evidence; cancel watchdog only after external pass.
   Do NOT run reboot during an unverified stage.

## Documentation / inventory files likely to update

- `inventory/hosts.yml` - jellysa entry: add `wg0`, `wireguard-address`,
  `wireguard-endpoint`, `advertised-routes` (nine subnets), `subnet-router`.
- `inventory/services.yml` - if remote-subnet services become managed
  (service placement/URLs/status).
- `docs/plans/018-jellysa-tailscale-wireguard-routing.md` - THIS plan:
  status, evidence, resolved questions.
- `docs/operations/` - new or updated runbook for jellysa WireGuard routing
  (mirroring the seedit4me ops-doc pattern).
- `docs/roadmap/product-roadmap.md` - gap register entries for
  subnet-router enablement.
- `docs/plans/016-jellysa-and-jellybackup-onboarding.md` - cross-reference
  the routing plan.
- `docs/specs/` - only if a host-firewall change on jellysa is later
  approved (spec 007 covers the policy).
- Prometheus scrape configs (jellybase) - only if remote-subnet targets are
  added to monitoring; keep 5m/30s cadence per plan 016.

## Stop / go gates

- G0 (GO from plan to preflight): operator confirms this document's facts;
  peer Q1-Q7 answered or explicitly deferred.
- G1 (GO to create wg0): preflight complete, TWO access paths verified or
  on-site recovery confirmed, backups taken and verified, watchdog armed.
- G2 (GO to add FIRST route): wg0 handshake SUCCESS from another node;
  negative checks pass; first route approved in admin console.
- G3 (GO per subsequent route): previous route verified externally;
  watchdog re-armed; overlap check passed for the new /24.
- G4 (GO to reboot test): at least the first route proven across a full
  external verification; operator explicitly approves.
- STOP conditions (halt immediately, restore via watchdog/rollback):
  - Tailscale SSH lost while wg0 not yet proven.
  - Handshake fails after a route add and does not recover within the
    watchdog window.
  - Any `0.0.0.0/0` or default-route entry appears.
  - Any unapproved subnet becomes reachable.
  - Any sign the remote peer can originate into our tailnet.

## Rollback commands (templates only - NOT executed, NOT live)

```bash
# 1) Immediate removal of wg0 routes (restores tailscale-only routing)
sudo wg-quick down wg0

# 2) Remove just the last added subnet from wg0.conf and resync the full peer
sudo wg syncconf wg0 <(sudo wg-quick strip wg0)

# 3) Restore the captured sysctl files, then reload only that reviewed file.
#    Do not set global ip_forward=0; jellysa's exit-node role requires it.
sudo sysctl -p /etc/sysctl.d/<captured-reviewed-file>

# 4) Restore tailscale prefs from snapshot if Tailscale itself changed
#    (use flags captured in preflight backup; never commit secrets)
sudo tailscale set --advertise-routes=<captured-list> --advertise-exit-node=<captured-boolean>

# 5) Cancel watchdog ONLY after external verification passes
#    atrm <job>  |  systemctl stop jwg-watchdog.timer  |  tmux kill-session -t jwg-watch
```

These are documentation-of-intent templates. They have NOT been executed.
Live execution requires explicit operator approval plus re-armed watchdog.

## Acceptance evidence

The plan is "proven" only when the following evidence set exists:

- [ ] Preflight snapshot dated and stored (routes, flags, firewall, rp_filter, MTU).
- [ ] Backup manifest with sha256sums; rollback.sh executable.
- [ ] `wg0` handshake SUCCESS recorded from another tailnet node.
- [ ] Each of the nine subnets verified reachable FROM another tailnet node,
      one at a time, with timestamps.
- [ ] Negative checks pass: no default route, no 0.0.0.0/0, no unapproved
      subnet reachable, no remote-originated access into our tailnet.
- [ ] Tailscale admin console shows exactly the nine approved routes.
- [ ] ACL policy restricts route access to approved nodes/tags.
- [ ] Reboot test passed after explicit approval; both interfaces auto-start.
- [ ] Watchdog armed/cancelled log shows arm-before-mutation and
      cancel-after-external-verification for every stage.
- [ ] inventory/docs updated to match proven state.
- [ ] This plan's Status field flipped from "planned" to "live" only by an
      authorized operator, with the evidence links attached.

## State distinction (what each layer means)

| Layer | What it is | Current status |
| --- | --- | --- |
| Source plan | This document's intent and gates | Planned |
| Staged config | Templates in this file; restart content, not runtime | Not applied |
| Live execution | Commands run on jellysa | NONE performed |
| Tailscale admin route approval | Admin console route enablement | Not performed |
| ACL/grant policy | Tailnet access rules | Not performed |
| Proven runtime | Verified working end-to-end after reboot | Not reached |

No success is claimed. This is a plan for review, not a record of execution.
