# Dependencies and artwork

The project license applies to Together's own source. It does not replace dependency licenses. Dependencies are pinned in package-lock.json; DEPENDENCY-LICENSES.csv records its package/version/license fields. This inventory is not a legal clearance. The source ZIP distributes no node_modules or dependency binaries. Preserve their own notices when distributing built artifacts or binaries.

The three robot portraits are original generated assets. public/assets/ASSET-MANIFEST.json records Image Gen provenance and hashes. Design-reference images, historical screenshots, third-party courses and private transcripts are excluded. The owner decides permission to publish code and artwork.

Together uses the root MIT license. This Builder Workroom edition is published as source; runtime state and credentials remain private. No license from another Steve project is borrowed.

The Builder entry additionally pins `@agent-native/core` 0.221.0 (MIT, copyright 2026 Builder.io, Inc.) and Zod 4.3.6 in the separate `agent-native/package-lock.json`. The framework and its dependencies are installed from npm; their own licenses and notices continue to apply. The source distribution does not bundle their installed code. This narrow integration uses the official action and Fetch MCP exports while retaining Together's own local storage and authentication.
