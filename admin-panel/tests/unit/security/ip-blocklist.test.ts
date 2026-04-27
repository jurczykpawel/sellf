import { describe, it, expect } from 'vitest';
import { isPrivateOrReservedIp } from '@/lib/security/ip-blocklist';

describe('isPrivateOrReservedIp', () => {
  describe('IPv4', () => {
    it('blocks loopback 127.0.0.0/8', () => {
      expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('127.255.255.255')).toBe(true);
    });

    it('blocks RFC1918 private ranges', () => {
      expect(isPrivateOrReservedIp('10.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('10.255.255.255')).toBe(true);
      expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('172.31.255.255')).toBe(true);
      expect(isPrivateOrReservedIp('192.168.1.1')).toBe(true);
    });

    it('blocks link-local incl. cloud metadata 169.254.0.0/16', () => {
      expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true); // AWS / GCP / DO metadata
      expect(isPrivateOrReservedIp('169.254.0.1')).toBe(true);
    });

    it('blocks 0.0.0.0/8', () => {
      expect(isPrivateOrReservedIp('0.0.0.0')).toBe(true);
      expect(isPrivateOrReservedIp('0.1.2.3')).toBe(true);
    });

    it('blocks multicast 224.0.0.0/4 and reserved 240.0.0.0/4', () => {
      expect(isPrivateOrReservedIp('224.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('239.255.255.255')).toBe(true);
      expect(isPrivateOrReservedIp('240.0.0.1')).toBe(true);
    });

    it('does not block public IPv4 just outside private ranges', () => {
      expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
      expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false);
      expect(isPrivateOrReservedIp('172.15.0.1')).toBe(false); // edge: just below 172.16
      expect(isPrivateOrReservedIp('172.32.0.1')).toBe(false); // edge: just above 172.31
      expect(isPrivateOrReservedIp('11.0.0.1')).toBe(false);
    });
  });

  describe('IPv6', () => {
    it('blocks loopback ::1 and unspecified ::', () => {
      expect(isPrivateOrReservedIp('::1')).toBe(true);
      expect(isPrivateOrReservedIp('::')).toBe(true);
    });

    it('blocks link-local fe80::/10', () => {
      expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
    });

    it('blocks unique-local fc00::/7', () => {
      expect(isPrivateOrReservedIp('fc00::1')).toBe(true);
      expect(isPrivateOrReservedIp('fd12::abcd')).toBe(true);
    });

    it('treats IPv4-mapped IPv6 as the underlying IPv4 (decimal form)', () => {
      expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('::ffff:169.254.169.254')).toBe(true);
      expect(isPrivateOrReservedIp('::ffff:8.8.8.8')).toBe(false);
    });

    it('treats IPv4-mapped IPv6 as the underlying IPv4 (hex form)', () => {
      expect(isPrivateOrReservedIp('::ffff:7f00:1')).toBe(true);
      expect(isPrivateOrReservedIp('::ffff:a9fe:a9fe')).toBe(true);
    });

    it('does not block public IPv6 (e.g. Cloudflare, Google DNS)', () => {
      expect(isPrivateOrReservedIp('2606:4700:4700::1111')).toBe(false);
      expect(isPrivateOrReservedIp('2001:4860:4860::8888')).toBe(false);
    });
  });

  it('treats empty input as blocked (fail-closed)', () => {
    expect(isPrivateOrReservedIp('')).toBe(true);
  });
});
