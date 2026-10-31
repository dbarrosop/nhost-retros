CREATE TABLE public.retro_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.retro_questions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  text text NOT NULL CHECK (text = public.retro_trim(text) AND char_length(text) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Many cards per person/question: these are deliberately non-unique indexes.
CREATE INDEX retro_answers_question_id_idx ON public.retro_answers(question_id);
CREATE INDEX retro_answers_author_id_idx ON public.retro_answers(author_id);

CREATE FUNCTION public.retro_guard_answer() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_id uuid;
  is_ended boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.question_id IS DISTINCT FROM OLD.question_id
      OR NEW.author_id IS DISTINCT FROM OLD.author_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
      RAISE EXCEPTION 'Answer identity, author, parent and timestamps are immutable';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN parent_id := NEW.question_id; ELSE parent_id := OLD.question_id; END IF;
  -- Lock and read the session in ONE statement. A blocked READ COMMITTED writer
  -- must observe a concurrent committed close, not a pre-lock permission snapshot.
  SELECT s.ended INTO is_ended FROM public.retro_sessions s
    JOIN public.retro_questions q ON q.session_id = s.id
    WHERE q.id = parent_id FOR SHARE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Question not found'; END IF;
  IF is_ended THEN RAISE EXCEPTION 'Ended sessions are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.text := public.retro_trim(NEW.text);
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := clock_timestamp(); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER retro_guard_answer BEFORE INSERT OR UPDATE OR DELETE ON public.retro_answers
FOR EACH ROW EXECUTE FUNCTION public.retro_guard_answer();
