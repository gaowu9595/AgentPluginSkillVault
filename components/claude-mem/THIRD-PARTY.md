# Third-party notices and corresponding-source status

Evidence date: 2026-11-13. Scope: Vault claude-mem component 1.0.0 using the
prepared claude-mem 15.17.0 Windows x64 runtime, Node.js 24.11.1 and Bun 1.4.4.
The fixed input is 312976919 bytes, SHA256
`9e407ea2c0b907bb40c0e77513de7b5fc33a1421596fbdd6cb9c1db0c826495c`.
This document records evidence and remaining obligations; it does not certify
legal clearance or constitute a written source offer.

The integration permits upstream no-model manual save on Claude Code and Codex.
Codex automatic capture remains deferred. Disabling an optional runtime feature
does not remove licensing obligations for code still distributed in the package.

## Notices and license texts included

- `NOTICE` is the exact public claude-mem 15.17.0 NOTICE, including
  "Copyright 2026 Alex Newman". Its SHA256 is
  `35003c303ee484c77872fd45eb5d590ce679d1ae7ac5bb672d33069cca66685b`.
  It was copied from the verified prepared public npm package, not user data.
- Retain the runtime's `LICENSES/claude-mem.txt` (Apache-2.0),
  `LICENSES/node.txt` (Node and bundled-library notices) and
  `LICENSES/bun.txt` (Bun and linked-library notices), plus dependency notices,
  README license tables, copyright notices and bundled JavaScript license comments.
- `licenses/LGPL-2.0.txt`, `LGPL-2.1.txt`, `LGPL-3.0.txt`,
  `GPL-2.0.txt` and `GPL-3.0.txt` contain full license texts.
  LGPL 2.0 uses the historical name "GNU Library General Public License".
  GPL texts accompany LGPL references; they do not relicense the Vault adapter.
- `licenses/WebKit-JavaScriptCore-COPYING.LIB` preserves the actual pinned
  JavaScriptCore license file and its additional introductory notice.
  `licenses/libvips-8.18.7-LICENSE.txt` preserves the pinned libvips license.
  `licenses/MPL-1.1.txt` accompanies the Cairo entry in Sharp's Windows notices.
- `licenses/SOURCE-REFERENCES.json` records verified references, text hashes,
  binary dependency inventories, failed lookups and uncollected source archives.
  A license-text hash is not a source-tarball hash.

For claude-mem Apache-2.0 redistribution, supply the license and NOTICE
attributions, retain applicable source notices, and identify modifications
prominently in modified files. Record adapter and packaging changes separately;
do not edit the preserved upstream NOTICE. Apache-2.0 grants no general right to
claim endorsement or use upstream trademarks beyond its stated allowances.
The component's own LICENSE does not replace third-party licenses.

## Bun 1.4.4 and JavaScriptCore

