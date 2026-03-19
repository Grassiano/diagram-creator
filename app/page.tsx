'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useSpring, useTransform } from 'framer-motion';
import { Paperclip, Send, RotateCcw, Download, Check, AlertCircle, X } from 'lucide-react';
import type {
  ChatMessage, ChatResponse, CorrectResponse,
  DiagramSpec, GenerateResponse, ValidateResponse,
} from '@/lib/types';

/* ─── Types ─── */
type Step = 'idle' | 'analyzing' | 'generating' | 'validating' | 'done' | 'error';

const STEP_LABELS: Record<Step, string> = {
  idle:       '',
  analyzing:  'מנתח תיאור',
  generating: 'יוצר דיאגרמה',
  validating: 'מאמת תוצאה',
  done:       'הדיאגרמה מוכנה!',
  error:      'אירעה שגיאה',
};

const PROGRESS: Record<Step, number> = {
  idle: 0, analyzing: 20, generating: 58, validating: 85, done: 100, error: 0,
};

type PipeStep = { label: string; status: 'pending' | 'active' | 'done' };

const PIPE_STEPS: PipeStep[] = [
  { label: 'ניתוח',  status: 'pending' },
  { label: 'יצירה',  status: 'pending' },
  { label: 'אימות',  status: 'pending' },
];

const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');

