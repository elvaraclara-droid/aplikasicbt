-- =============================================================================
-- 0009_security_functions_and_indexes.sql
-- Hardens SECURITY DEFINER functions, creates unexposed private RLS schema,
-- and adds covering indexes on hot operational foreign keys.
-- =============================================================================

ALTER FUNCTION public.set_updated_at() SET search_path = public;

REVOKE ALL ON FUNCTION public.save_student_answer_atomic(
  UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID[], JSONB, TEXT,
  BOOLEAN, BOOLEAN, INTEGER, VARCHAR, TIMESTAMPTZ, UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_student_answer_atomic(
  UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID[], JSONB, TEXT,
  BOOLEAN, BOOLEAN, INTEGER, VARCHAR, TIMESTAMPTZ, UUID
) TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_expired_face_records() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_face_records() TO service_role;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = (SELECT auth.uid()) AND is_active = TRUE LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.current_school_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT school_id FROM public.profiles WHERE id = (SELECT auth.uid()) AND is_active = TRUE LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.current_student_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.students WHERE profile_id = (SELECT auth.uid()) LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.current_teacher_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.teachers WHERE profile_id = (SELECT auth.uid()) LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT role = 'super_admin' FROM public.profiles WHERE id = (SELECT auth.uid()) AND is_active = TRUE), FALSE);
$$;

CREATE OR REPLACE FUNCTION private.is_school_admin_of(p_school_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role = 'school_admin' AND school_id = p_school_id
     FROM public.profiles WHERE id = (SELECT auth.uid()) AND is_active = TRUE),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION private.is_teacher_for_subject(p_school_id UUID, p_subject_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teacher_subjects ts
    JOIN public.teachers t ON t.id = ts.teacher_id
    WHERE t.profile_id = (SELECT auth.uid())
      AND ts.school_id = p_school_id
      AND ts.subject_id = p_subject_id
      AND ts.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION private.is_supervisor_for_exam(p_exam_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.exam_supervisors es
    WHERE es.exam_id = p_exam_id
      AND es.supervisor_id = (SELECT auth.uid())
      AND es.status = 'assigned'
  );
$$;

CREATE OR REPLACE FUNCTION private.is_student_enrolled_in_exam(p_exam_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.exam_session_students ess
    JOIN public.students s ON s.id = ess.student_id
    WHERE ess.exam_id = p_exam_id
      AND s.profile_id = (SELECT auth.uid())
      AND ess.status = 'enrolled'
  );
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_exam_attempts_school_id ON public.exam_attempts(school_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_session_id ON public.exam_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_token_id ON public.exam_attempts(token_id);

CREATE INDEX IF NOT EXISTS idx_student_answers_school_id ON public.student_answers(school_id);
CREATE INDEX IF NOT EXISTS idx_student_answers_exam_id ON public.student_answers(exam_id);
CREATE INDEX IF NOT EXISTS idx_student_answers_session_id ON public.student_answers(session_id);
CREATE INDEX IF NOT EXISTS idx_student_answers_student_id ON public.student_answers(student_id);
CREATE INDEX IF NOT EXISTS idx_student_answers_question_id ON public.student_answers(question_id);

CREATE INDEX IF NOT EXISTS idx_answer_details_exam_id ON public.answer_details(exam_id);
CREATE INDEX IF NOT EXISTS idx_answer_details_question_id ON public.answer_details(question_id);
CREATE INDEX IF NOT EXISTS idx_answer_details_student_id ON public.answer_details(student_id);
CREATE INDEX IF NOT EXISTS idx_answer_details_student_answer_id ON public.answer_details(student_answer_id);

CREATE INDEX IF NOT EXISTS idx_exam_results_session_id ON public.exam_results(session_id);
CREATE INDEX IF NOT EXISTS idx_exam_results_student_id ON public.exam_results(student_id);

CREATE INDEX IF NOT EXISTS idx_exam_security_events_session_id ON public.exam_security_events(session_id);
CREATE INDEX IF NOT EXISTS idx_exam_security_events_student_id ON public.exam_security_events(student_id);

CREATE INDEX IF NOT EXISTS idx_exam_activity_logs_session_id ON public.exam_activity_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_exam_activity_logs_student_id ON public.exam_activity_logs(student_id);

CREATE INDEX IF NOT EXISTS idx_supervisor_actions_student_id ON public.supervisor_actions(student_id);
CREATE INDEX IF NOT EXISTS idx_supervisor_actions_supervisor_id ON public.supervisor_actions(supervisor_id);

CREATE INDEX IF NOT EXISTS idx_face_verification_attempt_id ON public.face_verification_records(attempt_id);
CREATE INDEX IF NOT EXISTS idx_face_verification_student_id ON public.face_verification_records(student_id);

CREATE INDEX IF NOT EXISTS idx_exam_session_students_student_id ON public.exam_session_students(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_questions_question_id ON public.exam_questions(question_id);
CREATE INDEX IF NOT EXISTS idx_exam_tokens_session_id ON public.exam_tokens(session_id);
CREATE INDEX IF NOT EXISTS idx_exams_subject_id ON public.exams(subject_id);
CREATE INDEX IF NOT EXISTS idx_exams_class_id ON public.exams(class_id);

CREATE INDEX IF NOT EXISTS idx_manual_grading_answer_detail_id ON public.manual_grading(answer_detail_id);
CREATE INDEX IF NOT EXISTS idx_manual_grading_question_id ON public.manual_grading(question_id);
CREATE INDEX IF NOT EXISTS idx_manual_grading_student_id ON public.manual_grading(student_id);
