import { useEffect, useState } from "react";

interface VoiceSelectorProps {
  language: string;
  selectedVoice: string | undefined;
  onChange: (voice: string) => void;
}

export function VoiceSelector({ language, selectedVoice, onChange }: VoiceSelectorProps) {
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadVoices = () => {
      if (!window.speechSynthesis) {
        setIsLoading(false);
        return;
      }

      const voices = window.speechSynthesis.getVoices();
      
      // Map language setting to speech synthesis language code
      let targetLang = "en";
      if (language === "Română") targetLang = "ro";
      else if (language === "Magyar") targetLang = "hu";
      else if (language === "Español") targetLang = "es";
      else if (language === "Deutsch") targetLang = "de";

      // Filter voices by language
      const filteredVoices = voices.filter((v) => v.lang.startsWith(targetLang));
      setAvailableVoices(filteredVoices);
      setIsLoading(false);

      // If no voice selected yet, select first available
      if (!selectedVoice && filteredVoices.length > 0) {
        onChange(filteredVoices[0].name);
      }
    };

    // Voices may load asynchronously
    if (window.speechSynthesis.getVoices().length > 0) {
      loadVoices();
    } else {
      window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
      return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
    }
  }, [language, selectedVoice, onChange]);

  if (isLoading) {
    return <div className="text-sm text-ytm-text-secondary">Loading voices...</div>;
  }

  if (availableVoices.length === 0) {
    return (
      <div className="text-sm text-ytm-text-secondary">
        No voices available for this language. Check your system text-to-speech settings.
      </div>
    );
  }

  return (
    <select
      value={selectedVoice || ""}
      onChange={(e) => onChange(e.target.value)}
      className="bg-ytm-bg border border-ytm-border rounded-lg px-3 py-2 text-sm w-full"
    >
      <option value="">Default voice for {language}</option>
      {availableVoices.map((voice) => (
        <option key={voice.name} value={voice.name}>
          {voice.name} {voice.default ? "(default)" : ""} {voice.lang}
        </option>
      ))}
    </select>
  );
}
