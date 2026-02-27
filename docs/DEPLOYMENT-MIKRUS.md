# Sellf Deployment - Mikrus VPS (Optimized)

**Last Updated**: 2026-01-15 (Performance Optimization Release)

This guide covers deployment of Sellf on Mikrus.us VPS with optimized configuration for **high performance** on resource-constrained environments.

---

## 📊 Performance Expectations

After optimization (ISR + PM2 cluster + optional Redis):

| Mikrus Plan | CPU | RAM | Expected Performance | Recommended Instances |
|-------------|-----|-----|---------------------|----------------------|
| **Mikrus 2.0** | 1 core | 512MB | 30-50 req/sec | 1 instance |
| **Mikrus 2.0+** | 1 core | 1GB | 50-80 req/sec | 1-2 instances |
| **Mikrus 3.0** | 2 cores | 2GB | 100-200 req/sec | 2 instances (cluster) |
| **Mikrus 3.0+** | 4+ cores | 4GB+ | 200-400+ req/sec | 4 instances (cluster) |

**Baseline (before optimization)**: ~11-12 req/sec on any VPS (CPU bottleneck)

**After optimization**: 10-30x improvement depending on hardware

---

## 🎯 Prerequisites

1. **Mikrus VPS** with Ubuntu 22.04+ or Debian 12+
2. **Domain** pointed to your VPS IP
3. **Supabase Project** (hosted or self-hosted)
4. **Stripe Account** (for payments)
5. **SSH Access** to your VPS

---

## 📦 Part 1: System Setup (All Mikrus Plans)

### Step 1: Connect to VPS

```bash
ssh root@your-mikrus-vps.mikr.us
```

### Step 2: Create Non-Root User

```bash
# Create deploy user
adduser sellf
usermod -aG sudo sellf

# Switch to deploy user
su - sellf
```

### Step 3: Install Node.js 20.x LTS

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version  # Should be v20.x
npm --version
```

### Step 4: Install PM2 Globally

```bash
sudo npm install -g pm2@latest

# Verify installation
pm2 --version
```

### Step 5: Install Git

```bash
sudo apt-get update
sudo apt-get install -y git
```

---

## 🚀 Part 2: Deploy Sellf

### Step 1: Clone Repository

```bash
cd ~
git clone https://github.com/yourusername/sellf.git
cd sellf
```

### Step 2: Install Dependencies

```bash
cd admin-panel
npm install
cd ..
```

### Step 3: Configure Environment Variables

Copy and edit environment file:

```bash
cp .env.fullstack.example .env.fullstack
nano .env.fullstack
```

**Minimum Required Variables:**

```bash
# Database
POSTGRES_PASSWORD=your_secure_password_here

# JWT & Auth
JWT_SECRET=generate_with_openssl_rand_base64_32
REALTIME_SECRET_KEY_BASE=generate_with_openssl_rand_base64_32
ANON_KEY=your_supabase_anon_key
SERVICE_ROLE_KEY=your_supabase_service_role_key

