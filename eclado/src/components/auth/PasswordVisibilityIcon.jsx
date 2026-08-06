import React from 'react';

export default function PasswordVisibilityIcon({ visible }) {
  if (visible) {
    return (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M10.6 5.2A9.7 9.7 0 0112 5c5.4 0 9 7 9 7a17 17 0 01-2.4 3.4M6.2 6.2C4.2 7.7 3 10 3 12c0 0 3.6 7 9 7 1.3 0 2.5-.4 3.6-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9.9 9.9a3 3 0 004.2 4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 12s3.6-7 9-7 9 7 9 7-3.6 7-9 7-9-7-9-7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