/* ─── Progress component (from 21st.dev + adapted) ─── */
function AIPipelineProgress({ step }: { step: Step }) {
  const progressSpring = useSpring(PROGRESS[step], { stiffness: 60, damping: 18 });
  const progressWidth  = useTransform(progressSpring, (v) => `${v}%`);

  useEffect(() => {
    progressSpring.set(PROGRESS[step]);
  }, [step, progressSpring]);

  const steps: PipeStep[] = PIPE_STEPS.map((s, i) => {
    const order: Step[] = ['analyzing', 'generating', 'validating'];
    const idx = order.indexOf(step);
    return {
      ...s,
      status:
        i < idx    ? 'done'
        : i === idx ? 'active'
        : 'pending',
    };
  });

  return (
    <motion.div
      className="glass-card px-6 py-5"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
    >
      {/* Top row: label + pct */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold" style={{ color: 'var(--accent-light)' }}>
          {STEP_LABELS[step]}...
        </span>
        <motion.span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {PROGRESS[step]}%
        </motion.span>
      </div>

      {/* Bar */}
      <div className="relative h-[3px] rounded-full mb-5" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <motion.div
          className="absolute inset-y-0 right-0 rounded-full"
          style={{
            width: progressWidth,
            background: 'linear-gradient(270deg, #7da3f5 0%, #4a80ec 50%, #3a6fd8 100%)',
            boxShadow: '0 0 10px rgba(74,128,236,0.6)',
          }}
        >
          {/* shimmer sweep */}
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{
              background: 'linear-gradient(270deg, transparent, rgba(255,255,255,0.3), transparent)',
            }}
            animate={{ x: ['-100%', '200%'] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
          />
        </motion.div>
      </div>

      {/* Steps */}
      <div className="flex justify-between">
        {steps.map((s, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <motion.div
              className="w-10 h-10 rounded-full flex items-center justify-center border-2"
              style={{
                background:
                  s.status === 'done'   ? 'rgba(61,214,140,0.15)'
                  : s.status === 'active' ? 'rgba(74,128,236,0.15)'
                  : 'rgba(255,255,255,0.04)',
                borderColor:
                  s.status === 'done'   ? 'var(--success)'
                  : s.status === 'active' ? 'var(--accent)'
                  : 'rgba(255,255,255,0.1)',
              }}
              animate={s.status === 'active' ? {
                scale: [1, 1.08, 1],
                boxShadow: [
                  '0 0 0 0 rgba(74,128,236,0)',
                  '0 0 0 8px rgba(74,128,236,0.2)',
                  '0 0 0 0 rgba(74,128,236,0)',
                ],
              } : {}}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              {s.status === 'done' ? (
                <motion.div
                  initial={{ scale: 0, rotate: -90 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                >
                  <Check size={16} color="var(--success)" />
                </motion.div>
              ) : (
                <motion.div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{
                    background:
                      s.status === 'active' ? 'var(--accent)'
                      : 'rgba(255,255,255,0.15)',
                  }}
                  animate={s.status === 'active' ? { scale: [1, 1.4, 1], opacity: [1, 0.6, 1] } : {}}
                  transition={{ duration: 0.9, repeat: Infinity }}
                />
              )}
            </motion.div>
            <span className="text-xs" style={{
              color:
                s.status === 'done'   ? 'var(--success)'
                : s.status === 'active' ? 'var(--accent-light)'
                : 'var(--text-hint)',
              fontWeight: s.status === 'active' ? 600 : 400,
            }}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/* ─── Main page ─── */
export default function HomePage() {
  const [input, setInput]               = useState('');
  const [history, setHistory]           = useState<ChatMessage[]>([]);
  const [step, setStep]                 = useState<Step>('idle');
  const [clarification, setClarification] = useState<string | null>(null);
  const [currentSpec, setCurrentSpec]   = useState<DiagramSpec | null>(null);
  const [image, setImage]               = useState<GenerateResponse | null>(null);
  const [errorMsg, setErrorMsg]         = useState<string | null>(null);
  const [correctionText, setCorrectionText] = useState('');
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [isDragging, setIsDragging]     = useState(false);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);

  const fileInputRef   = useRef<HTMLInputElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);
  const resultRef      = useRef<HTMLDivElement>(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const isLoading = step === 'analyzing' || step === 'generating' || step === 'validating';

  /* ─── API helpers ─── */
  const runGenerate = useCallback(async (spec: DiagramSpec): Promise<GenerateResponse | null> => {
    setStep('generating');
    try {
      const res = await fetch('/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: 'שגיאת יצירה' })) as { error: string };
        setErrorMsg(e.error); setStep('error'); return null;
      }
      return res.json() as Promise<GenerateResponse>;
    } catch { setErrorMsg('שגיאת רשת — בדוק חיבור לאינטרנט'); setStep('error'); return null; }
  }, []);

  const runValidate = useCallback(async (gen: GenerateResponse, spec: DiagramSpec): Promise<void> => {
    setStep('validating');
    try {
      const res = await fetch('/api/validate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: gen.imageBase64, mimeType: gen.mimeType, spec }),
      });
      if (!res.ok) return;
      const v = await res.json() as ValidateResponse;
      if (!v.valid && v.issues.length > 0) {
        const retry = await runGenerate(spec);
        if (retry) setImage(retry);
      }
    } catch { /* fail open */ }
  }, [runGenerate]);

  const runPipeline = useCallback(async (message: string, msgs: ChatMessage[]) => {
    setStep('analyzing'); setErrorMsg(null); setClarification(null);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: msgs }),
      });
      if (!res.ok) { setErrorMsg('שגיאת תקשורת עם השרת'); setStep('error'); return; }
      const data = await res.json() as ChatResponse;

      if (data.type === 'clarification' && data.question) {
        setClarification(data.question);
        setHistory((h) => [...h,
          { role: 'user', content: message },
          { role: 'assistant', content: data.question! },
        ]);
        setStep('idle');
        setTimeout(() => textareaRef.current?.focus(), 50);
        return;
      }
      if (data.type === 'error' || !data.spec) {
        setErrorMsg(data.message ?? 'שגיאה לא ידועה'); setStep('error'); return;
      }

      const spec = data.spec;
      setCurrentSpec(spec);
      setHistory((h) => [...h, { role: 'user', content: message }]);

      const gen = await runGenerate(spec);
      if (!gen) return;
      setImage(gen);
      await runValidate(gen, spec);
      setStep('done');
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150);
    } catch { setErrorMsg('שגיאת רשת — בדוק חיבור לאינטרנט'); setStep('error'); }
  }, [runGenerate, runValidate]);

  const handleSubmit = async () => {
    const msg = input.trim();
    if (!msg || isLoading) return;
    setInput(''); setUploadedFile(null);
    await runPipeline(msg, history);
  };

  const handleCorrection = async () => {
    const correction = correctionText.trim();
    if (!correction || !image || !currentSpec || isLoading) return;
    setStep('analyzing'); setCorrectionError(null);
    try {
      const res = await fetch('/api/correct', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: image.imageBase64, mimeType: image.mimeType, currentSpec, correctionPrompt: correction }),
      });
      if (!res.ok) { setCorrectionError('שגיאה בעיבוד התיקון'); setStep('done'); return; }
      const data = await res.json() as CorrectResponse | { error: string };
      if ('error' in data) { setCorrectionError(data.error); setStep('done'); return; }
      setCurrentSpec(data.spec); setCorrectionText('');
      const gen = await runGenerate(data.spec);
      if (!gen) { setStep('done'); return; }
      setImage(gen);
      await runValidate(gen, data.spec);
      setStep('done');
    } catch { setCorrectionError('שגיאת רשת'); setStep('done'); }
  };

  const handleFileUpload = async (file: File) => {
    setIsUploadingFile(true);
    const form = new FormData(); form.append('file', file);
    try {
      const res = await fetch('/api/extract', { method: 'POST', body: form });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: 'שגיאה בחילוץ הקובץ' })) as { error: string };
        setErrorMsg(e.error); setStep('error'); return;
      }
      const { text, filename } = await res.json() as { text: string; filename: string };
      setUploadedFile(filename);
      setInput((p) => (p ? `${p}\n\n${text}` : text));
      textareaRef.current?.focus();
    } catch { setErrorMsg('שגיאת רשת בהעלאת הקובץ'); setStep('error'); }
    finally { setIsUploadingFile(false); }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFileUpload(file);
  };

  const downloadImage = () => {
    if (!image) return;
    const a = document.createElement('a');
    a.href = `data:${image.mimeType};base64,${image.imageBase64}`;
    a.download = `diagram-${Date.now()}.png`;
    a.style.display = 'none';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const handleNewDiagram = () => {
    if (image && !window.confirm('הדיאגרמה הנוכחית תאבד. להמשיך?')) return;
    setImage(null); setCurrentSpec(null); setHistory([]);
    setStep('idle'); setClarification(null); setCorrectionError(null); setInput('');
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  /* ─── Render ─── */
  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-12 pb-24" dir="rtl">
      {/* ─── Header ─── */}
      <motion.header
        className="w-full max-w-[640px] mb-10 text-center"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 24 }}
      >
        {/* Logo */}
        <motion.div
          className="w-16 h-16 rounded-[20px] mx-auto mb-4 flex items-center justify-center text-white text-2xl font-black"
          style={{
            background: 'linear-gradient(145deg, #4a80ec 0%, #1e3a8a 100%)',
            boxShadow: '0 0 0 0 rgba(74,128,236,0.5), 0 8px 32px rgba(74,128,236,0.4)',
          }}
          animate={{
            boxShadow: [
              '0 0 0 0 rgba(74,128,236,0.4), 0 8px 32px rgba(74,128,236,0.35)',
              '0 0 0 10px rgba(74,128,236,0), 0 8px 40px rgba(74,128,236,0.55)',
              '0 0 0 0 rgba(74,128,236,0.4), 0 8px 32px rgba(74,128,236,0.35)',
            ],
          }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          aria-hidden="true"
        >
          ד
        </motion.div>

        <h1 className="text-4xl font-extrabold tracking-tight text-gradient mb-2">
          DiagramGen
        </h1>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          יצירת דיאגרמות זרימה בעברית מופעל על ידי AI
        </p>
        <div className="flex items-center justify-center gap-2">
          <span className="badge">Claude + Gemini</span>
          <span className="badge">RTL · עברית</span>
        </div>
      </motion.header>

      {/* ─── Content column ─── */}
      <div className="w-full max-w-[640px] space-y-4">

        {/* ─── Input card ─── */}
        <motion.div
          className="glass-card p-5 space-y-3"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 24, delay: 0.08 }}
        >
          {/* Clarification banner */}
          <AnimatePresence>
            {clarification && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div
                  className="p-3 rounded-xl text-sm"
                  style={{
                    background: 'rgba(74,128,236,0.08)',
                    border: '1px solid rgba(74,128,236,0.3)',
                    color: 'var(--accent-light)',
                  }}
                  role="status"
                  aria-live="polite"
                >
                  <span className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>
                    שאלת הבהרה — ענה למטה:
                  </span>
                  {clarification}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* File badge */}
          <AnimatePresence>
            {uploadedFile && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
                style={{
                  background: 'rgba(61,214,140,0.1)',
                  color: 'var(--success)',
                  border: '1px solid rgba(61,214,140,0.25)',
                }}
              >
                <Paperclip size={11} />
                {uploadedFile}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleSubmit(); }
            }}
            placeholder={clarification
              ? 'הקלד את תשובתך כאן...'
              : 'תאר את הדיאגרמה שאתה רוצה ליצור...'}
            disabled={isLoading}
            aria-label={clarification ? 'תשובה לשאלת הבהרה' : 'תיאור דיאגרמה'}
            rows={4}
            className="w-full resize-none rounded-2xl px-4 py-3 text-sm transition-all duration-200 disabled:opacity-50"
            style={{
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid rgba(74,128,236,0.15)',
              color: 'var(--text-primary)',
              lineHeight: '1.75',
            }}
          />

          {/* Submit button — full width */}
          <motion.button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isLoading || !input.trim()}
            aria-label="צור דיאגרמה"
            className="btn-submit w-full flex items-center justify-center gap-2.5 py-3.5 rounded-2xl text-sm font-bold text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
          >
            {isLoading ? (
              <>
                <svg className="animate-spin-slow w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
                {STEP_LABELS[step]}...
              </>
            ) : (
              <>
                <Send size={16} />
                צור דיאגרמה
              </>
            )}
          </motion.button>

          {/* File upload row */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || isUploadingFile}
              aria-label="העלה קובץ PDF, DOCX, או TXT"
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs cursor-pointer transition-all duration-200 hover:opacity-80 disabled:opacity-40"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.07)',
                color: 'var(--text-muted)',
              }}
            >
              {isUploadingFile ? (
                <svg className="animate-spin-slow w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
              ) : (
                <Paperclip size={13} />
              )}
              {isUploadingFile ? 'מעלה...' : 'PDF · DOCX · TXT'}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.pdf,.docx"
              style={{ display: 'none' }}
              aria-hidden="true"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFileUpload(file);
                e.target.value = '';
              }}
            />

            <p className="text-xs" style={{ color: 'var(--text-hint)' }}>
              {isMac ? '⌘' : 'Ctrl'}+Enter לשליחה
            </p>
          </div>
        </motion.div>

        {/* ─── Progress ─── */}
        <AnimatePresence>
          {isLoading && <AIPipelineProgress step={step} />}
        </AnimatePresence>

        {/* ─── Error ─── */}
        <AnimatePresence>
          {step === 'error' && errorMsg && (
            <motion.div
              className="glass-card p-4"
              style={{ border: '1px solid rgba(255,107,107,0.3)', boxShadow: '0 0 30px rgba(255,107,107,0.08)' }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              role="alert"
            >
              <div className="flex items-start gap-3">
                <AlertCircle size={18} color="var(--error)" className="shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold" style={{ color: 'var(--error)' }}>שגיאה</p>
                  <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{errorMsg}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setErrorMsg(null); setStep('idle'); }}
                  aria-label="סגור שגיאה"
                  className="p-1.5 rounded-lg cursor-pointer transition-opacity hover:opacity-70"
                  style={{ background: 'rgba(255,107,107,0.1)', color: 'var(--error)' }}
                >
                  <X size={14} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── Result ─── */}
        <AnimatePresence>
          {image && step === 'done' && (
            <motion.div
              ref={resultRef}
              className="glass-card result-card p-5 space-y-4"
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ type: 'spring', stiffness: 240, damping: 26 }}
            >
              {/* Title */}
              {currentSpec?.title && (
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-gradient truncate flex-1">{currentSpec.title}</h2>
                  <span className="badge shrink-0 mr-2">{currentSpec.nodes.length} צמתים</span>
                </div>
              )}

              {/* Diagram */}
              <div
                className="rounded-2xl overflow-hidden"
                style={{ border: '1px solid rgba(74,128,236,0.15)', boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:${image.mimeType};base64,${image.imageBase64}`}
                  alt={currentSpec?.title ?? 'דיאגרמת זרימה'}
                  className="w-full h-auto diagram-reveal block"
                />
              </div>

              {/* Action buttons */}
              <div className="flex gap-3">
                <motion.button
                  type="button"
                  onClick={downloadImage}
                  aria-label="הורד PNG"
                  className="btn-download flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold text-white cursor-pointer"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <Download size={15} />
                  הורד PNG
                </motion.button>

                <motion.button
                  type="button"
                  onClick={handleNewDiagram}
                  aria-label="דיאגרמה חדשה"
                  className="flex items-center gap-2 px-5 py-3 rounded-2xl text-sm cursor-pointer transition-all duration-200 hover:opacity-80"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    color: 'var(--text-muted)',
                  }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <RotateCcw size={14} />
                  חדש
                </motion.button>
              </div>

              {/* Correction */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '14px' }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
                  תיקון ושינוי
                </p>

                <AnimatePresence>
                  {correctionError && (
                    <motion.p
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="text-xs mb-2" style={{ color: 'var(--error)' }} role="alert"
                    >
                      {correctionError}
                    </motion.p>
                  )}
                </AnimatePresence>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={correctionText}
                    onChange={(e) => setCorrectionText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleCorrection(); }}
                    placeholder="למשל: הוסף שלב בדיקה אחרי האישור"
                    disabled={isLoading}
                    className="flex-1 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 disabled:opacity-50"
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(74,128,236,0.15)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  <motion.button
                    type="button"
                    onClick={() => void handleCorrection()}
                    disabled={isLoading || !correctionText.trim()}
                    aria-label="החל תיקון"
                    className="px-4 py-2.5 rounded-xl text-sm font-semibold cursor-pointer transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: 'rgba(74,128,236,0.15)',
                      color: 'var(--accent-light)',
                      border: '1px solid rgba(74,128,236,0.25)',
                    }}
                    whileTap={{ scale: 0.96 }}
                  >
                    {isLoading ? (
                      <svg className="animate-spin-slow w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                        <path d="M12 2a10 10 0 0 1 10 10" />
                      </svg>
                    ) : 'תקן'}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── Drop zone ─── */}
        <AnimatePresence>
          {step === 'idle' && !image && (
            <motion.div
              className={`drop-zone rounded-2xl p-8 text-center cursor-pointer ${isDragging ? 'drag-over' : ''}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
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
                className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3"
                style={{ background: 'rgba(74,128,236,0.08)', border: '1px solid rgba(74,128,236,0.18)', color: 'var(--text-muted)' }}
              >
                <Paperclip size={20} />
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                גרור קובץ PDF, DOCX או TXT לכאן
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-hint)' }}>
                הטקסט יחולץ אוטומטית ויוכנס לשדה הקלט
              </p>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </main>
  );
}
