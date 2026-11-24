import fs from "node:fs";
import path from "node:path";
import type { GeneratedAudio, OfflineTts } from "sherpa-onnx-node";

/**
 * 서버 TTS 엔진 (Supertonic 3, sherpa-onnx)
 *
 * - 모델은 처음 필요할 때 한 번 읽는다 (약 0.5초, 메모리 약 300MB).
 * - 생성은 sherpa-onnx의 비동기 API로 별도 스레드에서 돌아 이벤트 루프(주문 처리·실시간 연결)를 막지 않는다.
 * - 한 번에 하나씩만 만든다. CPU 2코어 서버에서 스레드 2개가 가장 빨랐다 (scripts/tts-bench).
 * - TTS_MODEL_DIR이 없거나 모델 파일이 빠졌으면 꺼진 상태로 두고, 직원 화면은 알림음만 낸다.
 *
 * Next 라우트 번들과 server.ts가 같은 프로세스에서 모듈을 따로 읽을 수 있어 globalThis에 하나만 둔다.
 */

export const MODEL_ID = "supertonic-3-int8-2026-05-11";

const FILES = {
  durationPredictor: "duration_predictor.int8.onnx",
  textEncoder: "text_encoder.int8.onnx",
  vectorEstimator: "vector_estimator.int8.onnx",
  vocoder: "vocoder.int8.onnx",
  ttsJson: "tts.json",
  unicodeIndexer: "unicode_indexer.bin",
  voiceStyle: "voice.bin",
} as const;

/** CommonJS 패키지라 동적 import 결과의 default에 실제 모듈이 들어 있다 (번들러·tsx에 따라 다름) */
type Sherpa = typeof import("sherpa-onnx-node");
async function loadSherpa(): Promise<Sherpa> {
  const mod = (await import("sherpa-onnx-node")) as unknown as Sherpa & { default?: Sherpa };
  return mod.default ?? mod;
}

export type SynthOptions = { sid: number; numSteps: number; speed: number };
export type EngineState = "disabled" | "idle" | "loading" | "ready" | "error";

class TtsEngine {
  state: EngineState;
  error: string | null = null;
  private tts: Promise<OfflineTts | null> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly modelDir: string | null,
    private readonly threads: number,
  ) {
    this.state = this.modelDir && this.missingFiles().length === 0 ? "idle" : "disabled";
    if (this.state === "disabled") {
      const why = this.modelDir ? `모델 파일 없음: ${this.missingFiles().join(", ")}` : "TTS_MODEL_DIR 미설정";
      console.warn(`[tts] 꺼짐 (${why}) — 직원 화면은 알림음만 냅니다`);
    }
  }

  get enabled() {
    return this.state !== "disabled" && this.state !== "error";
  }

  private missingFiles() {
    return Object.values(FILES).filter((f) => !fs.existsSync(path.join(this.modelDir!, f)));
  }

  /** 모델 읽기 (한 번만). 실패하면 꺼짐 처리 */
  load(): Promise<OfflineTts | null> {
    if (!this.enabled) return Promise.resolve(null);
    this.tts ??= (async () => {
      this.state = "loading";
      const start = performance.now();
      try {
        const { OfflineTts } = await loadSherpa();
        const p = (f: string) => path.join(this.modelDir!, f);
        const tts = await OfflineTts.createAsync({
          model: {
            supertonic: Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, p(f)])) as Record<keyof typeof FILES, string>,
            debug: false,
            numThreads: this.threads,
            provider: "cpu",
          },
        });
        this.state = "ready";
        console.log(`[tts] 모델 준비 ${(performance.now() - start).toFixed(0)}ms (${tts.sampleRate}Hz, 스레드 ${this.threads})`);
        return tts;
      } catch (e) {
        this.state = "error";
        this.error = e instanceof Error ? e.message : String(e);
        console.error("[tts] 모델을 읽지 못했어요 — 알림음만 냅니다", e);
        return null;
      }
    })();
    return this.tts;
  }

  /** 문장 하나 생성. 앞선 요청이 끝난 뒤 차례대로 실행 */
  synth(text: string, opts: SynthOptions): Promise<GeneratedAudio> {
    const run = async () => {
      const tts = await this.load();
      if (!tts) throw new Error("TTS를 쓸 수 없어요");
      const { GenerationConfig } = await loadSherpa();
      const generationConfig = new GenerationConfig({ ...opts, extra: { lang: "ko" } });
      return tts.generateAsync({ text, generationConfig });
    };
    const job = this.queue.then(run, run);
    this.queue = job.catch(() => {});
    return job;
  }
}

declare global {
  var __ttsEngine: TtsEngine | undefined;
}

export function ttsEngine(): TtsEngine {
  globalThis.__ttsEngine ??= new TtsEngine(
    process.env.TTS_MODEL_DIR ? path.resolve(/*turbopackIgnore: true*/ process.env.TTS_MODEL_DIR) : null,
    Math.max(1, Number(process.env.TTS_THREADS ?? 2) || 2),
  );
  return globalThis.__ttsEngine;
}
