import { registerBundledSkill } from '../bundledSkills.js'

const HUNTER_PROMPT = `# Bug hunt {{scope}}

You are hunting for real defects in a set of changes and producing a review artifact the team can act on. Findings must be verified against the code, not guessed from the diff.

## Step 1: Establish the scope
- If a scope was given above, use it (a PR number via \`gh pr diff\`, a commit range, a branch, or a list of files).
- Otherwise use the working tree: \`git diff\` plus \`git diff --cached\`; if both are empty, use \`git diff origin/HEAD...HEAD\` or the last commit.
- List the changed files and skim the whole diff once before digging in.

## Step 2: Hunt
For each hunk, ask what could go wrong at runtime and check it by reading the surrounding code (callers, callees, types, tests), not only the diff:
- correctness: wrong conditions, off-by-one, null/undefined paths, error handling that swallows failures, async ordering, resource leaks
- contract breaks: changed signatures or return shapes with callers not updated, serialization or schema mismatches
- security: injection, path traversal, unsafe shell or SQL construction, secrets in logs
- concurrency and state: races, shared mutable state, missing cleanup
- tests: behaviour changed without a test, tests that cannot fail
Confirm each candidate with a concrete failure scenario (inputs or state, then the wrong outcome). Drop anything you cannot confirm or that is a style preference.

## Step 3: Write the artifact
Write a Markdown report to \`.claude/reviews/<YYYY-MM-DD>-hunter-<short-scope>.md\` (create the directory if needed) with:
1. Scope and how it was obtained
2. Findings, most severe first. For each: title, file:line, severity (blocker / high / medium / low), the failure scenario, and a suggested fix
3. Things checked and found fine (one line each), so nobody re-reviews them
4. Open questions that need the author

## Step 4: Report
Tell the user the path of the artifact and summarize the findings in a short list (one line per finding with file:line). If there are no confirmed findings, say so plainly and name what you checked.`

export function registerHunterSkill(): void {
  registerBundledSkill({
    name: 'hunter',
    description:
      'Hunts for verified bugs in a diff, PR or branch and writes a review artifact (Markdown report with findings, severities and fixes)',
    whenToUse:
      'When the user wants a thorough bug-focused review of changes with a written report, or asks to "hunt for bugs", "find what is wrong with this PR", or produce a review artifact.',
    argumentHint: '[PR number | commit range | branch | files]',
    userInvocable: true,
    async getPromptForCommand(args) {
      const scope = args?.trim() ? `\n\nScope requested: ${args.trim()}` : ''
      return [{ type: 'text', text: HUNTER_PROMPT.replace('{{scope}}', scope) }]
    },
  })
}
