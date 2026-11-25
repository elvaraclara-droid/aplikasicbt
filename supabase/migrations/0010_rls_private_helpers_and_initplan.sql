-- =============================================================================
-- 0010_rls_private_helpers_and_initplan.sql
-- Switches all RLS policies in public & storage to private.* helpers,
-- TO authenticated, and (SELECT auth.uid()) initplan expressions, and
-- revokes anon/authenticated execute on legacy public SECURITY DEFINER helpers.
-- =============================================================================

-- SCHOOLS
ALTER POLICY schools_select ON public.schools
  TO authenticated
  USING (private.is_super_admin() OR id = private.current_school_id());
ALTER POLICY schools_manage_super ON public.schools
  TO authenticated
  USING (private.is_super_admin())
  WITH CHECK (private.is_super_admin());

-- SCHOOL SETTINGS
ALTER POLICY school_settings_select ON public.school_settings
  TO authenticated
  USING (private.is_super_admin() OR school_id = private.current_school_id());
ALTER POLICY school_settings_manage ON public.school_settings
  TO authenticated
  USING (private.is_super_admin() OR private.is_school_admin_of(school_id))
  WITH CHECK (private.is_super_admin() OR private.is_school_admin_of(school_id));

-- PROFILES
ALTER POLICY profiles_select ON public.profiles
  TO authenticated
  USING (
    private.is_super_admin()
    OR id = (SELECT auth.uid())
    OR (private.is_school_admin_of(school_id) AND role <> 'super_admin')
    OR (private.current_user_role() IN ('teacher', 'supervisor') AND school_id = private.current_school_id() AND role = 'student')
  );
ALTER POLICY profiles_update_own ON public.profiles
  TO authenticated
  USING (private.is_super_admin() OR private.is_school_admin_of(school_id))
  WITH CHECK (private.is_super_admin() OR (private.is_school_admin_of(school_id) AND role <> 'super_admin'));

-- ACADEMIC YEARS, SEMESTERS, CLASSES, SUBJECTS
ALTER POLICY academic_years_read ON public.academic_years
  TO authenticated
  USING (private.is_super_admin() OR school_id = private.current_school_id());
ALTER POLICY academic_years_write ON public.academic_years
  TO authenticated
  USING (private.is_super_admin() OR private.is_school_admin_of(school_id))
  WITH CHECK (private.is_super_admin() OR private.is_school_admin_of(school_id));

ALTER POLICY semesters_read ON public.semesters
  TO authenticated
  USING (private.is_super_admin() OR school_id = private.current_school_id());
ALTER POLICY semesters_write ON public.semesters
  TO authenticated
  USING (private.is_super_admin() OR private.is_school_admin_of(school_id))
  WITH CHECK (private.is_super_admin() OR private.is_school_admin_of(school_id));

ALTER POLICY classes_read ON public.classes
  TO authenticated
  USING (private.is_super_admin() OR school_id = private.current_school_id());
ALTER POLICY classes_write ON public.classes
  TO authenticated
  USING (private.is_super_admin() OR private.is_school_admin_of(school_id))
  WITH CHECK (private.is_super_admin() OR private.is_school_admin_of(school_id));

ALTER POLICY subjects_read ON public.subjects
  TO authenticated
  USING (private.is_super_admin() OR school_id = private.current_school_id());
ALTER POLICY subjects_write ON public.subjects
  TO authenticated
  USING (private.is_super_admin() OR private.is_school_admin_of(school_id))
  WITH CHECK (private.is_super_admin() OR private.is_school_admin_of(school_id));

-- STUDENTS, TEACHERS, TEACHER_SUBJECTS
ALTER POLICY students_read ON public.students
  TO authenticated
  USING (
    private.is_super_admin()
    OR profile_id = (SELECT auth.uid())
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() IN ('teacher', 'supervisor') AND school_id = private.current_school_id())
  );
ALTER POLICY students_write ON public.students
  TO authenticated
  USING (private.is_super_admin() OR private.is_school_admin_of(school_id))
  WITH CHECK (private.is_super_admin() OR private.is_school_admin_of(school_id));

ALTER POLICY teachers_read ON public.teachers
  TO authenticated
  USING (private.is_super_admin() OR private.is_school_admin_of(school_id) OR profile_id = (SELECT auth.uid()));
ALTER POLICY teachers_write ON public.teachers
  TO authenticated
  USING (private.is_super_admin() OR private.is_school_admin_of(school_id))
  WITH CHECK (private.is_super_admin() OR private.is_school_admin_of(school_id));

