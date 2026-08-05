import React, { useRef, useState } from 'react';
import Modal from './Modal';

// Visual text editor for landing page templates. Loads the RAW template HTML into a
// sandboxed iframe (scripts disabled, so auto-download/redirect timers can't fire and
// placeholders like {{download_url}} stay intact). Clicking any element makes it
// contentEditable; saving serializes the edited DOM and hands it to onSave.
export default function PersonalizeModal({ title, initialHtml, onSave, onClose }) {
  const frameRef = useRef(null);
  const attached = useRef(false);
  const [saving, setSaving] = useState(false);

  function doc() {
    return frameRef.current ? frameRef.current.contentDocument : null;
  }

  function attachEditor() {
    const d = doc();
    if (!d || attached.current) return;
    attached.current = true;
    d.addEventListener('mouseover', e => {
      if (e.target && e.target.style && e.target !== d.body) e.target.style.outline = '2px dashed #4da3ff';
    });
    d.addEventListener('mouseout', e => {
      if (e.target && e.target.style) e.target.style.outline = '';
    });
    d.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const el = e.target;
      if (!el || el === d.body || el === d.documentElement) return;
      if (!el.isContentEditable && !(el.textContent || '').trim()) return;
      el.contentEditable = 'true';
      el.focus();
      el.addEventListener('blur', () => { el.contentEditable = 'false'; }, { once: true });
    }, true);
  }

  async function save() {
    const d = doc();
    if (!d || saving) return;
    setSaving(true);
    try {
      let html = d.documentElement.outerHTML;
      // Strip editing artifacts before persisting.
      html = html.replace(/ contenteditable="(?:true|false)"/g, '').replace(/ contenteditable=""/g, '');
      if (!/^\s*<!doctype/i.test(html)) html = '<!DOCTYPE html>\n' + html;
      await onSave(html);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={title}
      show
      onClose={onClose}
      wide
      footer={<>
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </>}
    >
      <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: 10 }}>
        <strong style={{ color: '#f1f5f9' }}>Click any text</strong> in the page below to edit it in place — headlines, descriptions, button labels, filenames. Hover shows what you're about to edit. Placeholders like <code>{'{{file_name}}'}</code> and <code>{'{{download_url}}'}</code> keep working after save, so only edit them if you mean to.
      </p>
      <iframe
        ref={frameRef}
        sandbox="allow-same-origin"
        srcDoc={initialHtml || ''}
        onLoad={attachEditor}
        title="Personalize landing page"
        style={{ width: '100%', height: 560, border: '1px solid #1e2230', borderRadius: 6, background: '#fff' }}
      />
    </Modal>
  );
}
