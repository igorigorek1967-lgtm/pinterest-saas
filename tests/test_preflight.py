import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('preflight', Path(__file__).parents[1] / 'scripts/research/preflight.py')
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.expected = dict(hostname='test-host', ip='192.0.2.1', fingerprint='SHA256:test-fixture', port=3039)
        self.facts = dict(hostname='test-host', global_ipv4=['192.0.2.1'], hostkey_sha256='SHA256:test-fixture', disk_used_percent=80, disk_free_bytes=10*1024**3, memory_available_bytes=4*1024**3, docker_disk_free_bytes=10*1024**3, docker_disk_used_percent=80, existing_pilot_resources=[], docker_ready=True, docker_local_socket=True, docker_daemon_name='test-host', compose_ready=True, port_check_complete=True, listening_tcp_ports=[22,443], probe_errors=[])

    def test_matching_host_with_available_resources_is_ready(self):
        self.assertTrue(preflight.assess(self.facts, self.expected)['ready_for_loopback_pilot'])

    def test_wrong_host_or_hostkey_never_passes(self):
        for field, wrong in [('hostname','other-host'), ('global_ipv4',['192.0.2.2']), ('hostkey_sha256','SHA256:other')]:
            with self.subTest(field=field):
                self.assertFalse(preflight.assess({**self.facts,field:wrong},self.expected)['ready_for_loopback_pilot'])

    def test_missing_observations_fail_closed(self):
        self.assertFalse(preflight.assess({}, self.expected)['ready_for_loopback_pilot'])
        self.assertFalse(preflight.assess({**self.facts,'probe_errors':['port']},self.expected)['ready_for_loopback_pilot'])

    def test_storage_boundary_and_occupied_port(self):
        for patch in [dict(disk_used_percent=90),dict(disk_free_bytes=4*1024**3-1),dict(memory_available_bytes=2*1024**3-1),dict(listening_tcp_ports=[3039]),dict(port_check_complete=False),dict(docker_ready=False),dict(compose_ready=False),dict(existing_pilot_resources=['existing-volume']),dict(docker_disk_used_percent=90),dict(docker_disk_free_bytes=0),dict(docker_local_socket=False),dict(docker_daemon_name='another-server')]:
            with self.subTest(patch=patch):
                self.assertFalse(preflight.assess({**self.facts,**patch},self.expected)['ready_for_loopback_pilot'])

    def test_remote_docker_environment_cannot_change_the_endpoint(self):
        with patch.dict(preflight.os.environ, {'DOCKER_HOST':'tcp://192.0.2.2:2375','DOCKER_CONTEXT':'remote-fixture'}):
            with patch.object(preflight.subprocess, 'run', return_value=Mock(stdout='fixture')) as run:
                preflight.command(['docker','info'])
                args, kwargs = run.call_args
                self.assertEqual(args[0][:3], ['docker','--host','unix:///var/run/docker.sock'])
                self.assertNotIn('DOCKER_CONTEXT',kwargs['env'])
                self.assertNotIn('DOCKER_HOST',kwargs['env'])

    def test_unlabeled_volume_and_network_names_are_detected(self):
        def output(args):
            if '--filter' in args:
                return ''
            if args[1:3] == ['volume','ls']:
                return 'pinterest-research-pilot_research_data'
            if args[1:3] == ['network','ls']:
                return 'pinterest-research-pilot_default'
            return ''
        with patch.object(preflight,'command',side_effect=output):
            self.assertEqual(preflight.pilot_resources(),['network:pinterest-research-pilot_default','volume:pinterest-research-pilot_research_data'])