# URLs
API_EXTERNAL_URL=https://api.yourdomain.com
NEXT_PUBLIC_SUPABASE_URL=https://api.yourdomain.com
GOTRUE_SITE_URL=https://yourdomain.com
NEXT_PUBLIC_SITE_URL=https://yourdomain.com

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxx
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# Cloudflare Turnstile
NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY=your_site_key
CLOUDFLARE_TURNSTILE_SECRET_KEY=your_secret_key
```

**Optional - Upstash Redis (Recommended for better performance):**

```bash
# Upstash Redis (Optional - but recommended)
# Free tier: 10k req/day, 256MB storage
# Benefits: <10ms latency, 50-70% reduced DB load
UPSTASH_REDIS_REST_URL=https://your-region.upstash.io
UPSTASH_REDIS_REST_TOKEN=AX...your-token...==
```

See [UPSTASH-REDIS.md](./UPSTASH-REDIS.md) for setup guide.

### Step 4: Build Application

```bash
cd admin-panel
npm run build
cd ..
```

**Expected output**: `✓ Compiled successfully`

If you see `ℹ️ Upstash Redis not configured - using database fallback (this is OK)` - that's fine! App works without Redis.

---

## ⚙️ Part 3: PM2 Configuration (Optimized for Mikrus)

The repository includes a pre-configured `ecosystem.config.js` optimized for different Mikrus plans.

### For Mikrus 2.0 (512MB - 1 core)

**Edit** `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    {
      name: 'sellf-admin',
      cwd: './admin-panel',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',

      // SINGLE INSTANCE MODE (1 core VPS)
      instances: 1,
      exec_mode: 'fork',  // Use 'fork' for single instance

      // MEMORY MANAGEMENT (critical for 512MB)
      max_memory_restart: '400M',  // Restart if exceeds 400MB
      min_uptime: '10s',
      max_restarts: 10,

      // GRACEFUL SHUTDOWN
      kill_timeout: 5000,
      listen_timeout: 10000,

      // LOGGING
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // ENV
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
}
```

**Expected Performance**: 30-50 req/sec, ~500ms latency

---

### For Mikrus 3.0 (2GB+ - 2+ cores) - RECOMMENDED

**Edit** `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    {
      name: 'sellf-admin',
      cwd: './admin-panel',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',

      // CLUSTER MODE - Use all CPU cores
      instances: 'max',  // Auto-detect cores (2-4 instances)
      exec_mode: 'cluster',

      // MEMORY MANAGEMENT
      max_memory_restart: '512M',  // Restart if exceeds 512MB per instance
      min_uptime: '10s',
      max_restarts: 10,

      // GRACEFUL SHUTDOWN
      kill_timeout: 5000,
      listen_timeout: 10000,
      wait_ready: true,

      // LOGGING
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // ENV
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
}
```

**Expected Performance**: 100-200+ req/sec, <200ms latency

---

## 🔥 Part 4: Start Application

### Step 1: Create Logs Directory

```bash
mkdir -p admin-panel/logs
```

### Step 2: Start PM2

```bash
pm2 start ecosystem.config.js
```

**Output (Mikrus 2.0 - single instance):**
```
┌────┬────────────────┬─────────┬─────────┬──────┬──────────┐
│ id │ name           │ mode    │ status  │ cpu  │ memory   │
├────┼────────────────┼─────────┼─────────┼──────┼──────────┤
│ 0  │ sellf-admin │ fork    │ online  │ 0%   │ 180.0mb  │
└────┴────────────────┴─────────┴─────────┴──────┴──────────┘
```

**Output (Mikrus 3.0 - cluster mode):**
```
┌────┬────────────────┬─────────┬─────────┬──────┬──────────┐
│ id │ name           │ mode    │ status  │ cpu  │ memory   │
├────┼────────────────┼─────────┼─────────┼──────┼──────────┤
│ 0  │ sellf-admin │ cluster │ online  │ 0%   │ 208.0mb  │
│ 1  │ sellf-admin │ cluster │ online  │ 0%   │ 207.8mb  │
└────┴────────────────┴─────────┴─────────┴──────┴──────────┘
```

### Step 3: Verify Application

```bash
# Check PM2 status
pm2 status

# View logs
pm2 logs sellf-admin --lines 20

# Monitor in real-time
pm2 monit
```

### Step 4: Test Homepage

```bash
curl http://localhost:3000
```

Should return HTML content (not error).

### Step 5: Save PM2 Process List

```bash
pm2 save
```

### Step 6: Setup Auto-Start on Reboot

```bash
pm2 startup

# Follow the instructions (will output a command like):
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u sellf --hp /home/sellf

# Run the generated command, then:
pm2 save
```

---

## 🌐 Part 5: Nginx Reverse Proxy (Optional but Recommended)

### Step 1: Install Nginx

```bash
sudo apt-get install -y nginx
```

### Step 2: Configure Nginx

```bash
sudo nano /etc/nginx/sites-available/sellf
```

**Add configuration:**

```nginx
# Rate limiting (adjust based on your Mikrus plan)
limit_req_zone $binary_remote_addr zone=app:10m rate=10r/s;

server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Rate limiting
    location / {
        limit_req zone=app burst=20 nodelay;

        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Health check endpoint
    location /api/health {
        proxy_pass http://localhost:3000;
        access_log off;
    }
}
```

### Step 3: Enable Site

```bash
sudo ln -s /etc/nginx/sites-available/sellf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Step 4: Setup SSL with Let's Encrypt

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

---

## 🔄 Part 6: Deployment & Updates

### Zero-Downtime Deployment Script

Use the included `scripts/deploy.sh`:

```bash
#!/bin/bash
set -e

echo "🚀 Deploying Sellf..."

# Pull latest changes
git pull origin main

# Install dependencies
cd admin-panel
npm ci

# Build
npm run build

# Reload PM2 (zero-downtime)
cd ..
pm2 reload ecosystem.config.js

# Verify
pm2 status

echo "✅ Deployment complete!"
```

**Usage:**

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

**For Mikrus 2.0 (single instance)**, use `pm2 restart` instead of `reload`:

```bash
pm2 restart ecosystem.config.js
```

---

## 📊 Part 7: Monitoring & Performance

### Check PM2 Status

```bash
# List processes
pm2 list

# Real-time monitoring
pm2 monit

# View logs
pm2 logs sellf-admin

# CPU & Memory usage
pm2 describe sellf-admin
```

### Run Benchmark (Optional)

From your local machine:

```bash
# Default: 50 concurrent connections
node scripts/benchmark.js https://yourdomain.com

# Small VPS (1 vCPU / ≤1GB RAM): use 5 connections for realistic results
node scripts/benchmark.js https://yourdomain.com 5
```

> **Why fewer connections for small VPS?** 50 concurrent connections will saturate a
> single-core server and produce misleadingly high latency numbers. 5 connections better
> reflects real-world traffic on a small instance and gives you actionable latency metrics.

**Expected Results (50 connections):**

