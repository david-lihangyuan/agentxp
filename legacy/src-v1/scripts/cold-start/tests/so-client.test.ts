import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchQuestions, SOQuestion } from "../so-client.js";

const mockItem = (overrides: Partial<{
  question_id: number;
  title: string;
  body: string;
  tags: string[];
  score: number;
  link: string;
  creation_date: number;
}> = {}) => ({
  question_id: 1,
  title: "How to use TypeScript generics?",
  body: "<p>I want to learn generics.</p>",
  tags: ["typescript", "generics"],
  score: 42,
  link: "https://stackoverflow.com/questions/1",
  creation_date: 1700000000,
  ...overrides,
});

function makeResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchQuestions", () => {
  it("fetches questions and maps fields correctly", async () => {
    const fetchMock = vi.fn().mockReturnValue(
      makeResponse({ items: [mockItem()] })
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await fetchQuestions(["typescript"]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const calledUrl: string = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain("api.stackexchange.com/2.3/questions");
    expect(calledUrl).toContain("tagged=typescript");

    expect(results).toHaveLength(1);
    const q: SOQuestion = results[0];
    expect(q.id).toBe(1);
    expect(q.title).toBe("How to use TypeScript generics?");
    expect(q.body).toBe("<p>I want to learn generics.</p>");
    expect(q.tags).toEqual(["typescript", "generics"]);
    expect(q.score).toBe(42);
    expect(q.link).toBe("https://stackoverflow.com/questions/1");
    expect(q.creation_date).toBe(1700000000);
  });

  it("filters out questions below minVotes threshold", async () => {
    const items = [
      mockItem({ question_id: 1, score: 100 }),
      mockItem({ question_id: 2, score: 5 }),
      mockItem({ question_id: 3, score: 50 }),
    ];
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(makeResponse({ items })));

    const results = await fetchQuestions(["typescript"], { minVotes: 10 });

    expect(results).toHaveLength(2);
    expect(results.map((q) => q.id)).toEqual([1, 3]);
  });

  it("logs a warning when API returns backoff but does not throw", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(makeResponse({ items: [mockItem()], backoff: 10 }))
    );

    const results = await fetchQuestions(["typescript"]);

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatch(/backoff.*10/i);
    expect(results).toHaveLength(1);
  });

  it("throws on non-ok HTTP response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        Promise.resolve(new Response("Forbidden", { status: 403, statusText: "Forbidden" }))
      )
    );

    await expect(fetchQuestions(["typescript"])).rejects.toThrow(
      /Stack Overflow API error: 403/
    );
  });
});
