# jellysa ↔ Remote Peer (MikroTik) — Information Gathering Guide for WireGuard

**Purpose:** unblock plan 018 (jellysa Tailscale + WireGuard) by collecting the few peer-side facts that cannot be guessed. This is **read-only** — none of these commands change anything on the remote router. For the operator at `154.126.215.194:13231`.

> Security: **never send private keys, preshared keys, passwords, PPPoE credentials, or output produced with `show-sensitive`.** The requested WireGuard public key and tunnel-routing values are not secrets.

---

## PART A — The message to send to the remote operator

> **Subject: Reading a few values off your router so we set up the WireGuard link correctly**
>
> Hi,
>
> We're standing up a Tailscale + WireGuard path so our home-lab can reach your approved subnets, and later so you can route **to** us (we'll be a backup destination). Before we start the tunnel we need a handful of read-only values from your MikroTik so we configure it correctly. **Nothing you run will change anything** — these are all reads. Please don't send private keys or passwords.
>
> **1. Your tunnel address (the peer side we tunnel to).** In a MikroTik terminal (Winbox → New Terminal, or WebFig → Terminal, or SSH):
> ```
> /interface wireguard print detail
> /ip address print detail where interface="WG-Rhenosterfontein"
> ```
> Send us: the WireGuard interface name, its **IP/prefix** (that's your tunnel address), the **MTU**, and confirm the **public key** shown matches ours: `h7zAUZaAvBpypPUlvKfuaLAdegfuFCMigp16Y7W7nGI=`.
>
> **2. What your router will route back to us.** For the peer entry that represents us (jellysa), send us its `allowed-address`. Standard behaviour would be `10.10.10.105/32` — please confirm, because that value is what determines return routing to our tunnel IP. Also send its `persistent-keepalive` if set.
> ```
> /interface wireguard peers print detail where name="Dom"
> ```
>
> **3. How the nine subnets route on your side (single hop vs second hop).** Send us the gateway/interface for each of: `192.168.11/21/31`, `192.168.12/22`, `192.168.13/23/33`, `192.168.14` (all `.0/24`). Specifically: are they all reachable **directly** through the WireGuard-facing router, or does any need a **second hop / another gateway** (i.e. are they behind more than one device)?
> ```
> /ip route print detail
> ```
>
> **4. Your firewall + NAT** (so we know our source `10.10.10.105` will be accepted, and whether NAT/keepalive applies):
> ```
> /ip firewall filter print
> /ip firewall nat print
> ```
>
> **5. Path MTU:** any PPPoE or low-MTU link on the tunnel path would force a lower tunnel MTU:
> ```
> /interface print
> /interface pppoe-client print
> ```
> If the WAN/tunnel uses PPPoE or an MTU below ~1420, tell us the value.
>
> **6. One test host.** Pick any single machine behind you that's safe for us to ping/SSH — ideally inside `192.168.14.0/24` (Lodge). Send its IP. We'll use it as the very first route-by-route check and won't touch anything else until it's proven.
>
> Also, please confirm two things so nothing is assumed: (a) our plan's direction — we initiate **to your approved subnets**, you do not originate back into our network; and (b) agreement to the later evolution where **you route to us and we act as a backup destination**.
>
> Thanks — this avoids a round of guess-and-debug.

---

## PART B — Copy-paste command set for the operator (MikroTik RouterOS 7)

How to run: **Winbox** login → top-left **New Terminal**; **WebFig** → **Terminal**; or `ssh admin@<router-ip>` (RouterOS 7's built-in terminal accepts the same commands).

Paste this whole block into the terminal (read-only):
```
/interface wireguard print detail
/interface wireguard peers print detail where name="Dom"
/ip address print detail where interface="WG-Rhenosterfontein"
/ip route print detail
/ip firewall filter print
/ip firewall nat print
/interface print
/interface pppoe-client print
/system resource print
```
The live interface is now confirmed as `WG-Rhenosterfontein`; keep the quoted name because it contains a hyphen.

The `name="Dom"` filter is intentional: it avoids collecting unrelated peers' public keys, names, traffic counters, and current endpoint IPs. If the peer has a different name, identify it locally in Winbox and substitute that exact name; do not send a full peer dump.

The route/firewall/NAT/interface commands are broader because their rule order and next hops matter. Before sending their output outside the trusted operator group, redact unrelated public endpoint IPs, peer/customer names, interface comments, PPPoE usernames, and any accidental credential material. Never use `show-sensitive`.

---

## PART C — What each value tells us (maps to plan Q1–Q7)

| # | Command | Value requested | Answers |
|---|---|---|---|
| 1 | `/interface wireguard print detail` + `/ip address print where interface=<wg>` | server tunnel IP/prefix, MTU, public key | **Q1** (peer tunnel address / subnet layout), Q6 (MTU) |
| 2 | `/interface wireguard peers print detail where name="Dom"` | `allowed-address` + `persistent-keepalive` for the jellysa peer | **Q1** (return routing / server-side AllowedIPs), Q4 (NAT/keepalive) |
| 3 | `/ip route print detail` | gateway/interface for each of the 9 subnets | **Q2** (single peer vs second hop), Q5 (route overlap sanity) |
| 4 | `/ip firewall filter print` / `/ip firewall nat print` | whether `10.10.10.105` is allowed; masquerade/NAT | **Q3** (source accepted by peer firewall), Q4 (NAT) |
| 5 | `/interface print` / `/interface pppoe-client print` | WAN/tunnel MTU, PPPoE presence | **Q6** (forced tunnel MTU) |
| 6 | (operator picks a host) | one safe test IP, ideally in `192.168.14.0/24` | first route-by-route milestone |
| 7 | n/a (out-of-band agreement) | confirm one-way direction + backup-destination evolution | direction + Phase-2 intent |
| — | `/system resource print` | RouterOS version (confirm RouterOS 7.x WG support) | sanity |

---

## PART D — Verified peer facts received from Piet (2026-09-02)
- Remote endpoint is Piet's MikroTik WAN: `154.126.215.194:13231/udp`.
- Router: MikroTik RouterOS `7.24.1`; WG interface `WG-Rhenosterfontein` is running.
- MikroTik WG address: `10.10.10.11/24`; interface public key matches `h7zAUZaAvBpypPUlvKfuaLAdegfuFCMigp16Y7W7nGI=`; MTU `1420`.
- PPPoE actual MTU is `1480`, so IPv4 WireGuard MTU `1420` fits exactly; retain PMTU testing as a gate.
- Existing MikroTik peer named `Dom`: `allowed-address=10.10.10.105/32`, `persistent-keepalive=25s`, no handshake yet.
- Approved route topology from Piet's router:
  - directly connected: `192.168.11.0/24`, `192.168.21.0/24`;
  - via next hop `192.168.21.254`: `192.168.31.0/24`;
  - onward through Piet's WireGuard hub: `192.168.12.0/24`, `192.168.22.0/24`, `192.168.13.0/24`, `192.168.23.0/24`, `192.168.33.0/24`, `192.168.14.0/24`.
- Other routed networks (`192.168.15.0/24`, `.19.0/24`, `.100.0/24`, `.151.0/24`) are **not approved** and stay excluded.
- The MikroTik firewall permits broad NEW forwarding for source `10.10.10.0/24` through the WG interface. Our phase-1 safety therefore depends on fail-closed INPUT and FORWARD rules on jellysa (and ideally a narrow destination-side rule on Piet's router later).


## PART E — Remaining answers/actions (do not start the tunnel until resolved)
1. **Key replacement required:** no matching private key has been verified on jellysa. Generate a fresh keypair on jellysa and ask Piet to replace **only** the `Dom` peer's `public-key`. Never request, transfer, or commit either side's private key.
2. **First target:** Piet must nominate one safe test host, ideally one IP inside `192.168.14.0/24`.
3. **Remote DNS:** confirm IP-only testing is acceptable for phase 1 (recommended).
4. **Return path on onward routers:** ask Piet to confirm the Rietfontein/onward WireGuard routers **and the `192.168.21.254` second-hop router for `192.168.31.0/24`** route replies for `10.10.10.105/32` back through `WG-Rhenosterfontein`. His central MikroTik has the correct `Dom /32`, but every far-side/second-hop router must also return traffic to it.
5. **Defence in depth:** before live routing, review a MikroTik rule placed before the broad inter-peer accepts that drops NEW WG traffic destined to `10.10.10.105` while phase 1 is one-way. Established replies remain allowed. This is a coordinated future mutation, not part of information gathering.