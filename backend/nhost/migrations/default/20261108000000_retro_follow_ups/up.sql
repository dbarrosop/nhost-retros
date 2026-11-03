-- Follow-ups are discussion outcomes, independent of frozen reflection content.
-- Restrictive FKs retain actions until a facilitator explicitly deletes them.
CREATE TABLE public.retro_follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.retro_questions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  action text NOT NULL CHECK (action = public.retro_trim(action) AND char_length(action) BETWEEN 1 AND 500),
  ticket_url text CHECK (
    ticket_url = public.retro_trim(ticket_url) AND char_length(ticket_url) BETWEEN 1 AND 2048
    AND ticket_url ~* '^https?://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]\\]*)?$'
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX retro_follow_ups_question_id_idx ON public.retro_follow_ups(question_id);
CREATE INDEX retro_follow_ups_owner_id_idx ON public.retro_follow_ups(owner_id);

CREATE FUNCTION public.retro_guard_follow_up() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.question_id IS DISTINCT FROM OLD.question_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Follow-up identity, question and creation time are immutable';
    END IF;
  END IF;
  -- Lock membership so a concurrent removal cannot leave a newly assigned
  -- action belonging to someone who was already removed. Retained owners may
  -- still have their action/link edited after removal; reassignment is explicit.
  IF TG_OP = 'INSERT' OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    PERFORM p.user_id FROM public.retro_session_participants p
      JOIN public.retro_questions q ON q.session_id = p.session_id
      JOIN public.retro_eligible_users e ON e.id = p.user_id
      WHERE q.id = NEW.question_id AND p.user_id = NEW.owner_id FOR SHARE OF p;
    IF NOT FOUND THEN RAISE EXCEPTION 'Choose an eligible session participant as owner'; END IF;
  END IF;
  NEW.action := public.retro_trim(NEW.action);
  NEW.ticket_url := nullif(public.retro_trim(NEW.ticket_url), '');
  RETURN NEW;
END;
$$;
CREATE TRIGGER retro_guard_follow_up BEFORE INSERT OR UPDATE ON public.retro_follow_ups
FOR EACH ROW EXECUTE FUNCTION public.retro_guard_follow_up();

-- Keep retained owners identifiable after removal without exposing Auth fields
-- or broadening the existing eligible-account directory.
CREATE VIEW public.retro_follow_up_owners AS
SELECT u.id, u.display_name, u.email FROM auth.users u
WHERE EXISTS (SELECT 1 FROM public.retro_follow_ups f WHERE f.owner_id = u.id);
