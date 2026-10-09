# Server Setup — Proxy Router Whitelist API

## Requirements

- Ubuntu/Debian server with Squid installed
- Node.js ≥ 18
- PM2 (`npm install -g pm2`)
- Your existing `ip_manager.sh` placed in this directory

---

## 1. Upload files

```bash
# From your local machine
scp -r server/ user@your-server:/opt/proxy-router-api/
```

## 2. Install dependencies

```bash
cd /opt/proxy-router-api
npm install
```

## 3. Allow the API user to run ip_manager.sh via sudo without password

```bash
sudo visudo
```

Add this line (replace `apiuser` with the user running PM2):

```
apiuser ALL=(ALL) NOPASSWD: /opt/proxy-router-api/ip_manager.sh
apiuser ALL=(ALL) NOPASSWD: /usr/sbin/squid
```

Make the script executable:

```bash
chmod +x /opt/proxy-router-api/ip_manager.sh
```

## 4. Set your auth token

Generate a secure random token:

```bash
openssl rand -hex 32
```

Export it as an environment variable **before** starting PM2:

```bash
export AUTH_TOKEN="your-generated-token-here"
```

Or set it in PM2's environment store:

```bash
pm2 set proxy-router-api:AUTH_TOKEN "your-generated-token-here"
```

## 5. Start with PM2

```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup   # follow the printed instructions to enable on boot
```

## 6. Test the API

```bash
# Health check
curl http://localhost:8080/health

# Add an IP (replace TOKEN and IP)
curl -X POST http://localhost:8080/api/whitelist \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ip": "1.2.3.4"}'

# View whitelist
curl http://localhost:8080/api/whitelist \
  -H "Authorization: Bearer TOKEN"

# Remove an IP
curl -X DELETE http://localhost:8080/api/whitelist \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ip": "1.2.3.4"}'
```

## 7. Firewall

Allow only trusted client IPs to reach port 8080:

```bash
sudo ufw allow from <your-home-ip> to any port 8080
sudo ufw deny 8080
```

Or use nginx as a reverse proxy with HTTPS (recommended for production).

---

## Environment Variables

| Variable         | Default                        | Description                      |
|------------------|--------------------------------|----------------------------------|
| `PORT`           | `8080`                         | API listen port                  |
| `AUTH_TOKEN`     | `""` (disabled)                | Bearer token for authentication  |
| `WHITELIST_FILE` | `/etc/squid/whitelist.txt`     | Path to Squid's IP whitelist     |
| `LOG_FILE`       | `./logs/api.log`               | JSON log file path               |
| `SQUID_BIN`      | `squid`                        | Squid binary path                |
