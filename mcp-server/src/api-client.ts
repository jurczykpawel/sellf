/**
 * Sellf API Client
 *
 * HTTP wrapper for the v1 REST API with API Key authentication.
 */

export interface ApiClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Request timeout in milliseconds. Defaults to 15s. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * The API key travels in every request as `X-API-Key`. Only allow an https
 * base URL (or loopback, for local development against `bun run dev`) — an
 * http base URL would send the key in the clear over the network.
 */
function assertSafeBaseUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid Sellf API base URL: ${rawUrl}`);
  }

  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
    throw new Error(
      `Sellf API base URL must be https:// (got "${parsed.protocol}//${parsed.hostname}"). ` +
        'Plain http is only allowed against localhost/127.0.0.1/::1 for local development.'
    );
  }
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
}


export class SellfApiClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(options: ApiClientOptions) {
    assertSafeBaseUrl(options.baseUrl);
    this.baseUrl = options.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      params?: Record<string, string | number | boolean | undefined>;
    }
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);

    // Add query params
    if (options?.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const headers: Record<string, string> = {
      'X-API-Key': this.apiKey,
      'Content-Type': 'application/json',
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (options?.body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(options.body);
    }

    // Never follow redirects: this client sends the API key in the
    // `X-API-Key` header on every request, and fetch's default
    // `redirect: 'follow'` does not distinguish same-origin from
    // cross-origin redirects, so a redirect to another origin would carry
    // the header there too.
    fetchOptions.redirect = 'error';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    fetchOptions.signal = controller.signal;

    let response: Response;
    try {
      response = await fetch(url.toString(), fetchOptions);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ApiClientError('TIMEOUT', `Request timed out after ${this.timeoutMs}ms`, 408);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
    const data = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      const errorData = data.error as ApiError | undefined;
      const error = errorData || { code: 'UNKNOWN_ERROR', message: 'An unknown error occurred' };
      throw new ApiClientError(error.code, error.message, response.status, error.details);
    }

    return data as T;
  }

  // HTTP method shortcuts
  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('GET', path, { params });
  }

  async post<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('POST', path, { body, params });
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, { body });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}

export class ApiClientError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, statusCode: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

// Singleton instance - initialized in server.ts
let apiClient: SellfApiClient | null = null;

export function initApiClient(options: ApiClientOptions): SellfApiClient {
  apiClient = new SellfApiClient(options);
  return apiClient;
}

export function getApiClient(): SellfApiClient {
  if (!apiClient) {
    throw new Error('API client not initialized. Call initApiClient() first.');
  }
  return apiClient;
}
