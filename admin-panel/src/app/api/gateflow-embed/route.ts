import { NextRequest } from 'next/server';
import { embedCache } from '@/lib/script-cache';

// Cloudflare dummy sitekey for testing (always passes)
const TURNSTILE_TEST_KEY = '1x00000000000000000000AA';

// Supported languages
const TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    title: '🎁 Get Free Access',
    subtitle: 'Enter your email to receive instant access to this free product',
    placeholder: 'Enter your email',
    button: 'Send Magic Link',
    sending: 'Sending...',
    terms: 'By submitting, you agree to receive emails from us.',
    successMessage: 'Check your email for the magic link! Then refresh this page.',
    errorGeneric: 'Something went wrong. Please try again.',
    errorEmail: 'Please enter a valid email address',
    errorCaptcha: 'Please complete the security verification',
    errorNetwork: 'Network error. Please check your connection.',
  },
  pl: {
    title: '🎁 Darmowy Dostęp',
    subtitle: 'Podaj email, aby otrzymać natychmiastowy dostęp do tego produktu',
    placeholder: 'Twój adres email',
    button: 'Wyślij Magic Link',
    sending: 'Wysyłanie...',
    terms: 'Wysyłając, zgadzasz się na otrzymywanie od nas wiadomości email.',
    successMessage: 'Sprawdź swoją skrzynkę email! Następnie odśwież tę stronę.',
    errorGeneric: 'Coś poszło nie tak. Spróbuj ponownie.',
    errorEmail: 'Wprowadź poprawny adres email',
    errorCaptcha: 'Potwierdź, że nie jesteś robotem',
    errorNetwork: 'Błąd sieci. Sprawdź połączenie internetowe.',
  },
  de: {
    title: '🎁 Kostenloser Zugang',
    subtitle: 'Geben Sie Ihre E-Mail ein, um sofortigen Zugang zu erhalten',
    placeholder: 'Ihre E-Mail-Adresse',
    button: 'Magic Link senden',
    sending: 'Wird gesendet...',
    terms: 'Mit dem Absenden stimmen Sie zu, E-Mails von uns zu erhalten.',
    successMessage: 'Überprüfen Sie Ihre E-Mail! Dann aktualisieren Sie diese Seite.',
    errorGeneric: 'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.',
    errorEmail: 'Bitte geben Sie eine gültige E-Mail-Adresse ein',
    errorCaptcha: 'Bitte bestätigen Sie die Sicherheitsüberprüfung',
    errorNetwork: 'Netzwerkfehler. Bitte überprüfen Sie Ihre Verbindung.',
  },
  es: {
    title: '🎁 Acceso Gratuito',
    subtitle: 'Ingresa tu email para recibir acceso instantáneo',
    placeholder: 'Tu correo electrónico',
    button: 'Enviar Magic Link',
    sending: 'Enviando...',
    terms: 'Al enviar, aceptas recibir correos electrónicos de nosotros.',
    successMessage: '¡Revisa tu correo electrónico! Luego actualiza esta página.',
    errorGeneric: 'Algo salió mal. Por favor, inténtalo de nuevo.',
    errorEmail: 'Por favor, ingresa un correo electrónico válido',
    errorCaptcha: 'Por favor, completa la verificación de seguridad',
    errorNetwork: 'Error de red. Por favor, verifica tu conexión.',
  },
  fr: {
    title: '🎁 Accès Gratuit',
    subtitle: 'Entrez votre email pour recevoir un accès instantané',
    placeholder: 'Votre adresse email',
    button: 'Envoyer le Magic Link',
    sending: 'Envoi...',
    terms: 'En soumettant, vous acceptez de recevoir des emails de notre part.',
    successMessage: 'Vérifiez votre email ! Ensuite, actualisez cette page.',
    errorGeneric: 'Une erreur est survenue. Veuillez réessayer.',
    errorEmail: 'Veuillez entrer une adresse email valide',
    errorCaptcha: 'Veuillez compléter la vérification de sécurité',
    errorNetwork: 'Erreur réseau. Veuillez vérifier votre connexion.',
  },
};

