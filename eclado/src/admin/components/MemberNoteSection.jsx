import React, { useEffect, useState } from 'react';

export const MEMBER_NOTE_MAX_LENGTH = 1000;

export function formatNoteMeta(note) {
  if (!note?.updatedAt) return '';
  const date = new Date(note.updatedAt);
  const when = Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  return [note.updatedByEmail, when].filter(Boolean).join(' · ');
}

export default function MemberNoteSection({ memberId, note, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setEditing(false); setError(''); }, [memberId]);

  function startEdit() {
    setDraft(note?.note || '');
    setError('');
    setEditing(true);
  }

  async function save(event) {
    event.preventDefault();
    if (draft.trim().length > MEMBER_NOTE_MAX_LENGTH) return setError(`備註最多 ${MEMBER_NOTE_MAX_LENGTH} 字`);
    setSaving(true);
    const result = await onSave(memberId, draft.trim());
    setSaving(false);
    if (!result?.ok) return setError(result?.message || '備註儲存失敗，請稍後再試');
    setEditing(false);
  }

  return (
    <section aria-label="會員內部備註" style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--mid)', letterSpacing: '0.08em' }}>會員內部備註（僅後台可見）</div>
        {onSave && !editing && (
          <button type="button" onClick={startEdit} style={{ background: 'none', border: '1px solid var(--border)', padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: 'var(--dark)' }}>
            {note?.note ? '編輯備註' : '新增備註'}
          </button>
        )}
      </div>
      {editing ? (
        <form onSubmit={save} style={{ display: 'grid', gap: 8 }}>
          <textarea
            aria-label="會員內部備註內容"
            value={draft}
            onChange={event => { setDraft(event.target.value); if (error) setError(''); }}
            maxLength={MEMBER_NOTE_MAX_LENGTH}
            rows={5}
            autoFocus
            placeholder=""
            style={{ width: '100%', border: '1px solid var(--border)', padding: '10px 12px', fontSize: 13, lineHeight: 1.7, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--mid)' }}>{draft.length} / {MEMBER_NOTE_MAX_LENGTH}　清空後儲存即刪除備註</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={saving} onClick={() => setEditing(false)} style={{ background: 'none', border: '1px solid var(--border)', padding: '6px 14px', fontSize: 11, cursor: 'pointer' }}>取消</button>
              <button type="submit" disabled={saving} style={{ background: 'var(--dark)', color: '#fff', border: 'none', padding: '6px 14px', fontSize: 11, cursor: saving ? 'wait' : 'pointer' }}>{saving ? '儲存中…' : '儲存'}</button>
            </div>
          </div>
          {error && <div role="alert" style={{ fontSize: 11, color: 'var(--red)' }}>{error}</div>}
        </form>
      ) : note?.note ? (
        <>
          <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--dark)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: '10px 12px', background: 'var(--off)', border: '1px solid var(--border)', borderLeft: '3px solid var(--note-member)' }}>{note.note}</div>
          {formatNoteMeta(note) && <div style={{ fontSize: 10, color: 'var(--mid)', marginTop: 6 }}>最後更新：{formatNoteMeta(note)}</div>}
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--mid)' }}>尚無備註</div>
      )}
    </section>
  );
}
