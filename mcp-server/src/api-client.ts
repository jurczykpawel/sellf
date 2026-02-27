/**
 * Sellf API Client
 *
 * HTTP wrapper for the v1 REST API with API Key authentication.
 */

export interface ApiClientOptions {
  baseUrl: string;
  apiKey: string;
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

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    cursor: string | null;
    next_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
}

export class SellfApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = options.apiKey;
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

    const response = await fetch(url.toString(), fetchOptions);
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
