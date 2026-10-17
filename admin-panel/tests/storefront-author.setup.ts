/** Publication acceptance requires an exclusive disposable local stack. */
import { test as setup, expect } from '@playwright/test';
import { getTestDatabaseContainer } from './helpers/database-container';

setup('template author environment uses a disposable stack', () => {
  expect(getTestDatabaseContainer()).not.toBe('supabase_db_sellf');
});
