#!/usr/bin/env python3
"""Read-only pilot preflight. Never modifies services, ports, keys or files."""
import argparse
import base64
import hashlib
import json
import os
import shutil
import socket
import subprocess
from pathlib import Path


DOCKER_SOCKET = 'unix:///var/run/docker.sock'
DOCKER_OVERRIDES = ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'DOCKER_API_VERSION')
PILOT_PROJECT = 'pinterest-research-pilot'


def command(args):
    environment = dict(os.environ)
    if args[0] == 'docker':
        for name in DOCKER_OVERRIDES:
            environment.pop(name, None)
        args = ['docker', '--host', DOCKER_SOCKET, *args[1:]]
    result = subprocess.run(args, env=environment, capture_output=True, text=True, timeout=10, check=True)
    return result.stdout.strip()


def assess(facts, expected):
    problems = []
    if facts.get('hostname') != expected['hostname']:
        problems.append('hostname_mismatch')
    if expected['ip'] not in facts.get('global_ipv4', []):
        problems.append('ip_mismatch')
    if facts.get('hostkey_sha256') != expected['fingerprint']:
        problems.append('hostkey_mismatch')
    if facts.get('disk_used_percent', 100) >= 90 or facts.get('disk_free_bytes', 0) < 4 * 1024**3:
        problems.append('insufficient_disk')
    if facts.get('docker_disk_used_percent', 100) >= 90 or facts.get('docker_disk_free_bytes', 0) < 4 * 1024**3:
        problems.append('insufficient_docker_disk')
    if facts.get('memory_available_bytes', 0) < 2 * 1024**3:
        problems.append('insufficient_memory')
    if facts.get('docker_local_socket') is not True or facts.get('docker_daemon_name') != facts.get('hostname'):
        problems.append('docker_identity_mismatch')
    if facts.get('docker_ready') is not True:
        problems.append('docker_unavailable')
    if facts.get('compose_ready') is not True:
        problems.append('compose_unavailable')
    if facts.get('port_check_complete') is not True or expected['port'] in facts.get('listening_tcp_ports', []):
        problems.append('port_unavailable')
    if facts.get('existing_pilot_resources'):
        problems.append('existing_pilot_requires_inspection')
    if facts.get('probe_errors'):
        problems.append('incomplete_probe')
    return {'ready_for_loopback_pilot': not problems, 'blockers': problems}


def pilot_resources():
    found = set()
    for kind, listing, exact, format_string in [
        ('container', ['docker', 'ps', '-a'], PILOT_PROJECT+'-research-1', '{{.Names}}'),
        ('volume', ['docker', 'volume', 'ls'], PILOT_PROJECT+'_research_data', '{{.Name}}'),
        ('network', ['docker', 'network', 'ls'], PILOT_PROJECT+'_default', '{{.Name}}'),
    ]:
        labeled = command([*listing, '--filter', 'label=com.docker.compose.project='+PILOT_PROJECT, '--format', format_string]).splitlines()
        exact_matches = [name for name in command([*listing, '--format', format_string]).splitlines() if name == exact]
        found.update(kind+':'+name for name in labeled+exact_matches)
    return sorted(found)


def collect():
    facts = {'hostname': socket.gethostname(), 'probe_errors': []}
    def probe(name, callback):
        try:
            facts[name] = callback()
        except (OSError, ValueError, KeyError, IndexError, StopIteration, subprocess.SubprocessError):
            facts['probe_errors'].append(name)
    probe('global_ipv4', lambda: [addr['local'] for interface in json.loads(command(['ip', '-j', '-4', 'address', 'show', 'scope', 'global'])) for addr in interface.get('addr_info', []) if addr.get('family') == 'inet'])
    def fingerprint():
        fields = Path('/etc/ssh/ssh_host_ed25519_key.pub').read_text().split()
        if fields[0] != 'ssh-ed25519':
            raise ValueError('Unexpected host key type')
        return 'SHA256:' + base64.b64encode(hashlib.sha256(base64.b64decode(fields[1], validate=True)).digest()).decode().rstrip('=')
    probe('hostkey_sha256', fingerprint)
    try:
        disk = shutil.disk_usage('/')
        available = os.statvfs('/').f_bavail * os.statvfs('/').f_frsize
        facts.update(disk_free_bytes=available, disk_used_percent=(disk.total-available) * 100 / disk.total)
    except OSError:
        facts['probe_errors'].append('disk')
    probe('memory_available_bytes', lambda: int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))) * 1024)
    def docker_disk():
        directory = command(['docker', 'info', '--format', '{{.DockerRootDir}}'])
        disk = shutil.disk_usage(directory)
        available = os.statvfs(directory).f_bavail * os.statvfs(directory).f_frsize
        facts.update(docker_disk_free_bytes=available, docker_disk_used_percent=(disk.total-available)*100/disk.total)
        return True
    probe('docker_storage_check_complete', docker_disk)
    probe('existing_pilot_resources', pilot_resources)
    probe('docker_local_socket', lambda: Path('/var/run/docker.sock').is_socket())
    probe('docker_daemon_name', lambda: command(['docker', 'info', '--format', '{{.Name}}']))
    probe('docker_ready', lambda: bool(command(['docker', 'info', '--format', '{{.ServerVersion}}'])))
    probe('compose_ready', lambda: bool(command(['docker', 'compose', 'version', '--short'])))
    probe('listening_tcp_ports', lambda: sorted({int(line.split()[3].rsplit(':', 1)[1]) for line in command(['ss', '-H', '-ltn']).splitlines()}))
    facts['port_check_complete'] = 'listening_tcp_ports' in facts
    return facts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-hostname', required=True)
    parser.add_argument('--expected-ip', required=True)
    parser.add_argument('--expected-hostkey-sha256', required=True)
    parser.add_argument('--port', required=True, type=int)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('Choose an unprivileged port from 1024 to 65535')
    expected = {'hostname': args.expected_hostname, 'ip': args.expected_ip, 'fingerprint': args.expected_hostkey_sha256, 'port': args.port}
    facts = collect()
    report = {'schema': 'research.pilot-preflight.v1', **assess(facts, expected), 'facts': facts, 'port': args.port, 'changes_made': False}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report['ready_for_loopback_pilot'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
