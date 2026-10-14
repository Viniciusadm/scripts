#!/usr/bin/env python3
import argparse
import json
import os
import resource
import signal
import sys
import time
from pathlib import Path

MEMINFO_KEYS = {
    "MemTotal": "mem_total", "MemFree": "mem_free", "MemAvailable": "mem_avail",
    "Buffers": "buffers", "Cached": "cached", "SwapCached": "swap_cached",
    "Active(anon)": "active_anon", "Inactive(anon)": "inactive_anon",
    "Active(file)": "active_file", "Inactive(file)": "inactive_file",
    "AnonPages": "anon", "Mapped": "mapped", "Shmem": "shmem",
    "Slab": "slab", "SReclaimable": "slab_recl", "SUnreclaim": "slab_unrecl",
    "SwapTotal": "swap_total", "SwapFree": "swap_free",
    "Dirty": "dirty", "Writeback": "writeback",
    "KernelStack": "kstack", "PageTables": "pgtables", "Committed_AS": "committed",
}

VMSTAT_KEYS = [
    "pswpin", "pswpout", "pgpgin", "pgpgout", "pgfault", "pgmajfault",
    "pgscan_kswapd", "pgscan_direct", "pgsteal_kswapd", "pgsteal_direct",
    "allocstall_normal", "allocstall_movable", "allocstall_dma32",
    "compact_stall", "compact_fail", "oom_kill",
    "workingset_refault_anon", "workingset_refault_file",
    "workingset_restore_anon", "workingset_restore_file",
    "nr_dirty", "nr_writeback", "psi_stall",
]

PRESSURE_SOURCES = ("cpu", "memory", "io")
PAGE_KB = resource.getpagesize() // 1024


def read_meminfo():
    out = {}
    with open("/proc/meminfo") as handle:
        for line in handle:
            name, _, rest = line.partition(":")
            key = MEMINFO_KEYS.get(name)
            if key:
                out[key] = int(rest.split()[0])
    return out


def read_vmstat():
    out = {}
    with open("/proc/vmstat") as handle:
        for line in handle:
            name, _, value = line.partition(" ")
            if name in VMSTAT_KEYS:
                out[name] = int(value)
    return out


def read_pressure():
    out = {}
    for source in PRESSURE_SOURCES:
        try:
            with open(f"/proc/pressure/{source}") as handle:
                for line in handle:
                    parts = line.split()
                    kind = parts[0]
                    for field in parts[1:]:
                        key, _, value = field.partition("=")
                        out[f"{source}_{kind}_{key}"] = float(value)
        except OSError:
            pass
    return out


def read_loadavg():
    fields = open("/proc/loadavg").read().split()
    running, _, total = fields[3].partition("/")
    return {
        "load1": float(fields[0]), "load5": float(fields[1]),
        "procs_running": int(running), "procs_total": int(total),
    }


def read_cpu_times():
    fields = open("/proc/stat").readline().split()[1:]
    values = [int(v) for v in fields]
    names = ["user", "nice", "sys", "idle", "iowait", "irq", "softirq", "steal"]
    return dict(zip(names, values))


def read_diskstats():
    out = {}
    with open("/proc/diskstats") as handle:
        for line in handle:
            fields = line.split()
            name = fields[2]
            if not name.startswith("nvme") or "p" in name[4:]:
                continue
            out[name] = {
                "read_sectors": int(fields[5]),
                "write_sectors": int(fields[9]),
                "io_ticks": int(fields[12]),
            }
    return out


