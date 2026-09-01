import { createHash } from 'node:crypto';

/**
 * Model provider abstraction.
 *
 * The runtime never calls a model directly. Two implementations exist: a
 * deterministic offline provider (the default, and the only one the test suite
 * uses) and a thin Claude adapter. The whole build — including every test —
 * runs without paid API access.
 */

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  /** What this call is for; the mock provider keys its responses off this. */
  purpose: string;
  system?: string;
  messages: LlmMessage[];
  max_tokens?: number;
  /** When set, the provider is asked to return JSON matching this shape. */
  expect_json?: boolean;
}

export interface LlmUsage {
  model_calls: number;
  tokens_in: number;
  tokens_out: number;
  estimated_cost: number;
}

export interface LlmResponse {
  text: string;
  json: unknown | null;
  usage: LlmUsage;
  model: string;
  provider: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** Rough token estimate; exact accounting is the provider's own usage report. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export type MockResponder = (request: LlmRequest, seed: number) => { text: string; json?: unknown };

/**
 * Deterministic provider.
 *
 * Same request in, same response out, with no network access and no clock
 * dependence. Responders are registered per purpose so a test can assert on
 * exact runtime behaviour rather than on a model's mood.
 */
export class DeterministicMockProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model = 'deterministic-mock-1';
  private readonly responders = new Map<string, MockResponder>();
  readonly calls: LlmRequest[] = [];

  constructor(responders: Record<string, MockResponder> = {}) {
    for (const [purpose, responder] of Object.entries(responders)) {
      this.responders.set(purpose, responder);
    }
  }

  register(purpose: string, responder: MockResponder): void {
    this.responders.set(purpose, responder);
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    const payload = JSON.stringify({
      purpose: request.purpose,
      system: request.system ?? '',
      messages: request.messages,
    });
    const seed = parseInt(createHash('sha256').update(payload).digest('hex').slice(0, 8), 16);

    const responder = this.responders.get(request.purpose);
    const result = responder
      ? responder(request, seed)
      : {
          text: `[mock:${request.purpose}] no responder registered`,
          json: { purpose: request.purpose, deterministic_seed: seed },
        };

    const tokensIn = estimateTokens(payload);
    const tokensOut = estimateTokens(result.text);

    return {
      text: result.text,
      json: result.json ?? null,
      usage: {
        model_calls: 1,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        // A nominal, provider-neutral unit price keeps budget arithmetic
        // exercised in tests without implying a real tariff.
        estimated_cost: Number(((tokensIn * 1e-6 + tokensOut * 5e-6)).toFixed(8)),
      },
      model: this.model,
      provider: this.name,
    };
  }
}

const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  // USD per token, from the published per-MTok rates.
  'claude-opus-5': { input: 5 / 1_000_000, output: 25 / 1_000_000 },
  'claude-sonnet-5': { input: 2 / 1_000_000, output: 10 / 1_000_000 },
  'claude-haiku-4-5': { input: 1 / 1_000_000, output: 5 / 1_000_000 },
};

/**
 * Claude adapter.
 *
 * The SDK is an optional dependency, imported lazily, so a checkout that never
 * sets WORKFORCE_LLM_PROVIDER=anthropic does not need it installed. This path
 * is not exercised by the test suite — it requires a real API key — and is
 * listed as such in docs/V04_TEST_REPORT.md.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private client: unknown = null;

  constructor(
    private readonly apiKey: string,
    model = 'claude-opus-5',
  ) {
    this.model = model;
  }

  private async getClient(): Promise<{
    messages: {
      create(body: Record<string, unknown>): Promise<{
        content: { type: string; text?: string }[];
        usage: { input_tokens: number; output_tokens: number };
        stop_reason: string;
      }>;
    };
  }> {
    if (!this.client) {
      const mod = (await import('@anthropic-ai/sdk')) as unknown as {
        default: new (opts: { apiKey: string }) => unknown;
      };
      const Ctor = mod.default;
      this.client = new Ctor({ apiKey: this.apiKey });
    }
    return this.client as never;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const client = await this.getClient();
    const system = request.expect_json
      ? `${request.system ?? ''}\n\nRespond with a single JSON object and no other text.`.trim()
      : request.system;

    const response = await client.messages.create({
      model: this.model,
      max_tokens: request.max_tokens ?? 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      ...(system ? { system } : {}),
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n');

    let json: unknown = null;
    if (request.expect_json) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          json = JSON.parse(match[0]);
        } catch {
          json = null;
        }
      }
    }

    const pricing = ANTHROPIC_PRICING[this.model] ?? { input: 0, output: 0 };
    return {
      text,
      json,
      usage: {
        model_calls: 1,
        tokens_in: response.usage.input_tokens,
        tokens_out: response.usage.output_tokens,
        estimated_cost: Number(
          (response.usage.input_tokens * pricing.input + response.usage.output_tokens * pricing.output).toFixed(8),
        ),
      },
      model: this.model,
      provider: this.name,
    };
  }
}

export function createProviderFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const kind = env.WORKFORCE_LLM_PROVIDER ?? 'mock';
  if (kind === 'anthropic') {
    const key = env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error(
        'WORKFORCE_LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY. Use the default "mock" provider for offline runs.',
      );
    }
    return new AnthropicProvider(key, env.WORKFORCE_LLM_MODEL ?? 'claude-opus-5');
  }
  return new DeterministicMockProvider();
}
