# Publishing the repository

The local Git repository uses branch `main` with this configured remote.

```text
origin  https://github.com/A-Erkhembileg/bugcapsule.git
```

The source, documentation and tests are prepared for publication to this existing public repository. The owner approved the v0.3.0 source publication. The source commit preserves the repository's initial history and uses the verified GitHub account's no-reply author address. GitHub CLI is unavailable in the development environment.

After reviewing the files, configure your chosen author identity for this repository. Use your GitHub no-reply address if you want your personal email to remain private.

```sh
git config user.name "YOUR_GIT_AUTHOR_NAME"
git config user.email "YOUR_GITHUB_NOREPLY_ADDRESS"
git add .
git diff --cached --stat
git commit -m "Release BugCapsule v0.3.0"
git push -u origin main
```

The final line publishes the committed files to the existing repository. Future publishing actions also require the owner's authorization. Preserve the remote's history and integrate newer changes before pushing; do not force-push over another contributor's work. Check the GitHub Actions result after publication.

Suggested repository description is **Privacy-first bug reporting and reproduction toolkit for web developers.** Suggested topics are `typescript`, `chrome-extension`, `bug-reporting`, `developer-tools`, `open-source`, `react` and `debugging`.

`pnpm package` writes `release/bugcapsule-0.3.0.zip`. It contains only the unpacked extension and bundled license notices. Build outputs, report downloads, browser traces, private configuration and credentials are excluded from source control by `.gitignore`. A GitHub Release or Chrome Web Store listing is a separate publishing action.
