// The reply kiss posts is the `Reply` field of the agent's [RESULT] block.
// A port of the field parsing in kiss's `parsePromptResult` (kiss
// src/services/prompts.ts): only known field names start a field, never
// inside fenced code, and an accidental YAML block-scalar wrapper is
// stripped. Contract-tested against kiss's own parser.

// kiss prompts.ts KNOWN_RESULT_FIELDS, verbatim.
export const KNOWN_RESULT_FIELDS = [
  "Status",
  "Changed",
  "Title",
  "Description",
  "Reviewer",
  "Branch",
  "Labels",
  "Validation",
  "Risk",
  "FailureType",
  "Commit",
  "Reply",
  "Review",
];

const YAML_BLOCK_SCALAR_FIELDS = ["Description", "Validation", "Risk", "Reply", "Review"];
const RESULT_BLOCK_REGEX = /\[RESULT\]\s*\n([\s\S]*?)(?:\n\s*\[\/RESULT\]|$)/i;

function stripYamlBlockScalar(value: string): string {
  const lines = value.split("\n");
  if (!/^[>|][+-]?\s*$/.test(lines[0]!) || !lines.slice(1).some((line) => line.trim())) return value;
  const content = lines.slice(1);
  const indentation = content
    .filter((line) => line.trim())
    .reduce<number | undefined>((minimum, line) => {
      const width = line.match(/^\s*/)?.[0].length ?? 0;
      return minimum === undefined ? width : Math.min(minimum, width);
    }, undefined);
  return content
    .map((line) => (indentation ? line.slice(indentation) : line))
    .join("\n")
    .trim();
}

export function parseResultFields(result: string): Record<string, string> {
  const match = result.match(RESULT_BLOCK_REGEX);
  if (!match) return {};
  const fields: Record<string, string> = {};
  let currentKey: string | null = null;
  let currentValue: string[] = [];
  let inCodeBlock = false;
  for (const line of match[1]!.split("\n")) {
    if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) inCodeBlock = !inCodeBlock;
    const keyMatch = !inCodeBlock ? line.match(/^(\w[\w\s]*?):\s*(.*)/) : null;
    if (keyMatch && KNOWN_RESULT_FIELDS.includes(keyMatch[1]!.trim())) {
      if (currentKey) fields[currentKey] = currentValue.join("\n").trim();
      currentKey = keyMatch[1]!.trim();
      currentValue = [keyMatch[2]!];
    } else if (currentKey) {
      currentValue.push(line);
    }
  }
  if (currentKey) fields[currentKey] = currentValue.join("\n").trim();
  for (const key of YAML_BLOCK_SCALAR_FIELDS) if (fields[key]) fields[key] = stripYamlBlockScalar(fields[key]!);
  return fields;
}

/** The text to post: the Reply field, else the whole answer. */
export function replyText(answer: string): string {
  const reply = parseResultFields(answer).Reply;
  return reply ? reply : answer.trim();
}

/** kiss utils/helpers.ts sanitizeBranchName, verbatim. */
export function sanitizeBranchName(name: string, maxLength = 250): string {
  const sanitized = name
    .replace(/[^A-Za-z0-9-_/.]/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/-{2,}/g, "-")
    .replace(/^[/_-]+|[/_-]+$/g, "");
  return sanitized.length <= maxLength ? sanitized : sanitized.slice(0, maxLength).replace(/[_/-]+$/, "");
}

/** kiss services/utils.ts generateMRDescription, verbatim. */
export function defaultMRDescription(prompt: string): string {
  return `
## 🤖 AI-Generated Merge Request

### Original Request
\`\`\`
${prompt}
\`\`\`

### Implementation Details
The AI analyzed the request and implemented the necessary changes following best practices.

### Checklist
- [ ] Code review completed
- [ ] Tests passing (if applicable)
- [ ] Documentation updated
- [ ] No breaking changes

---
*Please review the changes carefully and provide feedback if adjustments are needed.*
    `;
}
