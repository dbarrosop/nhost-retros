DROP VIEW public.retro_answer_authors;
DROP TABLE public.retro_answer_topics;
DROP FUNCTION public.retro_guard_answer_topic();
DROP TABLE public.retro_topics;
DROP FUNCTION public.retro_guard_topic();
ALTER TABLE public.retro_answers DROP CONSTRAINT retro_answers_id_question_key;
