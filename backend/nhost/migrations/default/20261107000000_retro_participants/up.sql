-- Deliberately no backfill: facilitators explicitly enroll existing accounts.
CREATE TABLE public.retro_session_participants (
  session_id uuid NOT NULL REFERENCES public.retro_sessions(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  PRIMARY KEY (session_id, user_id)
);
CREATE INDEX retro_session_participants_user_idx ON public.retro_session_participants(user_id);

-- A facilitator-only directory, not an expansion of the public Auth schema.
CREATE VIEW public.retro_participant_accounts AS
SELECT u.id, u.display_name, u.email
FROM auth.users u JOIN public.retro_eligible_users e ON e.id = u.id;

-- The membership row lock serializes answer writes with participant removal.
-- A stale API permission snapshot cannot write after removal wins the lock.
CREATE FUNCTION public.retro_guard_answer_participant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_id uuid;
  writer_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    parent_id := NEW.question_id;
    writer_id := NEW.author_id;
  ELSE
    parent_id := OLD.question_id;
    writer_id := OLD.author_id;
  END IF;
  PERFORM p.user_id FROM public.retro_session_participants p
    JOIN public.retro_questions q ON q.session_id = p.session_id
    WHERE q.id = parent_id AND p.user_id = writer_id FOR SHARE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only session participants can change answers'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER retro_guard_answer_participant BEFORE INSERT OR UPDATE OR DELETE ON public.retro_answers
FOR EACH ROW EXECUTE FUNCTION public.retro_guard_answer_participant();
