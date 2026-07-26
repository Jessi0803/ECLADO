export const POST_LOGIN_PAGE_KEY = 'eclado_post_login';
export const LOGIN_NOTICE_KEY = 'eclado_login_notice';
export const CHECKOUT_LOGIN_REDIRECT_KEY = 'eclado_checkout_login_redirect';
export const LINE_LOGIN_PENDING_KEY = 'eclado_line_login_pending';
export const PROFESSIONAL_LOGIN_NOTICE = '請先登入／註冊後再申請美容師會員。';

export function consumeCheckoutLoginRedirectPage() {
  const nextPage = sessionStorage.getItem(CHECKOUT_LOGIN_REDIRECT_KEY) === 'checkout' ? 'checkout' : 'account';
  sessionStorage.removeItem(CHECKOUT_LOGIN_REDIRECT_KEY);
  return nextPage;
}
