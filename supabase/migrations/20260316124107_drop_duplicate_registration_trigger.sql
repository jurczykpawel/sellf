-- Drop duplicate registration trigger.
--
-- Both `user_registration_trigger` (core_schema.sql) and `on_auth_user_created`
-- (features.sql) fire on auth.users INSERT and call handle_new_user_registration().
-- This causes the function to run twice on every signup. The advisory lock inside
-- the function prevents actual double admin assignment, but the duplicate execution
-- is unnecessary overhead.
--
-- We keep `on_auth_user_created` (the newer trigger from features.sql) and drop
-- the older `user_registration_trigger`.

DROP TRIGGER IF EXISTS user_registration_trigger ON auth.users;