def read_thermal():
    out = {}
    try:
        for zone in sorted(Path("/sys/class/thermal").glob("thermal_zone*")):
            kind = (zone / "type").read_text().strip()
            if kind in ("x86_pkg_temp", "TCPU", "acpitz"):
                out[kind] = int((zone / "temp").read_text()) // 1000
    except OSError:
        pass
    try:
        freqs = []
        for cpu in range(0, 16, 4):
            path = Path(f"/sys/devices/system/cpu/cpu{cpu}/cpufreq/scaling_cur_freq")
            if path.exists():
                freqs.append(int(path.read_text()) // 1000)
        if freqs:
            out["cpu_mhz_avg"] = sum(freqs) // len(freqs)
    except OSError:
        pass
    return out


def scan_processes():
    procs = []
    for entry in os.scandir("/proc"):
        if not entry.name.isdigit():
            continue
        pid = entry.name
        try:
            statm = open(f"/proc/{pid}/statm").readline().split()
            rss_kb = int(statm[1]) * PAGE_KB
            if rss_kb < 4096:
                continue
            comm = open(f"/proc/{pid}/comm").read().strip()
            stat = open(f"/proc/{pid}/stat").read()
            tail = stat[stat.rfind(")") + 2:].split()
            procs.append({
                "pid": int(pid), "comm": comm, "rss": rss_kb,
                "majflt": int(tail[9]), "utime": int(tail[11]), "stime": int(tail[12]),
            })
        except (OSError, IndexError, ValueError):
            continue
    return procs


def add_swap(procs, limit):
    for proc in sorted(procs, key=lambda p: -p["rss"])[:limit]:
        try:
            with open(f"/proc/{proc['pid']}/status") as handle:
                for line in handle:
                    if line.startswith("VmSwap:"):
                        proc["swap"] = int(line.split()[1])
                        break
        except OSError:
            continue
    return procs


def read_pss(pid):
    pss = swap = 0
    try:
        with open(f"/proc/{pid}/smaps_rollup") as handle:
            for line in handle:
                if line.startswith("Pss:"):
                    pss = int(line.split()[1])
                elif line.startswith("Swap:") and not line.startswith("SwapPss"):
                    swap = int(line.split()[1])
    except OSError:
        return None
    return pss, swap


def read_cmdline(pid):
    try:
        raw = open(f"/proc/{pid}/cmdline").read()
    except OSError:
        return ""
    return raw.replace("\0", " ").strip()[:120]


def aggregate(procs):
    totals = {}
    for proc in procs:
        slot = totals.setdefault(proc["comm"], {"rss": 0, "swap": 0, "n": 0})
        slot["rss"] += proc["rss"]
        slot["swap"] += proc.get("swap", 0)
        slot["n"] += 1
    ranked = sorted(totals.items(), key=lambda kv: -kv[1]["rss"])[:20]
    return {name: data for name, data in ranked}


class Writer:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.day = None
        self.handle = None

    def _rotate(self):
        day = time.strftime("%Y-%m-%d")
        if day != self.day:
            if self.handle:
                self.handle.close()
            self.day = day
            self.handle = open(self.directory / f"pcwatch-{day}.jsonl", "a", buffering=1)

    def emit(self, record, durable=False):
        self._rotate()
        self.handle.write(json.dumps(record, separators=(",", ":")) + "\n")
        if durable:
            self.handle.flush()
            os.fsync(self.handle.fileno())


class Collector:
    def __init__(self, args):
        self.args = args
        self.writer = Writer(args.dir)
        self.running = True
        self.prev_vmstat = None
        self.prev_cpu = None
        self.prev_disk = None
        self.prev_time = None
        self.last_proc = 0.0
        self.last_heavy = 0.0
        self.in_pressure = False
        signal.signal(signal.SIGTERM, self.stop)
        signal.signal(signal.SIGINT, self.stop)

    def stop(self, *_):
        self.running = False

    def deltas(self, now, vmstat, cpu, disk):
        if self.prev_time is None:
            return {}
        span = now - self.prev_time
        if span <= 0:
            return {}
        out = {"span": round(span, 2)}
        for key, value in vmstat.items():
            previous = self.prev_vmstat.get(key)
            if previous is not None and value != previous:
                out[f"d_{key}"] = round((value - previous) / span, 2)
        busy = sum(cpu.values()) - sum(self.prev_cpu.values())
        if busy > 0:
            for key in ("sys", "iowait", "steal"):
                out[f"cpu_{key}_pct"] = round(100 * (cpu[key] - self.prev_cpu[key]) / busy, 2)
            idle = cpu["idle"] - self.prev_cpu["idle"]
            out["cpu_busy_pct"] = round(100 * (1 - idle / busy), 2)
        for name, stats in disk.items():
            old = self.prev_disk.get(name)
            if not old:
                continue
            out[f"{name}_read_kbs"] = round((stats["read_sectors"] - old["read_sectors"]) / 2 / span, 1)
            out[f"{name}_write_kbs"] = round((stats["write_sectors"] - old["write_sectors"]) / 2 / span, 1)
            out[f"{name}_util_pct"] = round(100 * (stats["io_ticks"] - old["io_ticks"]) / (span * 1000), 1)
        return out

    def under_pressure(self, mem, pressure, rates):
        if mem.get("mem_total"):
            avail_pct = 100 * mem["mem_avail"] / mem["mem_total"]
            if avail_pct < self.args.avail_pct:
                return True
        if pressure.get("memory_some_avg10", 0) > self.args.psi_mem:
            return True
        if pressure.get("io_full_avg10", 0) > self.args.psi_io:
            return True
        if rates.get("d_pswpout", 0) > self.args.swapout_rate:
            return True
        return False

    def heavy_snapshot(self, procs):
        detailed = []
        for proc in sorted(procs, key=lambda p: -p["rss"])[:self.args.heavy_top]:
            result = read_pss(proc["pid"])
            if result is None:
                continue
            pss, swap = result
            detailed.append({
                "pid": proc["pid"], "comm": proc["comm"], "pss": pss,
                "swap": swap, "rss": proc["rss"], "majflt": proc["majflt"],
                "cmd": read_cmdline(proc["pid"]),
            })
        return detailed

    def run(self):
        started = time.time()
        self.writer.emit({
            "t": round(started, 2), "type": "start",
            "interval": self.args.interval, "pid": os.getpid(),
            "boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
            "kernel": Path("/proc/sys/kernel/osrelease").read_text().strip(),
        }, durable=True)
        tick = 0
        while self.running:
            now = time.time()
            mem = read_meminfo()
            vmstat = read_vmstat()
            pressure = read_pressure()
            cpu = read_cpu_times()
            disk = read_diskstats()
            rates = self.deltas(now, vmstat, cpu, disk)

            pressure_now = self.under_pressure(mem, pressure, rates)
            edge = pressure_now != self.in_pressure
            self.in_pressure = pressure_now

            record = {"t": round(now, 2), "type": "s", "p": int(pressure_now)}
            record.update(mem)
            record.update({k: round(v, 2) for k, v in pressure.items() if k.endswith(("avg10", "avg60"))})
            record.update(read_loadavg())
            record.update(rates)
            if tick % 12 == 0:
                record.update(read_thermal())
            oom = vmstat.get("oom_kill")
            if oom and self.prev_vmstat and oom > self.prev_vmstat.get("oom_kill", oom):
                record["oom_kill_event"] = oom - self.prev_vmstat["oom_kill"]
            self.writer.emit(record, durable=pressure_now or edge or "oom_kill_event" in record)

            need_procs = (now - self.last_proc >= self.args.proc_interval) or edge
            need_heavy = pressure_now and (now - self.last_heavy >= self.args.heavy_interval)
            if need_procs or need_heavy:
                procs = add_swap(scan_processes(), self.args.swap_top)
                if need_procs:
                    self.last_proc = now
                    self.writer.emit({
                        "t": round(now, 2), "type": "procs", "p": int(pressure_now),
                        "by_comm": aggregate(procs), "n_procs": len(procs),
                        "top": sorted(procs, key=lambda p: -p["rss"])[:self.args.proc_top],
                    }, durable=pressure_now)
                if need_heavy:
                    self.last_heavy = now
                    self.writer.emit({
                        "t": round(now, 2), "type": "heavy",
                        "detail": self.heavy_snapshot(procs),
                    }, durable=True)

            self.prev_vmstat, self.prev_cpu, self.prev_disk, self.prev_time = vmstat, cpu, disk, now
            tick += 1
            step = self.args.pressure_interval if pressure_now else self.args.interval
            target = now + step
            remaining = target - time.time()
            if remaining > 0:
                time.sleep(remaining)

        usage = resource.getrusage(resource.RUSAGE_SELF)
        self.writer.emit({
            "t": round(time.time(), 2), "type": "stop",
            "uptime_s": round(time.time() - started, 1),
            "own_cpu_s": round(usage.ru_utime + usage.ru_stime, 2),
            "own_maxrss_kb": usage.ru_maxrss,
        }, durable=True)


def cmd_mark(args):
    writer = Writer(args.dir)
    writer.emit({"t": round(time.time(), 2), "type": "mark", "text": " ".join(args.text)}, durable=True)
    print(f"marcador gravado: {' '.join(args.text)}")


def cmd_selftest(args):
    start = time.time()
    usage_before = resource.getrusage(resource.RUSAGE_SELF)
    rounds = 20
    for _ in range(rounds):
        read_meminfo()
        read_vmstat()
        read_pressure()
        read_loadavg()
        read_cpu_times()
        read_diskstats()
    light = resource.getrusage(resource.RUSAGE_SELF)
    light_cpu = (light.ru_utime + light.ru_stime) - (usage_before.ru_utime + usage_before.ru_stime)
    procs = add_swap(scan_processes(), 30)
    heavy_start = resource.getrusage(resource.RUSAGE_SELF)
    for proc in sorted(procs, key=lambda p: -p["rss"])[:40]:
        read_pss(proc["pid"])
    heavy = resource.getrusage(resource.RUSAGE_SELF)
    heavy_cpu = (heavy.ru_utime + heavy.ru_stime) - (heavy_start.ru_utime + heavy_start.ru_stime)
    print(f"amostra leve   : {1000 * light_cpu / rounds:.2f} ms de CPU")
    print(f"varredura procs: {len(procs)} processos acima de 4 MB")
    print(f"snapshot pesado: {1000 * heavy_cpu:.2f} ms de CPU (so sob pressao)")
    print(f"a 5s por amostra, custo continuo ~= {100 * (light_cpu / rounds) / 5:.4f}% de um core")
    print(f"tempo total do teste: {time.time() - start:.2f}s")


def build_parser():
    parser = argparse.ArgumentParser(prog="pcwatch", description="Coletor de metricas para diagnostico de travamento")
    parser.add_argument("--dir", default=os.path.expanduser("~/.local/share/pcwatch"))
    sub = parser.add_subparsers(dest="command")

    run = sub.add_parser("run", help="coleta continuamente")
    run.add_argument("--interval", type=float, default=5.0)
    run.add_argument("--pressure-interval", type=float, default=2.0)
    run.add_argument("--proc-interval", type=float, default=60.0)
    run.add_argument("--heavy-interval", type=float, default=15.0)
    run.add_argument("--proc-top", type=int, default=25)
    run.add_argument("--heavy-top", type=int, default=40)
    run.add_argument("--swap-top", type=int, default=40)
    run.add_argument("--avail-pct", type=float, default=25.0)
    run.add_argument("--psi-mem", type=float, default=1.0)
    run.add_argument("--psi-io", type=float, default=10.0)
    run.add_argument("--swapout-rate", type=float, default=200.0)
    run.set_defaults(func=lambda a: Collector(a).run())

    mark = sub.add_parser("mark", help="grava um marcador, ex: pcwatch mark travou agora")
    mark.add_argument("text", nargs="+")
    mark.set_defaults(func=cmd_mark)

    test = sub.add_parser("selftest", help="mede o custo do proprio coletor")
    test.set_defaults(func=cmd_selftest)
    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    if not getattr(args, "func", None):
        parser.print_help()
        return 1
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