function detectLanguage(acceptLanguage: string | null): string {
  if (!acceptLanguage) return 'en';

  // Parse Accept-Language header (e.g., "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7")
  const languages = acceptLanguage
    .split(',')
    .map(lang => {
      const [code, qValue] = lang.trim().split(';q=');
      return {
        code: code.split('-')[0].toLowerCase(), // Get base language (pl from pl-PL)
        q: qValue ? parseFloat(qValue) : 1.0,
      };
    })
    .sort((a, b) => b.q - a.q);

  // Find first supported language
  for (const { code } of languages) {
    if (TRANSLATIONS[code]) {
      return code;
    }
  }

  return 'en';
}

/**
 * Serve GateFlow Embed Widget script with injected configuration
 *
 * This endpoint serves the embed widget JS with:
 * - API_BASE_URL automatically set to the serving domain
 * - TURNSTILE_SITE_KEY from integrations_config (or test key for localhost)
 * - Translations based on browser's Accept-Language header
 *
 * Performance optimizations:
 * - Script cached in memory for 1 hour per language/host combination
 * - HTTP caching with ETag support (304 Not Modified responses)
 * - Stale-while-revalidate for better UX
 */
export async function GET(request: NextRequest) {
  // Get the origin/host for API_BASE_URL
  // SECURITY: Validate host header to prevent JS injection via Host header manipulation
  const rawProtocol = request.headers.get('x-forwarded-proto') || 'https';
  const rawHost = request.headers.get('host') || 'localhost:3000';
  const protocol = /^https?$/.test(rawProtocol) ? rawProtocol : 'https';
  const host = /^[a-zA-Z0-9._:-]+$/.test(rawHost) ? rawHost : 'localhost:3000';
  const apiBaseUrl = `${protocol}://${host}`;

  // Detect language from Accept-Language header
  const acceptLanguage = request.headers.get('accept-language');
  const lang = detectLanguage(acceptLanguage);
  const t = TRANSLATIONS[lang];

  // Check if localhost/development
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');

  // Get Turnstile key - use test key for localhost, env var for production
  const turnstileSiteKey = isLocalhost
    ? TURNSTILE_TEST_KEY
    : (process.env.CLOUDFLARE_TURNSTILE_SITE_KEY || TURNSTILE_TEST_KEY);

  // Generate cache key based on host + language + turnstile key
  const cacheKey = `embed_${host}_${lang}_${turnstileSiteKey}`;

  // Get cached script or generate new one
  const cached = embedCache.getOrGenerate(cacheKey, () =>
    generateEmbedScript(apiBaseUrl, turnstileSiteKey, t)
  );

  // CORS headers for embedding
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Vary': 'Accept-Language',
  };

  // Check for conditional request (ETag/If-None-Match)
  const conditionalResponse = embedCache.checkConditionalRequest(request, cached, corsHeaders);
  if (conditionalResponse) {
    return conditionalResponse;
  }

  return embedCache.createResponse(cached, corsHeaders);
}

