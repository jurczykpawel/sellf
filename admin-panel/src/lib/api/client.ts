/**
 * Frontend API Client for /api/v1/*
 *
 * Centralized client for all REST API v1 calls from the admin panel.
 * Provides consistent error handling, pagination, and type safety.
 */

const API_VERSION = 'v1';

export interface PaginationParams {
  cursor?: string;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    next_cursor: string | null;
    has_more: boolean;
    total?: number;
  };
}

export interface SingleResponse<T> {
  data: T;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
}

export class ApiError extends Error {
  code: string;
  status: number;
  details?: Record<string, string[]>;

  constructor(code: string, message: string, status: number, details?: Record<string, string[]>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Build query string from params object
 */
function buildQueryString(params: Record<string, unknown>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  return query.toString();
}

/**
 * Handle API response and throw ApiError if not ok
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorData: ApiErrorResponse;
    try {
      errorData = await response.json();
    } catch {
      throw new ApiError(
        'NETWORK_ERROR',
        `Request failed with status ${response.status}`,
        response.status
      );
    }
    throw new ApiError(
      errorData.error?.code || 'UNKNOWN_ERROR',
      errorData.error?.message || 'An unknown error occurred',
      response.status,
      errorData.error?.details
    );
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

/**
 * API Client for v1 endpoints
 */
class ApiClient {
  private baseUrl = `/api/${API_VERSION}`;

  /**
   * GET request for paginated list
   */
  async list<T>(
    resource: string,
    params: PaginationParams & Record<string, unknown> = {}
  ): Promise<PaginatedResponse<T>> {
    const queryString = buildQueryString(params);
    const url = queryString
      ? `${this.baseUrl}/${resource}?${queryString}`
      : `${this.baseUrl}/${resource}`;

    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
      },
    });

    return handleResponse<PaginatedResponse<T>>(response);
  }

  /**
   * GET request for single resource
   */
  async get<T>(resource: string, id: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${resource}/${id}`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
      },
    });

    const result = await handleResponse<SingleResponse<T>>(response);
    return result.data;
  }

  /**
   * GET request for custom endpoint (e.g., analytics/dashboard)
   */
  async getCustom<T>(
    path: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    const queryString = buildQueryString(params);
    const url = queryString
      ? `${this.baseUrl}/${path}?${queryString}`
      : `${this.baseUrl}/${path}`;

    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
      },
    });

    const result = await handleResponse<SingleResponse<T>>(response);
    return result.data;
  }

  /**
   * POST request to create resource
   */
  async create<T>(resource: string, data: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${resource}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(data),
    });

    const result = await handleResponse<SingleResponse<T>>(response);
    return result.data;
  }

  /**
   * POST request to custom endpoint
   */
  async postCustom<T>(
    path: string,
    data: Record<string, unknown> = {}
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(data),
    });

    const result = await handleResponse<SingleResponse<T>>(response);
    return result.data;
  }

  /**
   * PATCH request to update resource
   */
  async update<T>(
    resource: string,
    id: string,
    data: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${resource}/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(data),
    });

    const result = await handleResponse<SingleResponse<T>>(response);
    return result.data;
  }

  /**
   * PUT request to custom endpoint
   */
  async putCustom<T>(
    path: string,
    data: Record<string, unknown> = {}
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${path}`, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(data),
    });

    const result = await handleResponse<SingleResponse<T>>(response);
    return result.data;
  }

  /**
   * DELETE request
   */
  async delete(resource: string, id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${resource}/${id}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
      },
    });

    await handleResponse<void>(response);
  }

  /**
   * DELETE request to custom endpoint with query params
   */
  async deleteCustom(
    path: string,
    params: Record<string, unknown> = {}
  ): Promise<void> {
    const queryString = buildQueryString(params);
    const url = queryString
      ? `${this.baseUrl}/${path}?${queryString}`
      : `${this.baseUrl}/${path}`;

    const response = await fetch(url, {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
      },
    });

    await handleResponse<void>(response);
  }
}

// Export singleton instance
export const api = new ApiClient();

// Export types for use in components
export type { ApiClient };
