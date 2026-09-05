// Identity proposed from the git source of a service repo.
//
// The operator types the repo path first, and the last segment of that path is
// almost always what the service should be called — so both identity fields are
// offered filled rather than blank. Both stay editable: this proposes, it does
// not decide. `id` is the immutable half, so a wrong guess accepted by reflex is
// expensive; the guess is therefore kept literal (lowercase of the segment) and
// an illegal one is left for the field validator to reject in front of the
// operator, rather than being silently rewritten into something legal that they
// never chose.

/**
 * Last path segment of a git source, with the `.git` suffix and any trailing
 * slashes removed. Handles the scp-style remote (`user@host:path/repo.git`) as
 * well as a URL, because both are accepted by the git field.
 */
export function repoSegmentFromGit(git: string): string {
  const trimmed = git.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const withoutGitSuffix = trimmed.replace(/\.git$/i, '');
  // `:` separates host from path in the scp form; `/` everywhere else.
  const segment = withoutGitSuffix.split(/[/:]/).pop() ?? '';
  return segment.trim();
}

/** Proposed immutable identifier: the segment, lowercased. */
export function proposedId(git: string): string {
  return repoSegmentFromGit(git).toLowerCase();
}

/** Proposed display caption: the segment with its first character capitalized. */
export function proposedLabel(git: string): string {
  const segment = repoSegmentFromGit(git);
  if (!segment) return '';
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}
