-- Grouping is independent of answer content and remains mutable after closure.
ALTER TABLE public.retro_answers ADD CONSTRAINT retro_answers_id_question_key UNIQUE (id, question_id);

CREATE TABLE public.retro_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.retro_questions(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  name text NOT NULL CHECK (name = public.retro_trim(name) AND char_length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retro_topics_id_question_key UNIQUE (id, question_id)
);
CREATE INDEX retro_topics_question_id_idx ON public.retro_topics(question_id);

CREATE TABLE public.retro_answer_topics (
  answer_id uuid PRIMARY KEY,
  question_id uuid NOT NULL,
  topic_id uuid NOT NULL,
  CONSTRAINT retro_answer_topics_answer_fkey FOREIGN KEY (answer_id, question_id)
    REFERENCES public.retro_answers(id, question_id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT retro_answer_topics_topic_fkey FOREIGN KEY (topic_id, question_id)
    REFERENCES public.retro_topics(id, question_id) ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE INDEX retro_answer_topics_topic_idx ON public.retro_answer_topics(topic_id, question_id);
CREATE INDEX retro_answer_topics_question_id_idx ON public.retro_answer_topics(question_id);

CREATE FUNCTION public.retro_guard_topic() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.question_id IS DISTINCT FROM OLD.question_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Topic identity, parent and creation time are immutable';
    END IF;
  END IF;
  NEW.name := public.retro_trim(NEW.name);
  RETURN NEW;
END;
$$;
CREATE TRIGGER retro_guard_topic BEFORE INSERT OR UPDATE ON public.retro_topics
FOR EACH ROW EXECUTE FUNCTION public.retro_guard_topic();

CREATE FUNCTION public.retro_guard_answer_topic() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.answer_id IS DISTINCT FROM OLD.answer_id OR NEW.question_id IS DISTINCT FROM OLD.question_id THEN
    RAISE EXCEPTION 'Assignment answer and question are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER retro_guard_answer_topic BEFORE UPDATE ON public.retro_answer_topics
FOR EACH ROW EXECUTE FUNCTION public.retro_guard_answer_topic();

-- Only authors with retained cards, never a general account directory or Auth secrets.
CREATE VIEW public.retro_answer_authors AS
SELECT u.id, u.display_name, u.email
FROM auth.users u
WHERE EXISTS (SELECT 1 FROM public.retro_answers a WHERE a.author_id = u.id);
