# Jellybot Operator Bootstrap

## Purpose

Use this runbook when preparing a future machine to participate in the `home-network` deployment model.

The target outcome is a `jellybot` operator account that can:

- clone and refresh application repositories from GitHub,
- run Docker Compose deployments through the `docker` group,
- write repo-managed runtime config into `/opt/docker` through the `dockerops` group,
- receive SSH deployment commands from trusted operator hosts such as `jellyberry`, and
- keep secrets outside Git under `/opt/docker/.secrets`.

This is the base setup required for code refresh deployments such as:

```text
Hermes on jellyberry
  -> SSH to jellyhome/future-host as jellybot
  -> git fetch + git pull --ff-only app repo
  -> sync home-network config to /opt/docker
  -> docker compose up -d --build --force-recreate selected services
```

## Security model

The `jellybot` operator account is high trust.

Membership in the Docker group is effectively root-equivalent because Docker can mount host filesystems and start privileged containers. Membership in `dockerops` allows writing deployment config and appdata under `/opt/docker`.

Only use this account on trusted homelab hosts.

Do not print, paste, or commit private SSH keys. Public keys are safe to copy.

## Key concepts

There are two separate SSH trust paths:

### 1. Runtime host to GitHub

Each runtime host needs a `jellybot` SSH key that GitHub trusts so it can pull private repositories.

Example:

```text
future-host:/home/jellybot/.ssh/id_ed25519_github      # private key, never shared
future-host:/home/jellybot/.ssh/id_ed25519_github.pub  # public key, add to GitHub
```

Add the public key at:

```text
https://github.com/settings/keys
```

Suggested title:

```text
jellybot-<hostname>
```

### 2. Operator host to runtime host

The host running Hermes, commonly `jellyberry`, needs SSH access to the runtime host as `jellybot`.

That means copying the source host's public key into the runtime host's:

```text
/home/jellybot/.ssh/authorized_keys
```

Example:

```text
jellyberry:/home/jellybot/.ssh/id_ed25519.pub
  -> future-host:/home/jellybot/.ssh/authorized_keys
```

This allows commands like:

```bash
ssh jellybot@future-host 'hostname -s && git --version && docker --version'
```

## Helper script

The repo includes:

```text
scripts/bootstrap-jellybot-operator
```

The script is intended to be run on the target/future machine with sudo/root.

It does the following:

- creates the `jellybot` user if missing,
- creates/uses `docker` and `dockerops` groups,
- adds `jellybot` to both groups,
- creates `/opt/docker`, `/opt/docker/appdata`, `/opt/docker/hosts`, `/opt/docker/bin`, and `/opt/docker/.secrets`,
- fixes the top-level managed `/opt/docker` directory ownership/modes for `root:dockerops`,
- creates `/opt/docker/.env` with `TZ=Europe/London` if missing,
- creates `/home/jellybot/.ssh`,
- optionally appends one validated operator host public key to `authorized_keys`,
- generates a GitHub SSH key for `jellybot`, and
- prints only the public GitHub key to add to GitHub.

The helper intentionally does not recursively rewrite existing nested appdata/config ownership under `/opt/docker`. Use service-specific runbooks for existing stateful data.

The script does **not** install Docker. Install Docker Engine and the Docker Compose plugin separately first, or use the host bootstrap docs for that step.

## Dry run

On a brand-new host, get the helper onto the machine first. Options:

- clone `home-network` as your existing admin user,
- copy only `scripts/bootstrap-jellybot-operator` to `/tmp`, or
- run it from removable/bootstrap media.

Preview actions:

```bash
cd /path/to/home-network
sudo ./scripts/bootstrap-jellybot-operator \
  --github-email jellybot@example.local \
  --dry-run
```

## Basic bootstrap

Run on the new host:

```bash
cd /home/jellybot/home-network
sudo ./scripts/bootstrap-jellybot-operator \
  --github-email jellybot@example.local
```

Replace the email/comment with the label you want embedded in the SSH public key comment. It does not have to be a real mailbox, but using a recognizable label helps when reviewing GitHub keys.

## Bootstrap with operator-host SSH access

First, get the public key from the source/operator host, for example `jellyberry`:

```bash
sudo -iu jellybot sh -c 'ls -1 ~/.ssh/*.pub 2>/dev/null'
sudo -iu jellybot sh -c 'cat ~/.ssh/id_ed25519.pub'
```

Copy that public key to the target host, then run:

```bash
sudo ./scripts/bootstrap-jellybot-operator \
  --github-email jellybot@example.local \
  --authorized-key-file /tmp/jellyberry-jellybot.pub
```

Or pass the public key text directly:

```bash
sudo ./scripts/bootstrap-jellybot-operator \
  --github-email jellybot@example.local \
  --authorized-key 'ssh-ed25519 AAAA... jellybot@jellyberry'
```

Only public keys go here. Never pass a private key.

