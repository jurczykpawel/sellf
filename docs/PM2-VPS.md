# Advanced PM2 Deployment - Production-Grade Setup

**This is the ADVANCED guide for PM2 deployment.**
For basic PM2 setup, see [DEPLOYMENT-MIKRUS.md](./DEPLOYMENT-MIKRUS.md).

---

## 🎯 When to Use This Guide

Use this guide if you need:
- ✅ **Cluster mode** (multi-core CPU utilization)
- ✅ **Zero-downtime deployments**
- ✅ **Advanced monitoring** (PM2+, Keymetrics)
- ✅ **Auto-scaling** based on load
- ✅ **Log rotation** and management
- ✅ **Memory/CPU limits** per process
- ✅ **Load balancing** across instances
- ✅ **Custom deployment scripts**

**Prerequisites:**
- You're comfortable with Node.js and process management
- You understand PM2 basics (ecosystem files, pm2 commands)
- You've read the basic PM2 setup in [DEPLOYMENT-MIKRUS.md](./DEPLOYMENT-MIKRUS.md)

---

## 📋 System Requirements

- **OS:** Ubuntu 24.04 LTS (or similar)
- **Node.js:** v24.x LTS
- **PM2:** v5.3+ (`npm install -g pm2@latest`)
- **CPU:** 2+ cores (for cluster mode)
- **RAM:** 4GB+ (2GB+ available for app)

---

## 🚀 Advanced Ecosystem Configuration

### Production-Grade ecosystem.config.js

```javascript
module.exports = {
  apps: [
    {
      name: "sellf-admin",
      cwd: "./admin-panel",
      script: "npm",
      args: "start",

      // CLUSTER MODE - Utilize all CPU cores
      instances: "max",  // or specific number: 2, 4, etc.
      exec_mode: "cluster",

      // ENVIRONMENT
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },

      // RESOURCE LIMITS
      max_memory_restart: "1G",  // Restart if memory exceeds 1GB
      max_restarts: 10,          // Max restarts in min_uptime window
      min_uptime: "10s",         // Minimum uptime to consider restart loop

      // AUTO-RESTART
      autorestart: true,
      watch: false,  // Don't use watch in production (use pm2 reload instead)

      // LOGGING
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      // ADVANCED
      kill_timeout: 5000,      // Time to wait for graceful shutdown
      listen_timeout: 10000,   // Time to wait for app to listen
      shutdown_with_message: true,

      // CRON RESTART (optional - restart daily at 3am)
      // cron_restart: "0 3 * * *",

      // SOURCE MAP SUPPORT (for better error traces)
      source_map_support: true,

      // INSTANCE VAR (useful for logs)
      instance_var: "INSTANCE_ID",
    }
  ],

  // DEPLOYMENT CONFIGURATION
  deploy: {
    production: {
      user: "deploy",
      host: ["your-vps.mikr.us"],
      ref: "origin/main",
      repo: "git@github.com:YOUR_USERNAME/sellf.git",
      path: "/home/deploy/sellf",

      // PRE-DEPLOY HOOKS
      "pre-deploy-local": "echo 'Starting deployment...'",

      // POST-DEPLOY HOOKS
      "post-deploy": `
        cd admin-panel &&
        npm ci &&
        npm run build &&
        pm2 reload ecosystem.config.js --env production &&
        pm2 save
      `,

      // PRE-SETUP
      "pre-setup": "apt-get install git -y",

      // ENV
      env: {
        NODE_ENV: "production"
      }
    }
  }
};
```

---

## 🔧 Advanced PM2 Commands

### Cluster Management

```bash
# Start in cluster mode (uses all CPU cores)
pm2 start ecosystem.config.js

# Scale up/down
pm2 scale sellf-admin 4     # Scale to 4 instances
pm2 scale sellf-admin +2    # Add 2 more instances
pm2 scale sellf-admin -1    # Remove 1 instance

# Zero-downtime reload (cluster mode only)
pm2 reload sellf-admin

# Graceful restart (one by one)
pm2 gracefulReload sellf-admin
```

### Monitoring & Logs

```bash
# Real-time monitoring
pm2 monit

# CPU/Memory usage
pm2 status
pm2 describe sellf-admin

# Logs
pm2 logs sellf-admin --lines 200
pm2 logs sellf-admin --err      # Only errors
pm2 logs sellf-admin --raw      # Raw logs (no formatting)
pm2 flush sellf-admin           # Clear logs

# Log rotation (install module)
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 7     # Keep 7 days
pm2 set pm2-logrotate:compress true
```

### Process Management

```bash
# Stop/Start/Restart
pm2 stop sellf-admin
pm2 start sellf-admin
pm2 restart sellf-admin

# Delete process (remove from PM2)
pm2 delete sellf-admin

# Reset restart count
pm2 reset sellf-admin

# Send signal to process
pm2 sendSignal SIGUSR2 sellf-admin
```