The public [bun-v1.4.4 tag](https://github.com/oven-sh/bun/tree/bun-v1.4.4)
resolved to commit `38afee6c84fcf48c0edb2466aa4b27d287a59c30`.
Its [package.json](https://github.com/oven-sh/bun/blob/38afee6c84fcf48c0edb2466aa4b27d287a59c30/package.json)
reports 1.4.4. The [pinned WebKit build recipe](https://github.com/oven-sh/bun/blob/38afee6c84fcf48c0edb2466aa4b27d287a59c30/scripts/build/deps/webkit.ts)
sets `WEBKIT_VERSION=d6375c72affe0f70222cdcb45012b10f0bf3a9d5`.
The [pinned upstream license](https://github.com/oven-sh/bun/blob/38afee6c84fcf48c0edb2466aa4b27d287a59c30/LICENSE.md)
states that Bun statically links JavaScriptCore/WebKit under LGPL terms.

Exact source archive references, not downloaded source companions:

- Bun: <https://codeload.github.com/oven-sh/bun/tar.gz/38afee6c84fcf48c0edb2466aa4b27d287a59c30>
- Patched WebKit: <https://codeload.github.com/oven-sh/WebKit/tar.gz/d6375c72affe0f70222cdcb45012b10f0bf3a9d5>

Relink/rebuild procedure from the
[pinned CONTRIBUTING.md](https://github.com/oven-sh/bun/blob/38afee6c84fcf48c0edb2466aa4b27d287a59c30/CONTRIBUTING.md)
and package scripts:

1. Unpack the pinned Bun sources into a separate build directory. Install the
   matching Windows compiler/build prerequisites described by that revision.
2. Unpack the pinned WebKit sources into `vendor/WebKit` under that directory,
   or select that directory with `BUN_WEBKIT_PATH`. Apply the desired library
   modifications there. Do not update or modify an existing partial Git clone.
3. Use `bun run build:local` for the local debug build, or
   `bun run build:release:local` for the local release build. These are actual
   scripts in the pinned package.json and build JSC together with Bun.
   They require a separately prepared development environment; these are not
   commands to run during component installation.
4. Place the resulting Windows executable at `bin/bun.exe` in a separate
   recipient-owned source runtime. Follow the variant identity and pins
   procedure below before building/selecting that component. The unchanged
   Vault release rejects modified input bytes. Preserve the original managed
   runtime and user memory data.

Because JSC is statically linked, replacing a JSC DLL alone is not a relink
solution. Before redistribution, select and fulfil an applicable LGPL route,
including the required corresponding library source and application
source/object/relink materials, scripts and notices. The upstream source links
and these instructions alone do not prove that route has been fulfilled.
The full Windows toolchain, transitive source availability, relink output and
component acceptance of a rebuilt Bun have not been verified here.
Vault omits the prior host's `bin/claude-mem.exe`; shipping any Bun-compiled
launcher later requires the same assessment for that additional executable.

## Sharp 0.35.5 and libvips 8.18.7

The [Sharp v0.35.5 tag](https://github.com/lovell/sharp/tree/v0.35.5) peels through
annotated tag `9aac0c92b97e11d4e7d189ba81046271826118cf` to commit
`51a990faa26ade5586a4934ac9673c98d8893326`.
The [libvips v8.18.7 tag](https://github.com/libvips/libvips/tree/v8.18.7)
resolves to `24ad4d042940e6bf99a68871ba886ca8847c9c82`.
These source references match the version labels in the prepared binary
inventories; exact binary reproduction and downstream patch equivalence remain
unverified.

- Sharp sources: <https://codeload.github.com/lovell/sharp/tar.gz/51a990faa26ade5586a4934ac9673c98d8893326>
- libvips sources: <https://codeload.github.com/libvips/libvips/tar.gz/24ad4d042940e6bf99a68871ba886ca8847c9c82>
- Sharp build entry: [install/build.js](https://github.com/lovell/sharp/blob/51a990faa26ade5586a4934ac9673c98d8893326/install/build.js)
- libvips build entry: [meson.build](https://github.com/libvips/libvips/blob/24ad4d042940e6bf99a68871ba886ca8847c9c82/meson.build)

The runtime's `plugin/node_modules/@img/sharp-win32-x64/package.json` declares
`Apache-2.0 AND LGPL-3.0-or-later`; its sibling `README.md` lists libvips,
GLib, librsvg, Pango and other LGPL-covered libraries, plus Cairo under MPL-1.1.
The `@img/sharp-wasm32` package additionally declares MIT. Preserve each
package's `LICENSE`, `README.md` and `versions.json`.
The source index retains both exact binary version inventories, including
Emscripten 6.0.10 for WASM; an upstream libvips tarball alone does not cover every
library embedded in those prebuilt artifacts.

Replacement/relink procedure and limits:

1. Prepare libvips 8.18.7 sources, all required dependency sources/patches and
   build tools for the target architecture. Build/install into a separate
   prefix using its Meson build. Preserve library versions/ABI compatibility
   with the Sharp package. Exact supplier flags and patch sets remain a gap.
2. In a separate runtime copy, the Windows library files are
   `plugin/node_modules/@img/sharp-win32-x64/lib/libvips-42.dll` and
   `libvips-cpp-8.18.7.dll`. Replace the compatible rebuilt libraries there.
   Rebuild the Sharp native binding from the pinned source using its
   `npm run build` entry if required by the modified library ABI; retain the
   appropriate Node/N-API and architecture.
3. The WASM artifact `@img/sharp-wasm32/lib/sharp-wasm32-0.35.5.node.wasm`
   does not support DLL replacement. Rebuild the complete linked WASM artifact
   and any required wrapper using the pinned sources and matching Emscripten.
   The exact supplier WASM build/patch recipe has not been established.
4. Follow the recipient variant identity and pins procedure below, then select
   the resulting component explicitly. Do not overwrite the shared immutable
   installation or represent its expected hash conflict as proof that
   replacement is supported.

LGPL redistribution requires an applicable corresponding-source and
replacement/relink arrangement, including any required combined-work notices
and terms that permit modification and reverse engineering for debugging those
modifications. MPL-covered files have their own source-availability obligations.
Do not apply blanket restrictions that remove those rights.

The public `lovell/sharp-libvips` reference `v8.18.7` returned HTTP 404
during this investigation. Do not substitute its older v8.16.1 release for
8.18.7. The direct libvips reference above is verified, but is not evidence of
the complete patched source/build recipe for the bundled Sharp binaries.
Windows DLL replacement, native-binding rebuild and WASM relinking have not
been executed.

## Recipient variant identity and pins

A rebuilt binary is not accepted merely by changing its output manifest.
`build.py` verifies the complete input runtime archive, its source manifest,
binary dependency pins and upstream metadata against `component.json`.
It generates the output component manifest only after those input checks pass.

1. Work in a separate recipient-owned source/build/release namespace and use
   a new recipient variant release identity. Do not overwrite the published
   Vault release record or imply that the variant retains its verified hashes.
   The current builder accepts only `componentId: claude-mem` and a numeric
   `MAJOR.MINOR.PATCH` componentVersion. Use a fresh version in the recipient's
   separate namespace, or intentionally adapt builder/manager identity checks
   for a distinct componentId; an arbitrary new ID is not accepted unchanged.
2. Prepare a new source runtime archive containing the recipient modifications.
   Update its `UPSTREAM.json` to agree with the actual versions, source pins,
   profile and dependency lock. Preserve base upstream attribution/revisions
   and record local patches separately. Regenerate that input archive's
   `manifest.json` member list and every affected member SHA256, including
   changed provenance; this is not the component builder's output manifest.
3. In the recipient's `component.json`, explicitly update `componentVersion`,
   `runtimeArchive.bytes` and `runtimeArchive.sha256` for the completed source
   archive. Update `dependencies.bun` version/hash for a rebuilt Bun, `engine`
   pins if Node changes, and `dependencyLockSha256` if the lock changes. Keep
   upstream/version/profile fields consistent with the new source manifest
   and provenance. Sharp/library changes also require their source-manifest
   hashes and whole-archive pin to change, even if version labels stay the same.
4. Build and validate the recipient variant, generating new output manifest,
   archive and release checksums. Explicitly install/select that variant in
   its own managed runtime. Keep original releases and memories intact.

This is a source-level variant build route, not an implemented unpin flag or
an in-place replacement promise. A complete recipient variant build,
installation and relink/replacement journey has not been exercised here.

## Offline source companion and remaining work

Large source trees do not need to be committed to the main Git repository.
A separate offline source companion is a possible delivery mechanism, but none
has been assembled or hashed by this change.

Before treating that companion as delivered:

1. Collect the pinned Bun/WebKit and Sharp/libvips sources, the actual binary
   suppliers' patches, transitive covered sources, build recipes and any
   required relink/object materials for the selected licensing route.
2. Produce a separate immutable index recording each real archive's filename,
   byte count, SHA256, upstream URL, revision, applicable license and related
   binary/member. Resolve missing sources explicitly. Never invent a hash for
   an uncollected URL or rely on a moving branch or an old mismatched release.
3. Distribute the companion, or fulfil another permitted source-delivery method,
   alongside the binaries as required, and verify it can be used offline.
   Main-repository source references are not that delivery by themselves.
4. Exercise the recipient replacement/relink path and component integrity
   handling. Record results and limits without overwriting user data.
5. Complete the inventory/licensing review of code inlined into the worker,
   MCP and UI bundles, including Claude Agent SDK, MCP SDK and PostHog.
   Existing node_modules notices do not prove coverage of every inlined module.

This change supplies the missing claude-mem NOTICE, full license texts and
specific source references. Source-companion delivery, complete transitive
attribution, exact binary/source correspondence and tested relinking remain
open evidence gaps.