## Add the host key to GitHub

The helper creates an unencrypted SSH private key (`-N ""`) so unattended deployment can pull repositories without an interactive passphrase prompt. Protect it with host trust and strict `~/.ssh` permissions; do not copy or print the private key.

After the helper runs, it prints the generated GitHub public key.

Add that public key to GitHub:

```text
https://github.com/settings/keys
```

Choose:

```text
New SSH key
```

Suggested title:

```text
jellybot-<hostname>
```

Then verify on the host:

```bash
sudo -iu jellybot ssh -T git@github.com
```

On the first connection, SSH may ask to trust GitHub's host key. Confirm the fingerprint against GitHub's published SSH key fingerprints before accepting:

```text
https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
```

Expected result:

```text
Hi <github-user>! You've successfully authenticated, but GitHub does not provide shell access.
```

If GitHub blocks SSH port 22, add this to `/home/jellybot/.ssh/config`:

```sshconfig
Host github.com
  HostName ssh.github.com
  User git
  Port 443
  IdentityFile ~/.ssh/id_ed25519_github
  IdentitiesOnly yes
```

## Verify account and permissions

After adding the user to groups, start a fresh login/session. Existing shells will not always pick up group membership.

Verify:

```bash
id jellybot
sudo -iu jellybot groups
sudo -iu jellybot test -w /opt/docker && echo '/opt/docker writable'
stat -c '%A %U %G %n' /opt/docker /opt/docker/appdata /opt/docker/hosts /opt/docker/.secrets /opt/docker/.env
```

Expected shape:

```text
jellybot is in docker and dockerops
/opt/docker is root:dockerops and group-writable
/opt/docker/appdata is root:dockerops and group-writable
/opt/docker/hosts is root:dockerops and group-writable
/opt/docker/.secrets is root:dockerops and mode 2770 or equivalent restricted group access
/opt/docker/.env is root:dockerops and mode 660
```

Verify Docker access:

```bash
sudo -iu jellybot docker ps
```

## Prepare repositories

Clone `home-network` and any app repos the host will build locally:

```bash
sudo -iu jellybot git clone git@github.com:dotalbot/home-network.git /home/jellybot/home-network
sudo -iu jellybot git clone git@github.com:dotalbot/3dprint_loader.git /home/jellybot/3dprint_loader
```

If the repositories already exist, refresh them safely:

```bash
sudo -iu jellybot sh -c 'cd /home/jellybot/home-network && git fetch origin && git pull --ff-only'
sudo -iu jellybot sh -c 'cd /home/jellybot/3dprint_loader && git fetch origin && git pull --ff-only'
```

## Verify remote deployment access

From the operator host, for example `jellyberry`:

```bash
ssh jellybot@future-host 'hostname -s && whoami && id && test -w /opt/docker && echo opt-docker-writable'
```

Then verify GitHub from the runtime host through SSH:

```bash
ssh jellybot@future-host 'ssh -T git@github.com || true'
```

GitHub returns a non-shell message and may exit non-zero; the key part is that it greets the account instead of denying authentication.

## Use with cross-repo deployment

Once this runbook is complete, use:

```text
docs/operations/cross-repo-app-deployment.md
docs/runbooks/adopt-project-service-template.md
```

The deployment refresh step should remain Git-first:

```bash
cd /home/jellybot/<app-repo>
git fetch origin
git checkout <branch>
git pull --ff-only origin <branch>
```

Then recreate selected services from `/opt/docker`:

```bash
cd /opt/docker
docker compose \
  --env-file .env \
  -f docker-compose.yml \
  -f hosts/$(hostname -s).yaml \
  up -d --build --force-recreate <service-name>
```

## Troubleshooting

### `Permission denied (publickey,password)` when SSHing to the runtime host

The operator host public key is missing from:

```text
/home/jellybot/.ssh/authorized_keys
```

Copy only the `.pub` key from the operator host.

### `git@github.com: Permission denied (publickey)`

The runtime host's `jellybot` GitHub public key has not been added to GitHub, or SSH is using the wrong identity.

Check:

```bash
sudo -iu jellybot ssh -vT git@github.com
sudo -iu jellybot cat ~/.ssh/config
sudo -iu jellybot ls -l ~/.ssh/id_ed25519_github ~/.ssh/id_ed25519_github.pub
```

Do not paste private key output into chat or docs.

### `test -w /opt/docker` fails

Check permissions:

```bash
stat -c '%A %U %G %n' /opt/docker /opt/docker/appdata /opt/docker/hosts
id jellybot
```

Fix group permissions:

```bash
sudo chown -R root:dockerops /opt/docker
sudo chmod -R g+rwX /opt/docker
sudo find /opt/docker -type d -exec chmod g+s {} \;
sudo chmod 2770 /opt/docker/.secrets
sudo chmod 660 /opt/docker/.env
```

Start a fresh `jellybot` login/session afterward.
