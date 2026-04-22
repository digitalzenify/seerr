<p align="center">
<img src="./public/logo_full.svg" alt="Seerr" style="margin: 20px 0;">
</p>
<p align="center">
<img src="https://github.com/seerr-team/seerr/actions/workflows/release.yml/badge.svg" alt="Seerr Release" />
<img src="https://github.com/seerr-team/seerr/actions/workflows/ci.yml/badge.svg" alt="Seerr CI">
</p>
<p align="center">
<a href="https://discord.gg/seerr"><img src="https://img.shields.io/discord/783137440809746482" alt="Discord"></a>
<a href="https://hub.docker.com/r/seerr/seerr"><img src="https://img.shields.io/docker/pulls/seerr/seerr" alt="Docker pulls"></a>
<a href="https://translate.seerr.dev/engage/seerr/"><img src="https://translate.seerr.dev/widget/seerr/svg-badge.svg" alt="Translation status" /></a>
<a href="https://github.com/seerr-team/seerr/blob/develop/LICENSE"><img alt="GitHub" src="https://img.shields.io/github/license/seerr-team/seerr"></a>

**Seerr** is a free and open source software application for managing requests for your media library. It integrates with the media server of your choice: [Jellyfin](https://jellyfin.org), [Plex](https://plex.tv), and [Emby](https://emby.media/). In addition, it integrates with your existing services, such as **[Sonarr](https://sonarr.tv/)**, **[Radarr](https://radarr.video/)**.

## Current Features

- Full Jellyfin/Emby/Plex integration including authentication with user import & management.
- Support for **PostgreSQL** and **SQLite** databases.
- Supports Movies, Shows and Mixed Libraries.
- Ability to change email addresses for SMTP purposes.
- Easy integration with your existing services. Currently, Seerr supports Sonarr and Radarr. More to come!
- Jellyfin/Emby/Plex library scan, to keep track of the titles which are already available.
- Customizable request system, which allows users to request individual seasons or movies in a friendly, easy-to-use interface.
- Incredibly simple request management UI. Don't dig through the app to simply approve recent requests!
- Granular permission system.
- Support for various notification agents.
- Mobile-friendly design, for when you need to approve requests on the go!
- Support for watchlisting & blocklisting media.

With more features on the way! Check out our [issue tracker](/../../issues) to see the features which have already been requested.

## Getting Started

Check out our documentation for instructions on how to install and run Seerr:

https://docs.seerr.dev/getting-started/

## Real-Time Status Updates via Webhooks

By default Seerr polls Sonarr and Radarr once per minute to update download
status. You can get near-instant status transitions (Requested → Downloading →
Importing → Available) by configuring Sonarr and Radarr to push a webhook
notification to Seerr whenever a download or import event occurs.

### How it works

When Seerr receives a webhook it immediately re-fetches the Sonarr/Radarr
queue, so the next time the browser polls (every 15 seconds) it will see the
latest status. This is complemented by an automatic media-server library scan
that Seerr triggers ~60 seconds after a download leaves the queue, which is
what causes the status to transition from *Importing* to *Available*.

### Webhook URL

```
http://<your-seerr-host>:<port>/api/v1/service/webhook
```

Example: `http://192.168.1.100:5055/api/v1/service/webhook`

### Finding your Seerr API key

1. Open Seerr in your browser.
2. Go to **Settings → General**.
3. Copy the value shown in the **API Key** field.

### Configuring Radarr

1. In Radarr, open **Settings → Connect**.
2. Click the **+** button and choose **Webhook**.
3. Fill in the form:
   - **Name**: `Seerr` (or any name you prefer)
   - **Notification Triggers**: enable **On Grab** and **On Import** (and optionally **On Download Failure**)
   - **URL**: `http://<your-seerr-host>:<port>/api/v1/service/webhook`
   - **Method**: `POST`
4. Click **Add Header** and set:
   - **Key**: `X-API-Key`
   - **Value**: *(paste your Seerr API key)*
5. Click **Test** — you should see a ✅ success indicator.
6. Click **Save**.

### Configuring Sonarr

1. In Sonarr, open **Settings → Connect**.
2. Click the **+** button and choose **Webhook**.
3. Fill in the form:
   - **Name**: `Seerr` (or any name you prefer)
   - **Notification Triggers**: enable **On Grab** and **On Import** (and optionally **On Download Failure**)
   - **URL**: `http://<your-seerr-host>:<port>/api/v1/service/webhook`
   - **Method**: `POST`
4. Click **Add Header** and set:
   - **Key**: `X-API-Key`
   - **Value**: *(paste your Seerr API key)*
5. Click **Test** — you should see a ✅ success indicator.
6. Click **Save**.

### Notes

- The webhook requires the `X-API-Key` header for authentication. Requests
  without a valid key are rejected with `403 Forbidden`.
- If Seerr is behind a reverse proxy (nginx, Traefik, Caddy, etc.), use your
  **public URL** as the webhook URL (e.g. `https://seerr.yourdomain.com/api/v1/service/webhook`).
  Make sure your proxy forwards the `X-API-Key` header.
- The webhook is optional. Without it, Seerr falls back to its 60-second
  polling cycle for status transitions.

## Plex Support

Seerr now treats **Plex** as a first-class media server alongside Jellyfin/Emby.

### Obtaining an X-Plex-Token

The X-Plex-Token authenticates requests from Seerr to your Plex Media Server.

1. Open [Plex Web](https://app.plex.tv/desktop) and sign in.
2. Navigate to any media item in your library.
3. Click the **⋮** (More) menu → **Get Info** → **View XML**.
4. In the URL of the XML page, find the `X-Plex-Token=…` query parameter.
5. Copy that value — this is your token.

Alternatively, use the official Plex guide: <https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/>

### Obtaining the Machine Identifier

The machine identifier uniquely identifies your Plex Media Server instance.

1. Open `http://<your-plex-ip>:32400/identity` in a browser (no token needed).
2. Copy the value of the `machineIdentifier` attribute in the response XML.

### Configuring Plex in Settings

1. Open Seerr and go to **Settings → Plex**.
2. Fill in the following fields:
   - **Hostname or IP Address**: the LAN IP or hostname of your Plex server.
   - **Port**: usually `32400`.
   - **Use SSL**: enable if your Plex server uses HTTPS.
   - **X-Plex-Token**: paste the token you obtained above.
   - **Web App URL** *(optional)*: override the Plex Web URL used for deep links.
3. Click **Save**. Seerr will verify connectivity, populate the Machine ID automatically, and sync your libraries.
4. Toggle the libraries you want Seerr to manage and click **Sync Libraries**.

### MEDIA_SERVER_PRIMARY Feature Flag

The **Primary Media Server** setting in **Settings → General** controls which server Seerr treats as its source of truth.

| Value | Meaning |
|-------|---------|
| `plex` | Plex is the primary server. *(Default for new installs.)* |
| `jellyfin` | Jellyfin/Emby is the primary server. *(Default for existing Jellyfin installs on upgrade.)* |

> **Phase 1 scope**: This phase ships the configuration layer only.  
> User-facing UX pivots (e.g., availability badges sourced from Plex instead of Jellyfin) land in later phases. Jellyfin code paths are fully preserved and continue to work regardless of this flag.

### Plex Health Check

Seerr exposes a health endpoint for the configured Plex server:

```
GET /api/v1/settings/plex/health
```

Example response when healthy:

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



<img src="./public/preview.jpg" alt="Seerr application preview" />

## Migrating from Overseerr/Jellyseerr to Seerr

Read our [release announcement](https://docs.seerr.dev/blog/seerr-release) to learn what Seerr means for Jellyseerr and Overseerr users.

Please follow our [migration guide](https://docs.seerr.dev/migration-guide) for detailed instructions on migrating from Overseerr or Jellyseerr.

## Support

- Check out the [Seerr Documentation](https://docs.seerr.dev) before asking for help. Your question might already be in the docs!
- You can get support on [Discord](https://discord.gg/seerr).
- You can ask questions in the Help category of our [GitHub Discussions](/../../discussions).
- Bug reports and feature requests can be submitted via [GitHub Issues](/../../issues).

## API Documentation

You can access the API documentation from your local Seerr install at http://localhost:5055/api-docs

## Community

You can ask questions, share ideas, and more in [GitHub Discussions](/../../discussions).

If you would like to chat with other members of our growing community, [join the Seerr Discord server](https://discord.gg/seerr)!

Our [Code of Conduct](./CODE_OF_CONDUCT.md) applies to all Seerr community channels.

## Contributing

You can help improve Seerr too! Check out our [Contribution Guide](./CONTRIBUTING.md) to get started.

## Contributors ✨

[![Contributors](https://opencollective.com/seerr/contributors.svg?width=890)](https://opencollective.com/seerr/#backers)

[![Become a Backer](https://opencollective.com/seerr/backers.svg)](https://opencollective.com/seerr/#backers)
[![Become a Sponsor](https://opencollective.com/seerr/sponsors.svg)](https://opencollective.com/seerr/#sponsors)
