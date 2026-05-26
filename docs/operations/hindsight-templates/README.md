# Hindsight Bank Templates

These files are starter bank templates for the central Hindsight instance on `jellyhome`.

What they are:
- reusable bank configuration manifests
- importable via Hindsight bank template API/UI
- a way to predefine missions, directives, and mental models

What they are not:
- they do not preload historical memories
- they do not replace a retain/import pipeline for docs or conversations

Included templates:
- `global-dominic.json`
- `hermes-main.json`
- `home-network-main.json`
- `logk-main.json`
- `portfolio-intel-main.json`

Import options:

1. UI
- Create the target bank in the Hindsight UI
- Use the bank import/template option
- Upload the matching JSON file

2. API
```bash
curl -fsS -X POST \
  -H 'Content-Type: application/json' \
  --data @docs/operations/hindsight-templates/hermes-main.json \
  http://192.168.1.1:18888/v1/default/banks/hermes-main/import
```

Suggested rollout order:
1. `global-dominic`
2. `hermes-main`
3. `home-network-main`
4. project-specific banks such as `logk-main` and `portfolio-intel-main`

Recommended pattern:
- keep `global-dominic` sparse
- use project banks for project-specific facts
- retain stable docs/conversations into the matching bank after importing the template
