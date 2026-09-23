# Upstream maintenance

`upstream.json` records the exact CodexBar commit and relevant paths reviewed for the OpenCode Go collector. The weekly workflow compares this SHA to upstream HEAD and writes a summary of changed relevant files. It neither copies code nor modifies the manifest or opens an automatic port PR. Review upstream source, fixtures, licensing and current OpenCode V2 integration APIs before updating collectors and the pin together. Re-run mocked transport tests and CI before merging.

Source references: [Go usage fetcher](https://github.com/steipete/CodexBar/blob/efaee7a372139beaf93b4206c08865d750b60e7c/Sources/CodexBarCore/Providers/OpenCodeGo/OpenCodeGoUsageFetcher.swift), [Go notes](https://github.com/steipete/CodexBar/blob/efaee7a372139beaf93b4206c08865d750b60e7c/docs/opencode.md), [V2 plugin guide](https://opencode.ai/v2/docs/build/plugins), [V2 RPC guide](https://opencode.ai/v2/docs/build/plugins/rpc).
