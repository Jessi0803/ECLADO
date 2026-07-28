import { useCallback, useEffect, useState } from 'react';
import {
  LINE_LOGIN_PENDING_KEY,
  consumeCheckoutLoginRedirectPage,
} from '../app/authSession.js';
import { PAGE_PATHS } from '../app/routes.js';
import {
  cleanAuthCallbackFromUrl,
  getAuthCallbackErrorMessage,
  getSession,
  hasAuthCallbackInUrl,
  isEmailVerificationCallback,
  isPasswordRecoveryUrl,
  onAuthStateChange,
  sbError,
  signOut,
} from '../services/auth.js';
import {
  fetchMemberProfile,
  hasProfessionalApplication,
} from '../services/membership.js';

export default function useAuth(setPageState) {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [showProBanner, setShowProBanner] = useState(false);

  const loadUser = useCallback(async supabaseUser => {
    const { data } = await fetchMemberProfile(supabaseUser.id);
    const displayName = data?.name
      || supabaseUser.user_metadata?.full_name
      || supabaseUser.user_metadata?.name
      || supabaseUser.email?.split('@')[0]
      || 'LINE 用戶';
    const role = data?.role || 'consumer';

    setUser({
      name: displayName,
      email: supabaseUser.email || '',
      role,
      isPro: role === 'pro',
      uid: supabaseUser.id,
    });

    if (role === 'consumer') {
      const seenKey = `eclado_pro_banner_${supabaseUser.id}`;
      if (!localStorage.getItem(seenKey)) {
        const hasApplication = await hasProfessionalApplication(supabaseUser.id);
        if (!hasApplication) setShowProBanner(true);
      }
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const { data: { session } } = await getSession();
    if (session?.user) await loadUser(session.user);
  }, [loadUser]);

  useEffect(() => {
    let cancelled = false;
    const startedAsLineLoginCallback = window.location.pathname === '/line-callback'
      || sessionStorage.getItem(LINE_LOGIN_PENDING_KEY) === '1';
    let lineLoginRedirectDone = false;
    let lineLoginNextPage = null;

    function getLineLoginNextPage() {
      if (!lineLoginNextPage) {
        lineLoginNextPage = consumeCheckoutLoginRedirectPage();
      }
      return lineLoginNextPage;
    }

    async function finishLineLoginRedirect(session) {
      if (lineLoginRedirectDone) return;
      lineLoginRedirectDone = true;
      if (session?.user) await loadUser(session.user);
      sessionStorage.removeItem(LINE_LOGIN_PENDING_KEY);
      const nextPage = getLineLoginNextPage();
      cleanAuthCallbackFromUrl(PAGE_PATHS[nextPage] || '/account');
      setPageState(nextPage);
    }

    async function finishAuthCallback() {
      if (!hasAuthCallbackInUrl()) return;
      try {
        const authError = getAuthCallbackErrorMessage();
        if (authError) {
          sessionStorage.removeItem(LINE_LOGIN_PENDING_KEY);
          sessionStorage.setItem('eclado_auth_notice', `error:${authError}`);
          cleanAuthCallbackFromUrl('/login');
          if (!cancelled) setPageState('login');
          return;
        }

        const { data: { session }, error } = await getSession();
        if (cancelled) return;
        if (error) {
          sessionStorage.removeItem(LINE_LOGIN_PENDING_KEY);
          sessionStorage.setItem('eclado_auth_notice', `error:${sbError(error.message)}`);
          cleanAuthCallbackFromUrl('/login');
          setPageState('login');
          return;
        }
        if (isPasswordRecoveryUrl()) {
          cleanAuthCallbackFromUrl('/reset-password');
          setPageState('reset-password');
          return;
        }

        const isLineLoginCallback = window.location.pathname === '/line-callback'
          || sessionStorage.getItem(LINE_LOGIN_PENDING_KEY) === '1'
          || startedAsLineLoginCallback;

        if (session?.user) {
          if (isLineLoginCallback) {
            await finishLineLoginRedirect(session);
            return;
          }
          if (isEmailVerificationCallback()) {
            await loadUser(session.user);
            sessionStorage.setItem('eclado_auth_notice', 'email_verified');
            cleanAuthCallbackFromUrl('/login');
            setPageState('login');
            return;
          }
          await finishLineLoginRedirect(session);
        }
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    }

    finishAuthCallback();

    getSession().then(({ data: { session } }) => {
      if (cancelled || hasAuthCallbackInUrl()) return;
      const isPendingLineLogin = window.location.pathname === '/line-callback'
        || sessionStorage.getItem(LINE_LOGIN_PENDING_KEY) === '1'
        || startedAsLineLoginCallback;
      if (session?.user) {
        if (isPendingLineLogin) finishLineLoginRedirect(session);
        else loadUser(session.user);
      }
      setAuthReady(true);
    });

    const { data: { subscription } } = onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY' || isPasswordRecoveryUrl()) {
        cleanAuthCallbackFromUrl('/reset-password');
        setPageState('reset-password');
      } else if (
        event === 'SIGNED_IN'
        && (
          startedAsLineLoginCallback
          || window.location.pathname === '/line-callback'
          || sessionStorage.getItem(LINE_LOGIN_PENDING_KEY) === '1'
        )
      ) {
        await finishLineLoginRedirect(session);
      } else if (event === 'SIGNED_IN' && isEmailVerificationCallback()) {
        if (session?.user) await loadUser(session.user);
        sessionStorage.setItem('eclado_auth_notice', 'email_verified');
        cleanAuthCallbackFromUrl('/login');
        setPageState('login');
      } else if (event === 'SIGNED_IN' && hasAuthCallbackInUrl()) {
        await finishLineLoginRedirect(session);
      }

      if (session?.user) loadUser(session.user);
      else if (event === 'SIGNED_OUT') setUser(null);
      if (!hasAuthCallbackInUrl()) setAuthReady(true);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [loadUser, setPageState]);

  const handleSignOut = useCallback(() => {
    signOut();
    setUser(null);
  }, []);

  return {
    authReady,
    handleSignOut,
    refreshUser,
    setShowProBanner,
    showProBanner,
    user,
  };
}
