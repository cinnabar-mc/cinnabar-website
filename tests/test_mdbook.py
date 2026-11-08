"""Check that the mdBook installer rejects unverified download content."""

import io
import hashlib
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch

import mdbook


class MdbookTests(unittest.TestCase):
    def test_windows_installs_only_the_verified_executable_from_the_release_zip(self):
        """The Windows build uses the same pinned version and archive verification."""
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as bundle:
            bundle.writestr("mdbook.exe", b"synthetic executable")
            bundle.writestr("unrelated.txt", b"not installed")
        data = archive.getvalue()
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "tools"
            with patch.object(mdbook, "DIRECTORY", directory), patch.object(mdbook.platform, "system", return_value="Windows"), patch.object(
                mdbook.platform, "machine", return_value="AMD64"
            ), patch.dict(mdbook.ARCHIVES, {("Windows", "AMD64"): ("x86_64-pc-windows-msvc", hashlib.sha256(data).hexdigest())}), patch.object(
                mdbook, "urlopen", return_value=io.BytesIO(data)
            ) as download, patch.object(mdbook.subprocess, "check_output", return_value="mdbook v" + mdbook.VERSION):
                mdbook.install()
                self.assertEqual(mdbook.binary(), directory / "mdbook.exe")
                self.assertTrue(download.call_args.args[0].endswith("-windows-msvc.zip"))
            self.assertEqual((directory / "mdbook.exe").read_bytes(), b"synthetic executable")
            self.assertEqual([path.name for path in directory.iterdir()], ["mdbook.exe"])

    def test_checksum_failure_does_not_install_an_executable(self):
        """Reject corrupted archive bytes before extracting or replacing the binary."""
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "tools"
            with patch.object(mdbook, "DIRECTORY", directory), patch.object(
                mdbook.platform, "system", return_value="Linux"
            ), patch.object(mdbook.platform, "machine", return_value="x86_64"), patch.object(
                mdbook, "urlopen", return_value=io.BytesIO(b"invalid archive")
            ):
                with self.assertRaisesRegex(RuntimeError, "SHA-256"):
                    mdbook.install()
            self.assertFalse(directory.exists())
