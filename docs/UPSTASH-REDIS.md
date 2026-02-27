# Upstash Redis Setup (Optional Performance Optimization)

Upstash Redis is an **optional** feature that improves Sellf performance. The application works perfectly fine without it, but with Upstash you'll get:

- ✅ **<10ms latency** for cached data (vs ~50-100ms database queries)
- ✅ **50-70% reduced database load**
- ✅ **Global edge network** (16+ regions)
- ✅ **Better rate limiting** accuracy in serverless environments
- ✅ **Free tier**: 10,000 requests/day, 256MB storage

---

## ⚠️ Important: Upstash is OPTIONAL

Sellf is designed to work without Redis:

| Scenario | Performance | Behavior |
|----------|-------------|----------|
| **Without Redis** | Good ✅ | All data from database (~50-100ms) |
| **With Redis** | Excellent 🚀 | Cached data ~10ms, fallback to database |

**If Redis fails or is misconfigured**, the app automatically falls back to database queries. No errors, no crashes.

---

## 🚀 Quick Setup (5 minutes)

### Step 1: Create Upstash Account

1. Go to [console.upstash.com](https://console.upstash.com)
2. Sign up (free tier, no credit card required)

### Step 2: Create Redis Database

1. Click "Create Database"
2. Choose settings:
   - **Name**: `sellf-prod` (or any name)
   - **Type**: **Regional** (cheaper, faster for single region)
   - **Region**: Choose closest to your VPS location
   - **TLS**: Enabled (recommended)
   - **Eviction**: **No eviction** (recommended for caching)

3. Click "Create"

### Step 3: Get Credentials

After creation, you'll see:

```
REST API Endpoint: https://your-region.upstash.io
REST API Token: AX...your-token-here...==
```

### Step 4: Add to Environment Variables

Add to `.env.fullstack`:

```bash
# Upstash Redis (Optional - Performance Optimization)
UPSTASH_REDIS_REST_URL=https://your-region.upstash.io
UPSTASH_REDIS_REST_TOKEN=AX...your-token-here...==
```

### Step 5: Restart Application

```bash
# PM2
pm2 restart all

# Docker
docker-compose restart

# Dev mode
npm run dev
```

### Step 6: Verify

Check logs for:

```
✅ Upstash Redis connected - caching enabled
```

If you see this instead:

```
ℹ️  Upstash Redis not configured - using database fallback (this is OK)
```

...that means Redis is not configured, but **app still works fine**.

---

## 📊 Performance Comparison

### Without Redis (database only):
```
shop_config query:  ~50-100ms
Product query:      ~50-100ms
Total page load:    ~200-300ms
```

### With Redis (cached):
```
shop_config query:  ~5-10ms   ⚡ 10x faster
Product query:      ~5-10ms   ⚡ 10x faster
Total page load:    ~50-100ms ⚡ 3-5x faster
```

---

## 🔧 What Gets Cached?

Currently cached data:

| Data | TTL | Cache Key |
|------|-----|-----------|
| Shop Configuration | 1 hour | `shop:config` |
| Rate Limits | Dynamic | `ratelimit:*` |

**Future caching** (coming soon):
- Product data (5 min TTL)
- User purchases (1 min TTL)
- Analytics data (5 min TTL)

---

## 🧪 Testing Redis Connection

### Check if Redis is available:

```bash
# From admin-panel directory
node -e "
const { Redis } = require('@upstash/redis');
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

redis.ping()
  .then(() => console.log('✅ Redis connected'))
  .catch(err => console.error('❌ Redis error:', err.message));
"
```

### Check cache statistics:

Login to Upstash console → Your database → **Monitoring** tab to see:
- Requests per second
- Hit rate
- Data size

---

## 💰 Pricing

### Free Tier (Perfect for starting):
- **10,000 requests/day**
- **256 MB storage**
- **1 region**
- **TLS included**

**Good for**: Up to ~400 visitors/day with caching

### Pro Tier ($10/month):
- **100,000 requests/day**
- **1 GB storage**
- **1 region**

**Good for**: Up to ~3,000 visitors/day

### Pay-as-you-go:
- **$0.20 per 100,000 requests**
- **$0.25 per GB storage**

**Good for**: High-traffic sites

Calculate your needs:
```
Daily visitors: 1000
Cache hit rate: 80%
Cached requests/visitor: 5
Total requests: 1000 * 5 * 0.8 = 4,000 req/day

→ Free tier is enough! 🎉
```

---

## 🛠️ Troubleshooting

### Issue: "Expected 3 parts in JWT; got 1"

**Cause**: Upstash token is incorrect or incomplete.

**Fix**:
1. Go to Upstash console
2. Copy **full** REST API Token (should start with `AX` and end with `==`)
3. Make sure no spaces or newlines

### Issue: "Redis connection failed"

**Cause**: Network issue or wrong URL.

**Fix**:
1. Check `UPSTASH_REDIS_REST_URL` is complete (with `https://`)
2. Try pinging from VPS: `curl -I <your-url>`
3. Check firewall rules

### Issue: App is slow even with Redis

**Possible causes**:
1. Redis is far from your VPS (choose closer region)
2. Database queries are still slow (check database location)
3. ISR not enabled (check `revalidate` in pages)

**Debug**:
```bash
# Check logs for cache hits
pm2 logs | grep "Redis"
```

---

## 🔐 Security Best Practices

✅ **DO:**
- Keep tokens in `.env.fullstack` (never commit!)
- Use TLS (enabled by default)
- Rotate tokens periodically (Upstash console → Settings → Rotate)

❌ **DON'T:**
- Hardcode tokens in code
- Share tokens publicly
- Use same Redis for dev and production

---

## 📚 Advanced: Custom Caching

You can cache your own data using the cache helpers:

```typescript
import { cacheGet, cacheSet, CacheKeys, CacheTTL } from '@/lib/redis/cache'

// Get from cache
const product = await cacheGet<Product>(`product:${slug}`)

// Set to cache (5 min TTL)
await cacheSet(`product:${slug}`, productData, CacheTTL.MEDIUM)

// Delete from cache
await cacheDel(`product:${slug}`)

// Delete pattern (all products)
await cacheDelPattern('product:*')
```

**Pro tip**: Always check if `cacheGet()` returns `null` and fallback to database.

---

## 🆘 Still Need Help?

1. Check [Upstash Docs](https://docs.upstash.com/redis)
2. Check [Sellf Issues](https://github.com/yourusername/sellf/issues)
3. Ask in discussions

Remember: **Redis is optional**. If you're having issues, you can simply not configure it and the app will work fine! 🎉
