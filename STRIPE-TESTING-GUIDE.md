# Stripe Configuration Wizard - Manual Testing Guide

This guide explains how to manually test the Stripe configuration wizard in the Sellf admin panel.

## Table of Contents

1. [Overview](#overview)
2. [Accessing the Wizard](#accessing-the-wizard)
3. [Testing with Test Mode](#testing-with-test-mode)
4. [Testing with Live Mode](#testing-with-live-mode)
5. [Switching Between Configuration Methods](#switching-between-configuration-methods)
6. [Verifying Encryption](#verifying-encryption)
7. [Testing Key Rotation](#testing-key-rotation)
8. [Common Test Scenarios](#common-test-scenarios)
9. [Troubleshooting](#troubleshooting)

## Overview

Sellf supports **two equal configuration methods** for Stripe:

1. **Method 1: .env configuration** - Set `STRIPE_SECRET_KEY` in your `.env` file
   - Best for: Developers, Docker deployments, CI/CD pipelines
   - No wizard needed

2. **Method 2: Database wizard** - Use the visual wizard in Settings
   - Best for: Non-technical users, visual guides needed
   - Keys encrypted with AES-256-GCM

**Both methods are fully supported. Choose what works best for you.**

## Accessing the Wizard

### Prerequisites

1. **Admin Account**: You must be logged in as an admin user
2. **Encryption Key** (for wizard method): `STRIPE_ENCRYPTION_KEY` must be set in `.env`
   ```bash
   # Generate encryption key
   openssl rand -base64 32

   # Add to .env
   STRIPE_ENCRYPTION_KEY=your_generated_key_here
   ```

### Opening the Wizard

1. Log in to the admin panel at `https://your-domain.com/login`
2. Navigate to **Settings**: `https://your-domain.com/dashboard/settings`
3. Scroll to the **Stripe Configuration** section
4. Click the **"Configure Stripe"** button

The wizard will open with 5 steps:
- Step 1: Welcome
- Step 2: Mode Selection (Test/Live)
- Step 3: Create Key (Visual guide)
- Step 4: Enter & Validate Key
- Step 5: Success Summary

## Testing with Test Mode

### Step 1: Get a Test Restricted API Key

1. Go to [Stripe Dashboard - API Keys (Test Mode)](https://dashboard.stripe.com/test/apikeys/create?type=restricted)
2. Ensure you're in **Test Mode** (toggle in top right)
3. Click **"Create restricted key"**
4. Set the key name (e.g., "Sellf Test Key")
5. Configure permissions:
   - ✅ **Charges**: Write
   - ✅ **Customers**: Write
   - ✅ **Checkout Sessions**: Write
   - ✅ **Payment Intents**: Read
   - ✅ **Webhooks**: Read (optional but recommended)
6. Click **"Create key"**
7. Copy the key (starts with `rk_test_`)

### Step 2: Complete the Wizard

1. **Step 1 (Welcome)**: Click **"Start Configuration"**
2. **Step 2 (Mode Selection)**: Select **"Test Mode"** → Click **"Continue"**
3. **Step 3 (Create Key)**: Review instructions → Click **"I've Created the Key"**
4. **Step 4 (Enter Key)**:
   - Paste your test key (e.g., `rk_test_51ABC...xyz`)
   - The wizard will auto-trim whitespace
   - Click **"Validate API Key"**
   - Wait ~5 seconds for validation
   - You should see ✅ **"Key validated successfully"**
5. **Step 5 (Success)**: Click **"Finish"**

### Step 3: Verify Configuration

1. You should see a green banner: **"Currently using: Database configuration"**
2. Your masked key should be visible: `rk_test_****xyz`
3. Status should show: **"Test Mode"** with an orange badge
4. Permissions verified: ✅ **"Verified"**

### Step 4: Test a Payment

1. Create a test product in Products section
2. Go to the product page
3. Click "Buy Now"
4. Use Stripe test card: **4242 4242 4242 4242**
   - Expiry: Any future date (e.g., 12/34)
   - CVC: Any 3 digits (e.g., 123)
5. Complete checkout
6. Verify payment appears in:
   - Dashboard → Payments
   - Stripe Dashboard → Payments (Test Mode)

## Testing with Live Mode

⚠️ **WARNING**: Live mode uses real money. Only use this in production with real payment intent.

### Prerequisites

1. Stripe account must be fully activated (not just test mode)
2. Business verification completed
3. Bank account connected for payouts

### Process

1. Follow the same wizard steps as Test Mode
2. In **Step 2**, select **"Live Mode"** instead
3. Use a Live restricted key (starts with `rk_live_`)
4. Set the same permissions as Test Mode
5. Complete validation

The wizard will store Test and Live configurations separately. You can have both active at the same time.

## Switching Between Configuration Methods

### From .env to Database Wizard

**Current State**: You have `STRIPE_SECRET_KEY` in your `.env` file

**To Switch**:
1. Open Settings page
2. You'll see a blue info banner: **"Currently using: .env configuration"**
3. Click **"Configure Stripe"** button
4. Complete wizard as described above
5. **No need to remove .env variable** - the database config takes priority

**Result**: Your app now uses the database-encrypted key. The .env variable is ignored but still there as a fallback.

### From Database Wizard to .env

**Current State**: You configured Stripe via the wizard

**To Switch**:
1. Set `STRIPE_SECRET_KEY` in your `.env` file:
   ```bash
   # For test mode
   STRIPE_SECRET_KEY=sk_test_your_secret_key

   # For live mode
   STRIPE_SECRET_KEY=sk_live_your_secret_key
   ```
2. Delete the database configuration:
   ```bash
   # Connect to database
   docker exec supabase_db_sellf psql -U postgres -d postgres

   # Delete configs
   DELETE FROM stripe_configurations WHERE is_active = true;
   \q
   ```
3. Restart the application:
   ```bash
   docker compose restart admin-panel
   ```

**Result**: Your app now uses the .env key. The database is empty.

### Testing Both Methods Work

**Test .env Method**:
1. Ensure `STRIPE_SECRET_KEY` is set in `.env`
2. Ensure no active database configs
3. Restart app
4. Make a test payment
5. Check Settings page - you should see: **"Currently using: .env configuration"**

**Test Database Method**:
1. Complete wizard with a valid key
2. (Optional) Remove `STRIPE_SECRET_KEY` from `.env` or keep it as fallback
3. Restart app
4. Make a test payment
5. Check Settings page - you should see: **"Currently using: Database configuration"**

## Verifying Encryption

### Check Database Directly

```bash
# Connect to database
docker exec supabase_db_sellf psql -U postgres -d postgres

# View encrypted configs (no plaintext keys visible)
SELECT
  id,
  mode,
  key_prefix,
  key_last_4,
  LEFT(encrypted_key, 20) as encrypted_sample,
  permissions_verified,
  is_active,
  created_at
FROM stripe_configurations;
```

**Expected Output**:
```
 mode | key_prefix | key_last_4 | encrypted_sample     | permissions_verified
------+------------+------------+---------------------+----------------------
 test | rk_test_   | 1234       | U2FsdGVkX1+8yCk5... | t
```

You should **NEVER** see the full API key in plaintext in the database.

### Verify Encryption Key is Set

```bash
# In your .env file
grep STRIPE_ENCRYPTION_KEY .env
```

Should output:
```
STRIPE_ENCRYPTION_KEY=your_32_byte_base64_key
```

If this is missing, the wizard will fail with an error.

## Testing Key Rotation

### Why Rotate Keys?

- Security best practice: rotate keys every 90 days
- Compliance requirements
- Key compromise response

### Testing Rotation Flow

1. **Create First Configuration**:
   - Complete wizard with Test Mode key
   - Note the expiration date (90 days from creation)

2. **Wait or Manually Trigger Reminder** (simulate 90 days passing):
   ```bash
   # Update expires_at to yesterday
   docker exec supabase_db_sellf psql -U postgres -d postgres -c \
     "UPDATE stripe_configurations SET expires_at = NOW() - INTERVAL '1 day' WHERE mode = 'test';"
   ```

3. **Verify Reminder Appears**:
   - Refresh Settings page
   - You should see a warning: **"Rotation reminder: [past date]"**

4. **Rotate the Key**:
   - Click **"Configure Another Mode"** or open wizard
   - Select the same mode (Test)
   - Enter a NEW restricted key
   - Complete validation
   - The wizard will:
     - Deactivate old key (`is_active = false`)
     - Activate new key (`is_active = true`)
     - Set new expiration date (+90 days)

5. **Verify Old Key is Deactivated**:
   ```bash
   docker exec supabase_db_sellf psql -U postgres -d postgres -c \
     "SELECT mode, key_last_4, is_active, created_at FROM stripe_configurations ORDER BY created_at;"
   ```

Expected output:
```
 mode  | key_last_4 | is_active |     created_at
-------+------------+-----------+---------------------
 test  | 1234       | f         | 2025-12-20 10:00:00  (OLD)
 test  | 5678       | t         | 2025-12-27 14:30:00  (NEW)
```

## Common Test Scenarios

### Scenario 1: Invalid Key Format

**Test**: Enter a key with wrong prefix

1. Open wizard → Step 4
2. Enter: `sk_test_1234567890` (standard secret key, not restricted)
3. Blur the input
4. **Expected**: Error message: "Invalid key prefix. Expected 'rk_test_' or 'rk_live_'"

### Scenario 2: Key Too Short

**Test**: Enter a short key

1. Open wizard → Step 4
2. Enter: `rk_test_short`
3. Blur the input
4. **Expected**: Error message: "Key is too short (minimum 30 characters)"

### Scenario 3: Wrong Mode Key

**Test**: Paste Live key in Test mode wizard

1. Open wizard → Select **Test Mode** → Step 4
2. Paste a Live key: `rk_live_51ABC...`
3. Try to validate
4. **Expected**: Error message: "You selected Test Mode but provided a Live key"

### Scenario 4: Missing Permissions

**Test**: Create a key without required permissions

1. In Stripe Dashboard, create restricted key with only **Customers: Read**
2. Complete wizard with this key
3. Click **"Validate API Key"**
4. **Expected**:
   - Connection succeeds ✅
   - Permission verification fails ❌
   - Shows checklist:
     - ❌ Charges (Write) - Missing
     - ❌ Customers (Write) - Missing (you only granted Read)
     - ❌ Checkout Sessions (Write) - Missing

### Scenario 5: Exit Confirmation

**Test**: Close wizard mid-flow

1. Open wizard
2. Complete Step 1 and Step 2 (select mode)
3. Click the **X** (close button) or press **Escape**
4. **Expected**: Confirmation dialog appears:
   - Title: "Exit configuration?"
   - Message: "Your progress has been saved. You can resume later."
   - Buttons: "Continue Setup" | "Exit Anyway"
5. Click **"Continue Setup"** → Returns to wizard
6. Click **X** again → Click **"Exit Anyway"** → Wizard closes

### Scenario 6: Back Navigation

**Test**: Navigate backwards through steps

1. Complete Steps 1, 2, 3
2. On Step 4, click **"Back"**
3. **Expected**: Returns to Step 3
4. Your selected mode (Test/Live) is preserved
5. Click **"Back"** again → Returns to Step 2
6. Your mode selection is still highlighted

### Scenario 7: Copy-Paste with Whitespace

**Test**: Paste key with leading/trailing spaces

1. Copy this (with spaces): `  rk_test_51ABC123xyz   `
2. Paste into key input in Step 4
3. Blur the input (click outside)
4. **Expected**: Whitespace is auto-trimmed
5. Input now shows: `rk_test_51ABC123xyz` (no spaces)

### Scenario 8: Masked Key Display

**Test**: Verify key is masked after save

1. Complete wizard with key: `rk_test_51ABCdefGHIjklMNOpqrSTUvwxYZ1234`
2. On Success step (Step 5), verify key is shown as: `rk_test_****1234`
3. Go to Settings page
4. **Expected**: Active config shows: `rk_test_****1234`
5. Only last 4 characters visible

## Troubleshooting

### Error: "Encryption key not configured"

**Cause**: `STRIPE_ENCRYPTION_KEY` missing from `.env`

**Fix**:
```bash
# Generate key
openssl rand -base64 32

# Add to .env
echo "STRIPE_ENCRYPTION_KEY=YOUR_GENERATED_KEY" >> .env

# Restart app
docker compose restart admin-panel
```

### Error: "Failed to connect to Stripe"

**Cause**: Invalid API key or network issue

**Fix**:
1. Verify key is correct (copy again from Stripe Dashboard)
2. Check network connectivity
3. Verify Stripe is not experiencing downtime: https://status.stripe.com
4. Try again in 1-2 minutes

### Error: "Missing required permissions"

**Cause**: Restricted key doesn't have all required permissions

**Fix**:
1. Go back to Stripe Dashboard
2. Edit the restricted key (or create new one)
3. Enable ALL required permissions:
   - Charges: Write
   - Customers: Write
   - Checkout Sessions: Write
   - Payment Intents: Read
   - Webhooks: Read (optional)
4. Copy new key and retry

### Wizard doesn't open

**Cause**: JavaScript error or admin permission issue

**Fix**:
1. Check browser console for errors (F12 → Console tab)
2. Verify you're logged in as admin:
   ```bash
   docker exec supabase_db_sellf psql -U postgres -d postgres -c \
     "SELECT user_id FROM admin_users WHERE user_id = 'YOUR_USER_ID';"
   ```
3. Hard refresh page: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)

### Settings page shows wrong method

**Cause**: Cache or database sync issue

**Fix**:
```bash
# Check actual database state
docker exec supabase_db_sellf psql -U postgres -d postgres -c \
  "SELECT mode, key_prefix, key_last_4, is_active FROM stripe_configurations;"

# Check .env
grep STRIPE_SECRET_KEY .env

# Restart app
docker compose restart admin-panel

# Clear browser cache and refresh
```

### Payments fail after configuration

**Cause**: Incorrect mode (Test vs Live) or wrong key

**Fix**:
1. Check which mode you're in:
   ```bash
   echo $NODE_ENV
   ```
   - `development` = uses Test keys
   - `production` = uses Live keys
2. Verify you configured the matching mode in wizard
3. Check Stripe Dashboard for error logs
4. Test with Stripe test card: `4242 4242 4242 4242`

## Best Practices

1. **Always test in Test Mode first** before configuring Live Mode
2. **Rotate keys every 90 days** (wizard will remind you)
3. **Use .env method for CI/CD** pipelines and automated deployments
4. **Use wizard method for non-technical team members**
5. **Keep STRIPE_ENCRYPTION_KEY secret** - never commit to Git
6. **Backup your database** before changing configurations
7. **Test payments** after every configuration change
8. **Monitor Stripe Dashboard** for webhook errors and failed payments

---

**Need Help?**
- Check Stripe documentation: https://stripe.com/docs/keys#limit-access
- Sellf issues: [link to repository]
- Deployment guide: `./docs/DEPLOYMENT-MIKRUS.md`
