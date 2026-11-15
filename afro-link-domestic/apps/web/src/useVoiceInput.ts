import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionResultLike {
  transcript: string;
}

interface RecognitionEvent {
  results: ArrayLike<ArrayLike<SpeechRecognitionResultLike>>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const VOICE_LOCALES: Record<string, string> = {
  en: 'en-US',
  am: 'am-ET',
  om: 'om-ET',
  so: 'so-ET',
  ti: 'ti-ET',
  sw: 'sw-KE',
};

export function useVoiceInput(lang: string, onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const supported = recognitionCtor() !== undefined;

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError('unsupported');
      return;
    }
    const rec = new Ctor();
    rec.lang = VOICE_LOCALES[lang] ?? 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      const text = last?.[0]?.transcript;
      if (text) onTranscript(text);
    };
    rec.onerror = (event) => {
      setError(event.error ?? 'error');
      setListening(false);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setError(null);
    setListening(true);
    rec.start();
  }, [lang, onTranscript]);

  useEffect(() => () => recRef.current?.stop(), []);

  return { supported, listening, start, stop, error };
}
