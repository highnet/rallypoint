# Playbooks

One file per target: `.rallypoint/swarm/playbooks/<target-id>.md`. Every
session that touches a target reads its playbook first. Every session that
learns something general about the target writes it back, in the same pull
request as the change, or in its burial lesson. A failed idea still leaves a
lesson here.

Playbooks are tunable: the steward may edit them, and so may any worker
whose change taught something.

## Template

```markdown
# <Target name>

## How it works
The shape of this part of the code: entry points, the hot path, how it is
measured (which referee mode, which command, what the noise looks like).

## What to try
Ideas not yet tested, best first, each with the concept it belongs to.

## What failed, and why
- <idea> — buried in #<n>: <the numbers>. Lesson: <…>.

## Rules of thumb
Things every session should know before touching this target.
```