ALTER POLICY teacher_subjects_read ON public.teacher_subjects
  TO authenticated
  USING (private.is_super_admin() OR private.is_school_admin_of(school_id) OR teacher_id = private.current_teacher_id());
ALTER POLICY teacher_subjects_write ON public.teacher_subjects
  TO authenticated
  USING (private.is_super_admin() OR private.is_school_admin_of(school_id))
  WITH CHECK (private.is_super_admin() OR private.is_school_admin_of(school_id));

-- QUESTION CATEGORIES & QUESTION BANKS
ALTER POLICY q_categories_read ON public.question_categories
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id())
  );
ALTER POLICY q_categories_write ON public.question_categories
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id())
  )
  WITH CHECK (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id())
  );

ALTER POLICY q_banks_read ON public.question_banks
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id() AND (
      teacher_id = private.current_teacher_id()
      OR is_shared = TRUE
      OR private.is_teacher_for_subject(school_id, subject_id)
    ))
  );
ALTER POLICY q_banks_write ON public.question_banks
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id() AND (teacher_id = private.current_teacher_id() OR private.is_teacher_for_subject(school_id, subject_id)))
  )
  WITH CHECK (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id() AND private.is_teacher_for_subject(school_id, subject_id))
  );

-- QUESTIONS & ANSWER KEY TABLES
ALTER POLICY questions_staff_read ON public.questions
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id() AND (created_by = (SELECT auth.uid()) OR private.is_teacher_for_subject(school_id, subject_id)))
  );
ALTER POLICY questions_staff_write ON public.questions
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id() AND (created_by = (SELECT auth.uid()) OR private.is_teacher_for_subject(school_id, subject_id)))
  )
  WITH CHECK (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id() AND private.is_teacher_for_subject(school_id, subject_id))
  );

ALTER POLICY question_options_staff_only ON public.question_options
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id() AND EXISTS (
      SELECT 1 FROM public.questions q
      WHERE q.id = question_id AND (q.created_by = (SELECT auth.uid()) OR private.is_teacher_for_subject(q.school_id, q.subject_id))
    ))
  )
  WITH CHECK (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id() AND EXISTS (
      SELECT 1 FROM public.questions q
      WHERE q.id = question_id AND (q.created_by = (SELECT auth.uid()) OR private.is_teacher_for_subject(q.school_id, q.subject_id))
    ))
  );

ALTER POLICY question_statements_staff_only ON public.question_statements
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id() AND EXISTS (
      SELECT 1 FROM public.questions q
      WHERE q.id = question_id AND (q.created_by = (SELECT auth.uid()) OR private.is_teacher_for_subject(q.school_id, q.subject_id))
    ))
  )
  WITH CHECK (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id() AND EXISTS (
      SELECT 1 FROM public.questions q
      WHERE q.id = question_id AND (q.created_by = (SELECT auth.uid()) OR private.is_teacher_for_subject(q.school_id, q.subject_id))
    ))
  );

ALTER POLICY question_media_staff_only ON public.question_media
  TO authenticated
  USING (private.is_super_admin() OR private.is_school_admin_of(school_id) OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id()))
  WITH CHECK (private.is_super_admin() OR private.is_school_admin_of(school_id) OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id()));

-- EXAMS, SESSIONS, ENROLLMENTS, SUPERVISORS, TOKENS
ALTER POLICY exams_select ON public.exams
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id() AND (created_by = (SELECT auth.uid()) OR private.is_teacher_for_subject(school_id, subject_id)))
    OR (private.current_user_role() = 'supervisor' AND private.is_supervisor_for_exam(id))
    OR (private.current_user_role() = 'student' AND private.is_student_enrolled_in_exam(id))
  );
ALTER POLICY exams_write ON public.exams
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id() AND (created_by = (SELECT auth.uid()) OR private.is_teacher_for_subject(school_id, subject_id)))
  )
  WITH CHECK (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id() AND private.is_teacher_for_subject(school_id, subject_id))
  );

ALTER POLICY exam_questions_staff ON public.exam_questions
  TO authenticated
  USING (private.is_super_admin() OR private.is_school_admin_of(school_id) OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id()))
  WITH CHECK (private.is_super_admin() OR private.is_school_admin_of(school_id) OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id()));

ALTER POLICY exam_sessions_select ON public.exam_sessions
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id())
    OR (private.current_user_role() = 'supervisor' AND private.is_supervisor_for_exam(exam_id))
    OR (private.current_user_role() = 'student' AND private.is_student_enrolled_in_exam(exam_id))
  );
ALTER POLICY exam_sessions_write ON public.exam_sessions
  TO authenticated
  USING (private.is_super_admin() OR private.is_school_admin_of(school_id) OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id()))
  WITH CHECK (private.is_super_admin() OR private.is_school_admin_of(school_id) OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id()));

