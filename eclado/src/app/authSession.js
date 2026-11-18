import { courseIdFromPath } from './routes.js';

export const COURSE_LINE_RETURN_KEY = 'eclado_course_line_return';

export function courseRegistrationReturnPath(path) {
  const courseId = courseIdFromPath(path);
  return courseId && path.endsWith('/register') ? `/courses/${courseId}/register` : null;
}

export const POST_LOGIN_PAGE_KEY = 'eclado_post_login';
export const LOGIN_NOTICE_KEY = 'eclado_login_notice';
export const CHECKOUT_LOGIN_REDIRECT_KEY = 'eclado_checkout_login_redirect';
export const LINE_LOGIN_PENDING_KEY = 'eclado_line_login_pending';
export const PROFESSIONAL_LOGIN_NOTICE = '請先登入／註冊後再申請美容師會員。';

export function consumeCheckoutLoginRedirectPage() {
  const requested = sessionStorage.getItem(CHECKOUT_LOGIN_REDIRECT_KEY);
  const nextPage = ['checkout', 'cart'].includes(requested) ? requested : 'home';
  sessionStorage.removeItem(CHECKOUT_LOGIN_REDIRECT_KEY);
  return nextPage;
}
