# Rallypoint CLI

Install a repository-native operating protocol for coordinating planners,
workers, reviewers, testers, fixers, and janitors.

```bash
npx rallypoint@latest view loop
npx rallypoint@latest add loop --dry-run
npx rallypoint@latest add loop
```

The CLI is dependency-free. It ships with Rallypoint’s own checksummed registry,
refuses conflicting writes by default, and never requires the source repository
to be public.

Use `--force` only after reviewing conflicts. Use `--cwd <path>` to target a
repository other than the current directory.