ALTER POLICY exam_session_students_select ON public.exam_session_students
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR student_id = private.current_student_id()
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id())
    OR (private.current_user_role() = 'supervisor' AND private.is_supervisor_for_exam(exam_id))
  );
ALTER POLICY exam_session_students_write ON public.exam_session_students
  TO authenticated
  USING (private.is_super_admin() OR private.is_school_admin_of(school_id) OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id()))
  WITH CHECK (private.is_super_admin() OR private.is_school_admin_of(school_id) OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id()));

ALTER POLICY exam_supervisors_select ON public.exam_supervisors
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR supervisor_id = (SELECT auth.uid())
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id())
  );
ALTER POLICY exam_supervisors_write ON public.exam_supervisors
  TO authenticated
  USING (private.is_super_admin() OR private.is_school_admin_of(school_id))
  WITH CHECK (private.is_super_admin() OR private.is_school_admin_of(school_id));

ALTER POLICY exam_tokens_admin_only ON public.exam_tokens
  TO authenticated
  USING (private.is_super_admin() OR private.is_school_admin_of(school_id))
  WITH CHECK (private.is_super_admin() OR private.is_school_admin_of(school_id));

-- ATTEMPTS, STUDENT ANSWERS, ANSWER DETAILS
ALTER POLICY exam_attempts_select ON public.exam_attempts
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR student_id = private.current_student_id()
    OR (private.current_user_role() = 'supervisor' AND private.is_supervisor_for_exam(exam_id))
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id() AND EXISTS (
      SELECT 1 FROM public.exams e WHERE e.id = exam_id AND (e.created_by = (SELECT auth.uid()) OR private.is_teacher_for_subject(e.school_id, e.subject_id))
    ))
  );

ALTER POLICY student_answers_select ON public.student_answers
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR student_id = private.current_student_id()
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id() AND EXISTS (
      SELECT 1 FROM public.exams e WHERE e.id = exam_id AND (e.created_by = (SELECT auth.uid()) OR private.is_teacher_for_subject(e.school_id, e.subject_id))
    ))
  );

ALTER POLICY answer_details_select ON public.answer_details
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id() AND EXISTS (
      SELECT 1 FROM public.exams e WHERE e.id = exam_id AND (e.created_by = (SELECT auth.uid()) OR private.is_teacher_for_subject(e.school_id, e.subject_id))
    ))
    OR (student_id = private.current_student_id() AND EXISTS (
      SELECT 1 FROM public.exams e WHERE e.id = exam_id AND e.results_published = TRUE
    ))
  );

-- MONITORING, SECURITY, SUPERVISOR ACTIONS, ANNOUNCEMENTS, FACE VERIFICATION
ALTER POLICY exam_activity_logs_select ON public.exam_activity_logs
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'supervisor' AND private.is_supervisor_for_exam(exam_id))
  );

ALTER POLICY exam_security_events_select ON public.exam_security_events
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'supervisor' AND private.is_supervisor_for_exam(exam_id))
  );

ALTER POLICY supervisor_actions_select ON public.supervisor_actions
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'supervisor' AND private.is_supervisor_for_exam(exam_id))
    OR student_id = private.current_student_id()
  );

ALTER POLICY supervisor_override_logs_select ON public.supervisor_override_logs
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'supervisor' AND private.is_supervisor_for_exam(exam_id))
  );

ALTER POLICY exam_announcements_select ON public.exam_announcements
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'supervisor' AND private.is_supervisor_for_exam(exam_id))
    OR (private.current_user_role() = 'student' AND private.is_student_enrolled_in_exam(exam_id))
  );

ALTER POLICY face_verification_select ON public.face_verification_records
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR student_id = private.current_student_id()
    OR (private.current_user_role() = 'supervisor' AND private.is_supervisor_for_exam(exam_id))
  );

-- GRADING, RESULTS, EXPORTS
ALTER POLICY exam_results_select ON public.exam_results
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (student_id = private.current_student_id() AND is_published = TRUE)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id() AND EXISTS (
      SELECT 1 FROM public.exams e WHERE e.id = exam_id AND (e.created_by = (SELECT auth.uid()) OR private.is_teacher_for_subject(e.school_id, e.subject_id))
    ))
  );

