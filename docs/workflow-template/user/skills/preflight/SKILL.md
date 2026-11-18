---
name: preflight
description: Check the environment before starting work that depends on services, a deploy or a clean build: right folder, agents and skills loaded, services up, git state, stale caches. Use at the start of a session or when something odd happens that may not be a code bug.
---

# Preflight

Run these checks and report only what needs the user's attention.

1. **Where am I?** Print the working directory, the git root and the current branch. Confirm it is the project the user means (a session started in a parent folder will not load the project's agents or skills); list the project's `.claude/agents` and `.claude/skills` and say if they appear to be loaded.
2. **Git.** `git fetch`, then `git status -sb`. Say if the branch is behind its upstream, if local `main` is behind `origin/main`, and if there are uncommitted changes.
3. **Running processes.** Look for leftover dev servers, test hosts or the app/game itself (`Get-Process`), and say if a build could be stale or locked because of them. Do not stop anything that was not started in this session without asking.
4. **Services.** Check what the task depends on: database services (Postgres, MariaDB), local ports, deployed functions, a CI or Pages deployment. Report reachable or not.
5. **Caches.** For web or PWA work, note any service worker or CDN cache that can serve old code (for example a cache-version constant in `sw.js`) and whether the latest commit is deployed.
6. **Tooling.** Confirm the commands the task needs exist (`node`, `dotnet`, `gh`, `python`) and which shell is in use.

Finish with a short list: ready, or the exact things the user has to do.
