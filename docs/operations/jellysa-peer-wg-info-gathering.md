# jellysa ↔ Remote Peer (MikroTik) — Information Gathering Guide for WireGuard

**Purpose:** unblock plan 018 (jellysa Tailscale + WireGuard) by collecting the few peer-side facts that cannot be guessed. This is **read-only** — none of these commands change anything on the remote router. For the operator at `154.126.215.194:13231`.

> Security: **never send private keys or passwords.** All values requested below are public/tunnel config (a WG public key is not secret). The only secret on the MikroTik is its `private-key`, which must stay on the box.

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
> /ip address print where interface=wireguard1
> ```
> Send us: the WireGuard interface name, its **IP/prefix** (that's your tunnel address), the **MTU**, and confirm the **public key** shown matches ours: `h7zAUZaAvBpypPUlvKfuaLAdegfuFCMigp16Y7W7nGI=`.
>
> **2. What your router will route back to us.** For the peer entry that represents us (jellysa), send us its `allowed-address`. Standard behaviour would be `10.10.10.105/32` — please confirm, because that value is what determines return routing to our tunnel IP. Also send its `persistent-keepalive` if set.
> ```
> /interface wireguard peers print detail
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
/interface wireguard peers print detail
/ip address print where interface=wireguard1
/ip route print detail
/ip firewall filter print
/ip firewall nat print
/interface print
/interface pppoe-client print
/system resource print
```
If the WG interface is not named `wireguard1`, adjust the `/ip address` filter to the real name from the first command (or just run `/ip address print` and pick it out).

To pull **exactly the peer entry for jellysa** (once our public key is installed) by key:
```
/interface wireguard peers print detail where public-key=="<jellysa-public-key>"
```
(Until our key is installed, run the full `/interface wireguard peers print detail` and identify ours by comment/description.)

---

## PART C — What each value tells us (maps to plan Q1–Q7)

| # | Command | Value requested | Answers |
|---|---|---|---|
| 1 | `/interface wireguard print detail` + `/ip address print where interface=<wg>` | server tunnel IP/prefix, MTU, public key | **Q1** (peer tunnel address / subnet layout), Q6 (MTU) |
| 2 | `/interface wireguard peers print detail` | `allowed-address` + `persistent-keepalive` for the jellysa peer | **Q1** (return routing / server-side AllowedIPs), Q4 (NAT/keepalive) |
| 3 | `/ip route print detail` | gateway/interface for each of the 9 subnets | **Q2** (single peer vs second hop), Q5 (route overlap sanity) |
| 4 | `/ip firewall filter print` / `/ip firewall nat print` | whether `10.10.10.105` is allowed; masquerade/NAT | **Q3** (source accepted by peer firewall), Q4 (NAT) |
| 5 | `/interface print` / `/interface pppoe-client print` | WAN/tunnel MTU, PPPoE presence | **Q6** (forced tunnel MTU) |
| 6 | (operator picks a host) | one safe test IP, ideally in `192.168.14.0/24` | first route-by-route milestone |
| 7 | n/a (out-of-band agreement) | confirm one-way direction + backup-destination evolution | direction + Phase-2 intent |
| — | `/system resource print` | RouterOS version (confirm RouterOS 7.x WG support) | sanity |

---

## PART D — Things we already know about the peer (do not re-ask)
- Remote WireGuard endpoint: `154.126.215.194:13231` (UDP).
- Peer public key: `h7zAUZaAvBpypPUlvKfuaLAdegfuFCMigp16Y7W7nGI=` (the MikroTik's WG key; **public**, not secret).
- Then offset the tunnel: the supplied `10.10.10.105/32` is **jellysa's** address only; the MikroTik's own tunnel IP and its `allowed-address` for us are what PART A #1/#2 extract.