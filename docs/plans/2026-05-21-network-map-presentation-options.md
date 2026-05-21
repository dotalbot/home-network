# Network Map Presentation Options Plan

Goal: improve the existing network graph so it is less squashed, while showing three alternative presentation patterns in the interface for comparison.

Scope:
- Keep the existing static dashboard under `docker/appdata/network-map/site`.
- Preserve filters, inventory cards, clickable device details, and inferred-link wording.
- Show all visual options on the page at the same time so the preferred direction can be chosen later.

Options to render:
1. Expanded topology graph: larger canvas, smaller cards, grouped LAN/Tailnet lanes, clearer inferred links.
2. Zone lanes: LAN, Tailnet, management, and quiet/unknown device swimlanes for fast scanning.
3. Service matrix: devices by important open ports/services to reveal which boxes expose what.
4. Operations board: management/service-density/confidence cards to prioritise follow-up.

Acceptance criteria:
- The topology graph no longer crowds 33 nodes into a small oval.
- All four visual options use the same active filters.
- Clicking devices in any option updates the Selected device panel.
- No inline event handlers; use `data-*` plus `addEventListener`.
- Inventory-derived strings are escaped before insertion into `innerHTML`.
- Static checks pass: `node --check`, JSON validation, no `onclick=`, `git diff --check`, and `just network-map-render`.

Verification notes:
- Verify the generated dashboard loads locally and visually inspect the network map.
- If deployed during this change, verify the live endpoint after `just sync-docker-config` or `just homepage-deploy`.
