package processmanager

import (
	"fmt"
	"strconv"

	"hostdeck/internal/domain"
)

type processListCommand struct {
	name    string
	mode    string
	command string
}

var listProcessCommands = []processListCommand{
	{
		name:    "gnu_no_header",
		mode:    "ps",
		command: `LC_ALL=C ps -eo pid=,ppid=,user=,stat=,pcpu=,pmem=,rss=,vsz=,etime=,comm=,args= 2>/dev/null`,
	},
	{
		name:    "gnu_header",
		mode:    "ps",
		command: `LC_ALL=C ps -eo pid,ppid,user,stat,pcpu,pmem,rss,vsz,etime,comm,args 2>/dev/null`,
	},
	{
		name:    "ps_aux",
		mode:    "ps_aux",
		command: `LC_ALL=C ps auxww 2>/dev/null || LC_ALL=C ps aux 2>/dev/null`,
	},
	{
		name:    "busybox",
		mode:    "busybox",
		command: `LC_ALL=C ps w 2>/dev/null || LC_ALL=C ps 2>/dev/null`,
	},
	{
		name:    "proc",
		mode:    "proc",
		command: procProcessListCommand,
	},
}

const procProcessListCommand = `
LC_ALL=C
export LC_ALL
if [ -d /proc ]; then
  mem_total=$(awk '$1=="MemTotal:" {print $2 * 1024; exit}' /proc/meminfo 2>/dev/null)
  case "$mem_total" in ''|*[!0-9]*) mem_total=0;; esac
  page_size=$(getconf PAGESIZE 2>/dev/null)
  case "$page_size" in ''|*[!0-9]*) page_size=4096;; esac
  stats_file=''
  if command -v mktemp >/dev/null 2>&1 && command -v ps >/dev/null 2>&1; then
    stats_file=$(mktemp 2>/dev/null || true)
    if [ -n "$stats_file" ]; then
      ps -eo pid=,pcpu=,pmem=,etime= > "$stats_file" 2>/dev/null || true
    fi
  fi
  unreadable=0
  for proc in /proc/[0-9]*; do
    pid=${proc##*/}
    stat=$(cat "$proc/stat" 2>/dev/null) || { unreadable=1; continue; }
    comm=$(printf '%s\n' "$stat" | sed 's/^[^(]*(//; s/)[^)]*$//')
    rest=$(printf '%s\n' "$stat" | sed 's/^[^(]*(.*) //')
    set -- $rest
    [ "$#" -ge 22 ] || { unreadable=1; continue; }
    state=$1
    ppid=$2
    vsize=$21
    rss_pages=$22
    case "$ppid" in ''|*[!0-9]*) ppid=0;; esac
    case "$vsize" in ''|*[!0-9]*) vsize=0;; esac
    case "$rss_pages" in ''|*[!0-9-]*) rss_pages=0;; esac
    if [ "$rss_pages" -lt 0 ] 2>/dev/null; then rss_pages=0; fi
    rss_bytes=$((rss_pages * page_size))
    uid=$(awk '$1=="Uid:" {print $2; exit}' "$proc/status" 2>/dev/null)
    case "$uid" in ''|*[!0-9]*) uid=0;; esac
    user=$(awk -F: -v uid="$uid" '$3==uid {print $1; exit}' /etc/passwd 2>/dev/null)
    [ -n "$user" ] || user="$uid"
    cmdline=$(tr '\000' ' ' < "$proc/cmdline" 2>/dev/null | tr '\t\r\n' '   ' | cut -c 1-400)
    kernel=0
    if [ -z "$cmdline" ]; then
      cmdline="[$comm]"
      kernel=1
    fi
    cpu=0
    mem=0
    elapsed=''
    if [ -n "$stats_file" ] && [ -r "$stats_file" ]; then
      stats=$(awk -v p="$pid" '$1==p {print $2 " " $3 " " $4; exit}' "$stats_file")
      if [ -n "$stats" ]; then
        set -- $stats
        cpu=$1
        mem=$2
        elapsed=$3
      fi
    fi
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$pid" "$ppid" "$user" "$state" "$cpu" "$mem" "$rss_bytes" "$vsize" "$elapsed" "$comm" "$cmdline" "$kernel"
  done
  if [ -n "$stats_file" ]; then rm -f "$stats_file" 2>/dev/null || true; fi
  if [ "$unreadable" != "0" ]; then
    printf 'warning\t部分进程无法读取。\n'
  fi
  exit 0
fi
`

func detailCommand(pid int64) string {
	return fmt.Sprintf(`
pid=%d
if [ ! -d "/proc/$pid" ]; then
  printf 'error=not_found\n'
  exit 0
fi
status="/proc/$pid/status"
[ -r "$status" ] || { printf 'error=not_found\n'; exit 0; }
comm=$(awk '$1=="Name:" {print $2; exit}' "$status" 2>/dev/null)
state=$(awk '$1=="State:" {print $2; exit}' "$status" 2>/dev/null)
ppid=$(awk '$1=="PPid:" {print $2; exit}' "$status" 2>/dev/null)
uid=$(awk '$1=="Uid:" {print $2; exit}' "$status" 2>/dev/null)
user=$(awk -F: -v uid="$uid" '$3==uid {print $1; exit}' /etc/passwd 2>/dev/null)
[ -n "$user" ] || user="$uid"
threads=$(awk '$1=="Threads:" {print $2; exit}' "$status" 2>/dev/null)
rss_kb=$(awk '$1=="VmRSS:" {print $2; exit}' "$status" 2>/dev/null)
vsz_kb=$(awk '$1=="VmSize:" {print $2; exit}' "$status" 2>/dev/null)
cmdline=$(tr '\000' ' ' < "/proc/$pid/cmdline" 2>/dev/null | tr '\t\r\n' '   ' | cut -c 1-2000)
kernel=0
if [ -z "$cmdline" ]; then
  cmdline="[$comm]"
  kernel=1
fi
cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
exe=$(readlink "/proc/$pid/exe" 2>/dev/null || true)
printf 'pid=%%s\n' "$pid"
printf 'ppid=%%s\n' "$ppid"
printf 'user=%%s\n' "$user"
printf 'state=%%s\n' "$state"
printf 'command=%%s\n' "$comm"
printf 'cmdline=%%s\n' "$cmdline"
printf 'cwd=%%s\n' "$cwd"
printf 'exe=%%s\n' "$exe"
printf 'threads=%%s\n' "$threads"
printf 'rssKB=%%s\n' "$rss_kb"
printf 'vszKB=%%s\n' "$vsz_kb"
printf 'kernel=%%s\n' "$kernel"
`, pid)
}

func signalCommand(pid int64, signal domain.ProcessSignal) string {
	name := "TERM"
	if signal == domain.ProcessSignalKill {
		name = "KILL"
	}
	return fmt.Sprintf(`
pid=%d
if ! kill -0 "$pid" 2>/dev/null; then
  printf 'not_found\n'
  exit 0
fi
if kill -%s "$pid" 2>/dev/null; then
  printf 'ok\n'
else
  printf 'denied\n'
fi
`, pid, name)
}

func strconvParseInt(value string) (int64, error) {
	return strconv.ParseInt(value, 10, 64)
}
