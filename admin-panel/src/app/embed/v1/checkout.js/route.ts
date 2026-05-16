import { NextResponse } from 'next/server';

export async function GET() {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';

  // The SDK no longer takes a data-sellf-mode attribute. The single embed
  // endpoint /api/embed/checkout-session returns a discriminated union:
  //   { kind: 'paid', clientSecret, sessionId, product }  → Stripe Embedded
  //   { kind: 'free', product, captchaSiteKey }           → email gate form
  // The SDK reads `kind` and renders accordingly.
  const script = `
(function () {
  var script = document.currentScript;
  if (!script) return;

  var sellfOrigin = new URL(script.src).origin;
  var publishableKey = ${JSON.stringify(publishableKey)};

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

  var stripeInstances = {};

  function showMessage(root, message) {
    root.textContent = message;
  }

  function renderFreeForm(root, productSlug, captchaSiteKey) {
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
    root.textContent = '';
    root.appendChild(form);

    if (captchaSiteKey) {
      var captchaScript = document.createElement('script');
      captchaScript.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      captchaScript.onload = function () {
        if (!window.turnstile) return;
        window.turnstile.render(captcha, {
          sitekey: captchaSiteKey,
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

  function mountPaidCheckout(root, clientSecret) {
    if (!publishableKey) {
      showMessage(root, 'Checkout is not configured.');
      return;
    }
    loadStripeJs().then(function (Stripe) {
      var stripe = stripeInstances[publishableKey] || (stripeInstances[publishableKey] = Stripe(publishableKey));
      return stripe.initEmbeddedCheckout({ clientSecret: clientSecret });
    }).then(function (checkout) {
      root.textContent = '';
      checkout.mount(root);
    }).catch(function (error) {
      showMessage(root, error.message);
    });
  }

  function initEmbed(root) {
    var productSlug = root.getAttribute('data-product-slug');
    var email = root.getAttribute('data-email') || '';
    if (!productSlug) {
      showMessage(root, 'Missing product.');
      return;
    }

    postJson('/api/embed/checkout-session', productSlug, {
      productSlug: productSlug,
      email: email || undefined,
    }).then(function (body) {
      if (body.kind === 'free') {
        renderFreeForm(root, productSlug, body.captchaSiteKey || '');
      } else if (body.kind === 'paid' && body.clientSecret) {
        mountPaidCheckout(root, body.clientSecret);
      } else {
        showMessage(root, 'Unexpected response from Sellf.');
      }
    }).catch(function (error) {
      showMessage(root, error.message);
    });
  }

  document.querySelectorAll('[data-sellf-embed]').forEach(initEmbed);
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