| Mikrus Plan | Req/sec | Latency |
|-------------|---------|---------|
| **2.0 (512MB)** | 30-50 | ~500ms |
| **2.0+ (1GB)** | 50-80 | ~300ms |
| **3.0 (2GB)** | 100-200 | ~200ms |
| **3.0+ (4GB)** | 200-400+ | <200ms |

**Expected Results (5 connections — small VPS):**

| Mikrus Plan | Req/sec | Latency |
|-------------|---------|---------|
| **2.0 (512MB)** | 20-40 | ~150ms |
| **2.0+ (1GB)** | 30-50 | ~120ms |
| **3.0 (2GB)** | 50-100 | ~80ms |

### Setup Upstash Redis (Optional - Performance Boost)

See [UPSTASH-REDIS.md](./UPSTASH-REDIS.md) for detailed setup guide.

**Quick Summary:**

1. Create free Upstash account: https://console.upstash.com
2. Create Redis database (choose region closest to your VPS)
3. Add credentials to `.env.fullstack`:
   ```bash
   UPSTASH_REDIS_REST_URL=https://your-region.upstash.io
   UPSTASH_REDIS_REST_TOKEN=AX...your-token...==
   ```
4. Restart PM2:
   ```bash
   pm2 reload all
   ```
5. Verify in logs:
   ```bash
   pm2 logs | grep Redis
   # Should see: "✅ Upstash Redis connected - caching enabled"
   ```

**Performance Impact:**
- Shop config queries: 50-100ms → 5-10ms (10x faster)
- Database load: -50-70%
- Cache hit rate: 80%+

---

## 🛠️ Troubleshooting

### High Memory Usage (Mikrus 2.0)

**Symptom**: App keeps restarting due to memory limit

**Solution 1**: Lower memory limit in `ecosystem.config.js`:

```javascript
max_memory_restart: '350M',  // Lower limit for 512MB VPS
```

**Solution 2**: Disable PM2 cluster mode (use single instance):

```javascript
instances: 1,
exec_mode: 'fork',
```

**Solution 3**: Add swap space:

```bash
# Create 1GB swap file
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

### High CPU Usage

**Symptom**: PM2 shows 100% CPU usage

**Check logs**:

```bash
pm2 logs sellf-admin --lines 100
```

**Common causes**:
1. **No ISR cache** - Make sure `export const revalidate = 60` is in public pages
2. **Too many PM2 instances** - Reduce to 1-2 instances on Mikrus 2.0
3. **Heavy database queries** - Enable Upstash Redis caching

**Quick fix** (reduce instances):

```bash
pm2 scale sellf-admin 1
```

---

### Port 3000 Already in Use

```bash
# Find process using port 3000
sudo lsof -i :3000

# Kill process
sudo kill -9 <PID>

# Or restart PM2
pm2 restart sellf-admin
```

---

### Application Not Starting

**Check logs**:

```bash
pm2 logs sellf-admin --err --lines 50
```

**Common errors**:

1. **"Your project's URL and Key are required"**
   - Missing Supabase credentials in `.env.fullstack`

2. **"listen EADDRINUSE: address already in use"**
   - Port 3000 already taken (see above)

3. **"JavaScript heap out of memory"**
   - Lower `max_memory_restart` or add swap space

---

## 📚 Additional Resources

- **Performance Optimization Details**: [BACKLOG.md](../BACKLOG.md) - Search for "Performance & Scalability"
- **Upstash Redis Setup**: [UPSTASH-REDIS.md](./UPSTASH-REDIS.md)
- **PM2 Advanced**: [PM2-VPS.md](./PM2-VPS.md)
- **Benchmark Script**: `scripts/benchmark.js`

---

## ✅ Production Checklist

Before going live:

- [ ] PM2 started with optimized `ecosystem.config.js`
- [ ] PM2 auto-start enabled (`pm2 startup` + `pm2 save`)
- [ ] Nginx reverse proxy configured
- [ ] SSL certificate installed (Let's Encrypt)
- [ ] Environment variables properly set
- [ ] Upstash Redis configured (optional but recommended)
- [ ] Firewall configured (UFW)
- [ ] Monitoring enabled (`pm2 monit`)
- [ ] Backup strategy in place
- [ ] Benchmark test passed (>30 req/sec)

---

## 🎯 Summary

**Mikrus 2.0 (512MB - 1 core)**:
- Use single instance (`instances: 1`, `exec_mode: 'fork'`)
- Memory limit: 400MB
- Expected: 30-50 req/sec
- Consider adding swap space

**Mikrus 3.0 (2GB+ - 2+ cores)**:
- Use cluster mode (`instances: 'max'`, `exec_mode: 'cluster'`)
- Memory limit: 512MB per instance
- Expected: 100-200+ req/sec
- Highly recommended with Upstash Redis

**Both plans**:
- ISR enabled by default (60s cache)
- React cache() deduplication
- Optional Redis for extra performance
- Zero-downtime deployments with `pm2 reload`

---

**Last Updated**: 2026-01-15 (Performance Optimization Release)
