import React, { useEffect, useId, useRef, useState } from 'react';
import { appendRichText, validateRichTextLink, readRichText, writeRichText } from '../../domain/richText.js';
import './RichTextEditor.css';
import '../../components/rich-text/RichTextContent.css';

const tools = [
  [['粗體', 'bold', 'M6 4h7a4 4 0 0 1 0 8H6m7 0a4 4 0 0 1 0 8H6V4'], ['斜體', 'italic', 'M11 4h8M5 20h8m2-16L9 20'], ['底線', 'underline', 'M6 4v8a6 6 0 0 0 12 0V4M4 22h16'], ['刪除線', 'strikeThrough', 'M17 5h-6a4 4 0 0 0 0 8h2a4 4 0 0 1 0 8H7M4 13h16']],
  [['靠左', 'justifyLeft', 'M3 5h18M3 10h12M3 15h18M3 20h12'], ['置中', 'justifyCenter', 'M3 5h18M6 10h12M3 15h18M6 20h12'], ['靠右', 'justifyRight', 'M3 5h18M9 10h12M3 15h18M9 20h12']],
  [['項目符號', 'insertUnorderedList', 'M3 5h.1M3 12h.1M3 19h.1M8 5h13M8 12h13M8 19h13'], ['編號清單', 'insertOrderedList', 'M3 4h1v5m-1 0h2m-3 5a2 2 0 0 1 3 2l-3 3h3M9 6h12M9 12h12M9 18h12']],
  [['連結', 'link', 'M10 7H7a5 5 0 0 0 0 10h3m4-10h3a5 5 0 0 1 0 10h-3m-6-5h8'], ['插入圖片', 'image', 'M14 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6M3 17l5-5 4 4 3-3 6 6m-3-16v8m-4-4h8M8 8h.1']],
  [['復原', 'undo', 'M9 5l-6 6 6 6m-6-6h12a5 5 0 0 1 0 10'], ['重做', 'redo', 'm15 5 6 6-6 6m6-6H9a5 5 0 0 0 0 10'], ['清除文字格式', 'removeFormat', 'M4 8V5h14v3M11 5l-4 15m-3 0h7m4-6 6 6m0-6-6 6']],
];

const toggles = new Set(tools.slice(0, 3).flatMap(group => group.map(([, command]) => command)));
const inlineFormats = new Set(['bold', 'italic', 'underline', 'strikeThrough', 'removeFormat']);

