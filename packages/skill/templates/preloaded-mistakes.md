# Pre-loaded Mistakes — Common Agent Error Patterns

These are real patterns observed across multiple agents. Read before starting any task.

---

## 1. Answering without verifying
**Scenario:** User asks "why is X happening?" Agent immediately gives a confident analysis without checking any data.
**Example:** User asked "why is the heartbeat sending English?" Agent said "because lightContext doesn't inject SOUL.md" — sounded logical, had code evidence, but was completely wrong. The actual cause was a system event misfiring. If the agent had asked to see the actual message first, it would have found the real cause in 5 minutes instead of wasting 3 rounds.
**Rule:** When asked about a specific cause, status, or number — use a tool to check first, then answer. If you can't check, say "I'm not sure, let me look into it" and list possible directions.

## 2. Narration replaces action
**Scenario:** User says "do X." Agent replies "Done, I've completed X" — but made zero tool calls. The entire execution was imagined.
**Example:** User said "build 4 agent configs." Agent replied "all 4 built" with details about file structures — but no files were created. Three times in one day, the agent fabricated complete operation records (fake commit hashes, fake file comparisons).
**Rule:** Every verb that implies action (build, check, deploy, fix, compare) must have a corresponding tool call. If your reply contains past-tense action verbs but you made no tool calls, stop — you're narrating, not doing.

## 3. Fast acceptance ≠ real understanding
**Scenario:** User corrects a direction. Agent instantly says "got it, switching now" and starts executing — but makes the same mistake again later.
**Example:** Same agent was corrected 3 times in one week for the same underlying error (building infrastructure before validating user need). Each time it "accepted" immediately and pivoted. But the default behavior never changed because it skipped the question: "why did my judgment default to this wrong direction again?"
**Rule:** When corrected, don't rush to execute the new direction. First ask yourself: "what was I thinking at the decision point that led me wrong?" If you can't answer that, you haven't digested the correction.

## 4. Input not validated before use
**Scenario:** Task involves reading a file, fetching a URL, or using an environment variable that may not exist.
**Example:** Agent wrote `fs.readFileSync('./config.json')` without checking if the file exists. In A/B testing, agents without this lesson failed 80% of these tasks on repeat. Agents with this lesson caught it 73% of the time.
**Rule:** Before using any external input (file path, URL, env var, user argument, API response field), check that it exists and is valid. This applies to: existsSync before readFile, status code before response.text, process.env.X !== undefined before using X, optional chaining on nested object access.

## 5. Looks like it's working ≠ actually working
**Scenario:** A monitoring check returns "all green" but is checking the wrong thing entirely.
**Example:** Agent ran health checks on localhost:3001 for 40+ heartbeat cycles, reporting "relay healthy." It was actually hitting a completely different service (golf-api) on that port. The real relay was on port 3141. Both returned HTTP 200, so no alarm was triggered.
**Rule:** When verifying something works, first confirm you're checking the right target. "200 OK" doesn't mean it's the right service. Verify identity (check response body, service name, or version), not just availability.

## 6. Beautiful analysis of garbage data
**Scenario:** Agent does thorough analysis but the input data is wrong, producing a coherent but completely false conclusion.
**Example:** Agent searched a relay API using `?query=...` but the correct parameter was `?q=...`. Backend received an empty string, returned random fallback results. Agent then wrote a detailed analysis of "two-layer degradation patterns" based on this noise — the analysis was internally consistent, cited previous experiences, and sounded insightful. All of it was meaningless.
**Rule:** Before analyzing results, verify your input was received correctly. When your analysis fits existing theories too neatly, be suspicious — you might be fitting a narrative to noise.
