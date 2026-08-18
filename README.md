# SMARTwinFA Web

Web-friendly reconstruction of the SMARTwinFA Windows accounting interface.
This stack contains the complete application source required to rebuild the
ARM64-compatible container on the Raspberry Pi.

## Runtime

- Container: `smartwinfa-web`
- LAN URL: `http://pinas.local:4173`
- Published port: `4173`
- Container port: `3000`
- Restart policy: `unless-stopped`
- Persistent data: none in this interface-only phase
- Secrets: none required

The current version reproduces the desktop application's horizontal menus,
company/accounting-period/user strip, home artwork, dropdown navigation, and
status strip. Menu selections are UI placeholders until database and business
workflows are migrated.

## Restore or deploy

From this directory on the Pi:

```bash
sudo docker compose up --build -d
```

Verify the service:

```bash
sudo docker ps --filter name=smartwinfa-web
curl --fail http://127.0.0.1:4173/
```

To stop it:

```bash
sudo docker compose down
```

## Cloudflared

Use `http://pinas.local:4173` as the tunnel origin when Cloudflared can resolve
the Pi hostname. If Cloudflared shares a Docker network with this service, use
`http://smartwinfa-web:3000` instead.

The application currently has no authentication. Do not expose it publicly
until authentication and authorization have been implemented.

## Update procedure

After changing the source in this directory:

```bash
sudo docker compose up --build -d
```

Docker will rebuild the application and recreate the container while preserving
the `unless-stopped` restart behavior.
