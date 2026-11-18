// cert/meta.json needsTarballScripts: py-pycparser from this run's peer
// artifact when the pull request builds it, else its published version.
import { peerTarball } from '../../../scripts/peer-tarball.mjs';

console.log(peerTarball('py-pycparser'));
