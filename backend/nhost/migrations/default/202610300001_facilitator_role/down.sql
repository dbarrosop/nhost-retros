-- Refuse downgrade while privileges are in use; never silently revoke grants.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.user_roles WHERE role = 'facilitator')
     OR EXISTS (SELECT 1 FROM auth.users WHERE default_role = 'facilitator') THEN
    RAISE EXCEPTION 'Revoke facilitator grants explicitly before removing the role';
  END IF;
END;
$$;
DELETE FROM auth.roles WHERE role = 'facilitator';