function generateEmbedScript(
  apiBaseUrl: string,
  turnstileSiteKey: string,
  t: Record<string, string>
): string {
  return `/**
 * GateFlow Embed Widget v1.1
 * Auto-configured for: ${apiBaseUrl}
 */
(function(){
'use strict';

const API_BASE_URL='${apiBaseUrl}';
const TURNSTILE_SITE_KEY='${turnstileSiteKey}';
const T=${JSON.stringify(t)};

const widgetState=new Map();
let cssInjected=false;
let turnstileLoading=false;
let turnstileCallbacks=[];

function isValidEmail(email){
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);
}

function injectCSS(){
  if(cssInjected)return;
  cssInjected=true;
  const style=document.createElement('style');
  style.id='gateflow-embed-styles';
  style.textContent=\`
    .gateflow-widget{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:500px;margin:0 auto;padding:2rem;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.2)}
    .gateflow-widget *{box-sizing:border-box}
    .gateflow-widget h3{color:#fff;margin:0 0 .5rem;font-size:1.5rem;font-weight:600}
    .gateflow-widget p{color:rgba(255,255,255,.9);margin:0 0 1.5rem;font-size:.95rem}
    .gateflow-form{display:flex;flex-direction:column;gap:1rem}
    .gateflow-input{padding:.75rem 1rem;border:2px solid rgba(255,255,255,.2);border-radius:8px;font-size:1rem;background:rgba(255,255,255,.1);color:#fff;transition:all .3s}
    .gateflow-input::placeholder{color:rgba(255,255,255,.6)}
    .gateflow-input:focus{outline:none;border-color:rgba(255,255,255,.5);background:rgba(255,255,255,.15)}
    .gateflow-input.gateflow-input-error{border-color:rgba(239,68,68,.8)}
    .gateflow-button{padding:.75rem 2rem;border:none;border-radius:8px;font-size:1rem;font-weight:600;background:#fff;color:#667eea;cursor:pointer;transition:all .3s;display:flex;align-items:center;justify-content:center;gap:.5rem}
    .gateflow-button:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 5px 20px rgba(0,0,0,.2)}
    .gateflow-button:disabled{opacity:.6;cursor:not-allowed}
    .gateflow-spinner{border:2px solid rgba(102,126,234,.3);border-top-color:#667eea;border-radius:50%;width:18px;height:18px;animation:gateflow-spin .8s linear infinite;display:inline-block}
    @keyframes gateflow-spin{to{transform:rotate(360deg)}}
    .gateflow-message{padding:.75rem 1rem;border-radius:8px;font-size:.9rem;margin-top:1rem}
    .gateflow-message:empty{display:none}
    .gateflow-message-success{background:rgba(16,185,129,.2);border:1px solid rgba(16,185,129,.5);color:#fff}
    .gateflow-message-error{background:rgba(239,68,68,.2);border:1px solid rgba(239,68,68,.5);color:#fff}
    .gateflow-terms{color:rgba(255,255,255,.8);font-size:.85rem;margin-top:1rem;text-align:center}
    .gateflow-terms a{color:#fff;text-decoration:underline}
    .gateflow-turnstile{margin-top:1rem;display:flex;justify-content:center}
  \`;
  document.head.appendChild(style);
}

function init(){
  injectCSS();
  document.querySelectorAll('[data-gateflow-product]').forEach(widget=>{
    if(widget.hasAttribute('data-gateflow-initialized'))return;
    widget.setAttribute('data-gateflow-initialized','true');
    const productSlug=widget.getAttribute('data-gateflow-product');
    if(productSlug)renderWidget(widget,productSlug);
  });
}

function renderWidget(container,productSlug){
  const widgetId='gf-'+Math.random().toString(36).substr(2,9);

  widgetState.set(widgetId,{
    productSlug,
    container,
    email:'',
    loading:false,
    turnstileToken:null
  });

  container.innerHTML=\`
    <div id="\${widgetId}" class="gateflow-widget">
      <h3>\${T.title}</h3>
      <p>\${T.subtitle}</p>
      <form class="gateflow-form" id="\${widgetId}-form">
        <input type="email" class="gateflow-input" id="\${widgetId}-email" placeholder="\${T.placeholder}" required autocomplete="email"/>
        <button type="submit" class="gateflow-button" id="\${widgetId}-button">
          <span id="\${widgetId}-button-text">\${T.button}</span>
        </button>
        <div class="gateflow-turnstile" id="\${widgetId}-turnstile"></div>
        <div class="gateflow-terms">\${T.terms}</div>
      </form>
      <div class="gateflow-message" id="\${widgetId}-message"></div>
    </div>
  \`;

  document.getElementById(widgetId+'-form').addEventListener('submit',e=>handleSubmit(e,widgetId));
  document.getElementById(widgetId+'-email').addEventListener('input',e=>updateEmail(widgetId,e.target.value));
  loadTurnstile(widgetId);
}

function loadTurnstile(widgetId){
  if(window.turnstile){renderTurnstile(widgetId);return}
  if(turnstileLoading){turnstileCallbacks.push(()=>renderTurnstile(widgetId));return}
  turnstileLoading=true;
  turnstileCallbacks.push(()=>renderTurnstile(widgetId));
  const script=document.createElement('script');
  script.src='https://challenges.cloudflare.com/turnstile/v0/api.js';
  script.async=true;
  script.onload=()=>{turnstileLoading=false;turnstileCallbacks.forEach(cb=>cb());turnstileCallbacks=[]};
  script.onerror=()=>{turnstileLoading=false;console.error('GateFlow: Failed to load Turnstile')};
  document.head.appendChild(script);
}

function renderTurnstile(widgetId){
  const container=document.getElementById(widgetId+'-turnstile');
  if(!container||!window.turnstile)return;
  window.turnstile.render(container,{
    sitekey:TURNSTILE_SITE_KEY,
    theme:'light',
    callback:token=>{const s=widgetState.get(widgetId);if(s)s.turnstileToken=token},
    'error-callback':()=>{const s=widgetState.get(widgetId);if(s)s.turnstileToken=null}
  });
}

function updateEmail(widgetId,email){
  const state=widgetState.get(widgetId);
  if(state)state.email=email.trim();
  const input=document.getElementById(widgetId+'-email');
  if(input)input.classList.remove('gateflow-input-error');
}

async function handleSubmit(event,widgetId){
  event.preventDefault();
  const state=widgetState.get(widgetId);
  if(!state)return;

  const{productSlug,email,turnstileToken,container}=state;
  const emailInput=document.getElementById(widgetId+'-email');

  if(!email||!isValidEmail(email)){
    showMessage(widgetId,T.errorEmail,'error');
    emailInput?.classList.add('gateflow-input-error');
    return;
  }

  if(!turnstileToken){
    showMessage(widgetId,T.errorCaptcha,'error');
    return;
  }

  setLoading(widgetId,true);
  clearMessage(widgetId);

  try{
    const response=await fetch(API_BASE_URL+'/api/public/products/claim-free',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email,productSlug,turnstileToken})
    });
    const data=await response.json();

    if(response.ok&&data.success){
      showMessage(widgetId,T.successMessage,'success');
      document.getElementById(widgetId+'-form')?.reset();
      state.email='';

      // Dispatch success event
      const successEvent=new CustomEvent('gateflow:success',{
        bubbles:true,
        detail:{productSlug,email,widgetId}
      });
      container.dispatchEvent(successEvent);

      // Call onSuccess callback if defined
      const onSuccess=container.getAttribute('data-on-success');
      if(onSuccess&&typeof window[onSuccess]==='function'){
        window[onSuccess]({productSlug,email,widgetId});
      }
    }else{
      showMessage(widgetId,data.error||T.errorGeneric,'error');
    }
  }catch(error){
    console.error('GateFlow Embed Error:',error);
    showMessage(widgetId,T.errorNetwork,'error');
  }finally{
    setLoading(widgetId,false);
    if(window.turnstile){
      const tc=document.getElementById(widgetId+'-turnstile');
      if(tc)window.turnstile.reset(tc);
    }
    state.turnstileToken=null;
  }
}

function setLoading(widgetId,loading){
  const button=document.getElementById(widgetId+'-button');
  const buttonText=document.getElementById(widgetId+'-button-text');
  if(!button||!buttonText)return;
  if(loading){
    button.disabled=true;
    buttonText.innerHTML='<span class="gateflow-spinner"></span> '+T.sending;
  }else{
    button.disabled=false;
    buttonText.textContent=T.button;
  }
}

function showMessage(widgetId,message,type){
  const el=document.getElementById(widgetId+'-message');
  if(el){el.className='gateflow-message gateflow-message-'+type;el.textContent=message}
}

function clearMessage(widgetId){
  const el=document.getElementById(widgetId+'-message');
  if(el){el.className='gateflow-message';el.textContent=''}
}

window.GateFlowEmbed={init};
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init)}else{init()}
})();`;
}
