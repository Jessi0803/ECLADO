import { supabase } from './supabase.js';
import { optimizeProductImageFile } from '../utils/imageOptimization.js';
import { COURSE_UUID, isCourseSlug } from '../domain/courseUrls.js';

const images = supabase.storage.from('course-images');

async function courseRpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

export async function getPublishedCourses(key = null) {
  let id = key;
  if (key && !COURSE_UUID.test(key)) {
    if (!isCourseSlug(key)) return [];
    id = await courseRpc('resolve_course_slug', { p_slug: key });
    if (!id) return [];
  }
  return courseRpc('get_published_courses', { p_id: id });
}
export const getAdminCourses = () => courseRpc('get_admin_courses');
export const saveCourse = args => courseRpc('save_course_with_slug', args);

export async function downloadCourseImage(path) {
  const { data, error } = await images.download(path, {}, { cache: 'no-store' });
  if (error) throw error;
  return data;
}

export async function uploadCourseImage(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error('請選擇 20 MB 以下的圖片');
  const { file: optimized } = await optimizeProductImageFile(file);
  if (optimized.size > 2 * 1024 * 1024) throw new Error('圖片壓縮後仍超過 2 MB，請改用較小的圖片');
  const extension = optimized.type === 'image/jpeg' ? 'jpg' : 'webp';
  const path = `${crypto.randomUUID()}.${extension}`;
  const { error } = await images.upload(path, optimized, { contentType: optimized.type, upsert: false });
  if (error) throw error;
  return path;
}

export const createCourseRegistration = args => courseRpc('create_course_registration', args);
export const getMyCourseOrders = id => courseRpc('get_my_course_orders', { p_course_id: id });
export const getAdminCourseRoster = id => courseRpc('get_admin_course_roster', { p_course_id: id });
export const cancelCourseRegistration = (id, reason) => courseRpc('cancel_course_registration', {
  p_registration_id: id, p_reason: reason,
});
export const recordCourseAfterClassCase = (id, reason) => courseRpc('record_course_after_class_case', {
  p_registration_id: id, p_reason: reason,
});
export const resolveCourseManualCase = (id, resolution) => courseRpc('resolve_course_manual_case', {
  p_case_id: id, p_resolution: resolution,
});

export const queueCourseNotification = (courseId, requestId, registrationIds, message) =>
  courseRpc('queue_manual_course_notification', {
    p_course_id: courseId, p_request_id: requestId, p_registration_ids: registrationIds, p_message: message,
  });
export const getAdminCourseNotifications = (courseId, offset = 0, onlyExceptions = false) =>
  courseRpc('get_admin_course_notifications', {
    p_course_id: courseId, p_offset: offset, p_only_exceptions: onlyExceptions,
  });
export const getAdminCourseIncome = courseId => courseRpc('get_admin_course_income', { p_course_id: courseId });
export const recordCourseCaseRefund = (id, resolution, amount) =>
  courseRpc('resolve_course_case_and_record_refund', {
    p_case_id: id, p_resolution: resolution, p_refund_twd: amount,
  });
