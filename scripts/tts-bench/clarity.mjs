/**
 * 발음 비교용: 숫자 표기·품질 단계(numSteps)·속도를 바꿔 같은 문장을 만든다 (화자 sid 0, 스레드 2)
 *
 * 실행: SCRIPT=clarity.mjs ./run.sh
 * 결과: out/clarity/<문장>_<숫자표기>_steps<N>_speed<S>.wav, out/clarity/times.txt
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const sherpa = require("sherpa-onnx-node");

const MODEL_DIR = process.env.MODEL_DIR ?? "model/sherpa-onnx-supertonic-3-tts-int8-2026-05-11";
const OUT_DIR = path.join(process.env.OUT_DIR ?? "out", "clarity");
const SID = Number(process.env.SID ?? 0);
const STEPS = (process.env.STEPS ?? "8,16,32").split(",").map(Number);
const SPEEDS = (process.env.SPEEDS ?? "1,0.85").split(",").map(Number);

/** 0~9999 정수를 한자어 수사로 읽는다 (3 → 삼, 12 → 십이, 2026 → 이천이십육) */
export function sinoKorean(n) {
  if (!Number.isInteger(n) || n < 0 || n > 9999) return String(n);
  if (n === 0) return "영";
  const digits = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
  const units = ["천", "백", "십", ""];
  return String(n)
    .padStart(4, "0")
    .split("")
    .map((d, i) => {
      const v = Number(d);
      if (v === 0) return "";
      // 십·백·천 앞의 '일'은 읽지 않는다 (10 → 십, 100 → 백)
      return (v === 1 && i < 3 ? "" : digits[v]) + units[i];
    })
    .join("");
}

const hangulNumbers = (text) => text.replace(/\d+/g, (m) => sinoKorean(Number(m)));

const SENTENCES = [
  ["s-hong", "3학년 홍길동님, 주문하신 음료가 나왔습니다."],
  ["s-yoonseo", "1학년 최윤서님, 주문하신 음료가 나왔습니다."],
  ["s-namgung", "2학년 남궁민님, 주문하신 음료가 나왔습니다."],
  ["t-oh", "오은영 선생님, 주문하신 음료가 나왔습니다."],
  ["new-order", "주문이 들어왔어요."],
];

const p = (f) => path.join(MODEL_DIR, f);
const tts = new sherpa.OfflineTts({
  model: {
    supertonic: {
      durationPredictor: p("duration_predictor.int8.onnx"),
      textEncoder: p("text_encoder.int8.onnx"),
      vectorEstimator: p("vector_estimator.int8.onnx"),
      vocoder: p("vocoder.int8.onnx"),
      ttsJson: p("tts.json"),
      unicodeIndexer: p("unicode_indexer.bin"),
      voiceStyle: p("voice.bin"),
    },
    debug: false,
    numThreads: 2,
    provider: "cpu",
  },
});

function generate(text, numSteps, speed) {
  const generationConfig = new sherpa.GenerationConfig({ sid: SID, numSteps, speed, extra: { lang: "ko" } });
  const start = performance.now();
  const audio = tts.generate({ text, generationConfig });
  return { audio, ms: performance.now() - start };
}

mkdirSync(OUT_DIR, { recursive: true });
generate("준비 운동입니다.", 8, 1); // 첫 호출 제외

const lines = [];
const log = (s) => {
  console.log(s);
  lines.push(s);
};

for (const [key, raw] of SENTENCES) {
  const variants = /\d/.test(raw)
    ? [
        ["digit", raw],
        ["hangul", hangulNumbers(raw)],
      ]
    : [["text", raw]];
  for (const [label, text] of variants) {
    for (const numSteps of STEPS) {
      for (const speed of SPEEDS) {
        const { audio, ms } = generate(text, numSteps, speed);
        const file = `${key}_${label}_steps${numSteps}_speed${speed}.wav`;
        sherpa.writeWave(path.join(OUT_DIR, file), { samples: audio.samples, sampleRate: audio.sampleRate });
        log(`${file.padEnd(48)} ${ms.toFixed(0).padStart(5)}ms  "${text}"`);
      }
    }
  }
}

writeFileSync(path.join(OUT_DIR, "times.txt"), lines.join("\n") + "\n");
console.log(`\n듣기용 파일: ${OUT_DIR}/`);
