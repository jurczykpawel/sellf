import { z } from 'zod';

export const DashboardQueryDTO = z.object({ product_id: z.uuid().optional() });
export const RevenueQueryDTO = DashboardQueryDTO.extend({
  period: z.enum(['day', 'week', 'month', 'quarter', 'year', 'all']).optional(),
  group_by: z.enum(['day', 'week', 'month']).optional(),
});
