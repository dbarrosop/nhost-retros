-- Destructive rollback is exercised only in the guarded scratch database.
DROP TABLE public.retro_answers;
DROP FUNCTION public.retro_guard_answer();
