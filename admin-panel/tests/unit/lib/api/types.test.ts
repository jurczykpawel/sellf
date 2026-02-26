/**
 * API Types Unit Tests
 *
 * Tests for type guards, response helpers, and error code mappings.
 */

import { describe, it, expect } from 'vitest';
import {
  isApiError,
  successResponse,
  errorResponse,
  ErrorCodes,
  ErrorHttpStatus,
} from '@/lib/api/types';
import type { ApiSuccessResponse, ApiErrorResponse } from '@/lib/api/types';

describe('API Types', () => {
  describe('isApiError', () => {
    it('should return true for error response', () => {
      const errorResp: ApiErrorResponse = {
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found',
        },
      };
      expect(isApiError(errorResp)).toBe(true);
    });

    it('should return false for success response', () => {
      const successResp: ApiSuccessResponse<{ id: string }> = {
        data: { id: '123' },
      };
      expect(isApiError(successResp)).toBe(false);
    });

    it('should return false for success response with pagination', () => {
      const successResp: ApiSuccessResponse<string[]> = {
        data: ['a', 'b'],
        pagination: {
          cursor: null,
          next_cursor: 'abc',
          has_more: true,
          limit: 10,
        },
      };
      expect(isApiError(successResp)).toBe(false);
    });

    it('should handle error response with details', () => {
      const errorResp: ApiErrorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: {
            name: ['Name is required'],
            email: ['Email is invalid'],
          },
        },
      };
      expect(isApiError(errorResp)).toBe(true);
    });
  });

  describe('successResponse', () => {
    it('should create success response with data', () => {
      const data = { id: '123', name: 'Test' };
      const response = successResponse(data);

      expect(response.data).toEqual(data);
      expect(response.pagination).toBeUndefined();
    });

    it('should include pagination when provided', () => {
      const data = [{ id: '1' }, { id: '2' }];
      const pagination = {
        cursor: null,
        next_cursor: 'cursor-123',
        has_more: true,
        limit: 10,
      };
      const response = successResponse(data, pagination);

      expect(response.data).toEqual(data);
      expect(response.pagination).toEqual(pagination);
    });

    it('should handle null data', () => {
      const response = successResponse(null);
      expect(response.data).toBe(null);
    });

    it('should handle array data', () => {
      const data = ['item1', 'item2', 'item3'];
      const response = successResponse(data);
      expect(response.data).toEqual(data);
    });

    it('should handle empty array', () => {
      const response = successResponse([]);
      expect(response.data).toEqual([]);
    });

    it('should handle primitive data', () => {
      expect(successResponse(42).data).toBe(42);
      expect(successResponse('hello').data).toBe('hello');
      expect(successResponse(true).data).toBe(true);
    });
  });

  describe('errorResponse', () => {
    it('should create error response with code and message', () => {
      const response = errorResponse(ErrorCodes.NOT_FOUND, 'Product not found');

      expect(response.error.code).toBe('NOT_FOUND');
      expect(response.error.message).toBe('Product not found');
      expect(response.error.details).toBeUndefined();
    });

    it('should include details when provided', () => {
      const details = {
        price: ['Price must be positive'],
        name: ['Name is required', 'Name must be at least 3 characters'],
      };
      const response = errorResponse(ErrorCodes.VALIDATION_ERROR, 'Validation failed', details);

      expect(response.error.details).toEqual(details);
    });

    it('should handle empty details object', () => {
      const response = errorResponse(ErrorCodes.VALIDATION_ERROR, 'Invalid', {});
      expect(response.error.details).toEqual({});
    });
  });

  describe('ErrorCodes', () => {
    const EXPECTED_ERROR_CODES = [
      'UNAUTHORIZED',
      'FORBIDDEN',
      'INVALID_TOKEN',
      'VALIDATION_ERROR',
      'INVALID_INPUT',
      'NOT_FOUND',
      'CONFLICT',
      'ALREADY_EXISTS',
      'INTERNAL_ERROR',
      'SERVICE_UNAVAILABLE',
      'RATE_LIMITED',
    ] as const;

    it('should contain exactly the expected error codes', () => {
      const actualCodes = Object.values(ErrorCodes);
      expect(actualCodes).toHaveLength(EXPECTED_ERROR_CODES.length);
      for (const code of EXPECTED_ERROR_CODES) {
        expect(actualCodes).toContain(code);
      }
    });

    it('should expose codes as properties matching their string values', () => {
      expect(ErrorCodes.UNAUTHORIZED).toBe('UNAUTHORIZED');
      expect(ErrorCodes.FORBIDDEN).toBe('FORBIDDEN');
      expect(ErrorCodes.INVALID_TOKEN).toBe('INVALID_TOKEN');
      expect(ErrorCodes.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
      expect(ErrorCodes.INVALID_INPUT).toBe('INVALID_INPUT');
      expect(ErrorCodes.NOT_FOUND).toBe('NOT_FOUND');
      expect(ErrorCodes.CONFLICT).toBe('CONFLICT');
      expect(ErrorCodes.ALREADY_EXISTS).toBe('ALREADY_EXISTS');
      expect(ErrorCodes.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
      expect(ErrorCodes.SERVICE_UNAVAILABLE).toBe('SERVICE_UNAVAILABLE');
      expect(ErrorCodes.RATE_LIMITED).toBe('RATE_LIMITED');
    });

    it('should not contain unexpected extra codes', () => {
      const actualKeys = Object.keys(ErrorCodes);
      expect(actualKeys.sort()).toEqual([...EXPECTED_ERROR_CODES].sort());
    });
  });

  describe('ErrorHttpStatus', () => {
    it('should map authentication errors to 401', () => {
      expect(ErrorHttpStatus[ErrorCodes.UNAUTHORIZED]).toBe(401);
      expect(ErrorHttpStatus[ErrorCodes.INVALID_TOKEN]).toBe(401);
    });

    it('should map forbidden to 403', () => {
      expect(ErrorHttpStatus[ErrorCodes.FORBIDDEN]).toBe(403);
    });

    it('should map validation errors to 400', () => {
      expect(ErrorHttpStatus[ErrorCodes.VALIDATION_ERROR]).toBe(400);
      expect(ErrorHttpStatus[ErrorCodes.INVALID_INPUT]).toBe(400);
    });

    it('should map not found to 404', () => {
      expect(ErrorHttpStatus[ErrorCodes.NOT_FOUND]).toBe(404);
    });

    it('should map conflict errors to 409', () => {
      expect(ErrorHttpStatus[ErrorCodes.CONFLICT]).toBe(409);
      expect(ErrorHttpStatus[ErrorCodes.ALREADY_EXISTS]).toBe(409);
    });

    it('should map server errors to 5xx', () => {
      expect(ErrorHttpStatus[ErrorCodes.INTERNAL_ERROR]).toBe(500);
      expect(ErrorHttpStatus[ErrorCodes.SERVICE_UNAVAILABLE]).toBe(503);
    });

    it('should map rate limit to 429', () => {
      expect(ErrorHttpStatus[ErrorCodes.RATE_LIMITED]).toBe(429);
    });

    it('should have mapping for all error codes', () => {
      for (const code of Object.values(ErrorCodes)) {
        expect(ErrorHttpStatus[code]).toBeDefined();
        expect(typeof ErrorHttpStatus[code]).toBe('number');
      }
    });
  });
});
