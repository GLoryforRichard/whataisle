'use client';

import { Button } from '@/components/ui/button';
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
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground">
          {confirm.kind === 'voice' ? t('confirmHeard') : t('confirmSaw')}
        </p>
        <p className="rounded-lg border bg-muted/40 p-4 text-center font-semibold text-xl">
          {confirm.text}
        </p>
        {confirm.kind === 'voice' && confirm.candidates.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-sm">{t('didYouMean')}</p>
            {confirm.candidates.map((c) => (
              <Button
                key={c}
                variant="outline"
                onClick={() => goSearch(c, 'voice')}
              >
                {c}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => setConfirm(null)}
          >
            {t('confirmRetry')}
          </Button>
          <Button
            className="flex-1"
            disabled={!confirm.text}
            onClick={() =>
              goSearch(
                confirm.text,
                confirm.kind === 'voice' ? 'voice' : 'photo'
              )
            }
          >
            {t('confirmYes')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-center font-bold text-2xl">{t('greeting')}</h1>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          goSearch(text, 'text');
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('placeholder')}
          className="h-14 flex-1 text-lg"
          enterKeyHint="search"
        />
        <Button
          type="submit"
          size="lg"
          className="h-14 px-5"
          aria-label={t('searchButton')}
        >
          <SearchIcon className="size-5" />
        </Button>
      </form>

      <div className="grid grid-cols-2 gap-3">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-16 flex-col gap-1"
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
        </Button>

        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-16 flex-col gap-1"
          onClick={() => photoInputRef.current?.click()}
          disabled={busy !== null}
        >
          {busy === 'photo' ? (
            <Loader2Icon className="size-6 animate-spin" />
          ) : (
            <CameraIcon className="size-6" />
          )}
          <span className="text-sm">{t('photoButton')}</span>
        </Button>
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

      <p className="text-center text-muted-foreground text-xs">
        {t('photoNotKept')}
      </p>

      {permError ? (
        <p role="alert" className="text-center text-destructive text-sm">
          {permError}
        </p>
      ) : null}
    </div>
  );
}
