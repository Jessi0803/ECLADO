import { useEffect, useState } from 'react';
import { checkBackofficeAccess } from '../services/membership.js';

export default function useAdminAccess(userId) {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!userId) {
      setIsAdmin(false);
      return () => { alive = false; };
    }
    checkBackofficeAccess().then(allowed => {
      if (alive) setIsAdmin(allowed);
    });
    return () => { alive = false; };
  }, [userId]);

  return isAdmin;
}
