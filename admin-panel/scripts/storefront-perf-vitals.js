/** Reference metrics are collected only by the acceptance browser. */
import { onLCP, onCLS, onINP } from 'next/dist/compiled/web-vitals/web-vitals.js';
const values = { shifts: [] };
window.__perfValues = values;
for (const observe of [onLCP, onCLS, onINP]) observe(metric => { values[metric.name] = metric.value; }, { reportAllChanges: true });
new PerformanceObserver(list => {
  for (const entry of list.getEntries()) if (!entry.hadRecentInput) values.shifts.push({
    at: entry.startTime, value: entry.value, sources: (entry.sources ?? []).map(source => ({
      node: source.node ? `${source.node.tagName}#${source.node.id}.${String(source.node.className).slice(0, 120)}` : null,
      before: source.previousRect.toJSON(), after: source.currentRect.toJSON(),
    })),
  });
}).observe({ type: 'layout-shift', buffered: true });
