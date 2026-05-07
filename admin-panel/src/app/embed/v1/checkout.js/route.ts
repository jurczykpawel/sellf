import { NextResponse } from 'next/server';

export async function GET() {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';
  const turnstileSiteKey =
    process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY ||
    process.env.CLOUDFLARE_TURNSTILE_SITE_KEY ||
    '';

  const script = `
(function () {
  var script = document.currentScript;
  if (!script) return;

  var sellfOrigin = new URL(script.src).origin;
  var publishableKey = ${JSON.stringify(publishableKey)};
  var turnstileSiteKey = ${JSON.stringify(turnstileSiteKey)};

  function postJson(path, productSlug, payload) {
    var url = sellfOrigin + path + '?productSlug=' + encodeURIComponent(productSlug);
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sellf-Embed-Version': '1',
      },
      body: JSON.stringify(payload),
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) throw new Error(body && body.error ? body.error : 'Request failed');
        return body;
      });
    });
  }

  function loadStripeJs() {
    if (window.Stripe) return Promise.resolve(window.Stripe);
    return new Promise(function (resolve, reject) {
      var stripeScript = document.createElement('script');
      stripeScript.src = 'https://js.stripe.com/v3/';
      stripeScript.onload = function () { resolve(window.Stripe); };
      stripeScript.onerror = function () { reject(new Error('Stripe.js failed to load')); };
      document.head.appendChild(stripeScript);
    });
  }

  function showMessage(root, message) {
    root.textContent = message;
  }

  function renderFreeForm(root, productSlug) {
    var form = document.createElement('form');
    var input = document.createElement('input');
    var honeypot = document.createElement('input');
    var button = document.createElement('button');
    var status = document.createElement('div');
    var captcha = document.createElement('div');
    var turnstileToken = '';

    input.type = 'email';
    input.name = 'email';
    input.required = true;
    input.placeholder = 'Email';
    honeypot.type = 'text';
    honeypot.name = 'website';
    honeypot.tabIndex = -1;
    honeypot.autocomplete = 'off';
    honeypot.style.position = 'absolute';
    honeypot.style.left = '-10000px';
    honeypot.setAttribute('aria-hidden', 'true');
    captcha.className = 'sellf-turnstile';
    button.type = 'submit';
    button.textContent = 'Get access';

    form.appendChild(input);
    form.appendChild(honeypot);
    form.appendChild(captcha);
    form.appendChild(button);
    form.appendChild(status);
    root.appendChild(form);

    if (turnstileSiteKey) {
      var captchaScript = document.createElement('script');
      captchaScript.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      captchaScript.onload = function () {
        if (!window.turnstile) return;
        window.turnstile.render(captcha, {
          sitekey: turnstileSiteKey,
          callback: function (token) { turnstileToken = token; },
          'expired-callback': function () { turnstileToken = ''; },
          'error-callback': function () { turnstileToken = ''; },
        });
      };
      document.head.appendChild(captchaScript);
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      button.disabled = true;
      status.textContent = '';
      postJson('/api/embed/free-access', productSlug, {
        productSlug: productSlug,
        email: input.value,
        website: honeypot.value,
        turnstileToken: turnstileToken || undefined,
      }).then(function (body) {
        status.textContent = body.message || 'Check your email.';
      }).catch(function (error) {
        status.textContent = error.message;
      }).finally(function () {
        button.disabled = false;
      });
    });
  }

  function renderPaidCheckout(root, productSlug, email) {
    if (!publishableKey) {
      showMessage(root, 'Checkout is not configured.');
      return;
    }

    postJson('/api/embed/checkout-session', productSlug, {
      productSlug: productSlug,
      email: email || undefined,
    }).then(function (body) {
      return loadStripeJs().then(function (Stripe) {
        var stripe = Stripe(publishableKey);
        return stripe.initEmbeddedCheckout({ clientSecret: body.clientSecret });
      });
    }).then(function (checkout) {
      root.textContent = '';
      checkout.mount(root);
    }).catch(function (error) {
      showMessage(root, error.message);
    });
  }

  document.querySelectorAll('[data-sellf-embed]').forEach(function (root) {
    var productSlug = root.getAttribute('data-product-slug');
    var mode = root.getAttribute('data-sellf-mode') || 'paid';
    var email = root.getAttribute('data-email') || '';
    if (!productSlug) {
      showMessage(root, 'Missing product.');
      return;
    }
    if (mode === 'free') renderFreeForm(root, productSlug);
    else renderPaidCheckout(root, productSlug, email);
  });
})();
`.trim();

  return new NextResponse(script, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
