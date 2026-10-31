-- App authorization uses live account state, not merely claims from an old JWT.
CREATE VIEW public.retro_eligible_users AS
SELECT u.id,
  EXISTS (SELECT 1 FROM auth.user_roles r WHERE r.user_id = u.id AND r.role = 'facilitator') AS is_facilitator
FROM auth.users u
WHERE u.email_verified AND NOT u.disabled AND NOT u.is_anonymous
  AND lower(u.email::text) ~ '^[^@[:space:]]+@nhost[.]io$'
  AND u.default_role = 'user'
  AND EXISTS (SELECT 1 FROM auth.user_roles r WHERE r.user_id = u.id AND r.role = 'user');

-- Match ECMAScript trim's explicit Unicode whitespace set, not locale-dependent \s.
CREATE FUNCTION public.retro_trim(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT btrim(value, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;

CREATE TABLE public.retro_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (name = public.retro_trim(name) AND char_length(name) BETWEEN 1 AND 120),
  ended boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.retro_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.retro_sessions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  text text NOT NULL CHECK (text = public.retro_trim(text) AND char_length(text) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX retro_questions_session_id_idx ON public.retro_questions(session_id);

CREATE FUNCTION public.retro_guard_session() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.ended THEN RAISE EXCEPTION 'New sessions must be active'; END IF;
    NEW.name := public.retro_trim(NEW.name);
    RETURN NEW;
  END IF;
  -- UPDATE/DELETE already holds the session row lock. FOR SHARE in content
  -- triggers conflicts even with a non-key UPDATE of ended.
  IF OLD.ended THEN RAISE EXCEPTION 'Ended sessions are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Session identity is immutable';
  END IF;
  NEW.name := public.retro_trim(NEW.name);
  IF NEW.ended AND NEW.name IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION 'End and rename must be separate operations';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER retro_guard_session BEFORE INSERT OR UPDATE OR DELETE ON public.retro_sessions
FOR EACH ROW EXECUTE FUNCTION public.retro_guard_session();

CREATE FUNCTION public.retro_guard_question() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_id uuid;
  is_ended boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.session_id IS DISTINCT FROM OLD.session_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Question identity and parent are immutable';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN parent_id := NEW.session_id; ELSE parent_id := OLD.session_id; END IF;
  -- Do not read ended before locking: a waiting READ COMMITTED writer must
  -- inspect the committed row version after a concurrent close wins the lock.
  SELECT ended INTO is_ended FROM public.retro_sessions WHERE id = parent_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF is_ended THEN RAISE EXCEPTION 'Ended sessions are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.text := public.retro_trim(NEW.text);
  RETURN NEW;
END;
$$;
CREATE TRIGGER retro_guard_question BEFORE INSERT OR UPDATE OR DELETE ON public.retro_questions
FOR EACH ROW EXECUTE FUNCTION public.retro_guard_question();
