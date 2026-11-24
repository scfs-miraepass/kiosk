/** sherpa-onnx-node에는 타입 선언이 없어 쓰는 부분만 선언한다 */
declare module "sherpa-onnx-node" {
  export type GeneratedAudio = { samples: Float32Array; sampleRate: number };

  export class GenerationConfig {
    constructor(opts: { sid?: number; numSteps?: number; speed?: number; extra?: Record<string, string> });
  }

  export type OfflineTtsConfig = {
    model: {
      supertonic?: {
        durationPredictor: string;
        textEncoder: string;
        vectorEstimator: string;
        vocoder: string;
        ttsJson: string;
        unicodeIndexer: string;
        voiceStyle: string;
      };
      debug?: boolean;
      numThreads?: number;
      provider?: "cpu";
    };
  };

  export class OfflineTts {
    static createAsync(config: OfflineTtsConfig): Promise<OfflineTts>;
    readonly sampleRate: number;
    readonly numSpeakers: number;
    generateAsync(req: { text: string; generationConfig: GenerationConfig }): Promise<GeneratedAudio>;
  }
}
