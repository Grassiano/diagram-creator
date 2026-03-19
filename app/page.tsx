'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatResponse, CorrectResponse, DiagramSpec, GenerateResponse, ValidateResponse } from '@/lib/types';

type Step = 'idle' | 'analyzing' | 'generating' | 'validating' | 'done' | 'error';

const STEP_LABELS: Record<Step, string> = {
  idle: '',
  analyzing: 'מנתח תיאור...',
  generating: 'יוצר דיאגרמה...',
  validating: 'מאמת תוצאה...',
  done: 'הדיאגרמה מוכנה!',
  error: 'אירעה שגיאה',
};

const STEP_ORDER: Step[] = ['analyzing', 'generating', 'validating', 'done'];

const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');

export default function HomePage() {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [step, setStep] = useState<Step>('idle');
  const [clarification, setClarification] = useState<string | null>(null);
  const [currentSpec, setCurrentSpec] = useState<DiagramSpec | null>(null);
  const [image, setImage] = useState<GenerateResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [correctionText, setCorrectionText] = useState('');
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const correctionInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Auto-focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const resetError = () => {
    setErrorMsg(null);
    setStep('idle');
  };

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
        setErrorMsg(err.error);
        setStep('error');
        return null;
      }

      return res.json() as Promise<GenerateResponse>;
    } catch {
      setErrorMsg('שגיאת רשת — בדוק חיבור לאינטרנט');
      setStep('error');
      return null;
    }
  }, []);

  const runValidate = useCallback(async (
    genResult: GenerateResponse,
    spec: DiagramSpec,
  ): Promise<boolean> => {
    setStep('validating');
    try {
      const res = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: genResult.imageBase64, mimeType: genResult.mimeType, spec }),
      });

      if (!res.ok) return true; // fail open — show the image anyway
      const validation = await res.json() as ValidateResponse;

      if (!validation.valid && validation.issues.length > 0) {
        // One automatic retry
        const retry = await runGenerate(spec);
        if (!retry) return false;
        setImage(retry);
        return true;
      }

      return true;
    } catch {
      return true; // fail open
    }
  }, [runGenerate]);

  const runPipeline = useCallback(async (message: string, msgs: ChatMessage[]) => {
    setStep('analyzing');
    setErrorMsg(null);
    setClarification(null);

    try {
      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: msgs }),
      });

      if (!chatRes.ok) {
        setErrorMsg('שגיאת תקשורת עם השרת');
        setStep('error');
        return;
      }

      const chatData = await chatRes.json() as ChatResponse;

      if (chatData.type === 'clarification' && chatData.question) {
        setClarification(chatData.question);
        setHistory((h) => [...h, { role: 'user', content: message }, { role: 'assistant', content: chatData.question! }]);
        setStep('idle');
        // Focus textarea so user can answer immediately
        setTimeout(() => textareaRef.current?.focus(), 50);
        return;
      }

      if (chatData.type === 'error' || !chatData.spec) {
        setErrorMsg(chatData.message ?? 'שגיאה לא ידועה');
        setStep('error');
        return;
      }

      const spec = chatData.spec;
      setCurrentSpec(spec);
      setHistory((h) => [...h, { role: 'user', content: message }]);

      const genResult = await runGenerate(spec);
      if (!genResult) return;

      setImage(genResult);
      await runValidate(genResult, spec);
      setStep('done');

      // Scroll result into view and focus correction input
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    } catch {
      setErrorMsg('שגיאת רשת — בדוק חיבור לאינטרנט');
      setStep('error');
    }
  }, [runGenerate, runValidate]);

  const handleSubmit = async () => {
    const msg = input.trim();
    if (!msg || step === 'analyzing' || step === 'generating' || step === 'validating') return;

    setInput('');
    setUploadedFile(null);
    await runPipeline(msg, history);
  };

  const handleCorrection = async () => {
    const correction = correctionText.trim();
    if (!correction || !image || !currentSpec) return;
    if (step === 'analyzing' || step === 'generating' || step === 'validating') return;

    // Use a local analyzing state — don't clobber main step (keeps diagram visible)
    setStep('analyzing');
    setCorrectionError(null);

    try {
      const res = await fetch('/api/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: image.imageBase64,
          mimeType: image.mimeType,
          currentSpec,
          correctionPrompt: correction,
        }),
      });

      if (!res.ok) {
        setCorrectionError('שגיאה בעיבוד התיקון');
        setStep('done'); // stay on done — diagram still visible
        return;
      }

      const corrData = await res.json() as CorrectResponse | { error: string };
      if ('error' in corrData) {
        setCorrectionError(corrData.error);
        setStep('done');
        return;
      }

      setCurrentSpec(corrData.spec);
      setCorrectionText('');

      const genResult = await runGenerate(corrData.spec);
      if (!genResult) {
        setStep('done'); // stay on done
        return;
      }

      setImage(genResult);
      await runValidate(genResult, corrData.spec);
      setStep('done');
    } catch {
      setCorrectionError('שגיאת רשת — בדוק חיבור לאינטרנט');
      setStep('done');
    }
  };

  const handleFileUpload = async (file: File) => {
    setIsUploadingFile(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/extract', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'שגיאה בחילוץ הקובץ' })) as { error: string };
        setErrorMsg(err.error);
        setStep('error');
        return;
      }

      const { text, filename } = await res.json() as { text: string; filename: string };
      setUploadedFile(filename);
      setInput((prev) => (prev ? `${prev}\n\n${text}` : text));
      textareaRef.current?.focus();
    } catch {
      setErrorMsg('שגיאת רשת בהעלאת הקובץ');
      setStep('error');
    } finally {
      setIsUploadingFile(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFileUpload(file);
  };

  const handleNewDiagram = () => {
    if (image && !window.confirm('הדיאגרמה הנוכחית תאבד. להמשיך?')) return;
    setImage(null);
    setCurrentSpec(null);
    setHistory([]);
    setStep('idle');
    setClarification(null);
    setCorrectionError(null);
    setInput('');
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const isLoading = step === 'analyzing' || step === 'generating' || step === 'validating';
  const currentStepIndex = STEP_ORDER.indexOf(step);

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-8 pb-24" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <header className="w-full max-w-2xl mb-8 text-center">
        <div className="inline-flex items-center gap-2 mb-2">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold"
            style={{ background: 'linear-gradient(135deg, #4a80ec, #272c6c)' }}
            aria-hidden="true"
          >
            ד
          </div>
          <h1
            className="text-xl font-bold tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            DiagramGen
          </h1>
        </div>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          יצירת דיאגרמות זרימה בעברית בסגנון ספרי לשכת עורכי הדין
        </p>
      </header>

      {/* Main card */}
      <div className="w-full max-w-2xl space-y-4">
        {/* Input area */}
        <div className="glass-card p-4 space-y-3">
          {/* Clarification prompt */}
          {clarification && (
            <div
              className="p-3 rounded-lg text-sm font-medium animate-slide-up"
              style={{
                background: 'rgba(74, 128, 236, 0.12)',
                border: '1px solid rgba(74, 128, 236, 0.4)',
                color: '#a8c4f5',
              }}
              role="status"
              aria-live="polite"
            >
              <span className="text-xs block mb-1 opacity-70">שאלת הבהרה — הקלד את תשובתך למטה:</span>
              {clarification}
            </div>
          )}

          {/* Uploaded file badge */}
          {uploadedFile && (
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
              style={{ background: 'rgba(76, 175, 138, 0.15)', color: '#4caf8a', border: '1px solid rgba(76, 175, 138, 0.3)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder={clarification ? 'הקלד את תשובתך כאן...' : 'תאר את הדיאגרמה שאתה רוצה ליצור...'}
            disabled={isLoading}
            aria-label={clarification ? 'תשובה לשאלת הבהרה' : 'תיאור דיאגרמה'}
            rows={3}
            className="w-full resize-none rounded-xl px-4 py-3 text-sm transition-all duration-200 disabled:opacity-50"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(74, 128, 236, 0.2)',
              color: 'var(--text-primary)',
              minHeight: '80px',
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
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all duration-200 cursor-pointer hover:opacity-80 disabled:opacity-40"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'var(--text-muted)',
              }}
            >
              {isUploadingFile ? (
                <svg className="animate-spin-slow w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              )}
              {isUploadingFile ? 'מעלה...' : 'העלה קובץ'}
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

            {/* Submit button */}
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={isLoading || !input.trim()}
              aria-label="צור דיאגרמה"
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={
                isLoading
                  ? { background: 'rgba(74, 128, 236, 0.4)' }
                  : { background: 'var(--accent)', boxShadow: '0 0 16px rgba(74, 128, 236, 0.5)' }
              }
            >
              {isLoading ? (
                <>
                  <svg
                    className="animate-spin-slow w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
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

          {/* Hint */}
          {!isLoading && !image && (
            <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
              {isMac ? '⌘' : 'Ctrl'}+Enter לשליחה מהירה • תומך בקבצי PDF, DOCX, TXT
            </p>
          )}
        </div>

        {/* Progress steps */}
        {isLoading && (
          <div className="glass-card p-4 animate-slide-up" role="status" aria-live="polite" aria-label={STEP_LABELS[step]}>
            <div className="flex items-center justify-center gap-6">
              {STEP_ORDER.filter((s) => s !== 'done').map((s, i) => {
                const isActive = step === s;
                const isCompleted = currentStepIndex > i;
                const label = STEP_LABELS[s];
                return (
                  <div key={s} className="flex flex-col items-center gap-1.5">
                    <div
                      className={`step-dot w-2.5 h-2.5 rounded-full ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
                      style={
                        !isActive && !isCompleted
                          ? { background: 'rgba(255,255,255,0.15)' }
                          : undefined
                      }
                    />
                    <span
                      className="text-xs transition-colors duration-300"
                      style={{ color: isActive ? 'var(--accent)' : isCompleted ? '#4caf8a' : 'var(--text-muted)' }}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Error state (pipeline errors only) */}
        {step === 'error' && errorMsg && (
          <div
            className="glass-card p-4 animate-slide-up"
            style={{ border: '1px solid rgba(229, 115, 115, 0.4)' }}
            role="alert"
          >
            <div className="flex items-start gap-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e57373" strokeWidth="2" aria-hidden="true" className="shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-medium" style={{ color: '#e57373' }}>שגיאה</p>
                <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{errorMsg}</p>
              </div>
              <button
                type="button"
                onClick={resetError}
                aria-label="סגור שגיאה"
                className="text-xs px-3 py-1 rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                style={{ background: 'rgba(229, 115, 115, 0.15)', color: '#e57373' }}
              >
                סגור
              </button>
            </div>
          </div>
        )}

        {/* Diagram result */}
        {image && step === 'done' && (
          <div ref={resultRef} className="glass-card p-4 space-y-4 animate-slide-up">
            {/* Image */}
            <div
              className="rounded-xl overflow-hidden"
              style={{ border: '1px solid rgba(74, 128, 236, 0.2)' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- base64 data URI, Next Image doesn't support it */}
              <img
                src={`data:${image.mimeType};base64,${image.imageBase64}`}
                alt={currentSpec?.title ?? 'דיאגרמת זרימה'}
                className="w-full h-auto diagram-reveal"
                style={{ display: 'block' }}
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={downloadImage}
                aria-label="הורד דיאגרמה כ-PNG"
                className="btn-download flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white cursor-pointer"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
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
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm cursor-pointer hover:opacity-80 transition-opacity"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--text-muted)',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 .49-4.95" />
                </svg>
                חדש
              </button>
            </div>

            {/* Correction input */}
            <div className="space-y-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px' }}>
              <label htmlFor="correction-input" className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                תיקון / שינוי:
              </label>

              {correctionError && (
                <p className="text-xs" style={{ color: '#e57373' }} role="alert">{correctionError}</p>
              )}

              <div className="flex gap-2">
                <input
                  id="correction-input"
                  ref={correctionInputRef}
                  type="text"
                  value={correctionText}
                  onChange={(e) => setCorrectionText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCorrection();
                  }}
                  placeholder="למשל: הוסף שלב בדיקה אחרי האישור"
                  disabled={isLoading}
                  className="flex-1 px-3 py-2 rounded-lg text-sm transition-all duration-200 disabled:opacity-50"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(74, 128, 236, 0.2)',
                    color: 'var(--text-primary)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => void handleCorrection()}
                  disabled={isLoading || !correctionText.trim()}
                  aria-label="החל תיקון"
                  className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: 'rgba(74, 128, 236, 0.2)', color: '#a8c4f5', border: '1px solid rgba(74, 128, 236, 0.3)' }}
                >
                  {isLoading ? '...' : 'תקן'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* File drop zone (shown when idle and no image) */}
        {step === 'idle' && !image && (
          <div
            className={`drop-zone rounded-xl p-6 text-center cursor-pointer transition-all duration-200 ${isDragging ? 'drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="גרור קובץ PDF, DOCX, או TXT לכאן"
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="mx-auto mb-2"
              style={{ color: 'var(--text-muted)' }}
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="12" y2="12" />
              <line x1="15" y1="15" x2="12" y2="12" />
            </svg>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              גרור קובץ PDF, DOCX, TXT לכאן
            </p>
            <p className="text-xs mt-1" style={{ color: 'rgba(122, 138, 170, 0.5)' }}>
              הטקסט יחולץ אוטומטית ויוכנס לשדה הקלט
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
