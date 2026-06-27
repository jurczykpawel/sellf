import { describe, it, expect } from 'vitest';
import { memBucket, cpuBucket, majorVersion } from '@/lib/telemetry/coarsen';

describe('coarsen', () => {
  it.each([[512,'<1G'],[1995,'1-2'],[3936,'2-4'],[7945,'4-8'],[16104,'8-16'],[31000,'16-32'],[64000,'32+']])
    ('mem %i MB -> %s', (mb, b) => expect(memBucket(mb)).toBe(b));
  it.each([[1,'1'],[2,'2'],[4,'3-4'],[8,'5-8'],[24,'9+']])('cpu %i -> %s', (n, b) => expect(cpuBucket(n)).toBe(b));
  it('major version strips minor/patch', () => { expect(majorVersion('22.4.1')).toBe('22'); expect(majorVersion('v20.1')).toBe('20'); });
});
