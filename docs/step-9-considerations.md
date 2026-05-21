# Step 9 — Bootstrap Strategy, Cross-Platform Considerations and Future Direction

This document captures the design considerations, architectural goals, and future evolution of the bootstrap layer for the `home-network` platform.

Related current planning docs:

```text
docs/specs/home-network-platform-spec.md
docs/roadmap/product-roadmap.md
docs/README.md
```

Use this file for bootstrap-specific direction; use the roadmap for phase sequencing and gap tracking.

The bootstrap system is intended to support:

- fresh machine provisioning
- rebuild/recovery
- platform standardisation
- tooling consistency
- future automation
- future configuration orchestration

The bootstrap layer is part of the broader homelab control-plane architecture.

---

# Core bootstrap philosophy

The bootstrap layer should:

```text
Install missing tooling
Repair expected structure
Avoid destructive changes
Remain idempotent
Stay boring and predictable
```

It should NOT:

```text
Silently mutate production systems
Overwrite unknown configs
Destroy existing Docker data
Become a giant all-in-one platform orchestrator
```

The bootstrap process is intended to establish a known-good operational baseline.

---

# Bootstrap goals

The bootstrap layer should support:

## Fresh host provisioning

Example:

```text
New Ubuntu server
New Raspberry Pi
New Mac workstation
Rebuilt host after failure
```

## Tooling consistency

Every managed system should have:

```text
git
just
docker
tailscale
jq
yq
vim
borgbackup
rsync
```

or platform equivalents.

## Consistent Docker structure

Expected standard layout:

```text
/opt/docker
├── docker-compose.yml
├── appdata/
├── hosts/
└── .secrets/
```

## Consistent operational model

```text
Git repo            = source of truth
/opt/docker         = live deploy location
scripts/            = operational tooling
justfile            = command entrypoint
inventory/*.yml     = metadata and placement
```

---

# Bootstrap architecture direction

The bootstrap layer should eventually become:

```text
bootstrap/
├── bootstrap-ubuntu.sh
├── bootstrap-pi.sh
├── bootstrap-macos.sh
├── bootstrap-windows.ps1
└── bootstrap-common.sh
```

The goal is:

```text
shared concepts
platform-specific implementation
```

NOT:

```text
one cursed mega-script for every OS
```

---

# Ubuntu bootstrap considerations

Ubuntu hosts are the primary infrastructure layer.

Typical roles:

```text
docker-host
dev-server
monitoring-server
backup-node
gpu-node
ai-node
tailscale-router
```

Ubuntu bootstrap should:

- install Docker CE
- install Docker Compose plugin
- install Tailscale
- install just
- install jq/yq
- install BorgBackup
- install rsync
- configure dockerops group
- create /opt/docker structure
- enable required services
- remain rerunnable safely

## Ubuntu bootstrap should NOT

- auto-deploy production containers immediately
- auto-restore Borg data without confirmation
- auto-overwrite host overlays
- auto-delete containers
- auto-run dangerous Docker prune commands

---

# Raspberry Pi bootstrap considerations

Raspberry Pi nodes should be treated as lightweight infrastructure nodes.

Good Pi roles:

```text
netdata-child
dozzle-agent
homepage-secondary
dns
mqtt-bridge
tailscale-router
lightweight-docker-host
backup-relay
```

Avoid using Pis initially for:

```text
prometheus
grafana
heavy AI workloads
large databases
large media stacks
```

## Recommended Pi OS

```text
Raspberry Pi OS Lite 64-bit
```

Avoid desktop variants unless required.

## Docker considerations on Pi

Use:

```text
docker-ce
```

Avoid overly large stacks initially.

## Pi bootstrap priorities

- low memory overhead
- simple services
- predictable recovery
- lightweight monitoring
- Tailscale connectivity
- Borg participation if required

---

# macOS bootstrap considerations

Mac systems should generally be treated as:

```text
thin clients
portable admin workstations
optional dev nodes
```

NOT:

```text
authoritative infrastructure servers
```

## Primary Mac responsibilities

```text
WezTerm
SSH
tmux
chezmoi
git
OpenCode
Claude Code
just
Tailscale
```

## Recommended package manager

```text
Homebrew
```

## Recommended Mac tooling

```text
git
just
tmux
jq
yq
tree
rsync
chezmoi
wezterm
tailscale
htop/btop
```

## Mac bootstrap goals

