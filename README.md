# scripts

Personal command line tools for a Linux desktop. Each one is independent; there is no shared code. Messages and help texts are mostly in Portuguese.

| Part | What it is |
| --- | --- |
| [`folder-manager`](folder-manager) | `fm`, a Node.js CLI that archives and restores folders of the current directory into `~/.folder-archive/` (nothing is deleted), tags folders as free, busy or being freed, and makes disposable `<folder>.tmp` clones that `fm drop` can delete. Has an interactive checkbox mode. Its own README, in Portuguese, documents every command. |
| [`qmv`](qmv) | Python mover with a queue, a progress display and checks. `qmv SOURCE... DESTINATION` renames when it can and otherwise copies through a `.part` file, compares sizes and only then deletes the source. Paths under GVFS mounts go through `gio copy`. `--on 1-3` sets how many files move in parallel and `--dry-run` only lists the plan. |
| [`one.py`](one.py) | Merges a folder of `.cbz` chapters into volume `.cbz` files, in natural order, with renumbered chapters and pages. `-n` sets the chapters per volume (default 31) and `-o` the output folder. |
| [`audio`](audio) | Bash script that switches the PulseAudio/PipeWire default sink between the laptop speakers and an HDMI monitor, moves the playing streams and shows a notification. The two sink names are hard coded for one machine; replace them with the ones from `pactl list short sinks`. |
| [`pcwatch`](pcwatch) | Python collector for diagnosing system freezes. `pcwatch.py run` writes one JSON line every few seconds (memory, swap, vmstat, PSI pressure, CPU, disk, temperatures) to `~/.local/share/pcwatch/pcwatch-<day>.jsonl`, adds process snapshots periodically and the heaviest processes while under memory or I/O pressure. `pcwatch.py mark <text>` records a marker and `pcwatch.py selftest` measures the collector's own cost. |

## Requirements

- Python 3 for `qmv`, `one.py` and `pcwatch` (standard library only; used with 3.12)
- Node.js **20.12+** for `folder-manager` (required by `inquirer` 13)
- `pactl` and `notify-send` for `audio`; `gio` for `qmv` on GVFS mounts

## Usage

Install `fm` as a global command:

```bash
cd folder-manager
npm install
npm link
```

The other scripts run directly, or from a folder in `PATH`:

```bash
./qmv ~/Downloads/*.mkv /media/backup/videos
python3 one.py ~/comics/series -n 10
./audio
python3 pcwatch/pcwatch.py run
python3 pcwatch/pcwatch.py mark "travou agora"
```
