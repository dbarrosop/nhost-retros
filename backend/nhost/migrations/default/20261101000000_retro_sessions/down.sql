-- Destructive rollback is for a backed-up, explicitly approved database only.
DROP TABLE public.retro_questions;
DROP TABLE public.retro_sessions;
DROP FUNCTION public.retro_guard_question();
DROP FUNCTION public.retro_guard_session();
DROP FUNCTION public.retro_trim(text);
DROP VIEW public.retro_eligible_users;
