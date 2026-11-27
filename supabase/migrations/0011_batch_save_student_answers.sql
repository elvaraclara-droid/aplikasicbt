-- =============================================================================
-- 0011_batch_save_student_answers.sql
-- Adds single-transaction batch RPC for Hybrid Batch answer syncing so
-- multiple queued answers execute in 1 PostgREST round-trip and trigger
-- only 1 exam_attempts update per batch.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.save_student_answers_batch(
  p_school_id UUID,
  p_exam_id UUID,
  p_session_id UUID,
  p_student_id UUID,
  p_attempt_id UUID,
  p_items JSONB,
  p_actor_id UUID
)
RETURNS TABLE (
  question_id UUID,
  answer_id UUID,
  persisted_version INTEGER,
  conflict_detected BOOLEAN,
  saved_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_existing RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_answer_id UUID;
  v_version INTEGER;
  v_question_id UUID;
  v_selected_option_id UUID;
  v_selected_option_ids UUID[];
  v_statement_answers JSONB;
  v_essay_answer TEXT;
  v_is_flagged BOOLEAN;
  v_is_answered BOOLEAN;
  v_answer_version INTEGER;
  v_idempotency_key VARCHAR(128);
  v_client_updated_at TIMESTAMPTZ;
  v_updated_attempt BOOLEAN := FALSE;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_question_id := (v_item->>'question_id')::UUID;
    v_selected_option_id := NULLIF(v_item->>'selected_option_id', '')::UUID;
    v_selected_option_ids := ARRAY(
      SELECT jsonb_array_elements_text(COALESCE(v_item->'selected_option_ids', '[]'::jsonb))
    )::UUID[];
    v_statement_answers := COALESCE(v_item->'statement_answers', '{}'::jsonb);
    v_essay_answer := v_item->>'essay_answer';
    v_is_flagged := COALESCE((v_item->>'is_flagged')::BOOLEAN, FALSE);
    v_is_answered := COALESCE((v_item->>'is_answered')::BOOLEAN, FALSE);
    v_answer_version := GREATEST(1, COALESCE((v_item->>'answer_version')::INTEGER, 1));
    v_idempotency_key := LEFT(COALESCE(v_item->>'idempotency_key', ''), 128);
    v_client_updated_at := COALESCE(NULLIF(v_item->>'client_updated_at', '')::TIMESTAMPTZ, v_now);

    -- 1. Idempotency key replay check
    SELECT sa.id, sa.answer_version, sa.server_timestamp
    INTO v_existing
    FROM public.student_answers sa
    WHERE sa.attempt_id = p_attempt_id
      AND sa.idempotency_key = v_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      question_id := v_question_id;
      answer_id := v_existing.id;
      persisted_version := v_existing.answer_version;
      conflict_detected := FALSE;
      saved_at := v_existing.server_timestamp;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- 2. Lock target answer row to prevent stale overwrites
    SELECT sa.id, sa.answer_version, sa.server_timestamp
    INTO v_existing
    FROM public.student_answers sa
    WHERE sa.attempt_id = p_attempt_id
      AND sa.question_id = v_question_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_answer_version < v_existing.answer_version THEN
        question_id := v_question_id;
        answer_id := v_existing.id;
        persisted_version := v_existing.answer_version;
        conflict_detected := TRUE;
        saved_at := v_existing.server_timestamp;
        RETURN NEXT;
        CONTINUE;
      END IF;

      UPDATE public.student_answers
      SET
        selected_option_id = v_selected_option_id,
        selected_option_ids = COALESCE(v_selected_option_ids, '{}'),
        statement_answers = v_statement_answers,
        essay_answer = v_essay_answer,
        is_flagged = v_is_flagged,
        is_answered = v_is_answered,
        answer_version = GREATEST(v_existing.answer_version + 1, v_answer_version),
        idempotency_key = v_idempotency_key,
        client_updated_at = v_client_updated_at,
        server_timestamp = v_now,
        updated_by = p_actor_id
      WHERE id = v_existing.id
      RETURNING id, answer_version INTO v_answer_id, v_version;
    ELSE
      INSERT INTO public.student_answers (
        school_id, exam_id, session_id, student_id, attempt_id, question_id,
        selected_option_id, selected_option_ids, statement_answers, essay_answer,
        is_flagged, is_answered, answer_version, idempotency_key,
        client_updated_at, server_timestamp, created_by, updated_by
      )
      VALUES (
        p_school_id, p_exam_id, p_session_id, p_student_id, p_attempt_id, v_question_id,
        v_selected_option_id, COALESCE(v_selected_option_ids, '{}'), v_statement_answers, v_essay_answer,
        v_is_flagged, v_is_answered, v_answer_version, v_idempotency_key,
        v_client_updated_at, v_now, p_actor_id, p_actor_id
      )
      RETURNING id, answer_version INTO v_answer_id, v_version;
    END IF;

    v_updated_attempt := TRUE;
    question_id := v_question_id;
    answer_id := v_answer_id;
    persisted_version := v_version;
    conflict_detected := FALSE;
    saved_at := v_now;
    RETURN NEXT;
  END LOOP;

  IF v_updated_attempt THEN
    UPDATE public.exam_attempts
    SET last_saved_at = v_now,
        last_heartbeat_at = v_now,
        server_timestamp = v_now
    WHERE id = p_attempt_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_student_answers_batch(
  UUID, UUID, UUID, UUID, UUID, JSONB, UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_student_answers_batch(
  UUID, UUID, UUID, UUID, UUID, JSONB, UUID
) TO service_role;
