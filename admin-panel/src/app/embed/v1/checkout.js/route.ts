import { NextResponse } from 'next/server';

import { getStripePublishableKey } from '@/lib/stripe/publishable-key';

export async function GET() {
  const publishableKey = getStripePublishableKey();

  // SDK reads data-* attributes:
  //   data-product-slug   (required)
  //   data-email          (optional pre-fill)
  //   data-coupon         (optional coupon code to pre-fill and apply; buyers can change it)
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
        if (!response.ok) {
          var failure = new Error(body && body.error ? body.error : 'Request failed');
          failure.status = response.status;
          throw failure;
        }
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

  function languageFor(root) {
    return (root.getAttribute('data-locale') || root.getAttribute('lang') || script.getAttribute('data-locale') || script.getAttribute('lang') || document.documentElement.lang || navigator.language || 'en').toLowerCase().split('-')[0] === 'pl' ? 'pl' : 'en';
  }
  function errorMessage(error, language, coupon) {
    var polish = language === 'pl';
    if (!error.status) return polish ? 'Nie udało się połączyć. Spróbuj ponownie.' : 'Could not connect. Please try again.';
    if (error.status === 429) return polish ? 'Zbyt wiele prób. Spróbuj ponownie później.' : 'Too many attempts. Please try again later.';
    if (error.status === 404 || error.status === 403) return polish ? 'Ten produkt jest niedostępny.' : 'This product is unavailable.';
    if (error.status === 400 && coupon) return polish ? 'Nieprawidłowy kod kuponu' : 'Invalid coupon code';
    return polish ? 'Nie udało się otworzyć koszyka. Spróbuj ponownie.' : 'Could not open checkout. Please try again.';
  }

  function showMessage(root, message) {
    root.textContent = message;
  }

  function formatPrice(amount, currency, language) {
    try {
      return new Intl.NumberFormat(language || 'en', {
        style: 'currency',
        currency: currency || 'USD',
      }).format(Number(amount));
    } catch (e) {
      return amount + ' ' + (currency || '');
    }
  }

  function mountCaptchaWidget(slot, captcha, onToken, productSlug) {
    if (captcha && captcha.provider === 'turnstile' && captcha.siteKey && captcha.scriptUrl) {
      var turnstileScript = document.createElement('script');
      turnstileScript.src = captcha.scriptUrl;
      turnstileScript.onload = function () {
        if (!window.turnstile) return;
        window.turnstile.render(slot, {
          sitekey: captcha.siteKey,
          callback: function (token) { onToken(token); },
          'expired-callback': function () { onToken(''); },
          'error-callback': function () { onToken(''); },
        });
      };
      document.head.appendChild(turnstileScript);
    } else if (captcha && captcha.provider === 'altcha' && captcha.scriptUrl && captcha.challengeUrl) {
      var altchaScript = document.createElement('script');
      altchaScript.src = captcha.scriptUrl;
      altchaScript.type = 'module';
      // Subresource Integrity: the ALTCHA CDN URL is pinned to an exact
      // version (see lib/captcha/config.ts), so a hash mismatch here means
      // jsDelivr served something other than the reviewed, audited file —
      // the browser refuses to execute it rather than silently running it.
      if (captcha.scriptIntegrity) {
        altchaScript.integrity = captcha.scriptIntegrity;
        altchaScript.crossOrigin = 'anonymous';
      }
      altchaScript.onload = function () {
        var widget = document.createElement('altcha-widget');
        // The challenge endpoint reflects CORS only for the product's allowlisted
        // origins, so it needs the slug to know which seller's allowlist to check.
        var challengeUrl = sellfOrigin + captcha.challengeUrl;
        if (productSlug) {
          challengeUrl += (captcha.challengeUrl.indexOf('?') >= 0 ? '&' : '?') +
            'productSlug=' + encodeURIComponent(productSlug);
        }
        // ALTCHA v3's widget reads the challenge endpoint from the "challenge"
        // attribute. There is no "challengeurl" attribute (it is silently
        // ignored), which makes the widget fetch its default URL — the host
        // page itself — and fail with "invalid content-type" (HTML, not JSON).
        // Matches the in-app AltchaWidget, which also uses "challenge".
        widget.setAttribute('challenge', challengeUrl);
        // Mirror the in-app AltchaWidget: solve the proof-of-work invisibly on
        // load. Invisible + auto-solve sidesteps widget styling entirely and
        // removes the "where do I click" friction while keeping the same
        // proof-of-work protection.
        widget.setAttribute('auto', 'onload');
        widget.setAttribute('display', 'invisible');
        widget.setAttribute('hidelogo', '');
        widget.setAttribute('hidefooter', '');
        widget.addEventListener('statechange', function (ev) {
          var detail = ev && ev.detail;
          if (detail && detail.state === 'verified' && detail.payload) {
            onToken(detail.payload);
          } else if (detail && detail.state === 'error') {
            onToken('');
          }
        });
        slot.appendChild(widget);
      };
      document.head.appendChild(altchaScript);
    }
  }

  function awaitCaptchaToken(slot, captcha, productSlug) {
    return new Promise(function (resolve) {
      mountCaptchaWidget(slot, captcha, function (token) {
        if (token) resolve(token);
      }, productSlug);
    });
  }

  function renderPaidCaptchaGate(target, captcha, productSlug, language) {
    target.textContent = '';
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:16px;padding:24px 16px;font-family:system-ui,-apple-system,sans-serif;color:#1f2937;';
    var label = document.createElement('div');
    label.textContent = language === 'pl' ? 'Trwa weryfikacja…' : 'Verifying you\\'re human…';
    label.style.cssText = 'font-size:14px;color:#475569;text-align:center;';
    var captchaSlot = document.createElement('div');
    captchaSlot.className = 'sellf-captcha';
    wrap.appendChild(label);
    wrap.appendChild(captchaSlot);
    target.appendChild(wrap);
    return awaitCaptchaToken(captchaSlot, captcha, productSlug);
  }

  function renderFreeForm(root, productSlug, captcha, language) {
    var form = document.createElement('form');
    var input = document.createElement('input');
    var honeypot = document.createElement('input');
    var button = document.createElement('button');
    var status = document.createElement('div');
    var captchaSlot = document.createElement('div');
    var captchaToken = '';

    form.style.cssText = 'display:flex;flex-direction:column;gap:12px;padding:24px 16px;font-family:system-ui,-apple-system,sans-serif;';
    input.type = 'email';
    input.name = 'email';
    input.required = true;
    input.placeholder = 'Email';
    input.style.cssText = 'width:100%;box-sizing:border-box;padding:12px 16px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:16px;font-family:inherit;color:#1f2937;outline:none;';
    honeypot.type = 'text';
    honeypot.name = 'website';
    honeypot.tabIndex = -1;
    honeypot.autocomplete = 'off';
    honeypot.style.position = 'absolute';
    honeypot.style.left = '-10000px';
    honeypot.setAttribute('aria-hidden', 'true');
    captchaSlot.className = 'sellf-captcha';
    button.type = 'submit';
    button.textContent = language === 'pl' ? 'Uzyskaj dostęp' : 'Get access';
    button.style.cssText = 'width:100%;padding:12px 24px;background:#5b8def;color:#fff;border:0;border-radius:9999px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 4px 12px rgba(91,141,239,0.35);';
    status.style.cssText = 'font-size:13px;color:#475569;text-align:center;min-height:20px;';

    form.appendChild(input);
    form.appendChild(honeypot);
    form.appendChild(captchaSlot);
    form.appendChild(button);
    form.appendChild(status);
    root.textContent = '';
    root.appendChild(form);

    mountCaptchaWidget(captchaSlot, captcha, function (token) { captchaToken = token; }, productSlug);

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
        status.textContent = language === 'pl' ? 'Sprawdź pocztę.' : 'Check your email.';
      }).catch(function (error) {
        status.textContent = errorMessage(error, language);
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
  function mountStripeInto(target, clientSecret, language) {
    return loadStripeJs().then(function (Stripe) {
      var stripe = stripeInstances[language] || (stripeInstances[language] = Stripe(publishableKey, { locale: language }));
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
  function createLoader(label, language) {
    ensureStyles();
    var el = document.createElement('div');
    el.className = 'sellf-loader';
    var ring = document.createElement('div');
    ring.className = 'sellf-loader__ring';
    var lbl = document.createElement('div');
    lbl.textContent = label || (language === 'pl' ? 'Ładowanie koszyka…' : 'Loading checkout…');
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

  function openModalOverlay(trigger, language) {
    var polish = (language || document.documentElement.lang || navigator.language || 'en').toLowerCase().indexOf('pl') === 0;
    ensureStyles();

    var overlay = document.createElement('div');
    overlay.className = 'sellf-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:1rem;';

    var modal = document.createElement('dialog');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', polish ? 'Koszyk' : 'Checkout');
    modal.className = 'sellf-modal';
    modal.style.cssText = 'border:0;padding:0;margin:auto;background:#fff;border-radius:12px;max-width:560px;width:100%;min-height:440px;max-height:90vh;overflow:auto;position:relative;box-shadow:0 25px 50px rgba(0,0,0,0.25);';

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', polish ? 'Zamknij' : 'Close');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:transparent;border:0;font-size:28px;line-height:1;cursor:pointer;color:#64748b;padding:4px 8px;z-index:1;';

    var slot = document.createElement('div');
    slot.style.cssText = 'padding:24px 16px 16px;';
    slot.appendChild(createLoader(null, language));

    function focusGuard(atStart) {
      var guard = document.createElement('span');
      guard.tabIndex = 0;
      guard.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;';
      guard.addEventListener('focus', function () {
        var items = slot.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],iframe,[tabindex="0"]');
        var last = Array.prototype.filter.call(items, function (item) { return item.getClientRects().length > 0; }).pop();
        (atStart && last ? last : closeBtn).focus();
      });
      return guard;
    }
    modal.appendChild(focusGuard(true));
    modal.appendChild(closeBtn);
    modal.appendChild(slot);
    modal.appendChild(focusGuard(false));
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var stripeCheckout = null;

    function close() {
      if (stripeCheckout && typeof stripeCheckout.destroy === 'function') {
        try { stripeCheckout.destroy(); } catch (e) { /* ignore */ }
        stripeCheckout = null;
      }
      modal.close();
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      trigger.disabled = false;
      trigger.focus();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    modal.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    closeBtn.addEventListener('click', close);
    modal.addEventListener('click', function (e) {
      var rect = modal.getBoundingClientRect();
      if (e.target === modal && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)) close();
    });
    document.addEventListener('keydown', onKey);
    modal.showModal();
    closeBtn.focus();

    return {
      slot: slot,
      close: close,
      attachStripeCheckout: function (checkout) { stripeCheckout = checkout; },
    };
  }

  // Runs the paid flow (captcha gate -> checkout session -> Stripe mount) inside
  // host and owns the coupon field. The discount is part of the Stripe session, so
  // applying a coupon requests a new session; the checkout that is already mounted
  // is replaced only once that succeeds. A rejected code is reported under the
  // field and leaves the buyer's current checkout untouched, so they can always
  // pay. onMounted(checkout) lets a modal track the live instance.
  function startCheckout(host, productSlug, email, initialCoupon, onMounted, language) {
    language = language || languageFor(host);
    var polish = language === 'pl';
    var CHECKOUT_PATH = '/api/embed/checkout-session';
    var stripeCheckout = null;
    var gateSlot = null;
    var stripeSlot = null;
    var input = null;
    var applyButton = null;
    var status = null;

    function payload(coupon, token) {
      var body = { productSlug: productSlug, email: email || undefined, locale: language };
      if (coupon) body.couponCode = coupon;
      if (token) body.turnstileToken = token;
      return body;
    }

    function setStatus(text, isError) {
      status.textContent = text;
      if (isError) status.setAttribute('data-sellf-coupon-error', 'true');
      else status.removeAttribute('data-sellf-coupon-error');
      status.style.color = isError ? '#b91c1c' : '#047857';
    }

    // Coupon controls are attached only for a supplied code on a paid product.
    // It starts disabled: a run is always in flight at that point.
    function ensureLayout() {
      if (stripeSlot) return;
      var form = null;
      if (initialCoupon) {
        form = document.createElement('form');
        form.className = 'sellf-coupon';
        form.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:0 16px 12px;font-family:system-ui,-apple-system,sans-serif;';
        input = document.createElement('input');
        input.type = 'text';
        input.name = 'coupon';
        input.autocomplete = 'off';
        input.placeholder = polish ? 'Kod kuponu' : 'Coupon code';
        input.setAttribute('aria-label', polish ? 'Kod kuponu' : 'Coupon code');
        input.value = initialCoupon || '';
        input.style.cssText = 'flex:1;min-width:140px;box-sizing:border-box;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;font-family:inherit;color:#1f2937;outline:none;';
        applyButton = document.createElement('button');
        applyButton.type = 'submit';
        applyButton.disabled = true;
        applyButton.textContent = polish ? 'Zastosuj' : 'Apply';
        applyButton.style.cssText = 'padding:8px 16px;background:#5b8def;color:#fff;border:0;border-radius:9999px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;';
        status = document.createElement('div');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        status.style.cssText = 'flex-basis:100%;font-size:13px;min-height:18px;';
        form.appendChild(input);
        form.appendChild(applyButton);
        form.appendChild(status);
      }
      gateSlot = document.createElement('div');
      stripeSlot = document.createElement('div');
      host.textContent = '';
      if (form) host.appendChild(form);
      host.appendChild(gateSlot);
      host.appendChild(stripeSlot);
      stripeSlot.appendChild(createLoader(null, language));
      if (form) form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!applyButton.disabled) run(input.value.trim());
      });
    }

    // Resolves to a paid session body, or null when the product turned out to be free.
    function requestSession(coupon) {
      return postJson(CHECKOUT_PATH, productSlug, payload(coupon)).then(function (body) {
        if (body.kind === 'free') {
          renderFreeForm(host, productSlug, body.captcha || null, language);
          return null;
        }
        ensureLayout();
        if (body.kind === 'paid_needs_captcha') {
          return renderPaidCaptchaGate(gateSlot, body.captcha, productSlug, language).then(function (token) {
            gateSlot.textContent = '';
            return postJson(CHECKOUT_PATH, productSlug, payload(coupon, token));
          });
        }
        return body;
      });
    }

    function mountSession(body) {
      if (body.kind !== 'paid' || !body.clientSecret) {
        showMessage(host, polish ? 'Nieoczekiwana odpowiedź Sellf.' : 'Unexpected response from Sellf.');
        return Promise.resolve(false);
      }
      if (!publishableKey) {
        showMessage(host, polish ? 'Koszyk nie został skonfigurowany.' : 'Checkout is not configured.');
        return Promise.resolve(false);
      }
      if (stripeCheckout && typeof stripeCheckout.destroy === 'function') {
        try { stripeCheckout.destroy(); } catch (e) { /* ignore */ }
      }
      stripeCheckout = null;
      return mountStripeInto(stripeSlot, body.clientSecret, language).then(function (checkout) {
        stripeCheckout = checkout;
        if (onMounted) onMounted(checkout);
        return true;
      });
    }

    function run(coupon, rejection) {
      if (applyButton) {
        applyButton.disabled = true;
        setStatus(rejection || '', !!rejection);
      }
      return requestSession(coupon).then(function (body) {
        return body ? mountSession(body) : false;
      }).then(function (mounted) {
        if (!stripeSlot) return;
        if (applyButton) applyButton.disabled = false;
        if (mounted && coupon) setStatus(polish ? 'Zastosowano kupon ' + coupon.toUpperCase() + '.' : 'Coupon ' + coupon.toUpperCase() + ' applied.', false);
      }, function (error) {
        var couponProblem = coupon && error.status !== 403 && error.status !== 404;
        if (!couponProblem) {
          showMessage(host, errorMessage(error, language));
          return;
        }
        var message = errorMessage(error, language, true);
        ensureLayout();
        input.value = coupon;
        // With a checkout already mounted it stays as is; otherwise (a rejected
        // prefilled code) start one without the coupon.
        if (stripeCheckout) {
          applyButton.disabled = false;
          setStatus(message, true);
          return;
        }
        return run('', message);
      });
    }

    return run(initialCoupon || '');
  }

  function renderModalTrigger(root, productSlug, options) {
    ensureStyles();
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'sellf-embed-button';
    button.style.cssText = 'display:inline-flex;align-items:center;gap:8px;padding:12px 24px;background:#5b8def;color:#fff;border:0;border-radius:9999px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 4px 12px rgba(91,141,239,0.35);';

    var baseLabel = options.buttonLabel || (languageFor(root) === 'pl' ? 'Kup' : 'Buy');

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
      var modal = openModalOverlay(button, languageFor(root));
      startCheckout(modal.slot, productSlug, options.email, options.coupon, modal.attachStripeCheckout, languageFor(root)).then(function () {
        button.disabled = false;
      });
    });

    return { setLabel: setLabel };
  }

  function renderInline(root, productSlug, email, coupon) {
    // Show spinner immediately so the host page doesn't render a blank box
    // for the ~400-800ms until Stripe Embedded paints its iframe.
    // startCheckout clears root before mounting.
    root.textContent = '';
    root.appendChild(createLoader(null, languageFor(root)));
    startCheckout(root, productSlug, email, coupon, null, languageFor(root));
  }

  function initEmbed(root) {
    var productSlug = root.getAttribute('data-product-slug');
    var email = root.getAttribute('data-email') || '';
    var coupon = (root.getAttribute('data-coupon') || new URL(window.location.href).searchParams.get('coupon') || '').trim();
    var modal = root.getAttribute('data-modal') === 'true';
    var buttonLabel = root.getAttribute('data-button-label') || '';
    var showPrice = root.getAttribute('data-show-price') === 'true';

    if (!productSlug) {
      showMessage(root, languageFor(root) === 'pl' ? 'Nie wskazano produktu.' : 'Missing product.');
      return;
    }

    if (modal) {
      // Render the button immediately. When data-show-price is set, the price
      // fetch is async — we show a mini spinner inside the button label until
      // it lands, instead of leaving the host page with no visible button.
      var trigger = renderModalTrigger(root, productSlug, {
        buttonLabel: buttonLabel,
        email: email,
        coupon: coupon,
        initialPriceText: showPrice ? { loading: true } : '',
      });

      if (showPrice && trigger && trigger.setLabel) {
        postJson('/api/embed/checkout-session', productSlug, {
          productSlug: productSlug,
          locale: languageFor(root),
        }).then(function (body) {
          var product = body && body.product;
          var priceText = '';
          if (product && typeof product.price === 'number' && product.price > 0) {
            priceText = formatPrice(product.price, product.currency, languageFor(root));
          } else if (product && product.price === 0) {
            priceText = languageFor(root) === 'pl' ? 'Bezpłatnie' : 'Free';
          }
          trigger.setLabel(priceText);
        }).catch(function () {
          trigger.setLabel('');
        });
      }
      return;
    }

    renderInline(root, productSlug, email, coupon);
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