### Startup Script (Auto-start on reboot)

```bash
# Generate startup script
pm2 startup

# Follow the instructions (will output a command like):
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u deploy --hp /home/deploy

# Save current PM2 process list
pm2 save

# Test (reboot server)
sudo reboot

# After reboot, verify
pm2 status  # Should show sellf-admin running
```

---

## 📊 Advanced Monitoring

### Option 1: PM2 Plus (Keymetrics) - Cloud Monitoring

1. **Sign up** at https://app.pm2.io
2. **Link your server:**
   ```bash
   pm2 link <secret_key> <public_key>
   ```
3. **Features:**
   - Real-time metrics (CPU, Memory, Network)
   - Exception tracking
   - Custom metrics
   - Alerts (email, Slack, webhook)
   - Transaction tracing
   - Log streaming

### Option 2: PM2 Metrics Module (Self-Hosted)

```bash
# Install metrics module
pm2 install pm2-metrics

# Install auto-pull (auto-update from git)
pm2 install pm2-auto-pull

# Configure auto-pull
pm2 set pm2-auto-pull:interval 300000  # Check every 5 minutes
pm2 set pm2-auto-pull:apps sellf-admin
```

### Option 3: Prometheus + Grafana

```bash
# Install PM2 Prometheus exporter
npm install -g pm2-prometheus-exporter

# Start exporter
pm2-prometheus-exporter

# Metrics available at: http://localhost:9209/metrics
```

**Grafana Dashboard:**
- Import dashboard ID: 10869 (PM2 Metrics)
- Connect to Prometheus datasource
- Visualize: CPU, Memory, Restarts, Errors

---

## 🔄 Zero-Downtime Deployments

### Method 1: PM2 Reload

```bash
cd /path/to/sellf
git pull origin main

cd admin-panel
npm ci
npm run build

# Zero-downtime reload (cluster mode)
pm2 reload sellf-admin
```

**How it works:**
1. PM2 starts new instances with new code
2. Waits for them to be ready (listen on port)
3. Gracefully shuts down old instances
4. No downtime!

### Method 2: PM2 Deploy (Automated)

```bash
# Initial setup (one-time)
pm2 deploy production setup

# Deploy
pm2 deploy production

# Rollback
pm2 deploy production revert 1

# Execute command on remote
pm2 deploy production exec "pm2 reload all"
```

### Method 3: Custom Deploy Script

Create `scripts/deploy.sh`:

```bash
#!/bin/bash
set -e

echo "🚀 Starting deployment..."

# 1. Pull latest code
git pull origin main

# 2. Install dependencies
cd admin-panel
npm ci

# 3. Run migrations (if using Supabase CLI)
cd ..
npx supabase db push --linked

# 4. Build app
cd admin-panel
npm run build

# 5. Reload PM2 (zero-downtime)
cd ..
pm2 reload ecosystem.config.js

# 6. Verify
pm2 status
pm2 logs sellf-admin --lines 20 --nostream

echo "✅ Deployment complete!"
```

Make executable:
```bash
chmod +x scripts/deploy.sh
```

---

## 🛡️ Security & Hardening

### 1. Run as Non-Root User

```bash
# Create deploy user
sudo adduser deploy
sudo usermod -aG sudo deploy

# Switch to deploy user
su - deploy

# Install PM2 as deploy user
npm install -g pm2

# Setup PM2 startup
pm2 startup  # Follow instructions
```

### 2. Environment Variables

**Never commit .env.local to git!**

```bash
# Store secrets in PM2 ecosystem
module.exports = {
  apps: [{
    name: "sellf-admin",
    env_production: {
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    }
  }]
};

# Or use dotenv in ecosystem:
module.exports = {
  apps: [{
    name: "sellf-admin",
    env_file: "./admin-panel/.env.production",
  }]
};
```

### 3. Firewall

```bash
sudo ufw enable
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw deny 3000   # Block direct access to app
sudo ufw status
```

### 4. Rate Limiting (Nginx)

```nginx
# /etc/nginx/sites-available/sellf
limit_req_zone $binary_remote_addr zone=app:10m rate=10r/s;

server {
    listen 80;
    server_name your-domain.com;

    location / {
        limit_req zone=app burst=20 nodelay;
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 📈 Performance Optimization

### 1. Cluster Mode Tuning

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    instances: "max",  // Use all CPU cores
    exec_mode: "cluster",

    // OR: Reserve cores for other services
    // instances: Math.max(require('os').cpus().length - 1, 1),
  }]
};
```

### 2. Memory Management

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    max_memory_restart: "1G",  // Restart if memory > 1GB

    // Node.js memory options
    node_args: [
      "--max-old-space-size=1024",  // 1GB heap
      "--optimize-for-size",
    ],
  }]
};
```

### 3. Log Rotation

```bash
# Install log rotation
pm2 install pm2-logrotate

