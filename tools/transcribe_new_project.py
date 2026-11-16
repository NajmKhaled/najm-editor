"""Locally transcribe one Arabic narration file with Whisper word timestamps."""
from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
import os
from pathlib import Path

try:
    import whisper
except ImportError:
    whisper = None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("source", type=Path)
    ap.add_argument("output", type=Path)
    ap.add_argument("--model", default="small")
    ap.add_argument("--preprocessed", action="store_true", help="Input is already a local 16 kHz mono WAV")
    args = ap.parse_args()

    with tempfile.TemporaryDirectory(prefix="najm_new_video_") as temp:
        wav = args.source if args.preprocessed else Path(temp) / "narration.wav"
        if not args.preprocessed:
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(args.source), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", str(wav)], check=True)
        if whisper is not None:
            cached = Path.home() / '.cache' / 'whisper' / (args.model + '.pt')
            if not cached.is_file():
                raise RuntimeError('LOCAL_ASR_MODEL_MISSING: install the selected Whisper model explicitly; no download attempted')
            model = whisper.load_model(str(cached))
            result = model.transcribe(str(wav), language="ar", task="transcribe", word_timestamps=True, fp16=False, verbose=False)
            engine = "openai-whisper"
        else:
            from faster_whisper import WhisperModel
            model = WhisperModel(args.model, device="cpu", compute_type="int8", local_files_only=True)
            segments, info = model.transcribe(str(wav), language="ar", task="transcribe", word_timestamps=True)
            segs = list(segments)
            result = {
                "language": info.language,
                "text": " ".join(s.text.strip() for s in segs),
                "segments": [
                    {
                        "text": s.text, "start": s.start, "end": s.end,
                        "avg_logprob": s.avg_logprob, "no_speech_prob": s.no_speech_prob,
                        "words": [{"word": w.word, "start": w.start, "end": w.end, "probability": w.probability} for w in (s.words or [])]
                    } for s in segs
                ],
            }
            engine = "faster-whisper"

    phrases = []
    words = []
    for segment in result.get("segments", []):
        phrases.append({"text": segment.get("text", "").strip(), "start": round(float(segment["start"]), 3),
                        "end": round(float(segment["end"]), 3), "avg_logprob": segment.get("avg_logprob"),
                        "no_speech_prob": segment.get("no_speech_prob")})
        for word in segment.get("words", []):
            words.append({"text": word["word"].strip(), "start": round(float(word["start"]), 3),
                          "end": round(float(word["end"]), 3), "probability": word.get("probability")})
    payload = {
        "schema_version": 1,
        "method": {"engine": engine + " (local open-source)", "model": args.model, "language_hint": "ar",
                   "word_timestamps": True, "paid_api_used": False},
        "source_path": str(args.source.resolve()),
        "detected_language": result.get("language"),
        "raw_text": result.get("text", "").strip(),
        "normalized_text": result.get("text", "").strip(),
        "phrases": phrases,
        "words": words,
        "review_notes": [],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
