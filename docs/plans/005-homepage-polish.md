# Homepage polish plan

## Goal

Make the generated Homepage dashboard easier to scan at a glance by adding service icons, more useful grouping/layout defaults, lightweight HTTP status monitors, and quick links to the main operator docs.

## Scope

- Keep Homepage config generated from `inventory/services.yml` where practical.
- Add per-service icon metadata to the service inventory.
- Teach `scripts/homepage-render` to emit icon and safe HTTP `siteMonitor` fields.
- Improve generated `settings.yaml` with a clearer dark visual style and explicit group layout order.
- Generate useful operator bookmarks rather than an empty bookmark file.

## Non-goals

- No secrets, API keys, or authenticated widgets.
- No reverse proxy/TLS changes.
- No live deployment or container restart unless requested separately.

## Acceptance criteria

- `scripts/homepage-render` regenerates Homepage YAML without errors.
- Generated YAML parses successfully.
- Service cards include icons for current active services.
- Plain HTTP services get safe `siteMonitor` checks; non-HTTP and HTTPS/self-signed endpoints do not get forced status checks.
- Bookmarks include repository, roadmap, operations docs, and network map docs links.

## Verification strategy

- Run the renderer.
- Parse every generated Homepage YAML file with Python YAML.
- Run `python -m py_compile scripts/homepage-render`.
- Run `git diff --check`.
- Run repo task summaries where available (`just --summary`).

## Rollback

Revert `inventory/services.yml`, `scripts/homepage-render`, generated Homepage YAML, and this plan file from the branch if the generated Homepage config is not wanted.

## Follow-up: IP address links

Homepage service links should prefer stable LAN IP addresses instead of hostnames so the dashboard remains usable when local DNS or MagicDNS resolution is inconsistent. Keep alternate host metadata in inventory only when it is not rendered as a dashboard link.

## Follow-up: Dozzle agent coverage

Add `jellyberry` as a Dozzle agent peer alongside `jellybase` so the central Dozzle UI on `jellyhome` can show logs from all active Docker hosts.
