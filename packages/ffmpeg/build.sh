#!/usr/bin/env bash
# RETIRED: @ai-ecoverse/wasm-ffmpeg must not be built or published.
# SLICC owns the ffmpeg command; homescoop must not distribute MPEG codecs.
set -euo pipefail
echo "homescoop: packages/ffmpeg is retired (builder: retired)." >&2
echo "homescoop: do not build or publish @ai-ecoverse/wasm-ffmpeg." >&2
echo "homescoop: SLICC provides ffmpeg (core + mediabunny/WebCodecs)." >&2
exit 1
