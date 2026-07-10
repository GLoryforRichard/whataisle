'use client';

import { Input } from '@/components/ui/input';
import { CameraIcon, Loader2Icon, MicIcon, SearchIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

/**
 * The three parallel shopper inputs (requirements §4.1): typing, hold-to-talk
 * voice, and photo. Voice and photo include a "confirm what I heard/saw" step
 * before the search runs. Camera/mic denial never dead-ends — it falls back to
 * typing with a friendly explanation.
 */

type PendingConfirm =
  | { kind: 'voice'; text: string; candidates: string[] }
  | { kind: 'photo'; text: string }
  | null;

export function ShopperSearch() {
  const t = useTranslations('Shopper');
  const locale = useLocale();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'voice' | 'photo' | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const [permError, setPermError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);

  function goSearch(query: string, input: 'text' | 'voice' | 'photo') {
    const q = query.trim();
    if (!q) return;
    window.location.href = `/find?q=${encodeURIComponent(q)}&input=${input}`;
  }

  // --- Voice: hold-to-talk ---
  async function startRecording() {
    setPermError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        for (const track of stream.getTracks()) track.stop();
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        await sendVoice(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
    } catch {
      setPermError(t('permissionDenied.mic'));
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  async function sendVoice(blob: Blob) {
    setBusy('voice');
    try {
      const form = new FormData();
      form.set('audio', blob);
      form.set('lang', locale);
      const res = await fetch('/api/store/transcribe', {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (data.text || (data.candidates && data.candidates.length)) {
        setConfirm({
          kind: 'voice',
          text: data.text ?? '',
          candidates: data.candidates ?? [],
        });
      } else {
        setPermError(t('couldntCatch'));
      }
    } catch {
      setPermError(t('couldntCatch'));
    } finally {
      setBusy(null);
    }
  }

  // --- Photo ---
  async function sendPhoto(file: File) {
    setBusy('photo');
    setPermError(null);
    try {
      const form = new FormData();
      form.set('image', file);
      form.set('lang', locale);
      const res = await fetch('/api/store/identify-photo', {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (data.text) {
        setConfirm({ kind: 'photo', text: data.text });
      } else {
        setPermError(t('couldntCatch'));
      }
    } catch {
      setPermError(t('couldntCatch'));
    } finally {
      setBusy(null);
    }
  }

  // --- Confirm step ---
  if (confirm) {
    return (
      <div className="wa-fade-up flex flex-col gap-4">
        <p className="text-[#566058]">
          {confirm.kind === 'voice' ? t('confirmHeard') : t('confirmSaw')}
        </p>
        <p className="rounded-2xl border border-[#D8EBB4] bg-[#F1F7E8] p-4 text-center font-bold text-[var(--brand-ink)] text-xl">
          {confirm.text}
        </p>
        {confirm.kind === 'voice' && confirm.candidates.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-[#566058] text-sm">{t('didYouMean')}</p>
            {confirm.candidates.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => goSearch(c, 'voice')}
                className="h-12 rounded-xl border border-[#D5DCCB] bg-white px-4 font-semibold text-[var(--brand-ink)] transition-colors hover:border-[var(--brand-green)] active:scale-[0.98]"
              >
                {c}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex gap-3">
          <button
            type="button"
            className="h-13 flex-1 rounded-xl border border-[#D5DCCB] bg-white font-semibold text-[var(--brand-ink)] transition-transform active:scale-[0.98]"
            onClick={() => setConfirm(null)}
          >
            {t('confirmRetry')}
          </button>
          <button
            type="button"
            className="h-13 flex-1 rounded-xl bg-[var(--brand-green)] font-bold text-[var(--brand-lime)] transition-transform active:scale-[0.98] disabled:opacity-50"
            disabled={!confirm.text}
            onClick={() =>
              goSearch(
                confirm.text,
                confirm.kind === 'voice' ? 'voice' : 'photo'
              )
            }
          >
            {t('confirmYes')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wa-fade-up flex flex-col gap-5">
      <h1 className="text-center font-bold text-[27px] text-[var(--brand-ink)]">
        {t('greeting')}
      </h1>

      <form
        className="flex gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          goSearch(text, 'text');
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('placeholder')}
          className="h-15 flex-1 rounded-2xl bg-white text-lg"
          enterKeyHint="search"
        />
        <button
          type="submit"
          className="flex size-15 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand-green)] text-[var(--brand-lime)] shadow-[0_6px_18px_rgba(15,76,63,0.3)] transition-transform active:scale-95"
          aria-label={t('searchButton')}
        >
          <SearchIcon className="size-6" />
        </button>
      </form>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          className="flex h-19 flex-col items-center justify-center gap-1.5 rounded-2xl border-[1.5px] border-[#D5DCCB] bg-white font-semibold text-[var(--brand-ink)] transition-transform active:scale-[0.98] disabled:opacity-50"
          onPointerDown={startRecording}
          onPointerUp={stopRecording}
          onPointerLeave={stopRecording}
          disabled={busy !== null}
        >
          {busy === 'voice' ? (
            <Loader2Icon className="size-6 animate-spin" />
          ) : (
            <MicIcon className="size-6" />
          )}
          <span className="text-sm">{t('voiceHold')}</span>
        </button>

        <button
          type="button"
          className="flex h-19 flex-col items-center justify-center gap-1.5 rounded-2xl border-[1.5px] border-[#D5DCCB] bg-white font-semibold text-[var(--brand-ink)] transition-transform active:scale-[0.98] disabled:opacity-50"
          onClick={() => photoInputRef.current?.click()}
          disabled={busy !== null}
        >
          {busy === 'photo' ? (
            <Loader2Icon className="size-6 animate-spin" />
          ) : (
            <CameraIcon className="size-6" />
          )}
          <span className="text-sm">{t('photoButton')}</span>
        </button>
      </div>

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) sendPhoto(f);
        }}
      />

      <p className="text-center text-[#566058] text-xs">{t('photoNotKept')}</p>

      {permError ? (
        <p role="alert" className="text-center text-destructive text-sm">
          {permError}
        </p>
      ) : null}
    </div>
  );
}
