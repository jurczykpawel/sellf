import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { waitForEmail, extractMagicLink } from './helpers/mailpit';
import { acceptAllCookies } from './helpers/consent';
import { setAuthSession } from './helpers/admin-auth';

// Enforce single worker
test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Storefront & Checkout Flows', () => {
  let adminEmail: string;
  const adminPassword = 'password123';
  let freeProductSlug: string;
  let freeProductName: string;
  let freeProductId: string;

  // Helper to login as admin
  const loginAsAdmin = async (page: Page) => {
    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await setAuthSession(page, adminEmail, adminPassword);

    await page.waitForTimeout(1000); 
  };

  test.beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `test-admin-${Date.now()}-${randomStr}@example.com`;
    
    const { data: { user }, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (createError) throw createError;

    await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: user!.id });
      
    // Create Free Product
    freeProductName = `Magnet-${Date.now()}`;
    freeProductSlug = `m-${Date.now()}`;
    
    const { data: product } = await supabaseAdmin.from('products').insert({
        name: freeProductName,
        slug: freeProductSlug,
        description: 'Get this for free!',
        price: 0,
        currency: 'USD',
        is_active: true,
        content_delivery_type: 'content',
        content_config: { 
            content_items: [{ 
                id: 'item-1', 
                type: 'video_embed', 
                title: 'Welcome Video', 
                config: { embed_url: 'https://youtube.com/embed/dQw4w9WgXcQ' }, 
                order: 1, 
                is_active: true 
            }] 
        }
    }).select().single();
    
    freeProductId = product!.id;
  });

  test('UNAUTHENTICATED user should claim free product via Magic Link flow', async ({ page }) => {
    // Log browser errors
    page.on('console', msg => {
      if (msg.type() === 'error') console.log(`BROWSER ERROR: ${msg.text()}`);
    });

    // 1. Open Product Page
    await page.context().clearCookies();
    await page.goto(`/p/${freeProductSlug}`);
    
    await expect(page).toHaveURL(new RegExp(`/checkout/${freeProductSlug}`), { timeout: 10000 });

    // 2. Fill the Free Product Form
    const userEmail = `lead-${Date.now()}@example.com`;
    await page.locator('input[type="email"]').fill(userEmail);
    
    // Accept Terms
    const termsLabel = page.locator('label').filter({ hasText: /I agree|Akceptuję|regulamin/i });
    await termsLabel.click();
    
    // Wait for captcha to auto-verify (Turnstile dummy key or ALTCHA PoW)
    console.log('Waiting for captcha auto-verify...');
    await page.waitForTimeout(4000);
    
    // Submit
    const submitBtn = page.getByRole('button', { name: /Get|Odbierz|Send|Wyślij/i });
    await expect(submitBtn).toBeEnabled({ timeout: 15000 });
    await submitBtn.click();

    // 3. Verify Success Message UI
    await expect(page.getByText(/check your email|sprawdź swoją skrzynkę/i).first()).toBeVisible({ timeout: 20000 });
    
    // 4. CHECK EMAIL (Mailpit)
    console.log(`Waiting for email to ${userEmail}...`);
    const message = await waitForEmail(userEmail, { timeout: 25000 });
    expect(message).toBeTruthy();
    
    // 5. Click Magic Link
    const magicLink = extractMagicLink(message.Text || message.HTML || '');
    expect(magicLink).toBeTruthy();
    console.log(`Clicking magic link: ${magicLink}`);
    
    const fixedLink = magicLink!.replace('127.0.0.1', 'localhost');
    await page.goto(fixedLink);
    
    // 6. Verify Access Granted (UI)
    await expect(page).toHaveURL(new RegExp(`/p/${freeProductSlug}`), { timeout: 30000 });
    await expect(page.getByText(/Welcome Video/i)).toBeVisible({ timeout: 15000 });

    // NEW: Verify on My Products dashboard
    await page.goto('/en/my-products');
    await expect(page.getByText(freeProductName)).toBeVisible({ timeout: 10000 });

    // 7. BACKEND VERIFICATION
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
    const newUser = users.find(u => u.email === userEmail);
    
    expect(newUser).toBeDefined();
    console.log(`Verified user created in Auth: ${newUser?.id}`);

    // NEW: Verify public.profiles record was created by trigger
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', newUser!.id)
      .single();
    
    expect(profileError).toBeNull();
    expect(profile).toBeDefined();
    console.log(`Verified profile record created for user: ${profile.id}`);

    const { data: accessRecord, error: accessError } = await supabaseAdmin
      .from('user_product_access')
      .select('*')
      .eq('user_id', newUser!.id)
      .eq('product_id', freeProductId)
      .single();

    expect(accessError).toBeNull();
    expect(accessRecord).toBeDefined();
    console.log(`Verified access record in DB: ${accessRecord.id}`);
  });

  test('AUTHENTICATED user should claim free product instantly', async ({ page }) => {
    // 1. Fresh user
    const userEmail = `auth-user-${Date.now()}@example.com`;
    const userPassword = 'password123';
    
    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
        email: userEmail,
        password: userPassword,
        email_confirm: true
    });
    if (error) throw error;
    const userId = user!.id;

    await page.goto('/');
    await setAuthSession(page, userEmail, userPassword);
    await page.waitForTimeout(1000);

    // 2. Go to Product Page -> Redirect to Checkout
    await page.goto(`/p/${freeProductSlug}`);
    await expect(page).toHaveURL(new RegExp(`/checkout/${freeProductSlug}`), { timeout: 10000 });
    
    // 3. Accept Terms and Click "Get Free Access"
    const termsLabel = page.locator('label').filter({ hasText: /I agree|Akceptuję|regulamin/i });
    await expect(termsLabel).toBeVisible({ timeout: 5000 });
    await termsLabel.click();

    const getAccessBtn = page.getByRole('button', { name: /Get Free Access|Odbierz darmowy dostęp/i });
    await expect(getAccessBtn).toBeEnabled({ timeout: 5000 });
    await getAccessBtn.click();
    
    // 4. Verify Instant Success (UI)
    await expect(page).toHaveURL(new RegExp(`/p/${freeProductSlug}/payment-status`), { timeout: 15000 });
    await expect(page.getByText(/Success|Sukces|Granted/i).first()).toBeVisible();
    
    // Verify content access (UI)
    await page.goto(`/p/${freeProductSlug}`);
    await expect(page).toHaveURL(new RegExp(`/p/${freeProductSlug}$`));
    await expect(page.getByText(/Welcome Video/i)).toBeVisible();

    // NEW: Verify on My Products dashboard
    await page.goto('/en/my-products');
    await expect(page.getByText(freeProductName)).toBeVisible({ timeout: 10000 });

    // 5. BACKEND VERIFICATION
    const { data: accessRecord, error: accessError } = await supabaseAdmin
      .from('user_product_access')
      .select('*')
      .eq('user_id', userId)
      .eq('product_id', freeProductId)
      .single();

    expect(accessError).toBeNull();
    expect(accessRecord).toBeDefined();

    // NEW: Verify profile exists
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .single();
    expect(profile).toBeDefined();
    console.log(`Verified access record in DB: ${accessRecord.id}`);
  });

});