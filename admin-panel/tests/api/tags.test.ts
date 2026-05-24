import { describe, it, expect, afterAll } from 'vitest';
import { get, post, cleanup, deleteTestApiKey, API_URL } from './setup';

interface Tag { id: string; name: string; slug: string; created_at: string; }
interface ApiResp<T> { data?: T; error?: { code: string; message: string }; pagination?: { has_more: boolean; limit: number; next_cursor: string | null; }; }

const uniqueSlug = () => `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

describe('Tags API v1', () => {
  const created: string[] = [];
  afterAll(async () => {
    await cleanup({ tags: created });
    await deleteTestApiKey();
  });

  describe('Auth', () => {
    it('returns 401 unauthenticated', async () => {
      const res = await fetch(`${API_URL}/api/v1/tags`);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/tags', () => {
    it('lists tags with pagination', async () => {
      const { status, data } = await get<ApiResp<Tag[]>>('/api/v1/tags?limit=5');
      expect(status).toBe(200);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.pagination?.limit).toBe(5);
    });

    it('filters by search', async () => {
      const slug = uniqueSlug();
      const r = await post<ApiResp<Tag>>('/api/v1/tags', { name: 'ZUnique', slug });
      created.push(r.data.data!.id);
      const { data } = await get<ApiResp<Tag[]>>('/api/v1/tags?search=ZUnique');
      expect(data.data!.some((t) => t.slug === slug)).toBe(true);
    });
  });

  describe('POST /api/v1/tags', () => {
    it('creates a tag', async () => {
      const slug = uniqueSlug();
      const { status, data } = await post<ApiResp<Tag>>('/api/v1/tags', { name: 'New', slug });
      expect(status).toBe(201);
      expect(data.data!.slug).toBe(slug);
      created.push(data.data!.id);
    });
    it('rejects duplicate slug with 409', async () => {
      const slug = uniqueSlug();
      const a = await post<ApiResp<Tag>>('/api/v1/tags', { name: 'Dup', slug });
      created.push(a.data.data!.id);
      const b = await post<ApiResp<Tag>>('/api/v1/tags', { name: 'Dup2', slug });
      expect(b.status).toBe(409);
      expect(b.data.error?.code).toBe('CONFLICT');
    });
    it('rejects invalid slug', async () => {
      const { status, data } = await post<ApiResp<Tag>>('/api/v1/tags', { name: 'X', slug: 'has space' });
      expect(status).toBe(400);
      expect(data.error?.code).toBe('VALIDATION_ERROR');
    });
    it('rejects name longer than 50 chars', async () => {
      const { status } = await post<ApiResp<Tag>>('/api/v1/tags', { name: 'x'.repeat(51), slug: uniqueSlug() });
      expect(status).toBe(400);
    });
  });
});