# Configure
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:workerInterval 3600  # Rotate hourly
```

### 4. Build Optimization

```bash
# Use production mode
export NODE_ENV=production

# Optimize Next.js build
cd admin-panel
npm run build

# Check bundle size
npm run analyze  # If configured in next.config.js
```

---

## 🔍 Debugging & Profiling

### CPU Profiling

```bash
# Start app with --prof flag
pm2 start ecosystem.config.js --node-args="--prof"

# Run load test
# ...

# Stop app
pm2 stop sellf-admin

# Process v8 log
node --prof-process isolate-*.log > processed.txt

# Analyze processed.txt
```

### Memory Leak Detection

```bash
# Start with heap profiling
pm2 start ecosystem.config.js --node-args="--inspect"

# Connect Chrome DevTools
# chrome://inspect

# Take heap snapshots before/after suspected leak
# Compare snapshots to find leaked objects
```

### PM2 Internal Monitoring

```bash
# Enable internal monitoring
pm2 set pm2:autodump true

# Dump PM2 internal state
pm2 dump

# Restore from dump
pm2 resurrect
```

---

## 🚨 Troubleshooting

### High Memory Usage

```bash
# Check memory per instance
pm2 status

# Reduce instances
pm2 scale sellf-admin 2

# Set memory limit
# In ecosystem.config.js: max_memory_restart: "512M"
pm2 reload sellf-admin
```

### High CPU Usage

```bash
# Check CPU per instance
pm2 monit

# Profile the app (see CPU Profiling above)

# Reduce instances temporarily
pm2 scale sellf-admin 1
```

### Process Crashes

```bash
# Check logs
pm2 logs sellf-admin --err

# Check restart count
pm2 status

# Disable auto-restart temporarily (for debugging)
pm2 stop sellf-admin
pm2 start sellf-admin --no-autorestart

# Re-enable auto-restart
pm2 restart sellf-admin
```

### Port Already in Use

```bash
# Find process using port 3000
sudo lsof -i :3000

# Kill process
sudo kill -9 <PID>

# Or change port in ecosystem.config.js
```

---

## 📚 Additional Resources

- **PM2 Docs:** https://pm2.keymetrics.io/docs/usage/quick-start/
- **PM2 Plus:** https://app.pm2.io (monitoring)
- **Ecosystem File:** https://pm2.keymetrics.io/docs/usage/application-declaration/
- **Cluster Mode:** https://pm2.keymetrics.io/docs/usage/cluster-mode/
- **Deployment:** https://pm2.keymetrics.io/docs/usage/deployment/

---

## ✅ Production Checklist

Before going live:

- [ ] Cluster mode enabled (`instances: "max"`)
- [ ] Memory limits set (`max_memory_restart`)
- [ ] Log rotation configured
- [ ] PM2 startup script created (`pm2 startup`)
- [ ] Non-root user for PM2
- [ ] Firewall configured (UFW)
- [ ] Reverse proxy (Nginx/Caddy) with SSL
- [ ] Environment variables secure
- [ ] Monitoring enabled (PM2+ or custom)
- [ ] Backup strategy for logs/data
- [ ] Zero-downtime deployment tested
- [ ] Alert system configured

---

## 🆕 Performance Optimization Setup (Jan 2026)

### Using ecosystem.config.js in Root Directory

As of January 2026, Sellf includes a production-ready `ecosystem.config.js` in the root directory with optimized settings for ISR and cluster mode.

**Quick Start:**

```bash
# 1. Build the application
cd admin-panel
npm install
npm run build
cd ..

# 2. Start PM2 cluster
pm2 start ecosystem.config.js

# 3. Save process list
pm2 save

# 4. Enable auto-start on boot
pm2 startup
# Follow the command output instructions
```

**Automated Deployment with deploy.sh:**

```bash
# Make script executable (first time only)
chmod +x scripts/deploy.sh

# Deploy with zero-downtime reload
./scripts/deploy.sh
```

The `deploy.sh` script automatically:
- Pulls latest code from git
- Installs dependencies
- Builds the application
- Reloads PM2 with zero downtime

**Monitoring:**

```bash
pm2 list           # List all processes
pm2 monit          # Real-time monitoring
pm2 logs           # View logs
pm2 logs --lines 100
```

**Key Configuration Features:**
- ✅ Cluster mode with all CPU cores (`instances: 'max'`)
- ✅ 512MB memory limit per instance
- ✅ Graceful shutdown (5s timeout)
- ✅ Automatic crash recovery
- ✅ Centralized logging in `./logs/`

**Expected Performance:**
- **Before ISR + Cluster**: ~12 req/sec, ~3.8s latency on VPS
- **After ISR + Cluster**: 100-500+ req/sec, <500ms latency on VPS

---

**Last updated:** 2026-01-15 (ISR Optimization + PM2 Cluster)
