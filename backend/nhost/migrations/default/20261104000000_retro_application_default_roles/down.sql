-- Restore the original eligibility rule without changing accounts or grants.
CREATE OR REPLACE VIEW public.retro_eligible_users AS
SELECT u.id,
  EXISTS (SELECT 1 FROM auth.user_roles r WHERE r.user_id = u.id AND r.role = 'facilitator') AS is_facilitator
FROM auth.users u
WHERE u.email_verified AND NOT u.disabled AND NOT u.is_anonymous
  AND lower(u.email::text) ~ '^[^@[:space:]]+@nhost[.]io$'
  AND u.default_role = 'user'
  AND EXISTS (SELECT 1 FROM auth.user_roles r WHERE r.user_id = u.id AND r.role = 'user');
