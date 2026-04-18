export interface SOQuestion {
  id: number;
  title: string;
  body: string;
  tags: string[];
  score: number;
  link: string;
  creation_date: number;
}

interface SOApiItem {
  question_id: number;
  title: string;
  body?: string;
  tags: string[];
  score: number;
  link: string;
  creation_date: number;
  backoff?: number;
}

interface SOApiResponse {
  items: SOApiItem[];
  backoff?: number;
  error_id?: number;
  error_message?: string;
}

export async function fetchQuestions(
  tags: string[],
  options?: {
    page?: number;
    pageSize?: number;
    minVotes?: number;
    apiKey?: string;
  }
): Promise<SOQuestion[]> {
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? 30;
  const minVotes = options?.minVotes ?? 0;
  const apiKey = options?.apiKey;

  const params = new URLSearchParams({
    order: "desc",
    sort: "votes",
    tagged: tags.join(";"),
    site: "stackoverflow",
    filter: "withbody",
    page: String(page),
    pagesize: String(pageSize),
  });

  if (apiKey) {
    params.set("key", apiKey);
  }

  const url = `https://api.stackexchange.com/2.3/questions?${params.toString()}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Stack Overflow API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as SOApiResponse;

  if (data.error_id !== undefined) {
    throw new Error(`Stack Overflow API error ${data.error_id}: ${data.error_message}`);
  }

  if (data.backoff !== undefined) {
    console.warn(`Stack Overflow API requested backoff of ${data.backoff} seconds`);
  }

  return data.items
    .filter((item) => item.score >= minVotes)
    .map((item) => ({
      id: item.question_id,
      title: item.title,
      body: item.body ?? "",
      tags: item.tags,
      score: item.score,
      link: item.link,
      creation_date: item.creation_date,
    }));
}