export default function RichTextEditor({ label, value, onChange, onUploading, disabled, uploadImage, downloadImage }) {
  const labelId = useId();
  const linkErrorId = useId();
  const editor = useRef(null);
  const initialValue = useRef(value);
  const selection = useRef(null);
  const linkTarget = useRef(null);
  const imageInput = useRef(null);
  const urls = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState(null);
  const [linkActive, setLinkActive] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [block, setBlock] = useState('p');
  const [pressed, setPressed] = useState([]);
  const [history, setHistory] = useState({});

  async function preview(image, currentUrls) {
    try {
      const blob = await downloadImage(image.dataset.courseImage);
      if (urls.current !== currentUrls) return;
      const url = URL.createObjectURL(blob);
      currentUrls.add(url);
      image.src = url;
    } catch {
      // Keep the saved image reference if preview is unavailable.
    }
  }

  useEffect(() => {
    const area = editor.current;
    const currentUrls = new Set();
    urls.current = currentUrls;
    const nodes = readRichText(initialValue.current);
    area.replaceChildren();
    if (nodes) appendRichText(area, nodes);
    else area.innerText = initialValue.current;
    if (downloadImage) {
      for (const image of area.querySelectorAll('img')) void preview(image, currentUrls);
    }
    return () => {
      urls.current = null;
      currentUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  function linkAt(range) {
    if (!range) return null;
    const start = range.startContainer;
    const element = start.nodeType === Node.ELEMENT_NODE ? start : start.parentElement;
    const anchor = element?.closest('a[href]');
    return anchor && editor.current.contains(anchor) && anchor.contains(range.endContainer)
      ? anchor : null;
  }

  function rememberSelection() {
    const current = window.getSelection();
    if (current.rangeCount && editor.current.contains(current.getRangeAt(0).commonAncestorContainer)) {
      selection.current = current.getRangeAt(0).cloneRange();
      setLinkActive(Boolean(linkAt(selection.current)));
      const tag = document.queryCommandValue('formatBlock').toLowerCase();
      setBlock(['h3', 'h4'].includes(tag) ? tag : 'p');
      setPressed([...toggles].filter(command => document.queryCommandState(command)));
      setHistory({ undo: document.queryCommandEnabled('undo'), redo: document.queryCommandEnabled('redo') });
    }
  }

  function focusEditor(range = selection.current) {
    const area = editor.current;
    area.focus();
    if (range && area.contains(range.commonAncestorContainer)) {
      const current = window.getSelection();
      current.removeAllRanges();
      current.addRange(range);
    }
  }

  function update() {
    onChange(writeRichText(editor.current));
    rememberSelection();
  }

  function format(command, argument) {
    if (document.activeElement !== editor.current) focusEditor();
    if (inlineFormats.has(command)) {
      // Keep browser-generated inline overrides so partial selections survive saving.
      document.execCommand('styleWithCSS', false, 'true');
      try {
        document.execCommand(command, false, argument);
      } finally {
        document.execCommand('styleWithCSS', false, 'false');
      }
    } else {
      document.execCommand(command, false, argument);
    }
    update();
  }

  function toggleLink() {
    if (link !== null) {
      setLink(null);
      focusEditor();
      return;
    }
    rememberSelection();
    linkTarget.current = linkAt(selection.current);
    setLinkError('');
    setLink(linkTarget.current?.getAttribute('href') || '');
  }

  function applyLink() {
    const href = validateRichTextLink(link.trim());
    if (!href) {
      setLinkError('請輸入完整網址，例如 https://example.com。');
      return;
    }
    if (document.activeElement === editor.current) rememberSelection();
    const range = selection.current?.cloneRange();
    const target = linkAt(range);
    if (target) range.selectNodeContents(target);
    setLink(null);
    focusEditor(range);
    if (window.getSelection().isCollapsed) {
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.textContent = href;
      document.execCommand('insertHTML', false, anchor.outerHTML);
    } else {
      document.execCommand('createLink', false, href);
    }
    update();
  }

  function removeLink() {
    if (!editor.current.contains(linkTarget.current)) return;
    const range = document.createRange();
    range.selectNodeContents(linkTarget.current);
    setLink(null);
    focusEditor(range);
    document.execCommand('unlink');
    update();
  }

  async function addImage(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const alt = window.prompt('請輸入圖片說明（可留空）');
    if (alt === null) return;
    const currentUrls = urls.current;
    setError('');
    setUploading(true);
    onUploading?.(true);
    try {
      const path = await uploadImage(file);
      if (urls.current !== currentUrls) return;
      const image = document.createElement('img');
      image.dataset.courseImage = path;
      image.alt = alt;
      const src = URL.createObjectURL(file);
      currentUrls.add(src);
      image.src = src;
      format('insertHTML', image.outerHTML);
    } catch (failure) {
      if (urls.current === currentUrls) setError(failure.message || '圖片上傳失敗。');
    } finally {
      if (urls.current === currentUrls) {
        setUploading(false);
        onUploading?.(false);
      }
    }
  }

  return (
    <div className="admin-course-rich">
      <span id={labelId} className="admin-course-rich-label">{label}</span>
      <div className="admin-course-rich-tools" role="group" aria-label={label + '格式'}>
        <select aria-label="段落樣式" value={block} disabled={uploading}
          onChange={event => format('formatBlock', event.target.value)}>
          <option value="p">內文</option>
          <option value="h3">標題</option>
          <option value="h4">小標題</option>
        </select>
        {tools.map(group => (
          <div className="admin-course-rich-tool-group" key={group[0][1]}>
            {group.filter(([, command]) => command !== 'image' || uploadImage).map(([label, command, icon]) => (
              <button key={command} type="button" aria-label={label} title={label}
                aria-pressed={command === 'link' ? link !== null || linkActive : toggles.has(command) ? pressed.includes(command) : undefined}
                aria-expanded={command === 'link' ? link !== null : undefined}
                disabled={uploading || (['undo', 'redo'].includes(command) && !history[command])}
                onMouseDown={event => event.preventDefault()}
                onClick={() => {
                  if (command === 'link') toggleLink();
                  else if (command === 'image') imageInput.current.click();
                  else format(command);
                }}>
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d={icon} />
                </svg>
              </button>
            ))}
          </div>
        ))}
        <input ref={imageInput} hidden type="file" accept="image/*" onChange={addImage} />
        {uploading && <span role="status">圖片上傳中…</span>}
      </div>
      {link !== null && (
        <div className="admin-course-rich-link" data-editing={Boolean(linkTarget.current)}>
          <input autoFocus type="text" inputMode="url" aria-label="連結網址"
            placeholder="https://example.com" value={link}
            aria-invalid={Boolean(linkError)} aria-describedby={linkError ? linkErrorId : undefined}
            onChange={event => { setLink(event.target.value); setLinkError(''); }}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                toggleLink();
              }
            }} />
          <button type="button" className="admin-secondary-btn"
            onMouseDown={event => event.preventDefault()} onClick={applyLink}>套用</button>
          {linkTarget.current && (
            <button type="button" className="admin-secondary-btn" onClick={removeLink}>取消連結</button>
          )}
          {linkError && <p id={linkErrorId} role="alert">{linkError}</p>}
        </div>
      )}
      <div ref={editor} className="course-description-content admin-course-rich-input"
        role="textbox" aria-labelledby={labelId} aria-multiline="true"
        aria-disabled={disabled} contentEditable={!disabled} onInput={update}
        onFocus={rememberSelection} onBlur={rememberSelection} onKeyUp={rememberSelection} onMouseUp={rememberSelection}
        onDrop={event => event.preventDefault()}
        onPaste={event => {
          event.preventDefault();
          document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
          update();
        }} />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
