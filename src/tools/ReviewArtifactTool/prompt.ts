export const REVIEW_ARTIFACT_TOOL_NAME = 'ReviewArtifact'

export const REVIEW_ARTIFACT_PROMPT = `Publish a review artifact: a Markdown report of a code review, bug hunt or audit that the team can read and act on without the transcript.

The user is shown the title and a preview and approves before anything is written. Reports go under \`.claude/reviews/\` in the project unless a path is given. Include: scope, findings ordered by severity with file:line references and a concrete failure scenario each, what was checked and found fine, and open questions. Call it once per review, at the end.`
