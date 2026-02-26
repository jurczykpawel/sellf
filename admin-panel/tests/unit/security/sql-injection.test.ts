import { describe, it, expect } from 'vitest';
import {
  escapeIlikePattern,
  validateProductSortColumn,
  PRODUCT_SORT_COLUMNS
} from '@/lib/validations/product';

/**
 * Security Tests: SQL Injection Prevention
 *
 * These tests verify that user input is properly sanitized
 * to prevent SQL injection attacks via ILIKE patterns and sort columns.
 */
describe('SQL Injection Prevention', () => {
  describe('escapeIlikePattern', () => {
    // Basic functionality
    it('should return empty string for null/undefined input', () => {
      expect(escapeIlikePattern(null as unknown as string)).toBe('');
      expect(escapeIlikePattern(undefined as unknown as string)).toBe('');
      expect(escapeIlikePattern('')).toBe('');
    });

    it('should return input unchanged when no special characters', () => {
      expect(escapeIlikePattern('test')).toBe('test');
      expect(escapeIlikePattern('hello world')).toBe('hello world');
      expect(escapeIlikePattern('user@example.com')).toBe('user@example.com');
    });

    // Wildcard character escaping
    describe('ILIKE wildcard escaping', () => {
      it('should escape % wildcard character', () => {
        expect(escapeIlikePattern('%')).toBe('\\%');
        expect(escapeIlikePattern('100%')).toBe('100\\%');
        expect(escapeIlikePattern('%discount%')).toBe('\\%discount\\%');
      });

      it('should escape _ single-char wildcard', () => {
        expect(escapeIlikePattern('_')).toBe('\\_');
        expect(escapeIlikePattern('test_user')).toBe('test\\_user');
        expect(escapeIlikePattern('__init__')).toBe('\\_\\_init\\_\\_');
      });

      it('should escape backslash character', () => {
        expect(escapeIlikePattern('\\')).toBe('\\\\');
        expect(escapeIlikePattern('path\\to\\file')).toBe('path\\\\to\\\\file');
      });

      it('should escape all special characters together', () => {
        expect(escapeIlikePattern('%_\\')).toBe('\\%\\_\\\\');
        expect(escapeIlikePattern('100% off_sale\\special')).toBe('100\\% off\\_sale\\\\special');
      });
    });

    // SQL Injection attack patterns
    describe('SQL Injection attack prevention', () => {
      it('should handle SQL injection via ILIKE escape sequence', () => {
        // Attack: Try to break out of pattern with backslash
        const attack = "test\\' OR '1'='1";
        const escaped = escapeIlikePattern(attack);
        expect(escaped).toBe("test\\\\' OR '1'='1");
        // Backslash is escaped, preventing SQL escape sequence manipulation
      });

      it('should handle Unicode bypass attempts', () => {
        const attack = '%\u0000%'; // Null byte injection
        const escaped = escapeIlikePattern(attack);
        expect(escaped).toBe('\\%\u0000\\%');
      });

      it('should handle newline injection attempts', () => {
        const attack = '%\nDROP TABLE products;--';
        const escaped = escapeIlikePattern(attack);
        expect(escaped).toBe('\\%\nDROP TABLE products;--');
      });

      it('should not modify non-ILIKE special SQL characters', () => {
        // These are dangerous for SQL but not for ILIKE patterns specifically
        // The ILIKE pattern itself is wrapped in % wildcards by the app
        const attack = "'; DROP TABLE users;--";
        const escaped = escapeIlikePattern(attack);
        expect(escaped).toBe("'; DROP TABLE users;--");
        // Note: This is safe because Supabase uses parameterized queries
        // The ILIKE pattern is passed as a parameter, not concatenated
      });
    });

    // Real-world search scenarios
    describe('Real-world search term handling', () => {
      it('should handle email patterns correctly', () => {
        expect(escapeIlikePattern('user@example.com')).toBe('user@example.com');
        expect(escapeIlikePattern('test+label@gmail.com')).toBe('test+label@gmail.com');
      });

      it('should handle product names with special chars', () => {
        expect(escapeIlikePattern('50% OFF Sale!')).toBe('50\\% OFF Sale!');
        expect(escapeIlikePattern('Product_v2.0')).toBe('Product\\_v2.0');
      });

      it('should handle Windows-style paths', () => {
        expect(escapeIlikePattern('C:\\Users\\file.txt')).toBe('C:\\\\Users\\\\file.txt');
      });

      it('should handle regex-like patterns safely', () => {
        expect(escapeIlikePattern('*.txt')).toBe('*.txt'); // * is not ILIKE special
        expect(escapeIlikePattern('[a-z]')).toBe('[a-z]'); // [] is not ILIKE special
        expect(escapeIlikePattern('test%_file')).toBe('test\\%\\_file');
      });
    });
  });

  describe('validateProductSortColumn', () => {
    // Whitelist validation
    it('should return default for null/undefined', () => {
      expect(validateProductSortColumn(null)).toBe('created_at');
      expect(validateProductSortColumn(undefined as unknown as string)).toBe('created_at');
    });

    it('should accept valid sort columns', () => {
      expect(validateProductSortColumn('name')).toBe('name');
      expect(validateProductSortColumn('price')).toBe('price');
      expect(validateProductSortColumn('created_at')).toBe('created_at');
      expect(validateProductSortColumn('updated_at')).toBe('updated_at');
      expect(validateProductSortColumn('is_active')).toBe('is_active');
      expect(validateProductSortColumn('is_featured')).toBe('is_featured');
      expect(validateProductSortColumn('slug')).toBe('slug');
    });

    it('should return default for invalid columns', () => {
      expect(validateProductSortColumn('invalid')).toBe('created_at');
      expect(validateProductSortColumn('nonexistent')).toBe('created_at');
    });

    // SQL Injection attack prevention
    describe('SQL Injection attack prevention', () => {
      it('should reject SQL injection via column name', () => {
        const attacks = [
          'name; DROP TABLE products;--',
          "name' OR '1'='1",
          'name/**/UNION/**/SELECT/**/*/**/FROM/**/users',
          'name); DELETE FROM products WHERE (1=1',
          "1=1 OR name='admin'",
          'SLEEP(5)',
          'BENCHMARK(10000000,SHA1(1))',
        ];

        for (const attack of attacks) {
          expect(validateProductSortColumn(attack)).toBe('created_at');
        }
      });

      it('should reject column traversal attempts', () => {
        const attacks = [
          '../../../etc/passwd',
          'products.name',
          'users.password',
          '(SELECT password FROM users)',
        ];

        for (const attack of attacks) {
          expect(validateProductSortColumn(attack)).toBe('created_at');
        }
      });

      it('should reject encoded injection attempts', () => {
        const attacks = [
          '%6E%61%6D%65', // URL encoded 'name' - should fail because whitelist uses exact match
          'name%00',      // Null byte injection
          'name\x00',     // Null byte
        ];

        for (const attack of attacks) {
          expect(validateProductSortColumn(attack)).toBe('created_at');
        }
      });
    });

    // Whitelist integrity
    it('should have all expected columns in whitelist', () => {
      const expectedColumns = ['name', 'price', 'created_at', 'updated_at', 'is_active', 'is_featured', 'slug'];
      for (const col of expectedColumns) {
        expect(PRODUCT_SORT_COLUMNS).toHaveProperty(col);
      }
    });

    it('should not allow arbitrary database columns', () => {
      // These might exist in the database but should not be sortable
      const forbiddenColumns = [
        'id',          // Internal identifier
        'user_id',     // Foreign key
        'stripe_price_id', // Sensitive
        'content_config',  // JSON blob
        'sale_quantity_sold', // Internal counter
      ];

      for (const col of forbiddenColumns) {
        expect(validateProductSortColumn(col)).toBe('created_at');
      }
    });
  });

  describe('Integration: Search and Sort Security', () => {
    it('should handle combined attack vectors', () => {
      // Simulating what the API would receive
      const searchAttack = "admin%' UNION SELECT * FROM users--";
      const sortAttack = "name; DROP TABLE products;--";

      const escapedSearch = escapeIlikePattern(searchAttack);
      const validatedSort = validateProductSortColumn(sortAttack);

      // Search pattern is escaped
      expect(escapedSearch).toBe("admin\\%' UNION SELECT * FROM users--");
      // Sort column falls back to safe default
      expect(validatedSort).toBe('created_at');
    });

    it('should neutralize timing-based attacks', () => {
      const timingAttacks = [
        'SLEEP(10)',
        'pg_sleep(10)',
        "BENCHMARK(10000000,MD5('test'))",
        "WAITFOR DELAY '00:00:10'",
      ];

      for (const attack of timingAttacks) {
        expect(validateProductSortColumn(attack)).toBe('created_at');
      }

      // escapeIlikePattern only escapes ILIKE metacharacters (%, _, \) —
      // SQL keywords are safe because Supabase uses parameterized queries
      expect(escapeIlikePattern('SLEEP(10)')).toBe('SLEEP(10)');
      expect(escapeIlikePattern('pg_sleep(10)')).toBe('pg\\_sleep(10)');
    });
  });
});
