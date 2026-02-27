# Sellf - Production Deployment Guide

Complete guide for deploying Sellf on a production server using Docker Compose.

## Table of Contents

1. [Requirements](#requirements)
2. [Server Preparation](#server-preparation)
3. [Environment Variables Configuration](#environment-variables-configuration)
4. [Database Configuration](#database-configuration)
5. [Starting the Application](#starting-the-application)
6. [Domain and SSL Configuration](#domain-and-ssl-configuration)
7. [Stripe Webhooks Configuration](#stripe-webhooks-configuration)
8. [Initial Setup](#initial-setup)
9. [Monitoring and Logs](#monitoring-and-logs)
10. [Updating](#updating)
11. [Backup and Restore](#backup-and-restore)
12. [Troubleshooting](#troubleshooting)

## Requirements

### Minimum Hardware Requirements
- **CPU**: 2 vCPU
- **RAM**: 4 GB (recommended: 8 GB)
- **Disk**: 20 GB SSD (recommended: 50 GB)
- **Transfer**: 100 GB/month

### Software
- **Operating System**: Ubuntu 22.04 LTS or newer (recommended)
- **Docker**: version 24.0 or newer
- **Docker Compose**: version 2.20 or newer
- **Git**: for downloading the code

### External Services
- **Domain**: your own domain with DNS access
- **SMTP**: email service (SendGrid, AWS SES, Mailgun, etc.)
- **Stripe**: production account
- **Cloudflare Turnstile**: account (optional, for CAPTCHA)

## Server Preparation

### 1. System Update

```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Docker Installation

```bash
# Remove old versions
sudo apt remove docker docker-engine docker.io containerd runc

# Install dependencies
sudo apt install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# Add official Docker GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Verify installation
docker --version
docker compose version
```

### 3. Docker Configuration (optional but recommended)

```bash
# Add user to docker group (avoid sudo)
sudo usermod -aG docker $USER

# Log in again or:
newgrp docker

# Configure Docker to start automatically
sudo systemctl enable docker
sudo systemctl start docker
```

### 4. Git Installation

```bash
sudo apt install -y git
```

### 5. Firewall Configuration

```bash
# Enable UFW
sudo ufw enable

# Allow SSH
sudo ufw allow 22/tcp

# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Check status
sudo ufw status
```

## Environment Variables Configuration

### 1. Download Source Code

```bash
# Go to home directory
cd ~

# Clone the repository
git clone https://github.com/your-organization/sellf.git
cd sellf
```

### 2. Create Configuration File

```bash
# Copy the example file
cp .env.production.example .env.production

# Edit the file
nano .env.production
```

### 3. Generate Secure Keys

```bash
# Generate JWT_SECRET
openssl rand -base64 32

# Generate REALTIME_SECRET_KEY_BASE
openssl rand -base64 32

# Generate POSTGRES_PASSWORD (long password)
openssl rand -base64 48
```

### 4. Fill In All Variables

Below you will find a detailed description of each variable:

#### Database
```env
POSTGRES_PASSWORD=your_very_secure_postgresql_password
```

#### JWT and Authorization
```env
JWT_SECRET=paste_generated_jwt_secret
REALTIME_SECRET_KEY_BASE=paste_generated_realtime_secret
ANON_KEY=get_from_supabase_dashboard
SERVICE_ROLE_KEY=get_from_supabase_dashboard
```

**Note**: The `ANON_KEY` and `SERVICE_ROLE_KEY` keys can be generated in the Supabase Dashboard or using a JWT generation tool with the appropriate secret.

#### URLs and Domains
```env
API_EXTERNAL_URL=https://api.your-domain.com
NEXT_PUBLIC_SUPABASE_URL=https://api.your-domain.com
GOTRUE_SITE_URL=https://your-domain.com
NEXT_PUBLIC_SITE_URL=https://your-domain.com
NEXT_PUBLIC_BASE_URL=https://your-domain.com
MAIN_DOMAIN=your-domain.com
GOTRUE_URI_ALLOW_LIST=https://your-domain.com/*,https://www.your-domain.com/*
```

#### SMTP (Email)
Example for SendGrid:
```env
SMTP_ADMIN_EMAIL=noreply@your-domain.com
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=SG.xxxxxxxxxxxxxxxxxxxxxxxxx
SMTP_SENDER_NAME=Sellf
```

Example for Gmail:
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

#### Stripe - Choose ONE Configuration Method

**METHOD 1: .env Configuration (Recommended for developers, Docker, CI/CD)**
```env
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxx
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxx  # Standard Secret Key or Restricted Key
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```

**METHOD 2: Admin Panel Wizard (Recommended for non-technical users)**
```env
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxx
STRIPE_ENCRYPTION_KEY=ONIgOXqmoHOYZphEDkhydpL4briQsVlS9IS3o59mW9E=  # Generate: openssl rand -base64 32
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```
Then configure the Restricted API Key through the graphical interface in Settings.

**Both methods are fully supported. Choose the one that fits your workflow.**

**Details:** See section [5. Stripe Configuration](#5-stripe-configuration) below.

#### Cloudflare Turnstile (CAPTCHA)
```env
NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY=1x00000000000000000000AA
CLOUDFLARE_TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

### 5. Stripe Configuration

Sellf supports **two equivalent methods** for Stripe configuration. Choose the one that best fits your use case.

#### Method 1: .env Configuration (Recommended for developers)

**Advantages:**
- ✅ Quick setup (one environment variable)
- ✅ Ideal for Docker, CI/CD, automation
- ✅ Developers are familiar with this pattern
- ✅ Easy rollback (change .env and restart)

**Steps:**
1. Get the Secret Key from Stripe Dashboard:
   - Test Mode: https://dashboard.stripe.com/test/apikeys
   - Live Mode: https://dashboard.stripe.com/apikeys
   - You can use the Standard Secret Key (`sk_test_` or `sk_live_`)
   - Or a Restricted Key (`rk_test_` or `rk_live_`) with the appropriate permissions

2. Add to `.env.production`:
   ```bash
   # Test Mode (development)
   STRIPE_SECRET_KEY=sk_test_51ABC...xyz

   # OR Live Mode (production)
   STRIPE_SECRET_KEY=sk_live_51ABC...xyz
   ```

3. Restart the application:
   ```bash
   docker compose restart admin-panel
   ```

4. Verify in Settings:
   - Go to: `https://your-domain.com/dashboard/settings`
   - You should see a blue banner: **"Currently using: .env configuration"**

#### Method 2: Admin Panel Wizard (Recommended for non-technical users)

**Advantages:**
- ✅ Visual step-by-step guide
- ✅ AES-256-GCM encryption (keys in database)
- ✅ Automatic permission validation
- ✅ Key rotation reminders (every 90 days)
- ✅ No file editing required

**Steps:**

1. **Generate an encryption key** (one-time):
   ```bash
   openssl rand -base64 32
   ```

2. **Add the key to `.env.production`**:
   ```bash
   echo "STRIPE_ENCRYPTION_KEY=YOUR_GENERATED_KEY" >> .env.production
   ```

   **⚠️ CRITICAL: Never commit this key to Git!**

3. **Restart the application**:
   ```bash
   docker compose restart admin-panel
   ```

4. **Open the wizard**:
   - Go to: `https://your-domain.com/dashboard/settings`
   - Click the **"Configure Stripe"** button

5. **Go through 5 steps**:
   - **Step 1 (Welcome)**: Click "Start Configuration"
   - **Step 2 (Mode selection)**: Choose "Test Mode" or "Live Mode"
   - **Step 3 (Create key)**: Follow the visual guide:
     1. Open Stripe Dashboard
     2. Go to API Keys → Create restricted key
     3. Set permissions:
        - ✅ Charges: Write
        - ✅ Customers: Write
        - ✅ Checkout Sessions: Write
        - ✅ Payment Intents: Read
        - ✅ Webhooks: Read (optional)
     4. Copy the key (starts with `rk_test_` or `rk_live_`)
     5. Return to the wizard and click "I've Created the Key"
   - **Step 4 (Validation)**: Paste the key and click "Validate API Key"
   - **Step 5 (Success)**: Click "Finish"

6. **Verify configuration**:
   - You should see a green banner: **"Currently using: Database configuration"**
   - Your masked key: `rk_test_****1234` (only last 4 characters)
   - Status: Test Mode / Live Mode
   - Permissions: ✅ Verified

#### Switching Between Methods

**From .env to Wizard**:
1. Simply launch the wizard and configure the key
2. Database configuration takes priority over .env
3. You can leave the `STRIPE_SECRET_KEY` variable in .env as a fallback

**From Wizard to .env**:
1. Add `STRIPE_SECRET_KEY` to .env
2. Remove configuration from the database:
   ```bash
   docker exec supabase_db_sellf psql -U postgres -d postgres -c \
     "DELETE FROM stripe_configurations WHERE is_active = true;"
   ```
3. Restart the application

#### Testing Configuration

**Test with a Stripe test card:**
1. Create a test product in the Admin Panel
2. Go to the product page
3. Click "Buy Now"
4. Use the test card: `4242 4242 4242 4242`
   - Expiry: any future date (e.g. 12/34)
   - CVC: any 3 digits (e.g. 123)
5. Verify the payment in:
   - Dashboard → Payments
   - Stripe Dashboard → Payments

**📖 Full testing guide:** See `/STRIPE-TESTING-GUIDE.md`

#### Required Database Migrations

The wizard requires the `stripe_configurations` table in the database:

```bash
# Check if the migration exists
ls -la supabase/migrations/ | grep stripe

# Should be: 20251227000000_stripe_rak_configuration.sql
```

If the migration does not exist, it will be automatically executed during database startup.

## Database Configuration

### 1. Prepare Migrations

Check that all migrations are in place:

```bash
ls -la supabase/migrations/
```

The following files should be present:
- `20250709000000_initial_schema.sql` - Initial schema
- `20250717000000_payment_system.sql` - Payment system
- `20251227000000_stripe_rak_configuration.sql` - Stripe configuration (wizard)
- `20251227100000_shop_config.sql` - Shop configuration
- others...

### 2. Optionally: Modify Seed Data

If you want to have your own sample data:

```bash
nano supabase/seed.sql
```

## Starting the Application

### 1. Build and Start Containers

```bash
# Make sure you are in the main project directory
cd ~/sellf

# Build images (may take a few minutes on the first run)
docker compose build

# Start all services
docker compose up -d

# Check container status
docker compose ps
```

Expected output:
```
NAME                  STATUS              PORTS
sellf-admin        running             0.0.0.0:3000->3000/tcp
sellf-db           running (healthy)   0.0.0.0:5432->5432/tcp
sellf-auth         running
sellf-rest         running
sellf-storage      running
sellf-nginx        running             0.0.0.0:8080->80/tcp
...
```

### 2. Check Logs

```bash
# All containers
docker compose logs -f

# Specific container
docker compose logs -f admin-panel
docker compose logs -f db
```

### 3. Initialize Database

If the database was automatically initialized (migrations in `/docker-entrypoint-initdb.d`), you can skip this step. Otherwise:

```bash
# Connect to the database
docker compose exec db psql -U postgres

# Check tables
\dt

# Exit
\q
```

If the tables do not exist, run migrations manually:

```bash
# Copy migrations to the container
docker compose cp supabase/migrations/. db:/tmp/migrations/

# Execute migrations
docker compose exec db psql -U postgres -d postgres -f /tmp/migrations/20250709000000_initial_schema.sql
docker compose exec db psql -U postgres -d postgres -f /tmp/migrations/20250717000000_payment_system.sql
```

## Domain and SSL Configuration

### Option 1: Nginx Proxy Manager (Recommended for beginners)

1. Install Nginx Proxy Manager:
```bash
# Create a separate directory
mkdir ~/nginx-proxy-manager
cd ~/nginx-proxy-manager

# Download docker-compose.yml for NPM
wget https://github.com/NginxProxyManager/nginx-proxy-manager/blob/main/docker-compose.yml

# Start
docker compose up -d
```

2. Log in to the panel: `http://your-server:81`
   - Email: `admin@example.com`
   - Password: `changeme`

3. Add a Proxy Host:
   - Domain: `your-domain.com`
   - Forward Hostname: `admin-panel`
   - Forward Port: `3000`
   - Websockets: ✅
   - SSL: Select "Request a new SSL Certificate" (Let's Encrypt)

4. Add a second Proxy Host for the API:
   - Domain: `api.your-domain.com`
   - Forward Hostname: `kong`
   - Forward Port: `8000`
   - SSL: ✅

5. Add a third Proxy Host for examples:
   - Domain: `examples.your-domain.com` (optional)
   - Forward Hostname: `nginx`
   - Forward Port: `80`
   - SSL: ✅

### Option 2: Certbot + Nginx (For advanced users)

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d your-domain.com -d www.your-domain.com -d api.your-domain.com

# Automatic renewal
sudo systemctl enable certbot.timer
```

### DNS Configuration

Set DNS records with your provider:

```
Type   Name     Value                TTL
A      @        YOUR_SERVER_IP       3600
A      www      YOUR_SERVER_IP       3600
A      api      YOUR_SERVER_IP       3600
```

## Stripe Webhooks Configuration

### 1. Create a Webhook Endpoint in Stripe Dashboard

1. Go to: https://dashboard.stripe.com/webhooks
2. Click "Add endpoint"
3. URL: `https://your-domain.com/api/webhooks/stripe`
4. Select events:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
5. Save and copy the **Signing secret** (`whsec_...`)

### 2. Update Environment Variables

```bash
nano .env.production
```

Add/update:
```env
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

Restart the application:
```bash
docker compose restart admin-panel
```

## Initial Setup

### 1. Create First Administrator Account

1. Go to: `https://your-domain.com/login`
2. Enter your email
3. Click "Send Magic Link"
4. Check your email inbox and click the link
5. The first account automatically gets administrator privileges!

### 2. Test the Dashboard

1. After logging in, go to: `https://your-domain.com/dashboard`
2. Check the Admin section: `https://your-domain.com/admin/products`
3. Create your first test product

### 3. Test a Payment

1. Create a product with a test price (e.g. 10 PLN)
2. Go to the product page: `https://your-domain.com/p/product-slug`
3. Use the Stripe test card: `4242 4242 4242 4242`
4. Verify that the payment went through

## Monitoring and Logs

### Checking Status

```bash
# Status of all containers
docker compose ps

# Resource usage
docker stats

# Real-time logs
docker compose logs -f

# Logs of a specific service
docker compose logs -f admin-panel
docker compose logs -f db
```

### Application Logs

Logs are available in containers:

```bash
# Admin Panel
docker compose exec admin-panel sh
ls -la /app/.next/

# Database - PostgreSQL logs
docker compose logs db | grep ERROR

# Nginx
docker compose logs nginx
```

### Database Monitoring

```bash
# Connect to the database
docker compose exec db psql -U postgres

# Check database size
SELECT pg_size_pretty(pg_database_size('postgres'));

# Check active connections
SELECT count(*) FROM pg_stat_activity;

# Check most popular queries
SELECT query, calls, total_exec_time
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

## Updating

### Updating the Code

```bash
# Go to the project directory
cd ~/sellf

# Stop the application
docker compose down

# Pull the latest code
git pull origin main

# Rebuild images
docker compose build --no-cache

# Start again
docker compose up -d

# Check logs
docker compose logs -f admin-panel
```

### Updating the Database (Migrations)

```bash
# New migration will appear in supabase/migrations/
ls -la supabase/migrations/

# Execute the migration
docker compose exec db psql -U postgres -d postgres -f /tmp/migrations/NEW_MIGRATION.sql
```

### Backup Before Updating

**ALWAYS make a backup before updating!**

```bash
# Database backup
docker compose exec db pg_dump -U postgres postgres > backup_$(date +%Y%m%d_%H%M%S).sql

# Volume backup
docker run --rm \
  -v sellf_postgres_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/postgres_backup_$(date +%Y%m%d_%H%M%S).tar.gz /data
```

## Backup and Restore

### Automatic Database Backup

Create a backup script:

```bash
nano ~/backup-sellf.sh
```

Contents:
```bash
#!/bin/bash
BACKUP_DIR="/home/$(whoami)/backups/sellf"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Database backup
docker compose -f /home/$(whoami)/sellf/docker-compose.yml \
  exec -T db pg_dump -U postgres postgres | gzip > $BACKUP_DIR/db_$DATE.sql.gz

# Remove old backups (older than 7 days)
find $BACKUP_DIR -name "db_*.sql.gz" -mtime +7 -delete

echo "Backup completed: $BACKUP_DIR/db_$DATE.sql.gz"
```

Set permissions and cron:
```bash
chmod +x ~/backup-sellf.sh

# Add to cron (backup daily at 2:00 AM)
crontab -e

# Add the line:
0 2 * * * /home/yourusername/backup-sellf.sh >> /home/yourusername/backup-sellf.log 2>&1
```

### Restoring from Backup

```bash
# Stop the application
cd ~/sellf
docker compose down

# Restore the database
gunzip -c ~/backups/sellf/db_20250126_020000.sql.gz | \
  docker compose run --rm -T db psql -U postgres

# Start again
docker compose up -d
```

### File Backup

```bash
# Volume backup (storage, uploads, etc.)
docker run --rm \
  -v sellf_storage_data:/data \
  -v ~/backups/sellf:/backup \
  alpine tar czf /backup/storage_$(date +%Y%m%d).tar.gz /data
```

## Troubleshooting

### Problem: Containers won't start

```bash
# Check logs
docker compose logs

# Check configuration
docker compose config

# Remove everything and start from scratch
docker compose down -v
docker compose up -d
```

### Problem: Database not responding

```bash
# Check status
docker compose ps db

# Check logs
docker compose logs db

# Restart the database
docker compose restart db

# If that doesn't help, check free disk space
df -h
```

### Problem: Admin Panel returns 500

```bash
# Check logs
docker compose logs admin-panel

# Check environment variables
docker compose exec admin-panel env | grep SUPABASE

# Restart the panel
docker compose restart admin-panel
```

### Problem: Magic link doesn't work

1. Check SMTP configuration:
```bash
docker compose logs auth | grep SMTP
```

2. Check `GOTRUE_URI_ALLOW_LIST` in `.env.production`

3. Check if the email arrived (check spam)

### Problem: Stripe payments don't work

1. Check webhook secret:
```bash
docker compose exec admin-panel env | grep STRIPE
```

2. Check webhook logs in Stripe Dashboard

3. Test the endpoint manually:
```bash
curl -X POST https://your-domain.com/api/webhooks/stripe \
  -H "stripe-signature: test" \
  -d '{}'
```

### Problem: No disk space

```bash
# Check space
df -h

# Remove unused images
docker image prune -a

# Remove unused volumes
docker volume prune

# Remove old logs
docker compose logs --tail=0
```

### Problem: Slow performance

1. Check resource usage:
```bash
docker stats
```

2. Add more RAM or CPU in server settings

3. Optimize the database:
```bash
docker compose exec db psql -U postgres -c "VACUUM ANALYZE;"
```

4. Add indexes to frequently used columns

## Support and Documentation

- **Sellf Documentation**: `/CLAUDE.md` in the repository
- **Docker Documentation**: https://docs.docker.com/
- **Supabase Documentation**: https://supabase.com/docs
- **Stripe Documentation**: https://stripe.com/docs
- **GitHub Issues**: [link to repository]

## Security - Checklist

After deployment, check:

- [ ] All passwords are long and secure
- [ ] `.env.production` is NOT in the Git repository
- [ ] Firewall is configured (only ports 22, 80, 443)
- [ ] SSL/TLS is enabled (HTTPS)
- [ ] Backups are configured and tested
- [ ] SMTP uses an encrypted connection
- [ ] Stripe is in production mode (keys `pk_live_` and `sk_live_`)
- [ ] Rate limiting is enabled
- [ ] Logs do not contain sensitive data
- [ ] Monitoring is configured

---

**Congratulations! Sellf is now running in production!** 🎉
