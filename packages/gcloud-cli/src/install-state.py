#!/usr/bin/env python3
"""Write the SDK's own install state (.install/) for the components staged.

Run at build time with the build machine's python3 (-S -B), from the staged
tree, so the files are the ones Google's installer writes: for each component,
.install/<id>.snapshot.json (InstallationManifest.MarkInstalled, through
ComponentSnapshot.WriteToFile) and .install/<id>.manifest, the component's
files as its tarball lists them, less the ones this package leaves out.
`gcloud version` and `gcloud components list` read them; the component
manager itself is off (lib/googlecloudsdk/core/config.json disable_updater).

  python3 -S -B install-state.py <sdk root> <components-vX.json> <id>=<file list> ...
"""
import os
import sys


def main():
    root, manifest, *pairs = sys.argv[1:]
    sys.path.insert(0, os.path.join(root, "lib", "third_party"))
    sys.path.insert(0, os.path.join(root, "lib"))
    from googlecloudsdk.core.updater import local_state, snapshots

    snapshot = snapshots.ComponentSnapshot.FromFile(manifest)
    state = os.path.join(root, local_state.InstallationState.STATE_DIR_NAME)
    os.makedirs(state, exist_ok=True)
    for pair in pairs:
        cid, listing = pair.split("=", 1)
        with open(listing, encoding="utf-8") as f:
            names = [line.rstrip("\n") for line in f if line.strip()]
        shipped = [n for n in names if n.endswith("/") or os.path.isfile(os.path.join(root, n))]
        local_state.InstallationManifest(state, cid).MarkInstalled(snapshot, shipped)
        print(f"  .install/{cid}: {sum(not n.endswith('/') for n in shipped)} files")


if __name__ == "__main__":
    main()
