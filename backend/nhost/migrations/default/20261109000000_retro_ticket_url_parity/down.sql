-- Restore the original CHECK; rollback is for scratch migration roundtrips only.
ALTER TABLE public.retro_follow_ups
  DROP CONSTRAINT retro_follow_ups_ticket_url_check,
  ADD CONSTRAINT retro_follow_ups_ticket_url_check CHECK (
    ticket_url = public.retro_trim(ticket_url) AND char_length(ticket_url) BETWEEN 1 AND 2048
    AND ticket_url ~* '^https?://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]\\]*)?$'
  );