ALTER POLICY manual_grading_staff ON public.manual_grading
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id() AND EXISTS (
      SELECT 1 FROM public.exams e WHERE e.id = exam_id AND (e.created_by = (SELECT auth.uid()) OR private.is_teacher_for_subject(e.school_id, e.subject_id))
    ))
  )
  WITH CHECK (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id() AND EXISTS (
      SELECT 1 FROM public.exams e WHERE e.id = exam_id AND (e.created_by = (SELECT auth.uid()) OR private.is_teacher_for_subject(e.school_id, e.subject_id))
    ))
  );

ALTER POLICY grading_history_select ON public.grading_history
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND school_id = private.current_school_id())
  );

ALTER POLICY report_exports_select ON public.report_exports
  TO authenticated
  USING (
    private.is_super_admin()
    OR private.is_school_admin_of(school_id)
    OR (private.current_user_role() = 'teacher' AND created_by = (SELECT auth.uid()))
  );

-- AUDIT, SYSTEM SETTINGS, BACKUPS, USER SESSIONS, NOTIFICATIONS
ALTER POLICY audit_logs_select ON public.audit_logs
  TO authenticated
  USING (private.is_super_admin() OR private.is_school_admin_of(school_id));

ALTER POLICY system_settings_select ON public.system_settings
  TO authenticated
  USING (private.is_super_admin() OR is_public = TRUE);
ALTER POLICY system_settings_write ON public.system_settings
  TO authenticated
  USING (private.is_super_admin())
  WITH CHECK (private.is_super_admin());

ALTER POLICY backup_records_super ON public.backup_records
  TO authenticated
  USING (private.is_super_admin())
  WITH CHECK (private.is_super_admin());

ALTER POLICY user_sessions_select ON public.user_sessions
  TO authenticated
  USING (private.is_super_admin() OR user_id = (SELECT auth.uid()) OR private.is_school_admin_of(school_id));

ALTER POLICY notifications_own ON public.notifications
  TO authenticated
  USING (private.is_super_admin() OR recipient_id = (SELECT auth.uid()))
  WITH CHECK (private.is_super_admin() OR recipient_id = (SELECT auth.uid()));

ALTER POLICY auth_rate_limits_none ON public.auth_rate_limits
  TO authenticated
  USING (FALSE);

-- STORAGE OBJECTS
ALTER POLICY storage_question_media_staff ON storage.objects
  TO authenticated
  USING (
    bucket_id IN ('question-images', 'question-audio', 'question-videos', 'exam-attachments')
    AND (
      private.is_super_admin()
      OR (
        private.current_user_role() IN ('school_admin', 'teacher')
        AND (storage.foldername(name))[1] = private.current_school_id()::TEXT
      )
    )
  )
  WITH CHECK (
    bucket_id IN ('question-images', 'question-audio', 'question-videos', 'exam-attachments')
    AND (
      private.is_super_admin()
      OR (
        private.current_user_role() IN ('school_admin', 'teacher')
        AND (storage.foldername(name))[1] = private.current_school_id()::TEXT
      )
    )
  );

ALTER POLICY storage_student_uploads_policy ON storage.objects
  TO authenticated
  USING (
    bucket_id = 'student-uploads'
    AND (
      private.is_super_admin()
      OR (
        private.current_user_role() IN ('school_admin', 'supervisor')
        AND (storage.foldername(name))[1] = private.current_school_id()::TEXT
      )
      OR (
        private.current_user_role() = 'student'
        AND (storage.foldername(name))[1] = private.current_school_id()::TEXT
        AND (storage.foldername(name))[2] = private.current_student_id()::TEXT
      )
    )
  );

ALTER POLICY storage_report_exports_read ON storage.objects
  TO authenticated
  USING (
    bucket_id = 'report-exports'
    AND (
      private.is_super_admin()
      OR (
        private.current_user_role() IN ('school_admin', 'teacher')
        AND (storage.foldername(name))[1] = private.current_school_id()::TEXT
      )
    )
  );

ALTER POLICY storage_school_assets_manage ON storage.objects
  TO authenticated
  USING (
    bucket_id = 'school-assets'
    AND (
      private.is_super_admin()
      OR (
        private.current_user_role() = 'school_admin'
        AND (storage.foldername(name))[1] = private.current_school_id()::TEXT
      )
    )
  )
  WITH CHECK (
    bucket_id = 'school-assets'
    AND (
      private.is_super_admin()
      OR (
        private.current_user_role() = 'school_admin'
        AND (storage.foldername(name))[1] = private.current_school_id()::TEXT
      )
    )
  );

-- REVOKE legacy public RLS helper execute permissions from PUBLIC, anon, authenticated
REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_school_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_student_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_teacher_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_school_admin_of(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_teacher_for_subject(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_supervisor_for_exam(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_student_enrolled_in_exam(UUID) FROM PUBLIC, anon, authenticated;
