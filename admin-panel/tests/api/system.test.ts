/**
 * API Integration Tests: System
 *
 * Migrated from api-v1-system.spec.ts (Playwright → Vitest)
 * Tests system status endpoint.
 *
 * Run: npm run test:api (requires dev server running)
 */

import { describe, it, expect, afterAll } from 'vitest';
import { get, deleteTestApiKey, API_URL } from './setup';

interface SystemStatus {
  status: 'healthy' | 'degraded';
  timestamp: string;
  version: {
    api: string;
    service: string;
    build: string;
  };
  database: {
    connected: boolean;
  };
  counts: {
    products: {
      total: number;
      active: number;
    };
    users: {
      total: number;
    };
    transactions: {
      total: number;
      completed: number;
    };
    refund_requests: {
      pending: number;
    };
    webhooks: {
      active: number;
    };
    coupons: {
      active: number;
    };
    api_keys: {
      active: number;
    };
  };
  features: {
    webhooks_enabled: boolean;
    api_keys_enabled: boolean;
  };
  environment: 'development' | 'test' | 'production';
}

interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
}

describe('System API v1', () => {
  afterAll(async () => {
    await deleteTestApiKey();
  });

  describe('Authentication', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const response = await fetch(`${API_URL}/api/v1/system/status`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /api/v1/system/status', () => {
    it('should return system status for authenticated admin', async () => {
      const { status, data } = await get<ApiResponse<SystemStatus>>('/api/v1/system/status');

      expect(status).toBe(200);
      expect(data.data).toHaveProperty('status');
      expect(['healthy', 'degraded']).toContain(data.data!.status);
      expect(data.data).toHaveProperty('timestamp');
      expect(data.data).toHaveProperty('version');
      expect(data.data).toHaveProperty('database');
      expect(data.data).toHaveProperty('counts');
    });

    it('should include version information', async () => {
      const { status, data } = await get<ApiResponse<SystemStatus>>('/api/v1/system/status');

      expect(status).toBe(200);
      expect(data.data!.version).toHaveProperty('api');
      expect(data.data!.version.api).toBe('v1');
      expect(data.data!.version).toHaveProperty('service');
      expect(data.data!.version).toHaveProperty('build');
    });

    it('should include database health', async () => {
      const { status, data } = await get<ApiResponse<SystemStatus>>('/api/v1/system/status');

      expect(status).toBe(200);
      expect(data.data!.database).toHaveProperty('connected');
      expect(typeof data.data!.database.connected).toBe('boolean');
    });

    it('should include counts for various entities', async () => {
      const { status, data } = await get<ApiResponse<SystemStatus>>('/api/v1/system/status');

      expect(status).toBe(200);
      expect(data.data!.counts).toHaveProperty('products');
      expect(data.data!.counts.products).toHaveProperty('total');
      expect(data.data!.counts.products).toHaveProperty('active');

      expect(data.data!.counts).toHaveProperty('users');
      expect(data.data!.counts.users).toHaveProperty('total');

      expect(data.data!.counts).toHaveProperty('transactions');
      expect(data.data!.counts.transactions).toHaveProperty('total');
      expect(data.data!.counts.transactions).toHaveProperty('completed');

      expect(data.data!.counts).toHaveProperty('refund_requests');
      expect(data.data!.counts.refund_requests).toHaveProperty('pending');

      expect(data.data!.counts).toHaveProperty('webhooks');
      expect(data.data!.counts.webhooks).toHaveProperty('active');

      expect(data.data!.counts).toHaveProperty('coupons');
      expect(data.data!.counts.coupons).toHaveProperty('active');

      expect(data.data!.counts).toHaveProperty('api_keys');
      expect(data.data!.counts.api_keys).toHaveProperty('active');
    });

    it('should include feature flags', async () => {
      const { status, data } = await get<ApiResponse<SystemStatus>>('/api/v1/system/status');

      expect(status).toBe(200);
      expect(data.data).toHaveProperty('features');
      expect(data.data!.features).toHaveProperty('webhooks_enabled');
      expect(data.data!.features).toHaveProperty('api_keys_enabled');
    });

    it('should include environment information', async () => {
      const { status, data } = await get<ApiResponse<SystemStatus>>('/api/v1/system/status');

      expect(status).toBe(200);
      expect(data.data).toHaveProperty('environment');
      expect(['development', 'test', 'production']).toContain(data.data!.environment);
    });

    it('should return valid timestamp in ISO format', async () => {
      const { status, data } = await get<ApiResponse<SystemStatus>>('/api/v1/system/status');

      expect(status).toBe(200);
      const timestamp = new Date(data.data!.timestamp);
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).not.toBeNaN();
    });

    it('should report healthy status when database is connected', async () => {
      const { status, data } = await get<ApiResponse<SystemStatus>>('/api/v1/system/status');

      expect(status).toBe(200);
      // In a running test environment, the database must be connected
      expect(data.data!.database.connected).toBe(true);
      expect(data.data!.status).toBe('healthy');
    });
  });
});
