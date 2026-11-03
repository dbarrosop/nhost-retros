-- Match the SPA's ASCII host/scheme and ECMAScript whitespace + Unicode Cc rule.
-- C collation and explicit code points avoid locale-dependent ranges/classes.
-- NUL is already forbidden in PostgreSQL text; all other Cc characters are below.
ALTER TABLE public.retro_follow_ups
  DROP CONSTRAINT retro_follow_ups_ticket_url_check,
  ADD CONSTRAINT retro_follow_ups_ticket_url_check CHECK (
    ticket_url = public.retro_trim(ticket_url) AND char_length(ticket_url) BETWEEN 1 AND 2048
    AND ticket_url COLLATE "C" ~ '^[hH][tT][tT][pP][sS]?://[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?(:[0-9]{1,5})?([/?#][^\\\u0001-\u0020\u007f-\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*)?$'
  );
