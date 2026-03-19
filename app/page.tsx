'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatResponse, CorrectResponse, DiagramSpec, GenerateResponse, ValidateResponse } from '@/lib/types';

type Step = 'idle' | 'analyzing' | 'generating' | 'validating' | 'done' | 'error';

const STEP_LABELS: Record<Step, string> = {
  idle:       '',
  analyzing:  'מנתח תיאור...',
  generating: 'יוצר דיאגרמה...',
  validating: 'מאמת תוצאה...',
  done:       'הדיאגרמה מוכנה!',
  error:      'אירעה שגיאה',
};

const STEP_ORDER: Step[] = ['analyzing', 'generating', 'validating', 'done'];

const PROGRESS: Record<Step, number> = {
  idle:       0,
  analyzing:  20,
  generating: 55,
  validating: 82,
  done:       100,
  error:      0,
};

const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');

export default function HomePage() {
  const [input, setInput]                   = useState('');
  const [history, setHistory]               = useState<ChatMessage[]>([]);
  const [step, setStep]                     = useState<Step>('idle');
  const [clarification, setClarification]   = useState<string | null>(null);
  const [currentSpec, setCurrentSpec]       = useState<DiagramSpec | null>(null);
  const [image, setImage]                   = useState<GenerateResponse | null>(null);
  const [errorMsg, setErrorMsg]             = useState<string | null>(null);
  const [correctionText, setCorrectionText] = useState('');
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [isDragging, setIsDragging]         = useState(false);
  const [uploadedFile, setUploadedFile]     = useState<string | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);

  const fileInputRef      = useRef<HTMLInputElement>(null);
  const textareaRef       = useRef<HTMLTextAreaElement>(null);
  const correctionInputRef = useRef<HTMLInputElement>(null);
  const resultRef         = useRef<HTMLDivElement>(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const resetError = () => { setErrorMsg(null); setStep('idle'); };

  const downloadImage = () => {
    if (!image) return;
    const link = document.createElement('a');
    link.href = `data:${image.mimeType};base64,${image.imageBase64}`;
    link.download = `diagram-${Date.now()}.png`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const runGenerate = useCallback(async (spec: DiagramSpec): Promise<GenerateResponse | null> => {
    setStep('generating');
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'שגיאת יצירה' })) as { error: string };
        setErrorMsg(err.error); setStep('error'); return null;
      }
      return res.json() as Promise<GenerateResponse>;
    } catch {
      setErrorMsg('שגיאת רשת — בדוק חיבור לאינטרנט'); setStep('error'); return null;
    }
  }, []);

  const runValidate = useCallback(async (genResult: GenerateResponse, spec: DiagramSpec): Promise<boolean> => {
    setStep('validating');
    try {
      const res = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: genResult.imageBase64, mimeType: genResult.mimeType, spec }),
      });
      if (!res.ok) return true;
      const validation = await res.json() as ValidateResponse;
      if (!validation.valid && validation.issues.length > 0) {
        const retry = await runGenerate(spec);
        if (!retry) return false;
        setImage(retry);
        return true;
      }
      return true;
    } catch { return true; }
  }, [runGenerate]);

  const runPipeline = useCallback(async (message: string, msgs: ChatMessage[]) => {
    setStep('analyzing'); setErrorMsg(null); setClarification(null);
    try {
      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: msgs }),
      });
      if (!chatRes.ok) { setErrorMsg('שגיאת תקשורת עם השרת'); setStep('error'); return; }
      const chatData = await chatRes.json() as ChatResponse;

      if (chatData.type === 'clarification' && chatData.question) {
        setClarification(chatData.question);
        setHistory((h) => [...h, { role: 'user', content: message }, { role: 'assistant', content: chatData.question! }]);
        setStep('idle');
        setTimeout(() => textareaRef.current?.focus(), 50);
        return;
      }
      if (chatData.type === 'error' || !chatData.spec) {
        setErrorMsg(chatData.message ?? 'שגיאה לא ידועה'); setStep('error'); return;
      }
      const spec = chatData.spec;
      setCurrentSpec(spec);
      setHistory((h) => [...h, { role: 'user', content: message }]);
      const genResult = await runGenerate(spec);
      if (!genResult) return;
      setImage(genResult);
      await runValidate(genResult, spec);
      setStep('done');
      setTimeout(() => { resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 100);
    } catch { setErrorMsg('שגיאת רשת — בדוק חיבור לאינטרנט'); setStep('error'); }
  }, [runGenerate, runValidate]);

  const handleSubmit = async () => {
    const msg = input.trim();
    if (!msg || step === 'analyzing' || step === 'generating' || step === 'validating') return;
    setInput(''); setUploadedFile(null);
    await runPipeline(msg, history);
  };

  const handleCorrection = async () => {
    const correction = correctionText.trim();
    if (!correction || !image || !currentSpec) return;
    if (step === 'analyzing' || step === 'generating' || step === 'validating') return;
    setStep('analyzing'); setCorrectionError(null);
    try {
      const res = await fetch('/api/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: image.imageBase64, mimeType: image.mimeType, currentSpec, correctionPrompt: correction }),
      });
      if (!res.ok) { setCorrectionError('שגיאה בעיבוד התיקון'); setStep('done'); return; }
      const corrData = await res.json() as CorrectResponse | { error: string };
      if ('error' in corrData) { setCorrectionError(corrData.error); setStep('done'); return; }
      setCurrentSpec(corrData.spec); setCorrectionText('');
      const genResult = await runGenerate(corrData.spec);
      if (!genResult) { setStep('done'); return; }
      setImage(genResult);
      await runValidate(genResult, corrData.spec);
      setStep('done');
    } catch { setCorrectionError('שגיאת רשת — בדוק חיבור לאינטרנט'); setStep('done'); }
  };

  const handleFileUpload = async (file: File) => {
    setIsUploadingFile(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/extract', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'שגיאה בחילוץ הקובץ' })) as { error: string };
        setErrorMsg(err.error); setStep('error'); return;
      }
      const { text, filename } = await res.json() as { text: string; filename: string };
      setUploadedFile(filename);
      setInput((prev) => (prev ? `${prev}\n\n${text}` : text));
      textareaRef.current?.focus();
    } catch { setErrorMsg('שגיאת רשת בהעלאת הקובץ'); setStep('error'); }
    finally { setIsUploadingFile(false); }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFileUpload(file);
  };

  const handleNewDiagram = () => {
    if (image && !window.confirm('הדיאגרמה הנוכחית תאבד. להמשיך?')) return;
    setImage(null); setCurrentSpec(null); setHistory([]); setStep('idle');
    setClarification(null); setCorrectionError(null); setInput('');
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const isLoading = step === 'analyzing' || step === 'generating' || step === 'validating';
  const progressPct = PROGRESS[step];

  return (
    <main
      className="min-h-screen flex flex-col items-center px-4 py-10 pb-24"
      style={{ background: 'var(--bg-primary)' }}
    >
      {/* ─── Header ─── */}
      <header className="w-full max-w-2xl mb-10 text-center">
        <div className="flex flex-col items-center gap-3">
          {/* Logo icon */}
          <div
            className="logo-icon w-14 h-14 text-2xl"
            aria-hidden="true"
          >
            ד
          </div>

          {/* Title */}
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-gradient leading-tight">
              DiagramGen
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              יצירת דיאגרמות זרימה בעברית · מופעל על ידי&nbsp;AI
            </p>
          </div>

          {/* Badges */}
          <div className="flex items-center gap-2">
            <span className="badge-ai">Claude + Gemini</span>
            <span className="badge-ai">RTL · עברית</span>
          </div>
        </div>
      </header>

      {/* ─── Main panel ─── */}
      <div className="w-full max-w-2xl space-y-4">

        {/* Input card */}
        <div className="glass-card p-5 space-y-4">

          {/* Clarification banner */}
          {clarification && (
            <div
              className="p-3 rounded-xl text-sm font-medium animate-slide-up"
              style={{
                background: 'rgba(74, 128, 236, 0.1)',
                border: '1px solid rgba(74, 128, 236, 0.35)',
                color: '#a8c4f5',
              }}
              role="status"
              aria-live="polite"
            >
              <span className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>
                שאלת הבהרה — ענה למטה:
              </span>
              {clarification}
            </div>
          )}

          {/* Uploaded file badge */}
          {uploadedFile && (
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs animate-fade-in"
              style={{ background: 'rgba(76, 175, 138, 0.12)', color: '#4caf8a', border: '1px solid rgba(76, 175, 138, 0.25)' }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
                <polyline points="14 2 14 8 20 8" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
              {uploadedFile}
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleSubmit(); }
            }}
            placeholder={clarification ? 'הקלד את תשובתך כאן...' : 'תאר את הדיאגרמה שאתה רוצה ליצור...'}
            disabled={isLoading}
            aria-label={clarification ? 'תשובה לשאלת הבהרה' : 'תיאור דיאגרמה'}
            rows={4}
            className="w-full resize-none rounded-2xl px-4 py-3 text-sm transition-all duration-200 disabled:opacity-50"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(74, 128, 236, 0.18)',
              color: 'var(--text-primary)',
              minHeight: '96px',
              lineHeight: '1.7',
            }}
          />

          {/* Actions row */}
          <div className="flex items-center justify-between gap-3">

            {/* File upload */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || isUploadingFile}
              aria-label="העלה קובץ PDF, DOCX, או TXT"
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs cursor-pointer transition-all duration-200 hover:opacity-80 disabled:opacity-40"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'var(--text-muted)',
              }}
            >
              {isUploadingFile ? (
                <svg className="animate-spin-slow w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              )}
              {isUploadingFile ? 'מעלה...' : 'קובץ'}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.pdf,.docx"
              className="hidden"
              aria-hidden="true"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFileUpload(file);
                e.target.value = '';
              }}
            />

            {/* Submit */}
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={isLoading || !input.trim()}
              aria-label="צור דיאגרמה"
              className="btn-submit flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-bold text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin-slow w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                  {STEP_LABELS[step]}
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  צור דיאגרמה
                </>
              )}
            </button>
          </div>

          {/* Keyboard hint */}
          {!isLoading && !image && (
            <p className="text-xs text-center" style={{ color: 'var(--text-hint)' }}>
              {isMac ? '⌘' : 'Ctrl'}+Enter לשליחה · PDF · DOCX · TXT
            </p>
          )}
        </div>

        {/* ─── Progress bar ─── */}
        {isLoading && (
          <div className="glass-card px-5 py-4 animate-slide-up" role="status" aria-live="polite" aria-label={STEP_LABELS[step]}>
            {/* Step label row */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold" style={{ color: 'var(--accent-light)' }}>
                {STEP_LABELS[step]}
              </span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {progressPct}%
              </span>
            </div>

            {/* Bar */}
            <div className="progress-track mb-3">
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>

            {/* Step dots */}
            <div className="flex items-center justify-between px-1">
              {STEP_ORDER.filter((s) => s !== 'done').map((s, i) => {
                const isActive    = step === s;
                const isCompleted = STEP_ORDER.indexOf(step) > i;
                return (
                  <div key={s} className="flex flex-col items-center gap-1">
                    <div
                      className={`step-dot w-2 h-2 rounded-full ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
                      style={!isActive && !isCompleted ? { background: 'rgba(255,255,255,0.12)' } : undefined}
                    />
                    <span className="text-xs" style={{ color: isActive ? 'var(--accent-light)' : isCompleted ? 'var(--success)' : 'var(--text-hint)' }}>
                      {STEP_LABELS[s].replace('...', '')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── Error state ─── */}
        {step === 'error' && errorMsg && (
          <div
            className="glass-card p-4 animate-slide-up"
            style={{ border: '1px solid rgba(229, 115, 115, 0.35)', boxShadow: '0 0 24px rgba(229, 115, 115, 0.1)' }}
            role="alert"
          >
            <div className="flex items-start gap-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e57373" strokeWidth="2" aria-hidden="true" className="shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-semibold" style={{ color: '#e57373' }}>שגיאה</p>
                <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{errorMsg}</p>
              </div>
              <button
                type="button"
                onClick={resetError}
                aria-label="סגור שגיאה"
                className="text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-opacity hover:opacity-70"
                style={{ background: 'rgba(229, 115, 115, 0.12)', color: '#e57373', border: '1px solid rgba(229, 115, 115, 0.2)' }}
              >
                סגור
              </button>
            </div>
          </div>
        )}

        {/* ─── Diagram result ─── */}
        {image && step === 'done' && (
          <div ref={resultRef} className="glass-card result-card p-5 space-y-4">

            {/* Title bar */}
            {currentSpec?.title && (
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-gradient truncate">{currentSpec.title}</h2>
                <span className="badge-ai shrink-0 mr-2">
                  {currentSpec.nodes.length} צמתים
                </span>
              </div>
            )}

            {/* Diagram image */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                border: '1px solid rgba(74, 128, 236, 0.2)',
                boxShadow: '0 4px 32px rgba(0, 0, 0, 0.4)',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- base64 data URI */}
              <img
                src={`data:${image.mimeType};base64,${image.imageBase64}`}
                alt={currentSpec?.title ?? 'דיאגרמת זרימה'}
                className="w-full h-auto diagram-reveal"
                style={{ display: 'block' }}
              />
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={downloadImage}
                aria-label="הורד דיאגרמה כ-PNG"
                className="btn-download flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white cursor-pointer"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                הורד PNG
              </button>

              <button
                type="button"
                onClick={handleNewDiagram}
                aria-label="צור דיאגרמה חדשה"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm cursor-pointer transition-all duration-200 hover:opacity-80"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: 'var(--text-muted)',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 .49-4.95" />
                </svg>
                דיאגרמה חדשה
              </button>
            </div>

            {/* Correction section */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '16px' }} className="space-y-2">
              <label htmlFor="correction-input" className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
                תיקון ושינוי
              </label>

              {correctionError && (
                <p className="text-xs animate-fade-in" style={{ color: 'var(--error)' }} role="alert">
                  {correctionError}
                </p>
              )}

              <div className="flex gap-2">
                <input
                  id="correction-input"
                  ref={correctionInputRef}
                  type="text"
                  value={correctionText}
                  onChange={(e) => setCorrectionText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleCorrection(); }}
                  placeholder="למשל: הוסף שלב בדיקה אחרי האישור"
                  disabled={isLoading}
                  className="flex-1 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 disabled:opacity-50"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(74, 128, 236, 0.18)',
                    color: 'var(--text-primary)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => void handleCorrection()}
                  disabled={isLoading || !correctionText.trim()}
                  aria-label="החל תיקון"
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold cursor-pointer transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
                  style={{
                    background: 'rgba(74, 128, 236, 0.18)',
                    color: 'var(--accent-light)',
                    border: '1px solid rgba(74, 128, 236, 0.3)',
                  }}
                >
                  {isLoading ? (
                    <svg className="animate-spin-slow w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 0 1 10 10" />
                    </svg>
                  ) : 'תקן'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── Drop zone ─── */}
        {step === 'idle' && !image && (
          <div
            className={`drop-zone rounded-2xl p-8 text-center cursor-pointer transition-all duration-250 ${isDragging ? 'drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="גרור קובץ PDF, DOCX, או TXT לכאן"
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3 transition-transform duration-200"
              style={{
                background: 'rgba(74, 128, 236, 0.1)',
                border: '1px solid rgba(74, 128, 236, 0.2)',
                color: 'var(--text-muted)',
              }}
              aria-hidden="true"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9"  y1="15" x2="12" y2="12" />
                <line x1="15" y1="15" x2="12" y2="12" />
              </svg>
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
              גרור קובץ PDF, DOCX או TXT לכאן
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-hint)' }}>
              הטקסט יחולץ אוטומטית ויוכנס לשדה הקלט
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
