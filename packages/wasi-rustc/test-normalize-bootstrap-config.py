import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("normalize-bootstrap-config.py")
SPEC = importlib.util.spec_from_file_location("normalize_bootstrap_config", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class NormalizeBootstrapConfigTest(unittest.TestCase):
    def test_name_section_settings_stay_in_rust_table(self):
        generated = """[rust]
debuginfo-level = 1

[target.'wasm32-wasip1']
linker = "clang"
rustflags = ["--export-table"]

[target.'x86_64-unknown-linux-gnu']
cc = "gcc"
strip = "/usr/bin/strip"
"""
        fixed = MODULE.normalize(generated, True)
        self.assertIn("[rust]\nstrip = false\ndebuginfo-level = 0", fixed)
        self.assertIn("[target.'x86_64-unknown-linux-gnu']\ncc = \"gcc\"", fixed)
        self.assertNotIn("rustflags", fixed)
        self.assertNotIn("/usr/bin/strip", fixed)
        self.assertEqual(fixed, MODULE.normalize(fixed, True))


if __name__ == "__main__":
    unittest.main()
