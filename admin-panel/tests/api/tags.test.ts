import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { get, post, patch, del, cleanup, deleteTestApiKey, API_URL } from './setup';

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

    it('sorts by name ascending when ?sort_by=name&sort_order=asc', async () => {
      const ts = Date.now();
      const a = await post<ApiResp<Tag>>('/api/v1/tags', { name: `AAA-${ts}`, slug: `aaa-${ts}` });
      const b = await post<ApiResp<Tag>>('/api/v1/tags', { name: `ZZZ-${ts}`, slug: `zzz-${ts}` });
      created.push(a.data.data!.id, b.data.data!.id);
      const { data } = await get<ApiResp<Tag[]>>(`/api/v1/tags?sort_by=name&sort_order=asc&search=-${ts}&limit=100`);
      const names = data.data!.map((t) => t.name);
      expect(names.indexOf(`AAA-${ts}`)).toBeLessThan(names.indexOf(`ZZZ-${ts}`));
    });

    it('falls back to created_at when sort_by is unknown', async () => {
      const { status } = await get<ApiResp<Tag[]>>('/api/v1/tags?sort_by=evil&limit=1');
      expect(status).toBe(200);
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

  describe('Single tag', () => {
    let id: string;
    beforeAll(async () => {
      const r = await post<ApiResp<Tag>>('/api/v1/tags', { name: 'Single', slug: uniqueSlug() });
      id = r.data.data!.id;
      created.push(id);
    });

    it('GET returns tag by id', async () => {
      const r = await get<ApiResp<Tag>>(`/api/v1/tags/${id}`);
      expect(r.status).toBe(200);
      expect(r.data.data!.id).toBe(id);
    });
    it('GET unknown id returns 404', async () => {
      const r = await get<ApiResp<Tag>>('/api/v1/tags/00000000-0000-0000-0000-000000000000');
      expect(r.status).toBe(404);
    });
    it('GET invalid uuid returns 400', async () => {
      const r = await get<ApiResp<Tag>>('/api/v1/tags/not-a-uuid');
      expect(r.status).toBe(400);
    });
    it('PATCH updates name', async () => {
      const r = await patch<ApiResp<Tag>>(`/api/v1/tags/${id}`, { name: 'Renamed' });
      expect(r.status).toBe(200);
      expect(r.data.data!.name).toBe('Renamed');
    });
    it('PATCH with empty body returns 400', async () => {
      const r = await patch<ApiResp<Tag>>(`/api/v1/tags/${id}`, {});
      expect(r.status).toBe(400);
    });
    it('PATCH to existing slug returns 409', async () => {
      const other = await post<ApiResp<Tag>>('/api/v1/tags', { name: 'Other', slug: uniqueSlug() });
      created.push(other.data.data!.id);
      const r = await patch<ApiResp<Tag>>(`/api/v1/tags/${id}`, { slug: other.data.data!.slug });
      expect(r.status).toBe(409);
    });
    it('DELETE removes the tag', async () => {
      const tmp = await post<ApiResp<Tag>>('/api/v1/tags', { name: 'Del', slug: uniqueSlug() });
      const tmpId = tmp.data.data!.id;
      const r = await del<ApiResp<unknown>>(`/api/v1/tags/${tmpId}`);
      expect(r.status).toBe(204);
      const after = await get<ApiResp<Tag>>(`/api/v1/tags/${tmpId}`);
      expect(after.status).toBe(404);
    });
  });
});
