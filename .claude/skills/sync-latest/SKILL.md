---
name: sync-latest
description: Check whether the local git checkout is behind its GitHub remote and, when it is safe to do so, fast-forward it up to date. Use at the start of a work session — especially when moving between machines (e.g. home vs work) — to make sure you're on the latest pushed code before making any changes. Never discards uncommitted or unpushed work.
---

# Sync to latest

Bring the current repository up to date with its GitHub remote, **safely**. The
guiding rule: this skill must never lose work. It only updates automatically
when doing so cannot cause a conflict or discard anything; in every other case
it reports the situation and asks the user how to proceed.

## Procedure

Run these steps in order using the shell tool (use whichever shell the
environment provides).

1. **Confirm this is a git repo and find the branch.**
   - `git rev-parse --abbrev-ref HEAD` → current branch.
   - If it prints `HEAD` (detached) or the command fails, stop and report — there
     is no branch to sync. Do not guess.

2. **Find the upstream (the GitHub branch this tracks).**
   - `git rev-parse --abbrev-ref --symbolic-full-name @{u}` → e.g. `origin/main`.
   - If it fails (no upstream configured), fall back to `origin/<branch>` if that
     ref exists (`git ls-remote --heads origin <branch>`). If there is no remote
     branch either, stop and report — nothing to sync against.

3. **Fetch from GitHub (this is the "check" — it does not touch your files).**
   - `git fetch origin`
   - If it fails (no network / auth), stop and report the error verbatim. When
     working from home this usually means VPN or GitHub auth — say so.

4. **Compare local vs remote.**
   - `git rev-list --left-right --count HEAD...@{u}` → prints `<ahead>  <behind>`.
     - `ahead`  = local commits not on the remote (your unpushed work).
     - `behind` = remote commits you don't have yet.
   - Also check the working tree: `git status --porcelain` (empty = clean).

5. **Act based on the four cases below.** Then always finish by reporting: the
   branch, ahead/behind counts, what you did (or didn't), and a one-line summary
   of any incoming commits (`git log --oneline HEAD..@{u}`).

## Decision table

| ahead | behind | working tree | Action |
|------:|-------:|--------------|--------|
| 0 | 0 | any | **Already up to date.** Report and stop. |
| 0 | >0 | clean | **Safe to update.** `git pull --ff-only`. Report the commits pulled. |
| 0 | >0 | dirty | **Do not pull** (a pull could conflict with your edits). Report the uncommitted files and the pending remote commits. Offer: (a) commit/stash first then re-run, or (b) you stash → `git pull --ff-only` → `git stash pop`. Only stash if the user says yes. |
| >0 | 0 | any | **Nothing to pull** — you're ahead. Tell the user they have N unpushed local commit(s); offer to `git push` (ask first). |
| >0 | >0 | any | **Diverged.** Do not auto-merge or rebase. Show both sides (`git log --oneline @{u}..HEAD` and `HEAD..@{u}`) and ask whether to `git pull --rebase`, merge, or leave it. Never resolve this silently. |

## Hard safety rules

- **Only ever `git pull --ff-only`** for the automatic path. A fast-forward
  cannot create a merge commit or lose commits; if it can't fast-forward it
  fails harmlessly rather than doing something surprising.
- **Never** run `git reset --hard`, `git checkout -- .`, `git clean`, `git push
  --force`, or any command that discards changes — not even to "fix" a diverged
  or dirty state. If those seem necessary, stop and explain the situation to the
  user instead.
- **Never stash without explicit consent**, and if you do stash, always
  `git stash pop` afterwards and confirm the changes came back.
- Treat a dirty working tree and unpushed local commits as **work to protect**,
  not obstacles to clear.
- If anything is ambiguous (no upstream, detached HEAD, fetch fails, diverged),
  **report and ask** rather than picking an action.

## Notes

- A fast-forward pull will not touch untracked files; it only aborts (harmlessly)
  if an incoming commit would overwrite one. That abort is safe — report it.
- This syncs the **current branch** only. If the user is on a feature branch but
  meant "is `main` up to date?", point that out and offer to check `main` too.
- Keep the final report short: branch, "behind by N / up to date / diverged",
  the action taken, and the incoming commit subjects if any.
