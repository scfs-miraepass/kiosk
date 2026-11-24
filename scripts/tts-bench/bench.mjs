/**
 * 서버 TTS(Supertonic 3, sherpa-onnx) 성능 측정
 *
 * 측정하는 것
 * - 모델 로딩 시간, 메모리(RSS)
 * - 스레드 수·품질 단계(numSteps)별 문장 생성 시간과 RTF(생성 시간 ÷ 음성 길이)
 * - 생성한 음성 파일(out/) — 이름 발음·음질은 직접 들어서 확인
 *
 * 실행: ./run.sh (Docker) 또는 MODEL_DIR=... node bench.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const sherpa = require("sherpa-onnx-node");

const MODEL_DIR = process.env.MODEL_DIR ?? "model/sherpa-onnx-supertonic-3-tts-int8-2026-05-11";
const OUT_DIR = process.env.OUT_DIR ?? "out";
const THREADS = (process.env.THREADS ?? "1,2,4").split(",").map(Number);
const STEPS = (process.env.STEPS ?? "4,8").split(",").map(Number);
const SID = Number(process.env.SID ?? 0);

const NEW_ORDER = "주문이 들어왔어요.";
const student = (grade, name) => `${grade}학년 ${name}님, 주문하신 음료가 나왔습니다.`;
const teacher = (name) => `${name} 선생님, 주문하신 음료가 나왔습니다.`;

const SENTENCES = [
  ["new-order", NEW_ORDER],
  ["s-hong", student(3, "홍길동")],
  ["s-minjun", student(1, "김민준")],
  ["s-seoyeon", student(2, "이서연")],
  ["s-jihoon", student(3, "박지훈")],
  ["s-yoonseo", student(1, "최윤서")],
  ["s-haeun", student(2, "정하은")],
  ["s-namgung", student(3, "남궁민")],
  ["s-seonwoo", student(1, "선우진")],
  ["s-ryu", student(2, "류이령")],
  ["t-kim", teacher("김선생")],
  ["t-oh", teacher("오은영")],
];

const p = (f) => path.join(MODEL_DIR, f);
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(0);
const rssMb = () => mb(process.memoryUsage().rss);

function createTts(numThreads) {
  return new sherpa.OfflineTts({
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
      numThreads,
      provider: "cpu",
    },
  });
}

function generate(tts, text, { sid = SID, numSteps, speed = 1 }) {
  const generationConfig = new sherpa.GenerationConfig({ sid, numSteps, speed, extra: { lang: "ko" } });
  const start = performance.now();
  const audio = tts.generate({ text, generationConfig });
  const ms = performance.now() - start;
  const seconds = audio.samples.length / audio.sampleRate;
  return { audio, ms, seconds, rtf: ms / 1000 / seconds };
}

const pct = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

mkdirSync(OUT_DIR, { recursive: true });
console.log(`CPU: ${os.cpus()[0]?.model ?? "?"} × ${os.availableParallelism()} (Node에서 보이는 코어 수)`);
console.log(`메모리: 전체 ${mb(os.totalmem())}MB, 시작 RSS ${rssMb()}MB`);
console.log(`모델: ${MODEL_DIR}\n`);

const summary = [];

for (const numThreads of THREADS) {
  const loadStart = performance.now();
  const tts = createTts(numThreads);
  const loadMs = performance.now() - loadStart;
  console.log(`── 스레드 ${numThreads}: 모델 로딩 ${loadMs.toFixed(0)}ms, RSS ${rssMb()}MB, 출력 ${tts.sampleRate}Hz`);

  for (const numSteps of STEPS) {
    generate(tts, "준비 운동입니다.", { numSteps }); // 첫 호출은 느리므로 제외

    const times = [];
    const rtfs = [];
    for (const [key, text] of SENTENCES) {
      const r = generate(tts, text, { numSteps });
      times.push(r.ms);
      rtfs.push(r.rtf);
      // 듣기용 파일은 스레드 수와 무관하므로 첫 스레드 설정에서만 저장
      if (numThreads === THREADS[0]) {
        sherpa.writeWave(path.join(OUT_DIR, `steps${numSteps}-${key}.wav`), {
          samples: r.audio.samples,
          sampleRate: r.audio.sampleRate,
        });
      }
    }
    const row = {
      threads: numThreads,
      steps: numSteps,
      avgMs: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
      p95Ms: Math.round(pct(times, 0.95)),
      maxMs: Math.round(Math.max(...times)),
      avgRtf: +(rtfs.reduce((a, b) => a + b, 0) / rtfs.length).toFixed(3),
      rssMb: Number(rssMb()),
    };
    summary.push(row);
    console.log(
      `   steps ${numSteps}: 평균 ${row.avgMs}ms, p95 ${row.p95Ms}ms, 최대 ${row.maxMs}ms, RTF ${row.avgRtf}, RSS ${row.rssMb}MB`,
    );
  }

  // 목소리 비교용: 첫 스레드 설정에서 화자 0~9로 같은 문장 저장
  if (numThreads === THREADS[0]) {
    for (let sid = 0; sid < 10; sid++) {
      const r = generate(tts, student(3, "홍길동"), { sid, numSteps: Math.max(...STEPS) });
      sherpa.writeWave(path.join(OUT_DIR, `voice-sid${sid}.wav`), { samples: r.audio.samples, sampleRate: r.audio.sampleRate });
    }
  }
}

const peak = process.resourceUsage().maxRSS * 1024;
console.log(`\n최대 RSS: ${mb(peak)}MB`);
console.table(summary);
writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify({ cpu: os.cpus()[0]?.model, cores: os.availableParallelism(), peakRssMb: Number(mb(peak)), summary }, null, 2));
console.log(`듣기용 파일: ${OUT_DIR}/ (steps*-*.wav: 품질 단계별, voice-sid*.wav: 목소리 10종)`);