- standardise tooling
- standardise terminal environment
- standardise SSH setup
- standardise AI tooling
- standardise shell configuration
- support rapid rebuild

---

# Windows future considerations

Windows bootstrap should eventually support:

```text
PowerShell bootstrap
WezTerm
Git
Tailscale
WSL2
OpenSSH
chezmoi
just
```

But Windows should remain:

```text
client/dev environment
```

rather than infrastructure authority.

---

# Future evolution: bootstrap-common.sh

Eventually common logic should move into:

```text
bootstrap/bootstrap-common.sh
```

Potential shared responsibilities:

```text
logging
permission checks
group creation
directory creation
utility functions
verification helpers
```

Platform scripts would then:

```text
source bootstrap-common.sh
```

and implement only platform-specific logic.

---

# Future evolution: Chezmoi integration

Long term direction:

```text
bootstrap installs tooling
chezmoi applies configuration
```

The bootstrap script should eventually:

```text
install chezmoi
pull dotfiles/config
apply machine role templates
```

rather than embedding huge configuration blocks directly.

---

# Future evolution: Machine roles

Future machine role model:

```yaml
roles:
  docker-host
  dev-server
  monitoring-node
  backup-node
  ai-node
  gpu-node
  pi
  thin-client
```

This should eventually drive:

- bootstrap behaviour
- package selection
- service deployment
- Homepage grouping
- monitoring expectations
- backup policy

---

# Future evolution: Bootstrap + deployment integration

Future desired workflow:

```text
Fresh OS install
        ↓
Bootstrap
        ↓
Join Tailscale
        ↓
Clone home-network
        ↓
Sync Docker config
        ↓
Deploy host overlay
        ↓
Restore data if required
```

Long-term target:

```bash
sudo ./bootstrap/bootstrap-ubuntu.sh
just deploy
```

Result:

```text
host joins platform
host becomes observable
host becomes manageable
host becomes rebuildable
```

---

# Future evolution: Recovery support

Bootstrap should support:

```text
full rebuild
partial rebuild
tooling repair
permission repair
docker structure repair
```

without requiring:

```text
full OS reinstall
manual Docker recreation
manual group recreation
manual package reinstall
```

---

# Future evolution: Verification layer

Eventually bootstrap should include:

```text
verification mode
```

Example:

```bash
./bootstrap/bootstrap-ubuntu.sh --verify
```

Checks:

```text
docker installed
tailscale running
required directories exist
group membership correct
required ports reachable
just installed
docker compose working
```

without changing anything.

---

# Future evolution: Host registration

Future possibility:

```text
bootstrap writes host metadata
```

Potential files:

```text
inventory/hosts.yml
inventory/services.yml
inventory/bootstrap-state.yml
```

Potential uses:

- Homepage generation
- monitoring generation
- deployment targeting
- recovery automation
- Hermes operational awareness

---

# Future evolution: Secrets management

Current state:

```text
.env
.secrets/
manual secret handling
```

Future direction:

```text
1Password CLI
Bitwarden CLI
sops
age
```

Avoid:

```text
random secrets scattered across shell rc files
hardcoded API keys in scripts
```

---

# Future evolution: Operational maturity

Current maturity:

```text
manual deploy + scripts + Git
```

Future maturity:

```text
bootstrap
verification
inventory-driven deployment
Homepage generation
monitoring integration
Hermes operational assistance
rebuild automation
```

Without drifting into:

```text
unnecessary Kubernetes complexity
```

---

# Design principle reminders

## Prefer boring systems

```text
boring = reliable
reliable = maintainable
```

## Git remains the authority

```text
Git repo = truth
Live host = deployed state
```

## Do not hide infrastructure state in GUIs

Avoid:

```text
Portainer-only configuration
manual GUI drift
untracked edits
```

## Bootstrap should repair, not surprise

A rerun should:

```text
install missing things
repair structure
fix permissions
```

NOT:

```text
destroy running services
wipe volumes
overwrite secrets
```

---

# Long-term strategic direction

The platform is gradually becoming:

```text
personal infrastructure platform
```

rather than:

```text
random Docker hosts
```

That means:

- reproducibility matters
- documentation matters
- inventory matters
- recovery matters
- operational discipline matters

The bootstrap layer is one of the key foundations for that maturity.

---

# Final guiding principle

The goal is:

```text
A dead machine should be an inconvenience, not a disaster.
```
