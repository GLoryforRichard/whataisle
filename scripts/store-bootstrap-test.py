"""Local filesystem tests; VM metadata, root-ownership and systemctl are mocked.
The install/rollback file operations are real, confined to a fresh temp tree.
No production path, service, credential or database is accessed.
"""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('bootstrap', Path(__file__).with_name('store-install-bootstrap.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BootstrapFiles(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='whataisle-bootstrap-test-')
        self.base = Path(self.temp.name)
        self.bundle = self.base / 'bootstrap/123456-abcdef123456'
        self.bundle.mkdir(parents=True, mode=0o700)
        self.asset = self.base / 'units/new-worker.service'
        self.paths = {
            'ROOT': self.bundle.parent,
            'CADDY': self.base / 'etc/Caddyfile',
            'PLATFORM': self.base / 'etc/platform.env',
            'WORKER': self.base / 'etc/new/worker.json',
            'CURRENT': self.base / 'store/current',
            'RELEASES': self.base / 'store/releases',
            'STATE_DIRECTORY': self.base / 'state/stores',
            'ROUTES': self.base / 'etc/routes',
            'ASSETS': {str(self.asset): 0o644},
            'INSTALL_DIRECTORIES': [(self.base / 'etc/new', 0o700), (self.base / 'etc/routes', 0o755)],
        }
        self.patches = [patch.object(module, key, value) for key, value in self.paths.items()]
        self.patches += [
            patch.object(module, 'root_path', lambda *args, **kwargs: None),
            patch.object(module.subprocess, 'run', side_effect=self.command),
            patch.object(module.subprocess, 'check_output', return_value='v24.18.0\n'),
        ]
        for item in self.patches:
            item.start()
        self.commands = []
        self.invalid_caddy = False
        self.original_caddy = b'wherebear.help { reverse_proxy localhost:3002 }\n'
        self.original_platform = b'DATABASE_URL="fixture-original"\n'
        self.candidate_platform = self.original_platform + b'STRIPE_PRICE_USD_MONTH="price_fixture"\n'
        module.CADDY.parent.mkdir(parents=True)
        module.CADDY.write_bytes(self.original_caddy)
        module.PLATFORM.write_bytes(self.original_platform)
        commit = 'a' * 40
        release = module.RELEASES / commit
        (release / '.next').mkdir(parents=True)
        (release / 'node_modules/next/dist/bin').mkdir(parents=True)
        (release / '.next/BUILD_ID').write_text('fixture')
        (release / 'node_modules/next/dist/bin/next').write_text('fixture')
        (release / 'store-runtime-manifest.json').write_text(json.dumps({'commit': commit, 'runtimeIdentity': 'server-env-v1', 'platformContract': 'v1', 'node': '24.18.0', 'buildPlatform': module.EXPECTED_BUILD_PLATFORM}))
        values = {
            'Caddyfile.before': self.original_caddy,
            'Caddyfile.candidate': self.original_caddy + b'import /etc/caddy/whataisle-stores/*.caddy\n',
            'platform.env.before': self.original_platform,
            'platform.env.candidate': self.candidate_platform,
            'worker.json.candidate': b'{"fixture":"not-a-secret"}\n',
            'asset-0': b'[Unit]\nDescription=isolated fixture\n',
        }
        for name, data in values.items():
            (self.bundle / name).write_bytes(data)
        self.manifest = {
            'version': 1, 'releaseCommit': commit,
            'caddyBefore': module.digest(values['Caddyfile.before']),
            'caddyAfter': module.digest(values['Caddyfile.candidate']),
            'platformBefore': module.digest(values['platform.env.before']),
            'platformAfter': module.digest(values['platform.env.candidate']),
            'workerDigest': module.digest(values['worker.json.candidate']),
            'assets': [{'destination': str(self.asset), 'mode': 0o644, 'file': 'asset-0', 'digest': module.digest(values['asset-0'])}],
        }
        (self.bundle / 'manifest.json').write_text(json.dumps(self.manifest))
        self.unrelated = self.base / 'wherebear-unrelated'
        self.unrelated.write_text('preserve current customer')

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def command(self, argv, **kwargs):
        self.commands.append(argv)
        if argv[:2] == ['systemctl', 'is-active']:
            return subprocess.CompletedProcess(argv, 3)
        if argv[:2] == ['caddy', 'validate']:
            return subprocess.CompletedProcess(argv, int(self.invalid_caddy))
        raise AssertionError('Unreviewed service command was attempted')

    def install(self):
        with contextlib.redirect_stdout(io.StringIO()):
            module.install(self.bundle, module.load_bundle(self.bundle))

    def rollback(self):
        with contextlib.redirect_stdout(io.StringIO()):
            module.rollback(self.bundle, module.load_bundle(self.bundle))

    def test_install_and_rollback_preserve_existing_files_without_activation(self):
        self.install()
        self.assertEqual(module.PLATFORM.read_bytes(), self.candidate_platform)
        self.assertTrue(module.CURRENT.is_symlink())
        self.assertEqual(module.WORKER.stat().st_mode & 0o777, 0o600)
        self.assertEqual(module.CADDY.stat().st_mode & 0o777, 0o644)
        self.rollback()
        self.assertEqual(module.CADDY.read_bytes(), self.original_caddy)
        self.assertEqual(module.PLATFORM.read_bytes(), self.original_platform)
        self.assertFalse(self.asset.exists())
        self.assertFalse(module.WORKER.exists())
        self.assertFalse(module.CURRENT.is_symlink())
        self.assertTrue((self.bundle / 'withdrawn').exists())
        self.assertEqual(self.unrelated.read_text(), 'preserve current customer')
        self.assertTrue(all(argv[1] in ['is-active', 'validate'] for argv in self.commands))

    def test_changed_configuration_refuses_install_before_any_new_asset(self):
        module.PLATFORM.write_bytes(b'changed independently')
        with self.assertRaisesRegex(RuntimeError, 'configuration changed'):
            self.install()
        self.assertFalse(self.asset.exists())
        self.assertFalse(module.CURRENT.is_symlink())
        self.assertEqual(module.CADDY.read_bytes(), self.original_caddy)

    def test_incompatible_native_artifact_refuses_install_before_any_new_asset(self):
        manifest_path = module.RELEASES / self.manifest['releaseCommit'] / 'store-runtime-manifest.json'
        runtime = json.loads(manifest_path.read_text())
        runtime['buildPlatform']['glibcVersion'] = '2.36'
        manifest_path.write_text(json.dumps(runtime))
        with self.assertRaisesRegex(RuntimeError, 'native ABI'):
            self.install()
        self.assertFalse(self.asset.exists())
        self.assertFalse(module.CURRENT.is_symlink())

    def test_failed_caddy_validation_does_not_change_configs_or_install_assets(self):
        self.invalid_caddy = True
        with self.assertRaisesRegex(RuntimeError, 'failed validation'):
            self.install()
        self.assertFalse(self.asset.exists())
        self.assertEqual(module.CADDY.read_bytes(), self.original_caddy)
        self.assertEqual(module.PLATFORM.read_bytes(), self.original_platform)

    def test_customer_state_prevents_initial_rollback(self):
        self.install()
        module.STATE_DIRECTORY.mkdir(parents=True)
        (module.STATE_DIRECTORY / 'fixture.json').write_text('{}')
        with self.assertRaisesRegex(RuntimeError, 'Provisioning has started'):
            self.rollback()
        self.assertTrue(module.WORKER.exists())
        self.assertEqual(module.PLATFORM.read_bytes(), self.candidate_platform)

    def test_unrelated_config_or_asset_edit_prevents_rollback(self):
        self.install()
        self.asset.write_text('independent operator update')
        with self.assertRaisesRegex(RuntimeError, 'Installed asset changed'):
            self.rollback()
        self.assertEqual(self.asset.read_text(), 'independent operator update')
        self.assertEqual(module.PLATFORM.read_bytes(), self.candidate_platform)

    def test_manifest_cannot_target_existing_platform_unit(self):
        self.manifest['assets'][0]['destination'] = '/etc/systemd/system/whataisle-platform.service'
        (self.bundle / 'manifest.json').write_text(json.dumps(self.manifest))
        with self.assertRaisesRegex(RuntimeError, 'Unexpected destination'):
            module.load_bundle(self.bundle)

    def test_candidate_tamper_is_rejected_by_digest(self):
        (self.bundle / 'worker.json.candidate').write_text('changed')
        with self.assertRaisesRegex(RuntimeError, 'Candidate or backup changed'):
            module.load_bundle(self.bundle)


if __name__ == '__main__':
    unittest.main(verbosity=2)
