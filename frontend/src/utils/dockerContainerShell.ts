const safeDockerContainerIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

export function buildDockerExecShellCommand(containerID: string): string {
  if (!safeDockerContainerIdPattern.test(containerID)) {
    throw new Error('Invalid Docker container id')
  }
  return `docker exec -it ${containerID} sh -lc 'if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi'\r`
}
