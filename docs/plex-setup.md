# Plex Setup Guide

This document provides step-by-step instructions for integrating Plex with Seerr.

---

## Prerequisites

- Plex Media Server running on your network (or accessible remotely).
- Admin access to your Seerr instance.
- Your **X-Plex-Token** (see below).

---

## 1. Obtaining Your X-Plex-Token

The X-Plex-Token authenticates Seerr's API calls to your Plex server. It is
stored in Seerr's settings file (the same place as other server secrets such as
the Jellyfin API key).

### Method A: Via Plex Web (recommended)

1. Open [Plex Web](https://app.plex.tv/desktop) and sign in with your Plex
   account.
2. Navigate to any media item in your library.
3. Click the **⋮** (More) menu → **Get Info** → **View XML**.
4. Look at the browser URL — it will contain `X-Plex-Token=XXXXXXXXXXXXXXXX`.
5. Copy the token value.

### Method B: Via Plex's official method

Follow Plex's official documentation:
<https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/>

---

## 2. Obtaining the Machine Identifier

The machine identifier uniquely identifies your Plex Media Server. Seerr uses
it to verify it is talking to the correct server.

1. In a browser, open:
   ```
   http://<your-plex-server-ip>:32400/identity
   ```
   No token is required for this endpoint.
2. The response XML contains a `machineIdentifier` attribute. Copy its value.

Alternatively, Seerr can populate this automatically when you save the Plex
settings — it contacts your server and reads the identifier from the response.

---

## 3. Configuring Plex in Seerr

1. Log into Seerr as an administrator.
2. Go to **Settings** → **Plex**.
3. Fill in the form fields:

| Field | Description | Example |
|-------|-------------|---------|
| **Hostname or IP Address** | LAN IP or hostname of your Plex server | `192.168.1.50` |
| **Port** | Port Plex listens on | `32400` |
| **Use SSL** | Enable if your server is configured for HTTPS | ☑ if using `https://` |
| **X-Plex-Token** | Your Plex authentication token | `abcXYZ1234` |
| **Web App URL** *(optional)* | Override the Plex Web URL for deep links | `https://app.plex.tv/desktop` |

4. Click **Save**. Seerr will:
   - Connect to your server.
   - Populate the **Machine ID** field automatically.
   - Display a success or failure toast.

5. After saving, click **Sync Libraries** to import your Plex library list.

6. Toggle the libraries you want Seerr to manage (movies, TV shows, etc.).

---

## 4. Library Management

After a successful connection:

- Enabled libraries are scanned by Seerr to determine which titles are already
  available in your collection.
- You can manually trigger a full library scan from the **Manual Library Scan**
  section at the bottom of the Plex settings page.
- Scheduled library scans run automatically in the background.

---

## 5. MEDIA_SERVER_PRIMARY Flag

The **Primary Media Server** setting in **Settings → General** determines which
server Seerr treats as its source of truth for media availability.

| Value | Meaning |
|-------|---------|
| `plex` | Plex is primary. **Default for new installs.** |
| `jellyfin` | Jellyfin/Emby is primary. **Default for existing Jellyfin installs on upgrade.** |

### Behaviour in Phase 1

- This flag is **configuration only** in Phase 1.
- Changing this flag does **not** yet switch the source of media availability
  data used on discover and request pages — that UX pivot lands in a later
  phase.
- All Jellyfin code paths remain fully operational regardless of which value
  is selected.
- The flag is stored in `settings.json` and is read at startup.

---

## 6. Health Check Endpoint

Seerr exposes a REST endpoint for monitoring the Plex connection:

```
GET /api/v1/settings/plex/health
```

### Response fields

| Field | Type | Meaning |
|-------|------|---------|
| `healthy` | boolean | `true` only when all four checks pass |
| `checks.reachable` | boolean | Server is reachable over the network |
| `checks.tokenValid` | boolean | X-Plex-Token is accepted by the server |
| `checks.machineIdMatches` | boolean | Server's machine ID matches the configured value (always `true` when no machine ID is configured) |
| `checks.libraryDiscoverable` | boolean | At least one library section was returned |

### Example — all checks passing

```json
{
  "healthy": true,
  "checks": {
    "reachable": true,
    "tokenValid": true,
    "machineIdMatches": true,
    "libraryDiscoverable": true
  }
}
```

### Example — token invalid or server unreachable

```json
{
  "healthy": false,
  "checks": {
    "reachable": false,
    "tokenValid": false,
    "machineIdMatches": false,
    "libraryDiscoverable": false
  }
}
```

You can use this endpoint in container health checks or external monitoring
tools such as Uptime Kuma.

---

## 7. Real-time Plex Events (SSE / WebSocket)

Seerr ships a `PlexEventsClient` that opens a persistent connection to your
Plex server's notification stream. This is used internally (e.g., for
detecting library changes in near-real-time).

- **Preferred transport**: Server-Sent Events (`/:/eventsource`)
- **Fallback transport**: WebSocket (`/:/websockets/notifications`)

The client reconnects automatically with exponential backoff if the connection
drops. No configuration is required — it activates automatically when Plex is
configured as the primary server.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| "Unable to connect to Plex" on save | Wrong IP/port, or server is down | Verify the IP and port and that Plex is running |
| `tokenValid: false` on health check | Wrong or expired token | Re-generate the token and update Seerr |
| `machineIdMatches: false` on health check | Token points to a different server | Ensure the token belongs to the correct Plex account and server |
| Libraries list is empty after sync | Libraries not enabled in Seerr | Toggle the libraries on in the Plex settings page and save |
| SSL certificate errors | Self-signed cert on Plex | Disable SSL in Seerr settings, or add your CA to the system trust store |

---

## See Also

- [README — Plex Support section](../README.md#plex-support)
- [Plex documentation](https://support.plex.tv)
- [Settings → General — MEDIA_SERVER_PRIMARY](../README.md#media_server_primary-feature-flag)
