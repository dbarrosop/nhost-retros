-- Development-only demo data. Nhost applies this on first local startup or
-- with `nhost up --apply-seeds`. Do not apply demo accounts to production.
-- Replays add missing rows without resetting data, overwriting cards or moving
-- existing assignments. Roles are granted only when a demo account is created.
-- No passwords, JWTs, shared credentials or disabled database triggers.
DO $seed$
DECLARE
  account record;
BEGIN
  IF current_database() <> 'local'
    AND current_database() !~ '^retro_scratch_[a-f0-9]{20}$' THEN
    RAISE EXCEPTION 'Demo seed requires the local development or scratch database';
  END IF;
  IF position('nhost[.]io' IN pg_get_viewdef('public.retro_eligible_users'::regclass, true)) > 0 THEN
    RAISE EXCEPTION 'Apply the unrestricted-email-domain migration before the demo seed';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '30s', true);
  PERFORM pg_advisory_xact_lock(hashtext('nhost-retro-demo-seed'));

  -- Keep the global signup roles user/me. The facilitator grant below is trusted
  -- seed SQL, never a signup-requestable role or a metadata claim.
  FOR account IN SELECT * FROM (VALUES
    ('acde0000-0000-4000-8000-000000000001'::uuid, 'factilitator@acme.local', 'Demo Facilitator'),
    ('acde0000-0000-4000-8000-000000000002'::uuid, 'avery@acme.local', 'Avery Morgan'),
    ('acde0000-0000-4000-8000-000000000003'::uuid, 'jordan@acme.local', 'Jordan Lee'),
    ('acde0000-0000-4000-8000-000000000004'::uuid, 'samira@acme.local', 'Samira Patel'),
    ('acde0000-0000-4000-8000-000000000005'::uuid, 'diego@acme.local', 'Diego Santos'),
    ('acde0000-0000-4000-8000-000000000006'::uuid, 'mei@acme.local', 'Mei Chen'),
    ('acde0000-0000-4000-8000-000000000007'::uuid, 'noah@acme.local', 'Noah Wilson'),
    ('acde0000-0000-4000-8000-000000000008'::uuid, 'imani@acme.local', 'Imani Brooks'),
    ('acde0000-0000-4000-8000-000000000009'::uuid, 'luca@acme.local', 'Luca Rossi')
  ) AS accounts(id, email, display_name)
  LOOP
    IF EXISTS (SELECT 1 FROM auth.users WHERE id=account.id AND lower(email::text)<>account.email) THEN
      RAISE EXCEPTION 'Demo account ID belongs to a different email; refusing to grant roles';
    END IF;
    WITH created AS (
      INSERT INTO auth.users(id, email, display_name, locale, default_role, email_verified, disabled, is_anonymous)
      SELECT account.id, account.email, account.display_name, 'en', 'user', true, false, false
      WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE id=account.id)
      RETURNING id
    )
    INSERT INTO auth.user_roles(user_id, role)
    SELECT created.id, membership.role FROM created
    CROSS JOIN (VALUES ('user'), ('me'), ('facilitator')) AS membership(role)
    WHERE membership.role<>'facilitator' OR created.id='acde0000-0000-4000-8000-000000000001'::uuid;
  END LOOP;

  -- Sessions start active so all inserts obey the ordinary closure triggers.
  WITH created_sessions AS (
  INSERT INTO public.retro_sessions(id, name, created_at)
  SELECT demo.id, demo.name, now()-make_interval(days => demo.age_days)
  FROM (VALUES
    ('acde1000-0000-4000-8000-000000000001'::uuid, 'Sprint 24 - Ship with confidence', 21),
    ('acde1000-0000-4000-8000-000000000002'::uuid, 'Sprint 25 - Developer experience', 7),
    ('acde1000-0000-4000-8000-000000000003'::uuid, 'Platform launch - Next chapter', 1)
  ) AS demo(id, name, age_days)
  WHERE NOT EXISTS (SELECT 1 FROM public.retro_sessions existing WHERE existing.id=demo.id)
  RETURNING id
  )
  -- Enroll only when creating a demo session; replay never restores removals.
  INSERT INTO public.retro_session_participants(session_id, user_id)
  SELECT s.id, u.id FROM created_sessions s CROSS JOIN auth.users u
  WHERE u.id BETWEEN 'acde0000-0000-4000-8000-000000000001'::uuid
    AND 'acde0000-0000-4000-8000-000000000009'::uuid;

  INSERT INTO public.retro_questions(id, session_id, text, created_at)
  SELECT demo.id, demo.session_id, demo.text,
    parent.created_at+make_interval(mins => demo.position*5)
  FROM (VALUES
    ('acde2000-0000-4000-8000-000000000001'::uuid, 'acde1000-0000-4000-8000-000000000001'::uuid, 'What helped us ship with confidence?', 1),
    ('acde2000-0000-4000-8000-000000000002'::uuid, 'acde1000-0000-4000-8000-000000000001'::uuid, 'What made this release harder than it needed to be?', 2),
    ('acde2000-0000-4000-8000-000000000003'::uuid, 'acde1000-0000-4000-8000-000000000001'::uuid, 'What should we try for the next release?', 3),
    ('acde2000-0000-4000-8000-000000000004'::uuid, 'acde1000-0000-4000-8000-000000000002'::uuid, 'What made development feel easier this sprint?', 1),
    ('acde2000-0000-4000-8000-000000000005'::uuid, 'acde1000-0000-4000-8000-000000000002'::uuid, 'Where did our workflow get in the way?', 2),
    ('acde2000-0000-4000-8000-000000000006'::uuid, 'acde1000-0000-4000-8000-000000000002'::uuid, 'Which small experiment should we run next sprint?', 3),
    ('acde2000-0000-4000-8000-000000000007'::uuid, 'acde1000-0000-4000-8000-000000000003'::uuid, 'What is working well as we prepare to launch?', 1),
    ('acde2000-0000-4000-8000-000000000008'::uuid, 'acde1000-0000-4000-8000-000000000003'::uuid, 'What risks or friction should we address before launch?', 2),
    ('acde2000-0000-4000-8000-000000000009'::uuid, 'acde1000-0000-4000-8000-000000000003'::uuid, 'How can we support each other through launch?', 3)
  ) AS demo(id, session_id, text, position)
  JOIN public.retro_sessions parent ON parent.id=demo.session_id
  WHERE NOT EXISTS (SELECT 1 FROM public.retro_questions existing WHERE existing.id=demo.id);

  -- Every participant has a card for each question; two per question stay
  -- ungrouped so the board demonstrates both topics and the ungrouped column.
  INSERT INTO public.retro_answers(id, question_id, author_id, text, created_at, updated_at)
  SELECT demo.id, demo.question_id, demo.author_id, demo.text,
    parent.created_at+make_interval(mins => demo.position),
    parent.created_at+make_interval(mins => demo.position)
  FROM (VALUES
    ('acde3000-0000-4000-8000-000000000001'::uuid, 'acde2000-0000-4000-8000-000000000001'::uuid, 'acde0000-0000-4000-8000-000000000002'::uuid, 'Pairing on the release checklist caught two integration issues early.', 1),
    ('acde3000-0000-4000-8000-000000000002'::uuid, 'acde2000-0000-4000-8000-000000000001'::uuid, 'acde0000-0000-4000-8000-000000000003'::uuid, 'The smaller pull requests were much easier to review.', 2),
    ('acde3000-0000-4000-8000-000000000003'::uuid, 'acde2000-0000-4000-8000-000000000001'::uuid, 'acde0000-0000-4000-8000-000000000004'::uuid, 'Our feature flags let us release without rushing the final polish.', 3),
    ('acde3000-0000-4000-8000-000000000004'::uuid, 'acde2000-0000-4000-8000-000000000001'::uuid, 'acde0000-0000-4000-8000-000000000005'::uuid, 'The shared release channel kept support and engineering aligned.', 4),
    ('acde3000-0000-4000-8000-000000000005'::uuid, 'acde2000-0000-4000-8000-000000000001'::uuid, 'acde0000-0000-4000-8000-000000000006'::uuid, 'The staging smoke tests gave me confidence in the migration.', 5),
    ('acde3000-0000-4000-8000-000000000006'::uuid, 'acde2000-0000-4000-8000-000000000001'::uuid, 'acde0000-0000-4000-8000-000000000007'::uuid, 'Someone always made time to help when I got stuck.', 6),
    ('acde3000-0000-4000-8000-000000000007'::uuid, 'acde2000-0000-4000-8000-000000000001'::uuid, 'acde0000-0000-4000-8000-000000000008'::uuid, 'The customer demo gave us quick, specific feedback.', 7),
    ('acde3000-0000-4000-8000-000000000008'::uuid, 'acde2000-0000-4000-8000-000000000001'::uuid, 'acde0000-0000-4000-8000-000000000009'::uuid, 'Having a clear owner for each release task reduced confusion.', 8),
    ('acde3000-0000-4000-8000-000000000009'::uuid, 'acde2000-0000-4000-8000-000000000002'::uuid, 'acde0000-0000-4000-8000-000000000002'::uuid, 'We waited too long for reviews on the last day of the sprint.', 1),
    ('acde3000-0000-4000-8000-000000000010'::uuid, 'acde2000-0000-4000-8000-000000000002'::uuid, 'acde0000-0000-4000-8000-000000000003'::uuid, 'The flaky end-to-end test cost us an afternoon.', 2),
    ('acde3000-0000-4000-8000-000000000011'::uuid, 'acde2000-0000-4000-8000-000000000002'::uuid, 'acde0000-0000-4000-8000-000000000004'::uuid, 'The release notes were spread across three documents.', 3),
    ('acde3000-0000-4000-8000-000000000012'::uuid, 'acde2000-0000-4000-8000-000000000002'::uuid, 'acde0000-0000-4000-8000-000000000005'::uuid, 'I was not sure who could approve a last-minute scope change.', 4),
    ('acde3000-0000-4000-8000-000000000013'::uuid, 'acde2000-0000-4000-8000-000000000002'::uuid, 'acde0000-0000-4000-8000-000000000006'::uuid, 'Our staging data did not cover the edge case we found in production.', 5),
    ('acde3000-0000-4000-8000-000000000014'::uuid, 'acde2000-0000-4000-8000-000000000002'::uuid, 'acde0000-0000-4000-8000-000000000007'::uuid, 'Unexpected support requests broke up my focus time.', 6),
    ('acde3000-0000-4000-8000-000000000015'::uuid, 'acde2000-0000-4000-8000-000000000002'::uuid, 'acde0000-0000-4000-8000-000000000008'::uuid, 'The deploy window overlapped with a customer meeting.', 7),
    ('acde3000-0000-4000-8000-000000000016'::uuid, 'acde2000-0000-4000-8000-000000000002'::uuid, 'acde0000-0000-4000-8000-000000000009'::uuid, 'The rollback instructions were difficult to find.', 8),
    ('acde3000-0000-4000-8000-000000000017'::uuid, 'acde2000-0000-4000-8000-000000000003'::uuid, 'acde0000-0000-4000-8000-000000000002'::uuid, 'Try a daily twenty-minute review window during release week.', 1),
    ('acde3000-0000-4000-8000-000000000018'::uuid, 'acde2000-0000-4000-8000-000000000003'::uuid, 'acde0000-0000-4000-8000-000000000003'::uuid, 'Assign an owner and a time budget to each flaky test.', 2),
    ('acde3000-0000-4000-8000-000000000019'::uuid, 'acde2000-0000-4000-8000-000000000003'::uuid, 'acde0000-0000-4000-8000-000000000004'::uuid, 'Keep the release checklist and notes in one shared place.', 3),
    ('acde3000-0000-4000-8000-000000000020'::uuid, 'acde2000-0000-4000-8000-000000000003'::uuid, 'acde0000-0000-4000-8000-000000000005'::uuid, 'Write down who can make the final scope decision.', 4),
    ('acde3000-0000-4000-8000-000000000021'::uuid, 'acde2000-0000-4000-8000-000000000003'::uuid, 'acde0000-0000-4000-8000-000000000006'::uuid, 'Add realistic migration fixtures before the next release.', 5),
    ('acde3000-0000-4000-8000-000000000022'::uuid, 'acde2000-0000-4000-8000-000000000003'::uuid, 'acde0000-0000-4000-8000-000000000007'::uuid, 'Rotate a support buddy so the rest of the team can focus.', 6),
    ('acde3000-0000-4000-8000-000000000023'::uuid, 'acde2000-0000-4000-8000-000000000003'::uuid, 'acde0000-0000-4000-8000-000000000008'::uuid, 'Agree on a deploy window at the start of the sprint.', 7),
    ('acde3000-0000-4000-8000-000000000024'::uuid, 'acde2000-0000-4000-8000-000000000003'::uuid, 'acde0000-0000-4000-8000-000000000009'::uuid, 'Rehearse rollback in staging and link it from the checklist.', 8),
    ('acde3000-0000-4000-8000-000000000025'::uuid, 'acde2000-0000-4000-8000-000000000004'::uuid, 'acde0000-0000-4000-8000-000000000002'::uuid, 'The updated local setup instructions worked on the first try.', 1),
    ('acde3000-0000-4000-8000-000000000026'::uuid, 'acde2000-0000-4000-8000-000000000004'::uuid, 'acde0000-0000-4000-8000-000000000003'::uuid, 'Faster incremental builds made small changes feel less expensive.', 2),
    ('acde3000-0000-4000-8000-000000000027'::uuid, 'acde2000-0000-4000-8000-000000000004'::uuid, 'acde0000-0000-4000-8000-000000000004'::uuid, 'The new API examples made onboarding much less intimidating.', 3),
    ('acde3000-0000-4000-8000-000000000028'::uuid, 'acde2000-0000-4000-8000-000000000004'::uuid, 'acde0000-0000-4000-8000-000000000005'::uuid, 'The design walkthrough answered my questions before implementation.', 4),
    ('acde3000-0000-4000-8000-000000000029'::uuid, 'acde2000-0000-4000-8000-000000000004'::uuid, 'acde0000-0000-4000-8000-000000000006'::uuid, 'Pairing across frontend and backend helped us agree on the contract.', 5),
    ('acde3000-0000-4000-8000-000000000030'::uuid, 'acde2000-0000-4000-8000-000000000004'::uuid, 'acde0000-0000-4000-8000-000000000007'::uuid, 'The quiet morning block was my most productive time all week.', 6),
    ('acde3000-0000-4000-8000-000000000031'::uuid, 'acde2000-0000-4000-8000-000000000004'::uuid, 'acde0000-0000-4000-8000-000000000008'::uuid, 'The issue templates gave us better reproduction steps.', 7),
    ('acde3000-0000-4000-8000-000000000032'::uuid, 'acde2000-0000-4000-8000-000000000004'::uuid, 'acde0000-0000-4000-8000-000000000009'::uuid, 'Seeing the demo early helped me understand the bigger picture.', 8),
    ('acde3000-0000-4000-8000-000000000033'::uuid, 'acde2000-0000-4000-8000-000000000005'::uuid, 'acde0000-0000-4000-8000-000000000002'::uuid, 'Local seed data drifted from what the UI expected.', 1),
    ('acde3000-0000-4000-8000-000000000034'::uuid, 'acde2000-0000-4000-8000-000000000005'::uuid, 'acde0000-0000-4000-8000-000000000003'::uuid, 'The feedback loop was slow when I had to run the entire test suite.', 2),
    ('acde3000-0000-4000-8000-000000000035'::uuid, 'acde2000-0000-4000-8000-000000000005'::uuid, 'acde0000-0000-4000-8000-000000000004'::uuid, 'I had to ask around to find the right service logs.', 3),
    ('acde3000-0000-4000-8000-000000000036'::uuid, 'acde2000-0000-4000-8000-000000000005'::uuid, 'acde0000-0000-4000-8000-000000000005'::uuid, 'Too many parallel priorities made it hard to finish a task.', 4),
    ('acde3000-0000-4000-8000-000000000037'::uuid, 'acde2000-0000-4000-8000-000000000005'::uuid, 'acde0000-0000-4000-8000-000000000006'::uuid, 'The API permission error did not explain which role was missing.', 5),
    ('acde3000-0000-4000-8000-000000000038'::uuid, 'acde2000-0000-4000-8000-000000000005'::uuid, 'acde0000-0000-4000-8000-000000000007'::uuid, 'Unscheduled meetings interrupted the quiet block.', 6),
    ('acde3000-0000-4000-8000-000000000039'::uuid, 'acde2000-0000-4000-8000-000000000005'::uuid, 'acde0000-0000-4000-8000-000000000008'::uuid, 'Some tickets still did not have a clear acceptance example.', 7),
    ('acde3000-0000-4000-8000-000000000040'::uuid, 'acde2000-0000-4000-8000-000000000005'::uuid, 'acde0000-0000-4000-8000-000000000009'::uuid, 'We discovered the mobile layout issue near the end of the sprint.', 8),
    ('acde3000-0000-4000-8000-000000000041'::uuid, 'acde2000-0000-4000-8000-000000000006'::uuid, 'acde0000-0000-4000-8000-000000000002'::uuid, 'Keep a small, repeatable demo dataset in the repository.', 1),
    ('acde3000-0000-4000-8000-000000000042'::uuid, 'acde2000-0000-4000-8000-000000000006'::uuid, 'acde0000-0000-4000-8000-000000000003'::uuid, 'Document the fastest useful test command for each package.', 2),
    ('acde3000-0000-4000-8000-000000000043'::uuid, 'acde2000-0000-4000-8000-000000000006'::uuid, 'acde0000-0000-4000-8000-000000000004'::uuid, 'Add a short map from service names to their logs.', 3),
    ('acde3000-0000-4000-8000-000000000044'::uuid, 'acde2000-0000-4000-8000-000000000006'::uuid, 'acde0000-0000-4000-8000-000000000005'::uuid, 'Limit work in progress to one primary task per person.', 4),
    ('acde3000-0000-4000-8000-000000000045'::uuid, 'acde2000-0000-4000-8000-000000000006'::uuid, 'acde0000-0000-4000-8000-000000000006'::uuid, 'Add role-aware examples to the API troubleshooting guide.', 5),
    ('acde3000-0000-4000-8000-000000000046'::uuid, 'acde2000-0000-4000-8000-000000000006'::uuid, 'acde0000-0000-4000-8000-000000000007'::uuid, 'Try meeting-free mornings on two days next week.', 6),
    ('acde3000-0000-4000-8000-000000000047'::uuid, 'acde2000-0000-4000-8000-000000000006'::uuid, 'acde0000-0000-4000-8000-000000000008'::uuid, 'Include one concrete example in each new ticket.', 7),
    ('acde3000-0000-4000-8000-000000000048'::uuid, 'acde2000-0000-4000-8000-000000000006'::uuid, 'acde0000-0000-4000-8000-000000000009'::uuid, 'Show a mobile preview during the first design review.', 8),
    ('acde3000-0000-4000-8000-000000000049'::uuid, 'acde2000-0000-4000-8000-000000000007'::uuid, 'acde0000-0000-4000-8000-000000000002'::uuid, 'The launch checklist makes the remaining work feel manageable.', 1),
    ('acde3000-0000-4000-8000-000000000050'::uuid, 'acde2000-0000-4000-8000-000000000007'::uuid, 'acde0000-0000-4000-8000-000000000003'::uuid, 'Support has been involved early enough to influence the plan.', 2),
    ('acde3000-0000-4000-8000-000000000051'::uuid, 'acde2000-0000-4000-8000-000000000007'::uuid, 'acde0000-0000-4000-8000-000000000004'::uuid, 'The accessibility review found improvements we could ship quickly.', 3),
    ('acde3000-0000-4000-8000-000000000052'::uuid, 'acde2000-0000-4000-8000-000000000007'::uuid, 'acde0000-0000-4000-8000-000000000005'::uuid, 'The preview environment makes it easy to share progress.', 4),
    ('acde3000-0000-4000-8000-000000000053'::uuid, 'acde2000-0000-4000-8000-000000000007'::uuid, 'acde0000-0000-4000-8000-000000000006'::uuid, 'The observability dashboard already answers our main questions.', 5),
    ('acde3000-0000-4000-8000-000000000054'::uuid, 'acde2000-0000-4000-8000-000000000007'::uuid, 'acde0000-0000-4000-8000-000000000007'::uuid, 'The team has been honest about uncertainty and capacity.', 6),
    ('acde3000-0000-4000-8000-000000000055'::uuid, 'acde2000-0000-4000-8000-000000000007'::uuid, 'acde0000-0000-4000-8000-000000000008'::uuid, 'The product walkthrough helped everyone explain the same story.', 7),
    ('acde3000-0000-4000-8000-000000000056'::uuid, 'acde2000-0000-4000-8000-000000000007'::uuid, 'acde0000-0000-4000-8000-000000000009'::uuid, 'Our cross-team pairing session resolved the integration questions.', 8),
    ('acde3000-0000-4000-8000-000000000057'::uuid, 'acde2000-0000-4000-8000-000000000008'::uuid, 'acde0000-0000-4000-8000-000000000002'::uuid, 'The on-call handoff still needs an explicit backup person.', 1),
    ('acde3000-0000-4000-8000-000000000058'::uuid, 'acde2000-0000-4000-8000-000000000008'::uuid, 'acde0000-0000-4000-8000-000000000003'::uuid, 'The largest customer dataset has not been exercised yet.', 2),
    ('acde3000-0000-4000-8000-000000000059'::uuid, 'acde2000-0000-4000-8000-000000000008'::uuid, 'acde0000-0000-4000-8000-000000000004'::uuid, 'The keyboard-only journey needs one more full pass.', 3),
    ('acde3000-0000-4000-8000-000000000060'::uuid, 'acde2000-0000-4000-8000-000000000008'::uuid, 'acde0000-0000-4000-8000-000000000005'::uuid, 'A few launch tasks depend on the same two people.', 4),
    ('acde3000-0000-4000-8000-000000000061'::uuid, 'acde2000-0000-4000-8000-000000000008'::uuid, 'acde0000-0000-4000-8000-000000000006'::uuid, 'Some alerts do not have a linked runbook.', 5),
    ('acde3000-0000-4000-8000-000000000062'::uuid, 'acde2000-0000-4000-8000-000000000008'::uuid, 'acde0000-0000-4000-8000-000000000007'::uuid, 'I am concerned about after-hours work becoming the default.', 6),
    ('acde3000-0000-4000-8000-000000000063'::uuid, 'acde2000-0000-4000-8000-000000000008'::uuid, 'acde0000-0000-4000-8000-000000000008'::uuid, 'The support FAQ does not cover account recovery yet.', 7),
    ('acde3000-0000-4000-8000-000000000064'::uuid, 'acde2000-0000-4000-8000-000000000008'::uuid, 'acde0000-0000-4000-8000-000000000009'::uuid, 'The final external dependency does not have a confirmed date.', 8),
    ('acde3000-0000-4000-8000-000000000065'::uuid, 'acde2000-0000-4000-8000-000000000009'::uuid, 'acde0000-0000-4000-8000-000000000002'::uuid, 'Publish an on-call rota with a named backup for every shift.', 1),
    ('acde3000-0000-4000-8000-000000000066'::uuid, 'acde2000-0000-4000-8000-000000000009'::uuid, 'acde0000-0000-4000-8000-000000000003'::uuid, 'Schedule a production-sized rehearsal before launch day.', 2),
    ('acde3000-0000-4000-8000-000000000067'::uuid, 'acde2000-0000-4000-8000-000000000009'::uuid, 'acde0000-0000-4000-8000-000000000004'::uuid, 'Pair on a keyboard and screen-reader walkthrough.', 3),
    ('acde3000-0000-4000-8000-000000000068'::uuid, 'acde2000-0000-4000-8000-000000000009'::uuid, 'acde0000-0000-4000-8000-000000000005'::uuid, 'Share ownership of the highest-risk launch tasks.', 4),
    ('acde3000-0000-4000-8000-000000000069'::uuid, 'acde2000-0000-4000-8000-000000000009'::uuid, 'acde0000-0000-4000-8000-000000000006'::uuid, 'Link a short runbook from each actionable alert.', 5),
    ('acde3000-0000-4000-8000-000000000070'::uuid, 'acde2000-0000-4000-8000-000000000009'::uuid, 'acde0000-0000-4000-8000-000000000007'::uuid, 'Agree on a sustainable launch-week schedule and recovery time.', 6),
    ('acde3000-0000-4000-8000-000000000071'::uuid, 'acde2000-0000-4000-8000-000000000009'::uuid, 'acde0000-0000-4000-8000-000000000008'::uuid, 'Run a support rehearsal using the account recovery flow.', 7),
    ('acde3000-0000-4000-8000-000000000072'::uuid, 'acde2000-0000-4000-8000-000000000009'::uuid, 'acde0000-0000-4000-8000-000000000009'::uuid, 'Prepare a fallback plan for the external dependency.', 8)
  ) AS demo(id, question_id, author_id, text, position)
  JOIN public.retro_questions parent ON parent.id=demo.question_id
  WHERE NOT EXISTS (SELECT 1 FROM public.retro_answers existing WHERE existing.id=demo.id);

  INSERT INTO public.retro_topics(id, question_id, name)
  SELECT demo.id, demo.question_id, demo.name FROM (VALUES
    ('acde4000-0000-4000-8000-000000000001'::uuid, 'acde2000-0000-4000-8000-000000000001'::uuid, 'Teamwork'),
    ('acde4000-0000-4000-8000-000000000002'::uuid, 'acde2000-0000-4000-8000-000000000001'::uuid, 'Delivery'),
    ('acde4000-0000-4000-8000-000000000003'::uuid, 'acde2000-0000-4000-8000-000000000002'::uuid, 'Feedback loops'),
    ('acde4000-0000-4000-8000-000000000004'::uuid, 'acde2000-0000-4000-8000-000000000002'::uuid, 'Tooling'),
    ('acde4000-0000-4000-8000-000000000005'::uuid, 'acde2000-0000-4000-8000-000000000003'::uuid, 'Experiments'),
    ('acde4000-0000-4000-8000-000000000006'::uuid, 'acde2000-0000-4000-8000-000000000003'::uuid, 'Ways of working'),
    ('acde4000-0000-4000-8000-000000000007'::uuid, 'acde2000-0000-4000-8000-000000000004'::uuid, 'Teamwork'),
    ('acde4000-0000-4000-8000-000000000008'::uuid, 'acde2000-0000-4000-8000-000000000004'::uuid, 'Delivery'),
    ('acde4000-0000-4000-8000-000000000009'::uuid, 'acde2000-0000-4000-8000-000000000005'::uuid, 'Feedback loops'),
    ('acde4000-0000-4000-8000-000000000010'::uuid, 'acde2000-0000-4000-8000-000000000005'::uuid, 'Tooling'),
    ('acde4000-0000-4000-8000-000000000011'::uuid, 'acde2000-0000-4000-8000-000000000006'::uuid, 'Experiments'),
    ('acde4000-0000-4000-8000-000000000012'::uuid, 'acde2000-0000-4000-8000-000000000006'::uuid, 'Ways of working'),
    ('acde4000-0000-4000-8000-000000000013'::uuid, 'acde2000-0000-4000-8000-000000000007'::uuid, 'Teamwork'),
    ('acde4000-0000-4000-8000-000000000014'::uuid, 'acde2000-0000-4000-8000-000000000007'::uuid, 'Delivery'),
    ('acde4000-0000-4000-8000-000000000015'::uuid, 'acde2000-0000-4000-8000-000000000008'::uuid, 'Feedback loops'),
    ('acde4000-0000-4000-8000-000000000016'::uuid, 'acde2000-0000-4000-8000-000000000008'::uuid, 'Tooling'),
    ('acde4000-0000-4000-8000-000000000017'::uuid, 'acde2000-0000-4000-8000-000000000009'::uuid, 'Experiments'),
    ('acde4000-0000-4000-8000-000000000018'::uuid, 'acde2000-0000-4000-8000-000000000009'::uuid, 'Ways of working'),
    ('acde4000-0000-4000-8000-000000000019'::uuid, 'acde2000-0000-4000-8000-000000000001'::uuid, 'Parking lot')
  ) AS demo(id, question_id, name)
  WHERE NOT EXISTS (SELECT 1 FROM public.retro_topics existing WHERE existing.id=demo.id);

  INSERT INTO public.retro_answer_topics(answer_id, question_id, topic_id)
  SELECT demo.answer_id, demo.question_id, demo.topic_id FROM (VALUES
    ('acde3000-0000-4000-8000-000000000001'::uuid, 'acde2000-0000-4000-8000-000000000001'::uuid, 'acde4000-0000-4000-8000-000000000001'::uuid),
    ('acde3000-0000-4000-8000-000000000002'::uuid, 'acde2000-0000-4000-8000-000000000001'::uuid, 'acde4000-0000-4000-8000-000000000002'::uuid),
    ('acde3000-0000-4000-8000-000000000003'::uuid, 'acde2000-0000-4000-8000-000000000001'::uuid, 'acde4000-0000-4000-8000-000000000001'::uuid),
    ('acde3000-0000-4000-8000-000000000004'::uuid, 'acde2000-0000-4000-8000-000000000001'::uuid, 'acde4000-0000-4000-8000-000000000002'::uuid),
    ('acde3000-0000-4000-8000-000000000005'::uuid, 'acde2000-0000-4000-8000-000000000001'::uuid, 'acde4000-0000-4000-8000-000000000001'::uuid),
    ('acde3000-0000-4000-8000-000000000006'::uuid, 'acde2000-0000-4000-8000-000000000001'::uuid, 'acde4000-0000-4000-8000-000000000002'::uuid),
    ('acde3000-0000-4000-8000-000000000009'::uuid, 'acde2000-0000-4000-8000-000000000002'::uuid, 'acde4000-0000-4000-8000-000000000003'::uuid),
    ('acde3000-0000-4000-8000-000000000010'::uuid, 'acde2000-0000-4000-8000-000000000002'::uuid, 'acde4000-0000-4000-8000-000000000004'::uuid),
    ('acde3000-0000-4000-8000-000000000011'::uuid, 'acde2000-0000-4000-8000-000000000002'::uuid, 'acde4000-0000-4000-8000-000000000003'::uuid),
    ('acde3000-0000-4000-8000-000000000012'::uuid, 'acde2000-0000-4000-8000-000000000002'::uuid, 'acde4000-0000-4000-8000-000000000004'::uuid),
    ('acde3000-0000-4000-8000-000000000013'::uuid, 'acde2000-0000-4000-8000-000000000002'::uuid, 'acde4000-0000-4000-8000-000000000003'::uuid),
    ('acde3000-0000-4000-8000-000000000014'::uuid, 'acde2000-0000-4000-8000-000000000002'::uuid, 'acde4000-0000-4000-8000-000000000004'::uuid),
    ('acde3000-0000-4000-8000-000000000017'::uuid, 'acde2000-0000-4000-8000-000000000003'::uuid, 'acde4000-0000-4000-8000-000000000005'::uuid),
    ('acde3000-0000-4000-8000-000000000018'::uuid, 'acde2000-0000-4000-8000-000000000003'::uuid, 'acde4000-0000-4000-8000-000000000006'::uuid),
    ('acde3000-0000-4000-8000-000000000019'::uuid, 'acde2000-0000-4000-8000-000000000003'::uuid, 'acde4000-0000-4000-8000-000000000005'::uuid),
    ('acde3000-0000-4000-8000-000000000020'::uuid, 'acde2000-0000-4000-8000-000000000003'::uuid, 'acde4000-0000-4000-8000-000000000006'::uuid),
    ('acde3000-0000-4000-8000-000000000021'::uuid, 'acde2000-0000-4000-8000-000000000003'::uuid, 'acde4000-0000-4000-8000-000000000005'::uuid),
    ('acde3000-0000-4000-8000-000000000022'::uuid, 'acde2000-0000-4000-8000-000000000003'::uuid, 'acde4000-0000-4000-8000-000000000006'::uuid),
    ('acde3000-0000-4000-8000-000000000025'::uuid, 'acde2000-0000-4000-8000-000000000004'::uuid, 'acde4000-0000-4000-8000-000000000007'::uuid),
    ('acde3000-0000-4000-8000-000000000026'::uuid, 'acde2000-0000-4000-8000-000000000004'::uuid, 'acde4000-0000-4000-8000-000000000008'::uuid),
    ('acde3000-0000-4000-8000-000000000027'::uuid, 'acde2000-0000-4000-8000-000000000004'::uuid, 'acde4000-0000-4000-8000-000000000007'::uuid),
    ('acde3000-0000-4000-8000-000000000028'::uuid, 'acde2000-0000-4000-8000-000000000004'::uuid, 'acde4000-0000-4000-8000-000000000008'::uuid),
    ('acde3000-0000-4000-8000-000000000029'::uuid, 'acde2000-0000-4000-8000-000000000004'::uuid, 'acde4000-0000-4000-8000-000000000007'::uuid),
    ('acde3000-0000-4000-8000-000000000030'::uuid, 'acde2000-0000-4000-8000-000000000004'::uuid, 'acde4000-0000-4000-8000-000000000008'::uuid),
    ('acde3000-0000-4000-8000-000000000033'::uuid, 'acde2000-0000-4000-8000-000000000005'::uuid, 'acde4000-0000-4000-8000-000000000009'::uuid),
    ('acde3000-0000-4000-8000-000000000034'::uuid, 'acde2000-0000-4000-8000-000000000005'::uuid, 'acde4000-0000-4000-8000-000000000010'::uuid),
    ('acde3000-0000-4000-8000-000000000035'::uuid, 'acde2000-0000-4000-8000-000000000005'::uuid, 'acde4000-0000-4000-8000-000000000009'::uuid),
    ('acde3000-0000-4000-8000-000000000036'::uuid, 'acde2000-0000-4000-8000-000000000005'::uuid, 'acde4000-0000-4000-8000-000000000010'::uuid),
    ('acde3000-0000-4000-8000-000000000037'::uuid, 'acde2000-0000-4000-8000-000000000005'::uuid, 'acde4000-0000-4000-8000-000000000009'::uuid),
    ('acde3000-0000-4000-8000-000000000038'::uuid, 'acde2000-0000-4000-8000-000000000005'::uuid, 'acde4000-0000-4000-8000-000000000010'::uuid),
    ('acde3000-0000-4000-8000-000000000041'::uuid, 'acde2000-0000-4000-8000-000000000006'::uuid, 'acde4000-0000-4000-8000-000000000011'::uuid),
    ('acde3000-0000-4000-8000-000000000042'::uuid, 'acde2000-0000-4000-8000-000000000006'::uuid, 'acde4000-0000-4000-8000-000000000012'::uuid),
    ('acde3000-0000-4000-8000-000000000043'::uuid, 'acde2000-0000-4000-8000-000000000006'::uuid, 'acde4000-0000-4000-8000-000000000011'::uuid),
    ('acde3000-0000-4000-8000-000000000044'::uuid, 'acde2000-0000-4000-8000-000000000006'::uuid, 'acde4000-0000-4000-8000-000000000012'::uuid),
    ('acde3000-0000-4000-8000-000000000045'::uuid, 'acde2000-0000-4000-8000-000000000006'::uuid, 'acde4000-0000-4000-8000-000000000011'::uuid),
    ('acde3000-0000-4000-8000-000000000046'::uuid, 'acde2000-0000-4000-8000-000000000006'::uuid, 'acde4000-0000-4000-8000-000000000012'::uuid),
    ('acde3000-0000-4000-8000-000000000049'::uuid, 'acde2000-0000-4000-8000-000000000007'::uuid, 'acde4000-0000-4000-8000-000000000013'::uuid),
    ('acde3000-0000-4000-8000-000000000050'::uuid, 'acde2000-0000-4000-8000-000000000007'::uuid, 'acde4000-0000-4000-8000-000000000014'::uuid),
    ('acde3000-0000-4000-8000-000000000051'::uuid, 'acde2000-0000-4000-8000-000000000007'::uuid, 'acde4000-0000-4000-8000-000000000013'::uuid),
    ('acde3000-0000-4000-8000-000000000052'::uuid, 'acde2000-0000-4000-8000-000000000007'::uuid, 'acde4000-0000-4000-8000-000000000014'::uuid),
    ('acde3000-0000-4000-8000-000000000053'::uuid, 'acde2000-0000-4000-8000-000000000007'::uuid, 'acde4000-0000-4000-8000-000000000013'::uuid),
    ('acde3000-0000-4000-8000-000000000054'::uuid, 'acde2000-0000-4000-8000-000000000007'::uuid, 'acde4000-0000-4000-8000-000000000014'::uuid),
    ('acde3000-0000-4000-8000-000000000057'::uuid, 'acde2000-0000-4000-8000-000000000008'::uuid, 'acde4000-0000-4000-8000-000000000015'::uuid),
    ('acde3000-0000-4000-8000-000000000058'::uuid, 'acde2000-0000-4000-8000-000000000008'::uuid, 'acde4000-0000-4000-8000-000000000016'::uuid),
    ('acde3000-0000-4000-8000-000000000059'::uuid, 'acde2000-0000-4000-8000-000000000008'::uuid, 'acde4000-0000-4000-8000-000000000015'::uuid),
    ('acde3000-0000-4000-8000-000000000060'::uuid, 'acde2000-0000-4000-8000-000000000008'::uuid, 'acde4000-0000-4000-8000-000000000016'::uuid),
    ('acde3000-0000-4000-8000-000000000061'::uuid, 'acde2000-0000-4000-8000-000000000008'::uuid, 'acde4000-0000-4000-8000-000000000015'::uuid),
    ('acde3000-0000-4000-8000-000000000062'::uuid, 'acde2000-0000-4000-8000-000000000008'::uuid, 'acde4000-0000-4000-8000-000000000016'::uuid),
    ('acde3000-0000-4000-8000-000000000065'::uuid, 'acde2000-0000-4000-8000-000000000009'::uuid, 'acde4000-0000-4000-8000-000000000017'::uuid),
    ('acde3000-0000-4000-8000-000000000066'::uuid, 'acde2000-0000-4000-8000-000000000009'::uuid, 'acde4000-0000-4000-8000-000000000018'::uuid),
    ('acde3000-0000-4000-8000-000000000067'::uuid, 'acde2000-0000-4000-8000-000000000009'::uuid, 'acde4000-0000-4000-8000-000000000017'::uuid),
    ('acde3000-0000-4000-8000-000000000068'::uuid, 'acde2000-0000-4000-8000-000000000009'::uuid, 'acde4000-0000-4000-8000-000000000018'::uuid),
    ('acde3000-0000-4000-8000-000000000069'::uuid, 'acde2000-0000-4000-8000-000000000009'::uuid, 'acde4000-0000-4000-8000-000000000017'::uuid),
    ('acde3000-0000-4000-8000-000000000070'::uuid, 'acde2000-0000-4000-8000-000000000009'::uuid, 'acde4000-0000-4000-8000-000000000018'::uuid)
  ) AS demo(answer_id, question_id, topic_id)
  WHERE NOT EXISTS (SELECT 1 FROM public.retro_answer_topics existing WHERE existing.answer_id=demo.answer_id);

  -- Close one historical session only after its content is complete. Its cards
  -- remain frozen, while facilitator grouping continues to work as usual.
  UPDATE public.retro_sessions SET ended=true
  WHERE id='acde1000-0000-4000-8000-000000000001'::uuid AND NOT ended;
END;
$seed$;
