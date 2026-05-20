import { NextResponse } from 'next/server';

export async function GET() {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';

  // SDK reads data-* attributes:
  //   data-product-slug   (required)
  //   data-email          (optional pre-fill)
  //   data-modal          ("true" → render button + modal; default inline)
  //   data-button-label   (modal mode only; text on the trigger button)
  //   data-show-price     (modal mode only; append " · 19,99 USD" to label)
  //
  // Backend dispatches on product type:
  //   { kind: 'paid', clientSecret, ... } → Stripe Embedded mount
  //   { kind: 'free', captchaSiteKey, product } → email-gate form
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
      var s = document.createElement('script');
      s.src = 'https://js.stripe.com/v3/';
      s.onload = function () { resolve(window.Stripe); };
      s.onerror = function () { reject(new Error('Stripe.js failed to load')); };
      document.head.appendChild(s);
    });
  }

  var stripeInstances = {};

  function showMessage(root, message) {
    root.textContent = message;
  }

  function formatPrice(amount, currency) {
    try {
      return new Intl.NumberFormat(navigator.language || 'pl-PL', {
        style: 'currency',
        currency: currency || 'USD',
        maximumFractionDigits: 2,
      }).format(Number(amount));
    } catch (e) {
      return amount + ' ' + (currency || '');
    }
  }

  function renderFreeForm(root, productSlug, captcha) {
    var form = document.createElement('form');
    var input = document.createElement('input');
    var honeypot = document.createElement('input');
    var button = document.createElement('button');
    var status = document.createElement('div');
    var captchaSlot = document.createElement('div');
    var captchaToken = '';

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
    captchaSlot.className = 'sellf-captcha';
    button.type = 'submit';
    button.textContent = 'Get access';

    form.appendChild(input);
    form.appendChild(honeypot);
    form.appendChild(captchaSlot);
    form.appendChild(button);
    form.appendChild(status);
    root.textContent = '';
    root.appendChild(form);

    if (captcha && captcha.provider === 'turnstile' && captcha.siteKey && captcha.scriptUrl) {
      var turnstileScript = document.createElement('script');
      turnstileScript.src = captcha.scriptUrl;
      turnstileScript.onload = function () {
        if (!window.turnstile) return;
        window.turnstile.render(captchaSlot, {
          sitekey: captcha.siteKey,
          callback: function (token) { captchaToken = token; },
          'expired-callback': function () { captchaToken = ''; },
          'error-callback': function () { captchaToken = ''; },
        });
      };
      document.head.appendChild(turnstileScript);
    } else if (captcha && captcha.provider === 'altcha' && captcha.scriptUrl && captcha.challengeUrl) {
      var altchaScript = document.createElement('script');
      altchaScript.src = captcha.scriptUrl;
      altchaScript.type = 'module';
      altchaScript.onload = function () {
        var widget = document.createElement('altcha-widget');
        widget.setAttribute('challengeurl', sellfOrigin + captcha.challengeUrl);
        widget.addEventListener('statechange', function (ev) {
          var detail = ev && ev.detail;
          if (detail && detail.state === 'verified' && detail.payload) {
            captchaToken = detail.payload;
          } else if (detail && detail.state === 'error') {
            captchaToken = '';
          }
        });
        captchaSlot.appendChild(widget);
      };
      document.head.appendChild(altchaScript);
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      button.disabled = true;
      status.textContent = '';
      postJson('/api/embed/free-access', productSlug, {
        productSlug: productSlug,
        email: input.value,
        website: honeypot.value,
        turnstileToken: captchaToken || undefined,
      }).then(function (body) {
        status.textContent = body.message || 'Check your email.';
      }).catch(function (error) {
        status.textContent = error.message;
      }).finally(function () {
        button.disabled = false;
      });
    });
  }

  // Returns the Stripe EmbeddedCheckout instance so callers can destroy() it
  // when their host (e.g. the modal overlay) goes away. Stripe enforces a
  // single Embedded Checkout instance per page; failing to destroy() before
  // mounting another one throws "You cannot have multiple Embedded Checkout
  // objects."
  function mountStripeInto(target, clientSecret) {
    return loadStripeJs().then(function (Stripe) {
      var stripe = stripeInstances[publishableKey] || (stripeInstances[publishableKey] = Stripe(publishableKey));
      return stripe.initEmbeddedCheckout({ clientSecret: clientSecret });
    }).then(function (checkout) {
      target.textContent = '';
      checkout.mount(target);
      return checkout;
    });
  }

  // Idempotent style injection. Called from both renderModalTrigger (button
  // needs sellf-mini-ring before price fetch) and openModalOverlay (modal
  // body needs sellf-loader). @keyframes can't go on inline style attrs.
  function createLoader(label) {
    ensureStyles();
    var el = document.createElement('div');
    el.className = 'sellf-loader';
    var ring = document.createElement('div');
    ring.className = 'sellf-loader__ring';
    var lbl = document.createElement('div');
    lbl.textContent = label || 'Ładowanie koszyka…';
    el.appendChild(ring);
    el.appendChild(lbl);
    return el;
  }

  function ensureStyles() {
    if (document.getElementById('sellf-style')) return;
    var style = document.createElement('style');
    style.id = 'sellf-style';
    style.textContent =
      '@keyframes sellf-spin{to{transform:rotate(360deg)}}' +
      '.sellf-loader{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:380px;color:#64748b;font-family:system-ui,-apple-system,sans-serif;font-size:14px}' +
      '.sellf-loader__ring{width:32px;height:32px;border:3px solid #e2e8f0;border-top-color:#5b8def;border-radius:50%;animation:sellf-spin 0.8s linear infinite}' +
      '.sellf-mini-ring{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.4);border-top-color:#fff;border-radius:50%;animation:sellf-spin 0.8s linear infinite;vertical-align:middle}';
    document.head.appendChild(style);
  }

  function openModalOverlay() {
    ensureStyles();

    var overlay = document.createElement('div');
    overlay.className = 'sellf-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:1rem;';

    var modal = document.createElement('div');
    modal.className = 'sellf-modal';
    modal.style.cssText = 'background:#fff;border-radius:12px;max-width:560px;width:100%;min-height:440px;max-height:90vh;overflow:auto;position:relative;box-shadow:0 25px 50px rgba(0,0,0,0.25);';

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:transparent;border:0;font-size:28px;line-height:1;cursor:pointer;color:#64748b;padding:4px 8px;z-index:1;';

    var slot = document.createElement('div');
    slot.style.cssText = 'padding:24px 16px 16px;';
    slot.appendChild(createLoader());

    modal.appendChild(closeBtn);
    modal.appendChild(slot);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var stripeCheckout = null;

    function close() {
      if (stripeCheckout && typeof stripeCheckout.destroy === 'function') {
        try { stripeCheckout.destroy(); } catch (e) { /* ignore */ }
        stripeCheckout = null;
      }
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);

    return {
      slot: slot,
      close: close,
      attachStripeCheckout: function (checkout) { stripeCheckout = checkout; },
    };
  }

  function renderModalTrigger(root, productSlug, options) {
    ensureStyles();
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'sellf-embed-button';
    button.style.cssText = 'display:inline-flex;align-items:center;gap:8px;padding:12px 24px;background:#5b8def;color:#fff;border:0;border-radius:9999px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 4px 12px rgba(91,141,239,0.35);';

    var baseLabel = options.buttonLabel || 'Kup';

    // setLabel('price text')   → "<baseLabel> · 19,99 USD"
    // setLabel({loading:true}) → "<baseLabel>  ◌"  (mini spinner while we wait)
    // setLabel()               → "<baseLabel>"     (price toggle off / fetch failed)
    function setLabel(arg) {
      button.textContent = '';
      button.appendChild(document.createTextNode(baseLabel));
      if (arg && typeof arg === 'object' && arg.loading) {
        button.appendChild(document.createTextNode(' '));
        var ring = document.createElement('span');
        ring.className = 'sellf-mini-ring';
        button.appendChild(ring);
      } else if (typeof arg === 'string' && arg) {
        button.appendChild(document.createTextNode(' · ' + arg));
      }
    }

    setLabel(options.initialPriceText || '');

    root.textContent = '';
    root.appendChild(button);

    button.addEventListener('click', function () {
      button.disabled = true;
      var modal = openModalOverlay();
      postJson('/api/embed/checkout-session', productSlug, {
        productSlug: productSlug,
        email: options.email || undefined,
      }).then(function (body) {
        if (body.kind === 'free') {
          renderFreeForm(modal.slot, productSlug, body.captchaSiteKey || '');
        } else if (body.kind === 'paid' && body.clientSecret) {
          return mountStripeInto(modal.slot, body.clientSecret).then(function (checkout) {
            modal.attachStripeCheckout(checkout);
          });
        } else {
          modal.slot.textContent = 'Unexpected response from Sellf.';
        }
      }).catch(function (error) {
        modal.slot.textContent = error.message;
      }).finally(function () {
        button.disabled = false;
      });
    });

    return { setLabel: setLabel };
  }

  function renderInline(root, productSlug, email) {
    // Show spinner immediately so the host page doesn't render a blank box
    // for the ~400-800ms until Stripe Embedded paints its iframe.
    // mountStripeInto / renderFreeForm both clear root before mounting.
    root.textContent = '';
    root.appendChild(createLoader());

    postJson('/api/embed/checkout-session', productSlug, {
      productSlug: productSlug,
      email: email || undefined,
    }).then(function (body) {
      if (body.kind === 'free') {
        renderFreeForm(root, productSlug, body.captcha || null);
      } else if (body.kind === 'paid' && body.clientSecret) {
        if (!publishableKey) {
          showMessage(root, 'Checkout is not configured.');
          return;
        }
        return mountStripeInto(root, body.clientSecret);
      } else {
        showMessage(root, 'Unexpected response from Sellf.');
      }
    }).catch(function (error) {
      showMessage(root, error.message);
    });
  }

  function initEmbed(root) {
    var productSlug = root.getAttribute('data-product-slug');
    var email = root.getAttribute('data-email') || '';
    var modal = root.getAttribute('data-modal') === 'true';
    var buttonLabel = root.getAttribute('data-button-label') || '';
    var showPrice = root.getAttribute('data-show-price') === 'true';

    if (!productSlug) {
      showMessage(root, 'Missing product.');
      return;
    }

    if (modal) {
      // Render the button immediately. When data-show-price is set, the price
      // fetch is async — we show a mini spinner inside the button label until
      // it lands, instead of leaving the host page with no visible button.
      var trigger = renderModalTrigger(root, productSlug, {
        buttonLabel: buttonLabel,
        email: email,
        initialPriceText: showPrice ? { loading: true } : '',
      });

      if (showPrice && trigger && trigger.setLabel) {
        postJson('/api/embed/checkout-session', productSlug, {
          productSlug: productSlug,
        }).then(function (body) {
          var product = body && body.product;
          var priceText = '';
          if (product && typeof product.price === 'number' && product.price > 0) {
            priceText = formatPrice(product.price, product.currency);
          } else if (product && product.price === 0) {
            priceText = 'Free';
          }
          trigger.setLabel(priceText);
        }).catch(function () {
          trigger.setLabel('');
        });
      }
      return;
    }

    renderInline(root, productSlug, email);
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
