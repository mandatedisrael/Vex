import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetProviderModelCatalogForTests,
  loadProviderModelCatalog,
} from "../provider-model-catalog.js";

function model(overrides: Record<string, unknown> = {}) {
  return {
    id: "anthropic/claude-sonnet-4.5",
    name: "Anthropic: Claude Sonnet 4.5",
    contextLength: 200_000,
    supportedParameters: ["tools", "tool_choice"],
    pricing: { prompt: "0.000003", completion: "0.000015" },
    ...overrides,
  };
}

function clientFactory(data: ReadonlyArray<ReturnType<typeof model>>) {
  const list = vi.fn().mockResolvedValue({ data });
  return { list, factory: () => ({ models: { list } }) as never };
}

beforeEach(() => __resetProviderModelCatalogForTests());

describe("provider model catalogue", () => {
  it("normalizes, filters, projects, sorts, and converts prices", async () => {
    const client = clientFactory([
      model({ id: " openai/gpt ", name: " GPT ", pricing: { prompt: "0.0000000004", completion: "0.000015" } }),
      model(),
      model({ id: "legacy/text", supportedParameters: ["temperature"] }),
    ]);
    const result = await loadProviderModelCatalog({ clientFactory: client.factory });

    expect(result.models).toEqual([
      expect.objectContaining({ modelId: "anthropic/claude-sonnet-4.5", providerId: "anthropic" }),
      expect.objectContaining({
        modelId: "openai/gpt",
        displayName: "GPT",
        providerId: "openai",
        pricingInputPerMillion: 0.0004,
      }),
    ]);
    expect(client.list).toHaveBeenCalledWith(
      { outputModalities: "text", supportedParameters: "tools" },
      expect.objectContaining({ timeoutMs: 15_000 }),
    );
  });

  it("deduplicates normalized ids with first occurrence winning", async () => {
    const client = clientFactory([
      model({ id: " vendor/model ", name: "First" }),
      model({ id: "vendor/model", name: "Second" }),
    ]);
    const result = await loadProviderModelCatalog({ clientFactory: client.factory });
    expect(result.models).toHaveLength(1);
    expect(result.models[0]?.displayName).toBe("First");
  });

  it("sorts before retaining exactly the first 1,000 models", async () => {
    const client = clientFactory(
      Array.from({ length: 1_001 }, (_, index) => {
        const ordinal = String(1_000 - index).padStart(4, "0");
        return model({ id: `vendor/model-${ordinal}`, name: `Model ${ordinal}` });
      }),
    );
    const result = await loadProviderModelCatalog({ clientFactory: client.factory });
    expect(result.models).toHaveLength(1_000);
    expect(result.models[0]?.modelId).toBe("vendor/model-0000");
    expect(result.models.at(-1)?.modelId).toBe("vendor/model-0999");
    expect(result.models.some(({ modelId }) => modelId === "vendor/model-1000")).toBe(false);
  });

  it("reuses fresh cache and serves stale cache on non-abort failure", async () => {
    let now = 1_000;
    const initialClient = clientFactory([model()]);
    const initial = await loadProviderModelCatalog({
      clientFactory: initialClient.factory,
      now: () => now,
    });
    const unused = clientFactory([model({ id: "openai/unused" })]);
    expect(
      await loadProviderModelCatalog({ clientFactory: unused.factory, now: () => now + 1 }),
    ).toBe(initial);
    expect(unused.list).not.toHaveBeenCalled();

    now += 3_600_001;
    const failing = vi.fn().mockRejectedValue(new Error("offline"));
    expect(
      await loadProviderModelCatalog({
        clientFactory: () => ({ models: { list: failing } }) as never,
        now: () => now,
      }),
    ).toBe(initial);
  });

  it("rejects abort with stale cache and leaves the cache unchanged", async () => {
    let now = 1_000;
    const initialClient = clientFactory([model()]);
    const initial = await loadProviderModelCatalog({
      clientFactory: initialClient.factory,
      now: () => now,
    });
    now += 3_600_001;
    const abort = Object.assign(new Error("cancelled"), {
      name: "RequestAbortedError",
    });
    const abortedList = vi.fn().mockRejectedValue(abort);
    await expect(
      loadProviderModelCatalog({
        clientFactory: () => ({ models: { list: abortedList } }) as never,
        now: () => now,
      }),
    ).rejects.toBe(abort);

    const failing = vi.fn().mockRejectedValue(new Error("offline"));
    expect(
      await loadProviderModelCatalog({
        clientFactory: () => ({ models: { list: failing } }) as never,
        now: () => now,
      }),
    ).toBe(initial);
  });
});
