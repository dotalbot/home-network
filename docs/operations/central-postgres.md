# Central PostgreSQL Operations

Central PostgreSQL is planned as the shared database service for home-network applications, starting with Manyfold.

## Runtime host

Proposed first host:

```text
jellybase / 192.168.1.2
```

Compose service/container:

```text
central-postgres
```

Persistent data path:

```text
/opt/docker/appdata/postgres/data
```

## Secrets

Do not commit real passwords to Git and do not paste them into chat.

The first-run superuser password is expected at:

```text
/opt/docker/.secrets/postgres_superuser_password
```

Recommended permissions:

```bash
sudo install -d -m 750 -o root -g dockerops /opt/docker/.secrets
sudo touch /opt/docker/.secrets/postgres_superuser_password
sudo chown root:dockerops /opt/docker/.secrets/postgres_superuser_password
sudo chmod 640 /opt/docker/.secrets/postgres_superuser_password
```

Then edit it directly on the host with your preferred editor, for example:

```bash
sudo nano /opt/docker/.secrets/postgres_superuser_password
```

Use a long random password. The file should contain only the password and a trailing newline is OK.

Later, each app should get a separate password file, for example:

```text
/opt/docker/.secrets/postgres_manyfold_password
```

## First deploy checklist

Run from the home-network repo on the target host after the secret file exists:

```bash
just compose-config
just up central-postgres
```

Verify locally:

```bash
docker inspect central-postgres --format '{{.State.Health.Status}}'
docker exec central-postgres pg_isready -U postgres -d postgres
```

If LAN binding is enabled, verify from an app host such as `jellyhome`:

```bash
nc -vz 192.168.1.2 5432
```

## Backup/restore notes

Current backup class: `appdata-and-database`.

Minimum restore path:

1. Restore `/opt/docker/appdata/postgres/data` from Borg.
2. Ensure `/opt/docker/.secrets/postgres_superuser_password` exists on the host.
3. Deploy `central-postgres`.
4. Verify `pg_isready`.

Future hardening should add periodic logical dumps using `pg_dumpall` or per-database `pg_dump`, stored outside `/opt/docker/.secrets` and covered by the backup policy.

## Open decisions

- Whether to expose `192.168.1.2:5432` on the LAN immediately or bind localhost-only first.
- Whether `postgres:17-alpine` is the preferred version.
- Whether app users should be created manually first or through an idempotent bootstrap script.
