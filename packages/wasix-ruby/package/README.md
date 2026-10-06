# `@ai-ecoverse/wasix-ruby`

MRI Ruby for slicc WASIX. No epoll (poll fallback). See PRESTAGE.md.

## Gem executables on PATH

Command env puts user gem bins ahead of the package:

```text
${HOME}/.local/share/gem/ruby/3.4.0/bin:${package}/bin:${PATH}
```

That covers Ruby child processes (`system`, `spawn`, `bundle exec`, …). To run those gems **by name from your shell**, add the same user gem bin directory to the host PATH, e.g. in `~/.bashrc`:

```bash
export PATH="$HOME/.local/share/gem/ruby/3.4.0/bin:$PATH"
```
