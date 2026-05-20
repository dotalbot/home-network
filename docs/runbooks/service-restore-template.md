# Service Restore Template

Service:
Host:
Backup class:

---

# Restore steps

## 1. Verify host healthy

```bash
just status
```

---

## 2. Stop service

```bash
just down SERVICE
```

---

## 3. Restore Borg data

Restore:

```text
/opt/docker/appdata/SERVICE
```

and any related:
- databases
- libraries
- media
- config

---

## 4. Verify permissions

Typical examples:

```text
Prometheus → 65534:65534
Grafana    → 472:472
Netdata    → 201:201
```

---

## 5. Start service

```bash
just up SERVICE
```

---

## 6. Verify logs

```bash
just logs SERVICE
```

---

## 7. Verify UI/API

Check:
- URL
- API health
- expected data

---

# Recovery complete
