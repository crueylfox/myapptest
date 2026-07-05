package networkinspect

import "strings"

const snapshotCommand = `
LC_ALL=C
export LC_ALL
row_limit=500
info_limit=1000

printf '%s\t%s\n' '__SPNI_ROW_LIMIT__' "$row_limit"

find_tool() {
  name=$1
  shift
  found=$(command -v "$name" 2>/dev/null || true)
  if [ -n "$found" ] && [ -x "$found" ]; then
    printf '%s' "$found"
    return 0
  fi
  for candidate in "$@"; do
    if [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

tool_kind() {
  case "$1" in
    /usr/sbin/*|/sbin/*) printf 'sbin' ;;
    /usr/bin/*|/bin/*) printf 'bin' ;;
    *) printf 'path' ;;
  esac
}

emit_status() {
  printf '%s\t%s\t%s\n' '__SPNI_STATUS__' "$1" "$2"
}

socket_summary_awk='
function endpoint_host(endpoint, value, n, parts, port) {
  value = endpoint
  gsub(/^"|"$/, "", value)
  if (value == "" || value == "*") return ""
  if (substr(value, 1, 1) == "[") {
    sub(/^\[/, "", value)
    sub(/\]:[^]]*$/, "", value)
    sub(/%.*/, "", value)
    return value
  }
  n = split(value, parts, ":")
  if (n > 1) {
    port = parts[n]
    sub(":" port "$", "", value)
  }
  sub(/%.*/, "", value)
  return value
}
function add_socket(localEndpoint, remoteEndpoint, localHost, remoteHost) {
  localHost = endpoint_host(localEndpoint)
  remoteHost = endpoint_host(remoteEndpoint)
  if (remoteHost == "" || remoteHost == "*") return
  total++
  remoteSeen[remoteHost] = 1
  if (localHost != "" && localHost != "*") {
    localTotal[localHost]++
    localRemoteSeen[localHost SUBSEP remoteHost] = 1
  }
}
{
  lower = tolower($1)
  if (lower == "netid" || lower == "state" || lower == "recv-q" || lower == "proto") next
  if (lower ~ /^(tcp|udp)/) {
    if (tolower($2) ~ /estab/) add_socket($5, $6)
    else add_socket($4, $5)
    next
  }
  if (lower ~ /estab/) {
    add_socket($4, $5)
    next
  }
  if ($1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/) {
    add_socket($3, $4)
  }
}
END {
  remoteCount = 0
  for (remote in remoteSeen) remoteCount++
  printf "%s\t%d\t%d\tok\n", "__SPNI_SOCKET_SUMMARY__", total + 0, remoteCount + 0
  for (key in localRemoteSeen) {
    split(key, parts, SUBSEP)
    localRemoteCount[parts[1]]++
  }
  for (local in localTotal) {
    printf "%s\t%s\t%d\t%d\n", "__SPNI_SOCKET_LOCAL_SUMMARY__", local, localTotal[local] + 0, localRemoteCount[local] + 0
  }
}'

netstat_socket_summary_awk='
function endpoint_host(endpoint, value, n, parts, port) {
  value = endpoint
  if (value == "" || value == "*") return ""
  n = split(value, parts, ":")
  if (n > 1) {
    port = parts[n]
    sub(":" port "$", "", value)
  }
  return value
}
{
  lower = tolower($1)
  if (lower == "proto" || lower == "active") next
  if (lower !~ /^tcp/) next
  if (toupper($6) != "ESTABLISHED" && toupper($6) != "ESTAB") next
  localHost = endpoint_host($4)
  remoteHost = endpoint_host($5)
  if (remoteHost == "" || remoteHost == "*") next
  total++
  remoteSeen[remoteHost] = 1
  if (localHost != "" && localHost != "*") {
    localTotal[localHost]++
    localRemoteSeen[localHost SUBSEP remoteHost] = 1
  }
}
END {
  remoteCount = 0
  for (remote in remoteSeen) remoteCount++
  printf "%s\t%d\t%d\tok\n", "__SPNI_SOCKET_SUMMARY__", total + 0, remoteCount + 0
  for (key in localRemoteSeen) {
    split(key, parts, SUBSEP)
    localRemoteCount[parts[1]]++
  }
  for (local in localTotal) {
    printf "%s\t%s\t%d\t%d\n", "__SPNI_SOCKET_LOCAL_SUMMARY__", local, localTotal[local] + 0, localRemoteCount[local] + 0
  }
}'

emit_socket_summary_ss() {
  if "$ss_bin" -H -tn state established >/dev/null 2>&1; then
    "$ss_bin" -H -tn state established 2>/dev/null | awk "$socket_summary_awk"
    return 0
  fi
  if "$ss_bin" -tn state established >/dev/null 2>&1; then
    "$ss_bin" -tn state established 2>/dev/null | awk "$socket_summary_awk"
    return 0
  fi
  if "$ss_bin" -H -tn >/dev/null 2>&1; then
    "$ss_bin" -H -tn 2>/dev/null | awk "$socket_summary_awk"
    return 0
  fi
  if "$ss_bin" -tn >/dev/null 2>&1; then
    "$ss_bin" -tn 2>/dev/null | awk "$socket_summary_awk"
    return 0
  fi
  printf '%s\t\t\tunavailable\n' '__SPNI_SOCKET_SUMMARY__'
  return 1
}

emit_socket_summary_netstat() {
  if "$netstat_bin" -ntup >/dev/null 2>&1; then
    "$netstat_bin" -ntup 2>/dev/null | awk "$netstat_socket_summary_awk"
    return 0
  fi
  if "$netstat_bin" -ntu >/dev/null 2>&1; then
    "$netstat_bin" -ntu 2>/dev/null | awk "$netstat_socket_summary_awk"
    return 0
  fi
  printf '%s\t\t\tunavailable\n' '__SPNI_SOCKET_SUMMARY__'
  return 1
}

emit_interfaces() {
  printf '%s\n' '__SPNI_INTERFACES__'
  ip_bin=$(find_tool ip /usr/sbin/ip /sbin/ip /usr/bin/ip /bin/ip || true)
  if [ -z "$ip_bin" ]; then
    emit_status interfaces missing
    return 0
  fi
  if "$ip_bin" -o addr show 2>/dev/null | while IFS= read -r line; do
    set -- $line
    name=$2
    name=${name%%:}
    fam=$3
    addr=$4
    case "$fam" in
      inet|inet6)
        ipaddr=${addr%%/*}
        [ -n "$name" ] && [ -n "$ipaddr" ] && printf 'IFACE\t%s\t%s\n' "$name" "$ipaddr"
        ;;
    esac
  done
  then
    emit_status interfaces ok
  else
    emit_status interfaces failed
  fi
}

# __SPNI_DOCKER_HELPERS_BEGIN__
docker_rows_left=$row_limit
docker_container_limit=200

safe_docker_field() {
  printf '%s' "$1" | tr '\t\r\n' '   ' | cut -c 1-80
}

emit_docker_status() {
  printf '%s\t%s\t%s\n' '__SPNI_DOCKER_STATUS__' "$1" "$2"
}

emit_docker_summary_from_ss() {
  pid=$1
  if "$nsenter_bin" -t "$pid" -n "$ss_bin" -H -tn state established >/dev/null 2>&1; then
    "$nsenter_bin" -t "$pid" -n "$ss_bin" -H -tn state established 2>/dev/null | awk "$socket_summary_awk" | awk -F '\t' '$1=="__SPNI_SOCKET_SUMMARY__"{print "__SPNI_DOCKER_SOCKET_SUMMARY__\t"$2"\t"$3"\t"$4}'
    return 0
  fi
  if "$nsenter_bin" -t "$pid" -n "$ss_bin" -tn state established >/dev/null 2>&1; then
    "$nsenter_bin" -t "$pid" -n "$ss_bin" -tn state established 2>/dev/null | awk "$socket_summary_awk" | awk -F '\t' '$1=="__SPNI_SOCKET_SUMMARY__"{print "__SPNI_DOCKER_SOCKET_SUMMARY__\t"$2"\t"$3"\t"$4}'
    return 0
  fi
  if "$nsenter_bin" -t "$pid" -n "$ss_bin" -H -tn >/dev/null 2>&1; then
    "$nsenter_bin" -t "$pid" -n "$ss_bin" -H -tn 2>/dev/null | awk "$socket_summary_awk" | awk -F '\t' '$1=="__SPNI_SOCKET_SUMMARY__"{print "__SPNI_DOCKER_SOCKET_SUMMARY__\t"$2"\t"$3"\t"$4}'
    return 0
  fi
  if "$nsenter_bin" -t "$pid" -n "$ss_bin" -tn >/dev/null 2>&1; then
    "$nsenter_bin" -t "$pid" -n "$ss_bin" -tn 2>/dev/null | awk "$socket_summary_awk" | awk -F '\t' '$1=="__SPNI_SOCKET_SUMMARY__"{print "__SPNI_DOCKER_SOCKET_SUMMARY__\t"$2"\t"$3"\t"$4}'
    return 0
  fi
  return 1
}

emit_docker_endpoint_summary_from_ss() {
  pid=$1
  container_id=$2
  container_name=$3
  if "$nsenter_bin" -t "$pid" -n "$ss_bin" -H -tnp state established >/dev/null 2>&1; then
    "$nsenter_bin" -t "$pid" -n "$ss_bin" -H -tnp state established 2>/dev/null | awk -v cid="$container_id" -v cname="$container_name" -v limit="$row_limit" '
      function endpoint_host(endpoint, value, n, parts, port) {
        value = endpoint
        gsub(/^"|"$/, "", value)
        if (value == "" || value == "*") return ""
        if (substr(value, 1, 1) == "[") {
          sub(/^\[/, "", value)
          sub(/\]:[^]]*$/, "", value)
          sub(/%.*/, "", value)
          return value
        }
        n = split(value, parts, ":")
        if (n > 1) {
          port = parts[n]
          sub(":" port "$", "", value)
        }
        sub(/%.*/, "", value)
        return value
      }
      function proc_name(line, start, rest, stop, name) {
        start = index(line, "((\"")
        if (start <= 0) return cname
        rest = substr(line, start + 3)
        stop = index(rest, "\"")
        if (stop <= 1) return cname
        name = substr(rest, 1, stop - 1)
        return name == "" ? cname : name
      }
      function add_socket(proto, localEndpoint, remoteEndpoint, processName, remoteHost, key) {
        remoteHost = endpoint_host(remoteEndpoint)
        if (remoteHost == "" || remoteHost == "*") return
        key = proto SUBSEP processName
        total[key]++
        remoteSeen[key SUBSEP remoteHost] = 1
      }
      {
        lower = tolower($1)
        if (lower == "netid" || lower == "state" || lower == "recv-q" || lower == "proto") next
        proto = "tcp"
        processName = proc_name($0)
        if (lower ~ /^(tcp|udp)/) {
          proto = lower ~ /^udp/ ? "udp" : "tcp"
          if (tolower($2) ~ /estab/) add_socket(proto, $5, $6, processName)
          else add_socket(proto, $4, $5, processName)
          next
        }
        if (lower ~ /estab/) {
          add_socket(proto, $4, $5, processName)
          next
        }
        if ($1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/) {
          add_socket(proto, $3, $4, processName)
        }
      }
      END {
        for (key in remoteSeen) {
          split(key, parts, SUBSEP)
          remoteCount[parts[1] SUBSEP parts[2]]++
        }
        for (key in total) {
          split(key, parts, SUBSEP)
          if (total[key] > limit) printf "%s\t%s\t%s\t%s\t%s\t%d\t%d\n", "__SPNI_DOCKER_ENDPOINT_SUMMARY__", cid, cname, parts[1], parts[2], total[key] + 0, remoteCount[key] + 0
        }
      }'
    return 0
  fi
  if "$nsenter_bin" -t "$pid" -n "$ss_bin" -H -tn state established >/dev/null 2>&1; then
    "$nsenter_bin" -t "$pid" -n "$ss_bin" -H -tn state established 2>/dev/null | awk -v cid="$container_id" -v cname="$container_name" -v limit="$row_limit" '
      function endpoint_host(endpoint, value, n, parts, port) {
        value = endpoint
        if (value == "" || value == "*") return ""
        n = split(value, parts, ":")
        if (n > 1) { port = parts[n]; sub(":" port "$", "", value) }
        return value
      }
      {
        if ($1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/) {
          remote = endpoint_host($4)
          if (remote != "" && remote != "*") { total++; remoteSeen[remote]=1 }
        }
      }
      END {
        remoteCount = 0
        for (remote in remoteSeen) remoteCount++
        if (total > limit) printf "%s\t%s\t%s\ttcp\t%s\t%d\t%d\n", "__SPNI_DOCKER_ENDPOINT_SUMMARY__", cid, cname, cname, total + 0, remoteCount + 0
      }'
    return 0
  fi
  return 1
}

emit_limited_docker_lines() {
  marker=$1
  container_id=$2
  container_name=$3
  shift 3
  [ "$docker_rows_left" -gt 0 ] || return 0
  printf '%s\t%s\t%s\n' "$marker" "$container_id" "$container_name"
  rows=$("$@" 2>/dev/null | head -n "$docker_rows_left")
  if [ -n "$rows" ]; then
    printf '%s\n' "$rows"
    emitted=$(printf '%s\n' "$rows" | awk 'NF {count++} END {print count + 0}')
    docker_rows_left=$((docker_rows_left - emitted))
    if [ "$docker_rows_left" -le 0 ]; then
      emit_docker_status truncated "$row_limit"
    fi
  fi
}

emit_docker_proc_summary() {
  pid=$1
  container_id=$2
  container_name=$3
  awk -v cid="$container_id" -v cname="$container_name" -v limit="$row_limit" '
    NR > 1 && $4 == "01" {
      total++
      if ($3 != "" && $3 !~ /^0+:0000$/) remote[$3] = 1
    }
    END {
      remoteCount = 0
      for (item in remote) remoteCount++
      printf "%s\t%d\t%d\tok\n", "__SPNI_DOCKER_SOCKET_SUMMARY__", total + 0, remoteCount + 0
      if (total > limit) printf "%s\t%s\t%s\ttcp\t%s\t%d\t%d\n", "__SPNI_DOCKER_ENDPOINT_SUMMARY__", cid, cname, cname, total + 0, remoteCount + 0
    }' "/proc/$pid/net/tcp" "/proc/$pid/net/tcp6" 2>/dev/null
}

emit_limited_docker_proc_file() {
  proto=$1
  file=$2
  [ "$docker_rows_left" -gt 0 ] || return 0
  [ -r "$file" ] || return 0
  rows=$(awk -v proto="$proto" 'NR > 1 {print "DOCKER_PROC_SOCKET\t" proto "\t" $2 "\t" $3 "\t" $4 "\t" $10}' "$file" 2>/dev/null | head -n "$docker_rows_left")
  if [ -n "$rows" ]; then
    printf '%s\n' "$rows"
    emitted=$(printf '%s\n' "$rows" | awk 'NF {count++} END {print count + 0}')
    docker_rows_left=$((docker_rows_left - emitted))
    if [ "$docker_rows_left" -le 0 ]; then
      emit_docker_status truncated "$row_limit"
    fi
  fi
}

emit_docker_proc_snapshot() {
  pid=$1
  container_id=$2
  container_name=$3
  if [ ! -r "/proc/$pid/net/tcp" ] && [ ! -r "/proc/$pid/net/tcp6" ]; then
    emit_docker_status permission-limited "$container_id"
    return 1
  fi
  emit_docker_proc_summary "$pid" "$container_id" "$container_name"
  printf '%s\t%s\t%s\n' '__SPNI_DOCKER_PROC__' "$container_id" "$container_name"
  emit_limited_docker_proc_file tcp "/proc/$pid/net/tcp"
  emit_limited_docker_proc_file tcp6 "/proc/$pid/net/tcp6"
  emit_limited_docker_proc_file udp "/proc/$pid/net/udp"
  emit_limited_docker_proc_file udp6 "/proc/$pid/net/udp6"
  return 0
}

emit_docker_snapshot() {
  docker_bin=$(find_tool docker /usr/bin/docker /bin/docker /usr/local/bin/docker /usr/sbin/docker /sbin/docker || true)
  if [ -z "$docker_bin" ]; then
    emit_docker_status missing docker
    return 0
  fi
  nsenter_bin=$(find_tool nsenter /usr/bin/nsenter /bin/nsenter /usr/sbin/nsenter /sbin/nsenter || true)
  if [ -z "$nsenter_bin" ]; then
    emit_docker_status nsenter-missing nsenter
  fi
  docker_ps=$("$docker_bin" ps --no-trunc --format '{{.ID}}	{{.Names}}	{{.State}}	{{.Status}}' 2>/dev/null)
  docker_ps_status=$?
  if [ "$docker_ps_status" -ne 0 ]; then
    emit_docker_status permission-limited docker
    return 0
  fi
  if [ -z "$docker_ps" ]; then
    emit_docker_status available empty
    emit_docker_status containers 0
    printf '%s\t0\t0\tok\n' '__SPNI_DOCKER_SOCKET_SUMMARY__'
    return 0
  fi
  container_total=$(printf '%s\n' "$docker_ps" | awk 'NF {count++} END {print count + 0}')
  emit_docker_status available docker
  emit_docker_status containers "$container_total"
  scanned=0
  seen_netns=' '
  printf '%s\n' "$docker_ps" | while IFS='	' read -r container_id container_name container_state container_status; do
    [ "$scanned" -lt "$docker_container_limit" ] || break
    [ -n "$container_id" ] || continue
    inspect=$("$docker_bin" inspect --format '{{.Id}}	{{.Name}}	{{.State.Pid}}	{{.HostConfig.NetworkMode}}	{{range $name, $_ := .NetworkSettings.Networks}}{{$name}},{{end}}' "$container_id" 2>/dev/null || true)
    [ -n "$inspect" ] || continue
    IFS='	' read -r full_id inspect_name init_pid network_mode network_names <<EOF_DOCKER_INSPECT
$inspect
EOF_DOCKER_INSPECT
    case "$init_pid" in ''|*[!0-9]*) continue;; esac
    [ "$init_pid" -gt 0 ] || continue
    case "$network_mode" in host) continue;; esac
    netns=$(readlink "/proc/$init_pid/ns/net" 2>/dev/null || true)
    if [ -n "$netns" ]; then
      case "$seen_netns" in
        *" $netns "*) continue ;;
        *) seen_netns="$seen_netns$netns " ;;
      esac
    fi
    short_id=$(printf '%s' "$full_id" | cut -c 1-12)
    [ -n "$short_id" ] || short_id=$(printf '%s' "$container_id" | cut -c 1-12)
    clean_name=$(safe_docker_field "${inspect_name#/}")
    [ -n "$clean_name" ] || clean_name=$(safe_docker_field "$container_name")
    case "$network_mode" in container:*) clean_name="$clean_name（共享网络）" ;; esac
    emit_docker_status available container
    printf '%s\t%s\t%s\n' '__SPNI_DOCKER_CONTAINER__' "$short_id" "$clean_name"
    scanned=$((scanned + 1))
    if [ -n "$nsenter_bin" ] && [ -n "$ss_bin" ] && emit_docker_summary_from_ss "$init_pid"; then
      emit_docker_endpoint_summary_from_ss "$init_pid" "$short_id" "$clean_name" || true
      if "$nsenter_bin" -t "$init_pid" -n "$ss_bin" -H -lntup >/dev/null 2>&1; then
        emit_limited_docker_lines '__SPNI_DOCKER_LISTEN__' "$short_id" "$clean_name" "$nsenter_bin" -t "$init_pid" -n "$ss_bin" -H -lntup
      elif "$nsenter_bin" -t "$init_pid" -n "$ss_bin" -H -lntu >/dev/null 2>&1; then
        emit_limited_docker_lines '__SPNI_DOCKER_LISTEN__' "$short_id" "$clean_name" "$nsenter_bin" -t "$init_pid" -n "$ss_bin" -H -lntu
      fi
      if "$nsenter_bin" -t "$init_pid" -n "$ss_bin" -H -tnp state established >/dev/null 2>&1; then
        emit_limited_docker_lines '__SPNI_DOCKER_ESTABLISHED_FILTERED__' "$short_id" "$clean_name" "$nsenter_bin" -t "$init_pid" -n "$ss_bin" -H -tnp state established
      elif "$nsenter_bin" -t "$init_pid" -n "$ss_bin" -H -tn state established >/dev/null 2>&1; then
        emit_limited_docker_lines '__SPNI_DOCKER_ESTABLISHED_FILTERED__' "$short_id" "$clean_name" "$nsenter_bin" -t "$init_pid" -n "$ss_bin" -H -tn state established
      elif "$nsenter_bin" -t "$init_pid" -n "$ss_bin" -H -tn >/dev/null 2>&1; then
        emit_limited_docker_lines '__SPNI_DOCKER_ESTABLISHED_FILTERED__' "$short_id" "$clean_name" "$nsenter_bin" -t "$init_pid" -n "$ss_bin" -H -tn
      fi
      if "$nsenter_bin" -t "$init_pid" -n "$ss_bin" -H -tin state established >/dev/null 2>&1; then
        emit_limited_docker_lines '__SPNI_DOCKER_ESTABLISHED_INFO_FILTERED__' "$short_id" "$clean_name" "$nsenter_bin" -t "$init_pid" -n "$ss_bin" -H -tin state established
      fi
    else
      emit_docker_proc_snapshot "$init_pid" "$short_id" "$clean_name" || true
    fi
  done
}
# __SPNI_DOCKER_HELPERS_END__

if ss_bin=$(find_tool ss /usr/sbin/ss /sbin/ss /usr/bin/ss /bin/ss); then
  printf '%s ss\n' '__SPNI_STRATEGY__'
  printf '%s\tss\t%s\n' '__SPNI_TOOL__' "$(tool_kind "$ss_bin")"
  emit_socket_summary_ss || true

  printf '%s\n' '__SPNI_LISTEN__'
  if "$ss_bin" -H -lntu >/dev/null 2>&1; then
    "$ss_bin" -H -lntu 2>/dev/null | head -n "$row_limit"
    emit_status listener ok
  elif "$ss_bin" -lntu >/dev/null 2>&1; then
    "$ss_bin" -lntu 2>/dev/null | head -n "$row_limit"
    emit_status listener ok-no-H
  else
    emit_status listener failed
    printf '%s\t%s\n' '__SPNI_WARNING__' '监听端口读取失败。'
  fi

  printf '%s\n' '__SPNI_ESTABLISHED_FILTERED__'
  if "$ss_bin" -H -tn state established >/dev/null 2>&1; then
    "$ss_bin" -H -tn state established 2>/dev/null | head -n "$row_limit"
    emit_status connection ok-filtered
  elif "$ss_bin" -tn state established >/dev/null 2>&1; then
    "$ss_bin" -tn state established 2>/dev/null | head -n "$row_limit"
    emit_status connection ok-filtered-no-H
  else
    printf '%s\n' '__SPNI_ESTABLISHED_ALL__'
    if "$ss_bin" -H -tn >/dev/null 2>&1; then
      "$ss_bin" -H -tn 2>/dev/null | head -n "$row_limit"
      emit_status connection ok-all
    elif "$ss_bin" -tn >/dev/null 2>&1; then
      "$ss_bin" -tn 2>/dev/null | head -n "$row_limit"
      emit_status connection ok-all-no-H
    else
      emit_status connection failed
      printf '%s\t%s\n' '__SPNI_WARNING__' '已读取监听端口，但活动连接读取失败。'
    fi
  fi

  printf '%s\n' '__SPNI_LISTEN_PROCESS__'
  if "$ss_bin" -H -lntup >/dev/null 2>&1; then
    "$ss_bin" -H -lntup 2>/dev/null | head -n "$row_limit"
    emit_status process ok-listener
  elif "$ss_bin" -lntup >/dev/null 2>&1; then
    "$ss_bin" -lntup 2>/dev/null | head -n "$row_limit"
    emit_status process ok-listener-no-H
  else
    emit_status process failed-listener
  fi

  printf '%s\n' '__SPNI_ESTABLISHED_PROCESS_FILTERED__'
  if "$ss_bin" -H -tnp state established >/dev/null 2>&1; then
    "$ss_bin" -H -tnp state established 2>/dev/null | head -n "$row_limit"
    emit_status process ok-connection
  elif "$ss_bin" -tnp state established >/dev/null 2>&1; then
    "$ss_bin" -tnp state established 2>/dev/null | head -n "$row_limit"
    emit_status process ok-connection-no-H
  else
    emit_status process failed-connection
  fi

  printf '%s\n' '__SPNI_ESTABLISHED_INFO_FILTERED__'
  if "$ss_bin" -H -tin state established >/dev/null 2>&1; then
    "$ss_bin" -H -tin state established 2>/dev/null | head -n "$info_limit"
    emit_status counter ok-filtered
  elif "$ss_bin" -tin state established >/dev/null 2>&1; then
    "$ss_bin" -tin state established 2>/dev/null | head -n "$info_limit"
    emit_status counter ok-filtered-no-H
  else
    printf '%s\n' '__SPNI_ESTABLISHED_INFO_ALL__'
    if "$ss_bin" -H -tin >/dev/null 2>&1; then
      "$ss_bin" -H -tin 2>/dev/null | head -n "$info_limit"
      emit_status counter ok-all
    elif "$ss_bin" -tin >/dev/null 2>&1; then
      "$ss_bin" -tin 2>/dev/null | head -n "$info_limit"
      emit_status counter ok-all-no-H
    else
      emit_status counter failed
      printf '%s\t%s\n' '__SPNI_WARNING__' '当前 CentOS/iproute2 未提供可靠的单连接字节统计。'
    fi
  fi

  emit_docker_snapshot || true
  emit_interfaces
  exit 0
fi

if netstat_bin=$(find_tool netstat /usr/bin/netstat /bin/netstat /usr/sbin/netstat /sbin/netstat); then
  printf '%s netstat\n' '__SPNI_STRATEGY__'
  printf '%s\tnetstat\t%s\n' '__SPNI_TOOL__' "$(tool_kind "$netstat_bin")"
  emit_socket_summary_netstat || true

  printf '%s\n' '__SPNI_NETSTAT_LISTEN__'
  if "$netstat_bin" -lntup >/dev/null 2>&1; then
    "$netstat_bin" -lntup 2>/dev/null | head -n "$row_limit"
    emit_status listener ok
  elif "$netstat_bin" -lntu >/dev/null 2>&1; then
    "$netstat_bin" -lntu 2>/dev/null | head -n "$row_limit"
    emit_status listener ok-no-process
  else
    emit_status listener failed
    printf '%s\t%s\n' '__SPNI_WARNING__' '监听端口读取失败。'
  fi

  printf '%s\n' '__SPNI_NETSTAT_ESTABLISHED__'
  if "$netstat_bin" -ntup >/dev/null 2>&1; then
    "$netstat_bin" -ntup 2>/dev/null | head -n "$row_limit"
    emit_status connection ok
  elif "$netstat_bin" -ntu >/dev/null 2>&1; then
    "$netstat_bin" -ntu 2>/dev/null | head -n "$row_limit"
    emit_status connection ok-no-process
  else
    emit_status connection failed
    printf '%s\t%s\n' '__SPNI_WARNING__' '已读取监听端口，但活动连接读取失败。'
  fi

  emit_docker_snapshot || true
  emit_interfaces
  exit 0
fi

printf '%s proc\n' '__SPNI_STRATEGY__'
printf '%s\n' '__SPNI_PROC__'
proc_status=failed
if [ -r /proc/net/tcp ]; then
  proc_status=ok
  tail -n +2 /proc/net/tcp 2>/dev/null | while read -r sl local remote state txrx tr tm retr uid timeout inode rest; do
    printf 'PROC_SOCKET\t%s\t%s\t%s\t%s\t%s\n' "tcp" "$local" "$remote" "$state" "$inode"
  done
fi
if [ -r /proc/net/tcp6 ]; then
  proc_status=ok
  tail -n +2 /proc/net/tcp6 2>/dev/null | while read -r sl local remote state txrx tr tm retr uid timeout inode rest; do
    printf 'PROC_SOCKET\t%s\t%s\t%s\t%s\t%s\n' "tcp6" "$local" "$remote" "$state" "$inode"
  done
fi
if [ -r /proc/net/udp ]; then
  proc_status=ok
  tail -n +2 /proc/net/udp 2>/dev/null | while read -r sl local remote state txrx tr tm retr uid timeout inode rest; do
    printf 'PROC_SOCKET\t%s\t%s\t%s\t%s\t%s\n' "udp" "$local" "$remote" "$state" "$inode"
  done
fi
if [ -r /proc/net/udp6 ]; then
  proc_status=ok
  tail -n +2 /proc/net/udp6 2>/dev/null | while read -r sl local remote state txrx tr tm retr uid timeout inode rest; do
    printf 'PROC_SOCKET\t%s\t%s\t%s\t%s\t%s\n' "udp6" "$local" "$remote" "$state" "$inode"
  done
fi
emit_status listener "$proc_status"
emit_status connection "$proc_status"
emit_status counter unavailable

for proc in /proc/[0-9]*; do
  [ -d "$proc" ] || continue
  pid=${proc##*/}
  comm=$(cat "$proc/comm" 2>/dev/null | tr '\t\r\n' '   ' | cut -c 1-80)
  [ -n "$comm" ] || comm=''
  for fd in "$proc"/fd/*; do
    target=$(readlink "$fd" 2>/dev/null || true)
    case "$target" in
      socket:\[*\])
        inode=${target#socket:[}
        inode=${inode%]}
        [ -n "$inode" ] && printf 'PROC_OWNER\t%s\t%s\t%s\n' "$inode" "$pid" "$comm"
        ;;
    esac
  done
done
ss_bin=$(find_tool ss /usr/sbin/ss /sbin/ss /usr/bin/ss /bin/ss || true)
emit_docker_snapshot || true
emit_interfaces
`

const (
	snapshotScopeFull = "full"
	snapshotScopeHost = "host"
)

func snapshotCommandForScope(scope string) string {
	if normalizeSnapshotScope(scope) != snapshotScopeHost {
		return snapshotCommand
	}
	command := removeShellBlock(snapshotCommand, "# __SPNI_DOCKER_HELPERS_BEGIN__", "# __SPNI_DOCKER_HELPERS_END__")
	command = strings.ReplaceAll(command, "  emit_docker_snapshot || true\n", "")
	command = strings.ReplaceAll(command, "emit_docker_snapshot || true\n", "")
	return command
}

func normalizeSnapshotScope(scope string) string {
	if strings.EqualFold(strings.TrimSpace(scope), snapshotScopeHost) {
		return snapshotScopeHost
	}
	return snapshotScopeFull
}

func removeShellBlock(command, beginMarker, endMarker string) string {
	begin := strings.Index(command, beginMarker)
	if begin < 0 {
		return command
	}
	end := strings.Index(command[begin:], endMarker)
	if end < 0 {
		return command
	}
	end += begin + len(endMarker)
	if end < len(command) && command[end] == '\n' {
		end++
	}
	return command[:begin] + command[end:]
}
