-- Guided tutorials: which tutorial each user has already been shown (auto-start happens once per user).
-- @see admin-panel/src/lib/tutorials/registry.ts, admin-panel/src/lib/actions/tutorial-progress.ts

CREATE TABLE public.tutorial_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tutorial_id text NOT NULL CHECK (tutorial_id ~ '^[a-z][a-z0-9-]{1,63}$'),
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tutorial_id)
);

ALTER TABLE public.tutorial_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.tutorial_progress
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Users read own tutorial progress" ON public.tutorial_progress
  FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
CREATE POLICY "Users record own tutorial progress" ON public.tutorial_progress
  FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()));

REVOKE ALL ON public.tutorial_progress FROM anon, authenticated;
GRANT SELECT, INSERT ON public.tutorial_progress TO authenticated;
GRANT ALL ON public.tutorial_progress TO service_role;
